import {mkdir, readFile, writeFile, rename, readdir} from 'node:fs/promises';
import {join} from 'node:path';
import {randomUUID} from 'node:crypto';
import {AppError} from './errors.js';

export const MAX_IMAGE_BYTES = 8 * 1024 * 1024;
const fail = message => {throw new AppError(message, 'invalid_question', 'question', 400);};
const text = (value, label, max = 12000) => {
  if (typeof value !== 'string' || value.length > max) fail(`${label}格式不正确或过长。`);
  return value.trim();
};
const list = (value, label) => {
  if (!Array.isArray(value) || value.length > 40) fail(`${label}格式不正确。`);
  return value.map(item => text(item, label, 3000)).filter(Boolean);
};
export function validateAnalysis(value, {approval = false} = {}) {
  if (!value || typeof value !== 'object') fail('分析结果格式不正确。');
  if (Buffer.byteLength(JSON.stringify(value), 'utf8') > 150000) fail('分析结果过长，请重新分析为简明步骤。');
  const result = {};
  for (const key of ['question', 'expression', 'answer', 'firstInsight']) result[key] = text(value[key], key);
  for (const key of ['steps', 'knowledgePoints', 'mathMethods', 'commonMistakes', 'uncertainties']) result[key] = list(value[key], key);
  if (!['basic', 'standard', 'challenge'].includes(value.difficulty)) fail('请选择有效难度。');
  if (typeof value.needsClarification !== 'boolean') fail('缺少题目完整性判断。');
  result.difficulty = value.difficulty; result.needsClarification = value.needsClarification;
  if (!result.question && (approval || !result.needsClarification || !result.uncertainties.length)) fail('题干为空。请填写题干，或标记条件缺失并说明待确认内容。');
  if (approval && (!result.answer || !result.firstInsight || !result.steps.length || !result.knowledgePoints.length || !result.mathMethods.length || result.needsClarification || result.uncertainties.length))
    fail('请补全题干、答案、步骤及两套标签，并解决所有待确认条件后再保存审核。');
  return result;
}
export function decodeImage(data) {
  if (typeof data !== 'string') fail('请选择题目照片。');
  const match = /^data:image\/(jpeg|png|webp);base64,([A-Za-z0-9+/]+={0,2})$/.exec(data);
  if (!match || match[2].length % 4) fail('仅支持 JPEG、PNG 或 WebP 照片；HEIC 请先转换，PDF 将在后续版本开放。');
  const bytes = Buffer.from(match[2], 'base64');
  if (!bytes.length || bytes.length > MAX_IMAGE_BYTES) fail('照片大小需在 8 MB 以内。');
  const type = match[1];
  const valid = type === 'jpeg' ? bytes.length > 3 && bytes[0] === 255 && bytes[1] === 216 && bytes[2] === 255
    : type === 'png' ? bytes.subarray(0, 8).equals(Buffer.from([137,80,78,71,13,10,26,10]))
    : bytes.length >= 12 && bytes.subarray(0, 4).toString() === 'RIFF' && bytes.subarray(8, 12).toString() === 'WEBP';
  if (!valid) fail('照片内容与格式不匹配，请重新选择原始图片。');
  return {bytes, mime: `image/${type}`};
}
function metadata(value) {
  const source = text(value.source ?? '', '来源', 200);
  const date = value.date;
  if (typeof date !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(date) || !Number.isFinite(Date.parse(date)) || new Date(date).toISOString().slice(0,10) !== date) fail('请选择有效日期。');
  return {source, date};
}
export class QuestionStore {
  constructor(directory, protector) {this.directory = directory; this.protector = protector; this.parents = new Map();}
  path(id, extension = 'json') {
    if (typeof id !== 'string' || !/^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/.test(id)) fail('题目标识无效。');
    return join(this.directory, `${id}.${extension}.dpapi`);
  }
  async write(id, value, extension = 'json') {
    await mkdir(this.directory, {recursive:true});
    const file = this.path(id, extension), temporary = `${file}.${randomUUID()}.tmp`;
    const bytes = extension === 'json' ? Buffer.from(JSON.stringify(value)) : value;
    await writeFile(temporary, await this.protector.protect(bytes), {mode:0o600});
    await rename(temporary, file);
  }
  async readDocument(id) {return JSON.parse((await this.protector.unprotect(await readFile(this.path(id)))).toString());}
  async locate(id) {
    this.path(id);
    let fileId=this.parents.get(id) ?? id, document;
    try {document=await this.readDocument(fileId);}
    catch(error) {
      if(error.code!=='ENOENT')throw error;
      await this.list();fileId=this.parents.get(id) ?? id;
      try {document=await this.readDocument(fileId);}
      catch(retry) {if(retry.code==='ENOENT')throw new AppError('题目不存在。','question_not_found','question',404);throw retry;}
    }
    const record=document.kind==='photo_batch'?document.records.find(item=>item.id===id):document;
    if(!record)throw new AppError('题目不存在。','question_not_found','question',404);
    return {fileId,document,record};
  }
  async get(id) {return (await this.locate(id)).record;}
  async image(id) {const record = await this.get(id); return {mime:record.mime, bytes:await this.protector.unprotect(await readFile(this.path(record.photoId ?? id, 'image')))};}
  async list() {
    let files; try {files = await readdir(this.directory);} catch (error) {if (error.code === 'ENOENT') return []; throw error;}
    const records = [];
    for (const file of files.filter(file => file.endsWith('.json.dpapi'))) {
      const fileId=file.slice(0,-11), document=await this.readDocument(fileId);
      for(const record of document.kind==='photo_batch'?document.records:[document]) {
      if(record.photoId)this.parents.set(record.id,fileId);
      records.push({id:record.id, source:record.source, date:record.date, status:record.status, question:record.analysis?.question ?? '', createdAt:record.createdAt,
        photoId:record.photoId,photoLabel:record.photoLabel,photoIndex:record.photoIndex,photoCount:record.photoCount,
        difficulty:record.analysis?.difficulty, knowledgePoints:record.analysis?.knowledgePoints ?? [], mathMethods:record.analysis?.mathMethods ?? []});
      }
    }
    return records.sort((a,b) => b.createdAt.localeCompare(a.createdAt) || (a.photoIndex ?? 0)-(b.photoIndex ?? 0));
  }
  async create(value) {
    if ((await this.list()).length >= 100) fail('本机试用最多保存 100 道题；正式题库将在 Supabase 阶段接入。');
    const {bytes, mime} = decodeImage(value.image);
    const record = {id:randomUUID(), ...metadata(value), filename:text(value.filename ?? '题目照片', '文件名', 200), mime, size:bytes.length,
      kind:'school_original', status:'uploaded', revision:1, createdAt:new Date().toISOString(), analysis:null, aiAnalysis:null, reviewedAt:null};
    await this.write(record.id, bytes, 'image'); await this.write(record.id, record);
    return record;
  }
  async update(id, revision, transform) {
    const {fileId,document,record} = await this.locate(id);
    if (record.revision !== revision) throw new AppError('题目已被更新，请重新打开后再操作。', 'question_conflict', 'question', 409);
    const next = await transform(record);
    next.revision = record.revision + 1; next.updatedAt = new Date().toISOString();
    await this.write(fileId,document.kind==='photo_batch'?{...document,records:document.records.map(item=>item.id===id?next:item)}:next); return next;
  }
  async analyze(id, revision, math, model) {
    const record=await this.get(id);
    if(record.revision!==revision)throw new AppError('题目已被更新，请重新打开后再操作。','question_conflict','question',409);
    const {bytes,mime}=await this.image(id);
    const result=await math.analyzeQuestion({model,image:`data:${mime};base64,${bytes.toString('base64')}`,target:record.photoId?{index:record.photoIndex,label:record.photoLabel}:undefined});
    const items=result.analyses ?? [{analysis:result.analysis,rawAnalysis:result.rawAnalysis ?? result.analysis}];
    if(!items.length || items.length>20 || (record.photoId && items.length!==1))fail('AI 返回的题目数量不正确。');
    // Validate every item before replacing the original record: no partial batches.
    const checked=items.map(item=>({...item,analysis:validateAnalysis(item.analysis)}));
    const analyzedAt=new Date().toISOString();
    const analyzed=(base,item)=>({...base,aiAnalysis:item.rawAnalysis ?? item.analysis,analysis:item.analysis,model:result.model,analyzedAt,reviewedAt:null,
      status:item.analysis.needsClarification || item.analysis.uncertainties.length?'needs_clarification':'pending_review'});
    if(checked.length===1)return this.update(id,revision,async value=>analyzed(value,checked[0]));
    if((await this.list()).length+checked.length-1>100)fail('拆分后将超过本机100道题的上限。原图与已有记录已保留。');
    const latest=await this.get(id);
    if(latest.revision!==revision)throw new AppError('题目已被更新，请重新打开后再操作。','question_conflict','question',409);
    const records=checked.map((item,index)=>({...analyzed(record,item),id:index===0?id:randomUUID(),photoId:id,photoIndex:index+1,photoCount:checked.length,
      photoLabel:item.label ?? `第${index+1}题`,revision:index===0?revision+1:1,updatedAt:analyzedAt}));
    // One encrypted document and atomic rename commit all questions together.
    // They reference the unchanged original image, without duplicate photo files.
    await this.write(id,{id,kind:'photo_batch',records,rawPhotoAnalysis:result.rawPhotoAnalysis ?? null});
    for(const item of records)this.parents.set(item.id,id);
    return records[0];
  }
  async review(value) {
    if (value.confirmed !== true) fail('请先确认已对照原图核对题干和解答。');
    const analysis = validateAnalysis(value.analysis, {approval:true});
    return this.update(value.id, value.revision, async record => {
      if (!record.aiAnalysis) fail('请先完成 AI 分析，再审核。');
      return {...record, ...metadata(value), analysis, status:'approved', reviewedAt:new Date().toISOString()};
    });
  }
  async draft(value) {
    const analysis = validateAnalysis(value.analysis);
    return this.update(value.id, value.revision, async record => {
      if (!record.aiAnalysis) fail('请先完成 AI 分析。');
      return {...record, ...metadata(value), analysis, reviewedAt:null,
        status:analysis.needsClarification || analysis.uncertainties.length ? 'needs_clarification' : 'pending_review'};
    });
  }
}
