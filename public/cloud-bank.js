import {createClient} from '@supabase/supabase-js';
import {cloudConfig} from './cloud-config.js';

const BUCKET='math-originals';
const fail=(message,code='cloud_bank')=>Object.assign(new Error(message),{stage:'cloud_bank',code});
function checked(result) {
  const messages={email_address_not_authorized:'Supabase 默认邮件服务无法向此邮箱发送登录邮件。请为项目配置自定义 SMTP，继续使用你的家庭邮箱。',over_email_send_rate_limit:'登录邮件发送次数已达限制，请稍后重试。',otp_expired:'验证码已过期或无效，请检查邮件中的最新验证码。',validation_failed:'请检查邮箱地址或验证码。',PGRST205:'云端题库尚未建表，请完成 Supabase 初始化。','42P01':'云端题库尚未建表，请完成 Supabase 初始化。','42501':'题库权限检查失败，请检查家庭登录和 RLS 配置。'};
  if(result.error) throw fail(messages[result.error.code] || '云端操作未完成，请检查连接或重新登录。',result.error.code || 'cloud_request_failed');
  return result.data;
}
function record(row, raw=null) {
  return {id:row.id,source:row.source,date:row.source_date,filename:row.filename,mime:row.image_mime,size:row.image_bytes,
    status:row.status,revision:row.revision,analysis:row.analysis,aiAnalysis:raw?.raw_analysis,model:raw?.model,
    analyzedAt:raw?.created_at,reviewedAt:row.reviewed_at,createdAt:row.created_at,imageReady:row.image_ready,imagePath:row.image_path,ownerId:row.owner_id,
    difficulty:row.analysis?.difficulty,knowledgePoints:row.analysis?.knowledgePoints ?? [],mathMethods:row.analysis?.mathMethods ?? []};
}
function imageBlob(value) {
  const match=/^data:image\/(jpeg|png|webp);base64,([A-Za-z0-9+/]+={0,2})$/.exec(value ?? '');
  if(!match)throw fail('照片格式不正确。','invalid_image');
  const bytes=Uint8Array.from(atob(match[2]),char=>char.charCodeAt(0));
  if(!bytes.length || bytes.length>8*1024*1024)throw fail('照片大小需在 8 MB 以内。','invalid_image');
  const signature=match[1]==='png'?[137,80,78,71,13,10,26,10].every((byte,index)=>bytes[index]===byte):match[1]==='jpeg'?bytes[0]===255 && bytes[1]===216 && bytes[2]===255:new TextDecoder().decode(bytes.slice(0,4))==='RIFF' && new TextDecoder().decode(bytes.slice(8,12))==='WEBP';
  if(!signature)throw fail('照片内容与声明的格式不匹配。','invalid_image');
  return new Blob([bytes],{type:`image/${match[1]}`});
}
const dataUrl=blob=>new Promise((resolve,reject)=>{const reader=new FileReader();reader.onload=()=>resolve(reader.result);reader.onerror=()=>reject(fail('照片读取失败。'));reader.readAsDataURL(blob);});

