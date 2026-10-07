const $ = id => document.getElementById(id);
const labels = {uploaded:'原图已保存', needs_clarification:'条件待确认', pending_review:'待人工审核', approved:'已人工确认'};
const fields = ['question', 'expression', 'answer', 'steps', 'firstInsight', 'knowledgePoints', 'mathMethods', 'commonMistakes', 'uncertainties'];
const arrays = ['steps', 'knowledgePoints', 'mathMethods', 'commonMistakes', 'uncertainties'];
export function setupQuestions({request, act, message, showError, getState}) {
  let current = null, selected = null, questions = [], dirty = false, selection = 0;
  $('upload-date').value = new Intl.DateTimeFormat('en-CA', {timeZone:'Asia/Shanghai',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date());
  function render() {
    const state = getState(), hosted = state.mode === 'hosted';
    $('upload-cloud-note').hidden = !hosted;
    $('upload-form').hidden = hosted;
    $('upload-save').disabled = state.pending || !selected;
    $('analyze-question').disabled = state.pending || !state.verifiedAt || dirty;
    $('analyze-question').textContent = state.pending ? '正在处理，请稍候…' : 'AI 分析题目 →';
    $('save-draft').disabled = state.pending || !current?.analysis;
    $('approve-question').disabled = state.pending || !current?.analysis || !$('review-confirm').checked;
    $('analyze-note').textContent = dirty ? '你有未保存的修改，请先保存草稿。' : !state.verifiedAt ? '请先在设置完成模型连接测试。' : `使用当前模型 ${state.model} 分析，会使用 ChatGPT 订阅用量。`;
  }
  function listIn(container, items) {
    container.replaceChildren();
    if (!items.length) {const p = document.createElement('p');p.className='muted';p.textContent='还没有保存的题目。从一张学校作业照片开始。';container.append(p);return;}
    for (const item of items) {
      const button = document.createElement('button');button.className='question-row';button.type='button';
      const heading=document.createElement('strong');heading.textContent=item.question.slice(0,110) || item.source || '待分析的学校原题';
      const meta=document.createElement('small');meta.textContent=`${item.date} · ${item.source || '来源未填写'} · ${labels[item.status] ?? item.status}`;
      button.append(heading,meta);button.addEventListener('click',()=>act(async()=>{await open(item.id);location.hash='upload';}));container.append(button);
    }
  }
  async function loadList() {
    if (getState().mode === 'hosted') {$('bank-empty-note').textContent='云端题库尚未开放。Windows 本机保存的题目不会出现在这个预览页面。';return;}
    const response = await fetch('/api/questions', {cache:'no-store'}), value=await response.json();
    if (!response.ok) throw value.error;
    questions=value.questions;
    listIn($('question-list'),questions);listIn($('recent-questions'),questions.slice(0,3));
    $('original-count').textContent=questions.length;
    $('recent-empty').hidden=questions.length>0;
    $('bank-empty-note').textContent=`${questions.length} 道学校原题 · 保存于本机私有目录。Supabase 正式题库将在 V0.2 接入。`;
  }
  function show(record) {
    current=record;dirty=false;
    $('question-review').hidden=false;$('review-fields').hidden=!record.analysis;
    $('original-image').src=`/api/questions/${record.id}/image`;
    $('original-image-link').href=`/api/questions/${record.id}/image`;
    $('question-status').textContent=labels[record.status];
    $('question-provenance').textContent=`${record.date} · ${record.source || '来源未填写'} · ${record.filename} · 原图完整保留`;
    $('review-source').value=record.source;$('review-date').value=record.date;
    if(record.analysis) {
      for(const field of fields) $('review-'+field).value=arrays.includes(field)?record.analysis[field].join('\n'):record.analysis[field];
      $('review-difficulty').value=record.analysis.difficulty;
      $('review-incomplete').checked=record.analysis.needsClarification;
      $('ai-provenance').textContent=`${record.model} · ${new Date(record.analyzedAt).toLocaleString('zh-CN',{timeZone:'Asia/Shanghai'})} · AI 原始分析另行保留${record.reviewedAt?' · 已人工确认':''}`;
    }
    $('review-confirm').checked=false;render();
  }
  async function open(id) {
    const response=await fetch(`/api/questions/${id}`,{cache:'no-store'}),value=await response.json();
    if(!response.ok)throw value.error;
    show(value.question);
  }
  async function choose(input) {
    const ticket = ++selection;
    const file=input.files[0];selected=null;$('upload-preview').hidden=true;render();
    if(!file)return;
    if(!['image/jpeg','image/png','image/webp'].includes(file.type) || file.size>8*1024*1024) {message('请选择 8 MB 以内的 JPEG、PNG 或 WebP 图片。HEIC 请先转换；PDF 后续开放。',true);input.value='';return;}
    try {
      const image=await new Promise((resolve,reject)=>{const reader=new FileReader();reader.onload=()=>resolve(reader.result);reader.onerror=()=>reject(new Error('照片读取失败，请重新选择。'));reader.readAsDataURL(file);});
      if(input.files[0]!==file || ticket !== selection)return;
      selected={image,filename:file.name};$('upload-preview-image').src=image;$('selected-file').textContent=`${file.name} · ${(file.size/1024/1024).toFixed(2)} MB`;$('upload-preview').hidden=false;render();
    } catch(error){showError(error);}
  }
  for(const id of ['photo-file','camera-file'])$(id).addEventListener('change',()=>choose($(id)));
  $('upload-form').addEventListener('submit',event=>{event.preventDefault();act(async()=>{
    const value=await request('/api/questions',{...selected,source:$('upload-source').value,date:$('upload-date').value});
    show(value.question);selected=null;$('upload-preview').hidden=true;$('photo-file').value='';$('camera-file').value='';
    await loadList();message('原图已完整保存。现在可以开始 AI 分析。');$('question-review').scrollIntoView({behavior:'smooth'});
  });});
  $('analyze-question').addEventListener('click',()=>act(async()=>{
    message('正在分析题目，请等待完整回复。原图已保留。');
    const value=await request('/api/questions/analyze',{id:current.id,revision:current.revision});show(value.question);await loadList();
    message(current.status==='needs_clarification'?'有条件需要确认，请对照原图补全；暂不能作为已审核题目。':'分析完成。请对照原图核对题干和解答。');
  }));
  $('review-fields').addEventListener('input',event=>{if(event.target.id!=='review-confirm') {dirty=true;$('review-confirm').checked=false;}render();});
  function values() {
    const analysis={};for(const field of fields)analysis[field]=arrays.includes(field)?$('review-'+field).value.split('\n').map(x=>x.trim()).filter(Boolean):$('review-'+field).value;
    analysis.difficulty=$('review-difficulty').value;analysis.needsClarification=$('review-incomplete').checked;
    return {id:current.id,revision:current.revision,source:$('review-source').value,date:$('review-date').value,analysis,confirmed:$('review-confirm').checked};
  }
  $('save-draft').addEventListener('click',()=>act(async()=>{const value=await request('/api/questions/draft',values());show(value.question);await loadList();message('修改已保存为待审核草稿。');}));
  $('approve-question').addEventListener('click',()=>act(async()=>{const value=await request('/api/questions/review',values());show(value.question);await loadList();message('人工审核已保存。学校原题已确认；变式和学生练习尚未开放。');}));
  return {render, async enter(page){if(['home','bank','upload'].includes(page))await loadList();}};
}
