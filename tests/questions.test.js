import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp, rm, readdir, readFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {createCipheriv,createDecipheriv,randomBytes} from 'node:crypto';
import http from 'node:http';
import {QuestionStore,validateAnalysis,decodeImage} from '../src/questions.js';
import {MathAI} from '../src/provider.js';
import {createApp} from '../src/server.js';
import {DIRECT_SCOPE} from '../src/oauth.js';

// Deterministic public fixture; no student photograph or credentials.
const image='data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aX1sAAAAASUVORK5CYII=';
const analysis={question:'解方程：2x + 3 = 11',expression:'2x + 3 = 11',answer:'x = 4',steps:['两边减去 3，得 2x = 8','两边除以 2，得 x = 4'],firstInsight:'先消去常数项',knowledgePoints:['一元一次方程'],mathMethods:['等式两边同加减同乘除'],difficulty:'basic',commonMistakes:['移项符号出错'],uncertainties:[],needsClarification:false};
function protector(){const key=randomBytes(32);return {async protect(bytes){const iv=randomBytes(12),cipher=createCipheriv('aes-256-gcm',key,iv);const encrypted=Buffer.concat([cipher.update(bytes),cipher.final()]);return Buffer.concat([iv,encrypted,cipher.getAuthTag()]);},async unprotect(bytes){const cipher=createDecipheriv('aes-256-gcm',key,bytes.subarray(0,12));cipher.setAuthTag(bytes.subarray(-16));return Buffer.concat([cipher.update(bytes.subarray(12,-16)),cipher.final()]);}};}
async function storeFor(t){const directory=await mkdtemp(join(tmpdir(),'mathbank-questions-'));t.after(()=>rm(directory,{recursive:true,force:true}));return new QuestionStore(directory,protector());}

test('original photo and analysis survive restart, edits keep AI provenance and stale edits conflict',async t=>{
  const store=await storeFor(t),record=await store.create({image,filename:'public.png',source:'公开例题',date:'2026-10-07'});
  const math={analyzeQuestion:async()=>({analysis,model:'account-model'})};
  const analyzed=await store.analyze(record.id,record.revision,math,'account-model');
  const reviewed=await store.review({...analyzed,confirmed:true,analysis:{...analysis,answer:'x = 4（已核对）'}});
  assert.equal(reviewed.status,'approved');assert.equal(reviewed.aiAnalysis.answer,'x = 4');
  await assert.rejects(store.review({...analyzed,analysis,confirmed:true}),{code:'question_conflict'});
  const restarted=new QuestionStore(store.directory,store.protector);
  assert.equal((await restarted.get(record.id)).analysis.answer,'x = 4（已核对）');
  assert.deepEqual((await restarted.image(record.id)).bytes,decodeImage(image).bytes);
  const listed=await restarted.list();assert.equal(listed.length,1);assert.equal(listed[0].status,'approved');assert.equal(listed[0].aiAnalysis,undefined);
  for(const file of await readdir(store.directory))assert.doesNotMatch((await readFile(join(store.directory,file))).toString(),/公开例题|解方程|iVBORw0/);
});
test('uncertain analysis cannot be approved; correction needs explicit confirmation',async t=>{
  const store=await storeFor(t),record=await store.create({image,date:'2026-10-07'});
  const uncertain={...analysis,answer:'',steps:[],uncertainties:['右侧数字不清楚'],needsClarification:true};
  const value=await store.analyze(record.id,1,{analyzeQuestion:async()=>({analysis:uncertain,model:'account-model'})},'account-model');
  assert.equal(value.status,'needs_clarification');
  await assert.rejects(store.review({...value,confirmed:true}),{code:'invalid_question'});
  await assert.rejects(store.review({...value,analysis,confirmed:false}),{code:'invalid_question'});
  const drafted=await store.draft({...value,analysis});assert.equal(drafted.status,'pending_review');assert.equal(drafted.reviewedAt,null);
  assert.equal((await store.review({...drafted,confirmed:true})).status,'approved');
});
test('analysis or network failure retains original and revision for retry',async t=>{
  const store=await storeFor(t),record=await store.create({image,date:'2026-10-07'});
  await assert.rejects(store.analyze(record.id,1,{analyzeQuestion:async()=>{throw new Error('interrupted');}},'model'));
  assert.equal((await store.get(record.id)).status,'uploaded');assert.equal((await store.get(record.id)).revision,1);
  assert.deepEqual((await store.image(record.id)).bytes,decodeImage(image).bytes);
});