export class CloudBank {
  constructor(client=createClient(cloudConfig.url,cloudConfig.key,{auth:{flowType:'pkce',detectSessionInUrl:true}})) {this.client=client;this.user=null;this.ready=false;this.enabled=false;}
  async initialize() {
    const {data,error}=await this.client.auth.getSession();if(error)throw fail('题库登录状态读取失败。');
    this.user=data.session?.user ?? null;
  }
  async sendLogin(email) {checked(await this.client.auth.signInWithOtp({email,options:{emailRedirectTo:`${location.origin}/#settings`}}));}
  async verify(email,token) {const data=checked(await this.client.auth.verifyOtp({email,token,type:'email'}));this.user=data.user;}
  async signOut() {checked(await this.client.auth.signOut());this.user=null;this.ready=false;this.enabled=false;}
  async check() {
    this.ready=false;
    if(!this.user)throw fail('请先登录家庭题库账号。','cloud_login_required');
    this.user=checked(await this.client.auth.getUser()).user;
    checked(await this.client.from('math_questions').select('id').limit(1));
    checked(await this.client.from('math_question_analyses').select('id').limit(1));
    checked(await this.client.storage.from(BUCKET).list(this.user.id,{limit:1}));
    this.ready=true;
  }
  async list() {return checked(await this.client.from('math_questions').select('id,source,source_date,status,analysis,created_at,image_ready').order('created_at',{ascending:false}).limit(100)).map(row=>({...record(row),question:row.analysis?.question ?? ''}));}
  async get(id) {
    const row=checked(await this.client.from('math_questions').select('*').eq('id',id).single());
    const raw=row.latest_analysis_id?checked(await this.client.from('math_question_analyses').select('*').eq('id',row.latest_analysis_id).single()):null;
    // Recover a completed photo upload whose final metadata acknowledgement failed.
    if(!row.image_ready) {
      const result=await this.client.storage.from(BUCKET).download(row.image_path);
      if(!result.error){const updated=checked(await this.client.from('math_questions').update({image_ready:true}).eq('id',id).eq('revision',row.revision).select().maybeSingle());if(updated)Object.assign(row,updated);}
    }
    return record(row,raw);
  }
  async imageUrl(value) {const data=checked(await this.client.storage.from(BUCKET).createSignedUrl(value.imagePath,300));return data.signedUrl;}
  async create(value) {
    const blob=imageBlob(value.image), id=crypto.randomUUID();
    const extension=blob.type==='image/jpeg'?'jpg':blob.type.split('/')[1];
    const row=checked(await this.client.from('math_questions').insert({id,owner_id:this.user.id,source:value.source,source_date:value.date,filename:value.filename,image_mime:blob.type,image_bytes:blob.size,image_path:`${this.user.id}/${id}/original.${extension}`}).select().single());
    try {await this.upload(record(row),blob);return await this.get(id);}
    catch(error){error.message+=' 记录已保留，可在题库中打开后补传原图。';throw error;}
  }
  async upload(value,blob) {
    if(value.imageReady)throw fail('原图已经保存，不可覆盖。','original_immutable');
    if(blob.size!==value.size || blob.type!==value.mime)throw fail('补传照片的类型和大小必须与首次选择一致。','image_mismatch');
    checked(await this.client.storage.from(BUCKET).upload(value.imagePath,blob,{upsert:false,contentType:blob.type}));
    const updated=checked(await this.client.from('math_questions').update({image_ready:true}).eq('id',value.id).eq('revision',value.revision).select().maybeSingle());
    if(!updated)throw fail('题目已被更新，请重新打开。','question_conflict');
  }
  async repair(value,image) {await this.upload(value,imageBlob(image));return this.get(value.id);}
  async update(value,patch) {
    const updated=checked(await this.client.from('math_questions').update(patch).eq('id',value.id).eq('revision',value.revision).select().maybeSingle());
    if(!updated)throw fail('题目已更新，请重新打开后再操作。','question_conflict');
    return this.get(value.id);
  }
  async analyze(value,localRequest) {
    if(!value.imageReady)throw fail('请先补传原图。','photo_missing');
    const blob=checked(await this.client.storage.from(BUCKET).download(value.imagePath));
    const result=await localRequest('/api/analyze-image',{image:await dataUrl(blob)});
    const raw=checked(await this.client.from('math_question_analyses').insert({question_id:value.id,owner_id:this.user.id,model:result.model,raw_analysis:result.analysis}).select().single());
    return this.update(value,{analysis:result.analysis,latest_analysis_id:raw.id,status:result.analysis.needsClarification || result.analysis.uncertainties.length?'needs_clarification':'pending_review',reviewed_at:null});
  }
  async draft(value) {return this.update(value,{source:value.source,source_date:value.date,analysis:value.analysis,status:value.analysis.needsClarification || value.analysis.uncertainties.length?'needs_clarification':'pending_review',reviewed_at:null});}
  async review(value) {
    const a=value.analysis;
    if(!value.confirmed || !a.answer.trim() || !a.question.trim() || !a.firstInsight.trim() || !a.steps.length || !a.knowledgePoints.length || !a.mathMethods.length || a.needsClarification || a.uncertainties.length)throw fail('请补全分析、解决待确认条件，并勾选已核对。','invalid_question');
    const drafted=await this.draft(value);
    return this.update(drafted,{status:'approved'});
  }
}
