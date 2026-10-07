import test from 'node:test';
import assert from 'node:assert/strict';
import {CloudBank} from '../public/cloud-bank.js';

test('cloud readiness requires verified Supabase user, both tables and private storage access',async()=>{
  let storageChecked=false;const bank=new CloudBank({auth:{getUser:async()=>({data:{user:{id:'verified-user'}}})},from:()=>({select:()=>({limit:async()=>({data:[]})})}),storage:{from:()=>({list:async user=>{assert.equal(user,'verified-user');storageChecked=true;return {data:[]};}})}});
  await assert.rejects(bank.check(),{code:'cloud_login_required'});
  bank.user={id:'unverified-storage-value'};await bank.check();assert.equal(bank.user.id,'verified-user');assert.equal(bank.ready,true);assert.equal(storageChecked,true);
  bank.client.from=()=>({select:()=>({limit:async()=>({error:{code:'PGRST205'}})})});
  await assert.rejects(bank.check(),{code:'PGRST205'});assert.equal(bank.ready,false);
});
test('cloud edits send expected revision and reject a lost update',async()=>{
  const filters=[];const chain={eq:(field,value)=>{filters.push([field,value]);return chain;},select:()=>chain,maybeSingle:async()=>({data:null})};
  const bank=new CloudBank({from:()=>({update:()=>chain})});
  await assert.rejects(bank.update({id:'question-a',revision:4},{source:'new'}),{code:'question_conflict'});
  assert.deepEqual(filters,[['id','question-a'],['revision',4]]);
});
test('cloud review refuses unresolved conditions before any database write',async()=>{
  const bank=new CloudBank({from:()=>assert.fail('must not write')});
  const analysis={question:'题目',answer:'答案',firstInsight:'突破口',steps:['步骤'],knowledgePoints:['知识'],mathMethods:['方法'],needsClarification:true,uncertainties:['缺图']};
  await assert.rejects(bank.review({confirmed:true,analysis}),{code:'invalid_question'});
});
test('original cloud images cannot be overwritten or repaired with mismatched bytes',async()=>{
  const bank=new CloudBank({storage:{from:()=>assert.fail('must not upload')}});
  await assert.rejects(bank.upload({imageReady:true},new Blob(['test'],{type:'image/png'})),{code:'original_immutable'});
  await assert.rejects(bank.upload({imageReady:false,size:9,mime:'image/png'},new Blob(['test'],{type:'image/png'})),{code:'image_mismatch'});
});