test('an empty model question is retained as an incomplete draft with raw output and original photo',async t=>{
  const store=await storeFor(t),record=await store.create({image,date:'2026-10-07'});
  const raw={...analysis,question:''};
  const math=new MathAI({invoke:async()=>({text:JSON.stringify(raw)})});
  const saved=await store.analyze(record.id,1,math,'model');
  assert.equal(saved.status,'needs_clarification');assert.equal(saved.analysis.question,'');
  assert.equal(saved.analysis.needsClarification,true);assert.ok(saved.analysis.uncertainties.length);
  assert.deepEqual(saved.aiAnalysis,raw);
  const draft=await store.draft({...saved});assert.equal(draft.status,'needs_clarification');
  await assert.rejects(store.review({...draft,confirmed:true}),{code:'invalid_question'});
  assert.deepEqual((await store.image(record.id)).bytes,decodeImage(image).bytes);
  const corrected=await store.draft({...draft,analysis});assert.equal(corrected.status,'pending_review');
  assert.equal((await store.review({...corrected,confirmed:true})).status,'approved');
});
test('photo formats, path traversal and malformed AI schema are rejected',async t=>{
  const store=await storeFor(t);
  assert.throws(()=>decodeImage('data:image/jpeg;base64,aGVsbG8='),{code:'invalid_question'});
  assert.throws(()=>validateAnalysis({...analysis,mathMethods:'not an array'}),{code:'invalid_question'});
  await assert.rejects(store.get('../profile'),{code:'invalid_question'});
  await assert.rejects(store.create({image,date:'2026-02-31'}),{code:'invalid_question'});
});
test('MathAI supplies a real image input and rejects malformed completed output',async()=>{
  let sent;
  const math=new MathAI({invoke:async(model,input)=>{sent=input;return {text:JSON.stringify(analysis)};}});
  assert.deepEqual((await math.analyzeQuestion({model:'catalog-model',image})).analysis,analysis);
  assert.equal(sent[0].content[1].type,'input_image');assert.equal(sent[0].content[1].image_url,image);
  await assert.rejects(new MathAI({invoke:async()=>({text:'not JSON'})}).analyzeQuestion({model:'model',image}),{code:'invalid_analysis_json'});
});
test('a multi-question photo commits atomically, shares its original and keeps independent reviews after restart',async t=>{
  const store=await storeFor(t),uploaded=await store.create({image,source:'公开多题例图',date:'2026-10-07'});
  const second={...analysis,label:'16',question:'（1）解方程；（2）检验结果',answer:'',steps:[],uncertainties:['第二小问条件不清楚'],needsClarification:true};
  const raw={questions:[{...analysis,label:'15'},second]};
  let prompt;
  const math=new MathAI({invoke:async(_,input)=>{prompt=input[0].content[0].text;return {text:JSON.stringify(raw)};}});
  const first=await store.analyze(uploaded.id,1,math,'model');
  assert.match(prompt,/所有数学主题/);assert.match(prompt,/小问必须合并/);
  assert.equal(first.id,uploaded.id);assert.equal(first.photoCount,2);assert.equal(first.photoLabel,'15');
  const listed=await store.list(),child=listed.find(q=>q.id!==first.id);
  assert.equal(listed.length,2);assert.equal(child.status,'needs_clarification');
  assert.equal((await readdir(store.directory)).filter(f=>f.endsWith('.image.dpapi')).length,1);
  const restarted=new QuestionStore(store.directory,store.protector);
  assert.deepEqual((await restarted.get(child.id)).aiAnalysis,second);
  assert.deepEqual((await restarted.image(child.id)).bytes,(await restarted.image(first.id)).bytes);
  const approved=await restarted.review({...first,confirmed:true});assert.equal(approved.status,'approved');
  const other=await restarted.get(child.id);assert.equal(other.status,'needs_clarification');
  await assert.rejects(restarted.review({...other,confirmed:true}),{code:'invalid_question'});
  let target;
  const reanalyzed=await restarted.analyze(other.id,other.revision,{analyzeQuestion:async args=>{target=args.target;return {analysis,model:'model'};}},'model');
  assert.deepEqual(target,{index:2,label:'16'});assert.equal(reanalyzed.status,'pending_review');
  assert.equal((await restarted.list()).length,2);assert.equal((await restarted.get(first.id)).status,'approved');
  assert.equal((await restarted.get(first.id)).revision,approved.revision);
});
test('a malformed batch or failed encrypted commit leaves the original record intact',async t=>{
  const store=await storeFor(t),uploaded=await store.create({image,date:'2026-10-07'});
  const math={analyzeQuestion:async()=>({model:'model',analyses:[{analysis},{analysis:{...analysis,steps:'invalid'}}]})};
  await assert.rejects(store.analyze(uploaded.id,1,math,'model'),{code:'invalid_question'});
  assert.equal((await store.get(uploaded.id)).revision,1);assert.equal((await store.list()).length,1);
  const normal=store.protector.protect;
  store.protector.protect=async bytes=>{if(bytes.toString().includes('photo_batch'))throw new Error('simulated storage failure');return normal(bytes);};
  await assert.rejects(store.analyze(uploaded.id,1,{analyzeQuestion:async()=>({model:'model',analyses:[{analysis},{analysis}]})},'model'),/storage failure/);
  assert.equal((await store.get(uploaded.id)).status,'uploaded');assert.equal((await store.list()).length,1);
  assert.deepEqual((await store.image(uploaded.id)).bytes,decodeImage(image).bytes);
});
test('oversized and empty multi-question responses are not silently truncated',async()=>{
  for(const raw of [{questions:[]},{questions:Array(21).fill({...analysis,label:'1'})},{tooManyQuestions:true,questions:[]}]) {
    await assert.rejects(new MathAI({invoke:async()=>({text:JSON.stringify(raw)})}).analyzeQuestion({model:'model',image}));
  }
});
test('HTTP upload, analysis, draft and approval use verified selected subscription model',async t=>{
  const store=await storeFor(t),server=http.createServer();server.listen(0,'127.0.0.1');await new Promise(resolve=>server.once('listening',resolve));t.after(()=>server.close());
  const origin=`http://127.0.0.1:${server.address().port}`;
  const vault={data:{model:'selected-model',verifiedAt:'2026-10-07',credential:{access:'test-token',expires:Date.now()+3600000,scopes:[DIRECT_SCOPE]}},save:async()=>{}};
  const app=createApp({vault,origin,questionStore:store,fetchImpl:async(url,init)=>{
    if(url.endsWith('/models'))return Response.json({models:[{slug:'selected-model',visibility:'list'}]});
    const body=JSON.parse(init.body);assert.equal(body.model,'selected-model');assert.equal(body.input[0].content[1].image_url,image);
    return new Response(`data: ${JSON.stringify({type:'response.completed',response:{output:[{content:[{type:'output_text',text:JSON.stringify(analysis)}]}]}})}\n\n`);
  }});server.on('request',app.handler);
  const status=await fetch(`${origin}/api/status`),csrf=(await status.json()).csrf,cookie=status.headers.get('set-cookie').split(';')[0];
  const post=async(path,data)=>{const response=await fetch(origin+path,{method:'POST',headers:{Cookie:cookie,Origin:origin,'X-CSRF-Token':csrf,'Content-Type':'application/json'},body:JSON.stringify(data)});return {status:response.status,...await response.json()};};
  assert.equal((await fetch(`${origin}/api/questions`,{headers:{'Sec-Fetch-Site':'cross-site'}})).status,403);
  const uploaded=await post('/api/questions',{image,source:'来源中文',date:'2026-10-07'});assert.equal(uploaded.status,201);
  const analyzed=await post('/api/questions/analyze',{id:uploaded.question.id,revision:1});assert.equal(analyzed.status,200);
  const reviewed=await post('/api/questions/review',{...analyzed.question,confirmed:true});assert.equal(reviewed.question.status,'approved');
  const picture=await fetch(`${origin}/api/questions/${reviewed.question.id}/image`,{headers:{Cookie:cookie}});assert.deepEqual(Buffer.from(await picture.arrayBuffer()),decodeImage(image).bytes);
  vault.data.verifiedAt=null;assert.equal((await post('/api/questions/analyze',{id:uploaded.question.id,revision:3})).status,400);
});
