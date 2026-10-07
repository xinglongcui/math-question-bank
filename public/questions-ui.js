const $ = id => document.getElementById(id);
const labels = {uploaded:'原图已保存', needs_clarification:'条件待确认', pending_review:'待人工审核', approved:'已人工确认'};
const fields = ['question', 'expression', 'answer', 'steps', 'firstInsight', 'knowledgePoints', 'mathMethods', 'commonMistakes', 'uncertainties'];
const arrays = ['steps', 'knowledgePoints', 'mathMethods', 'commonMistakes', 'uncertainties'];
export function setupQuestions({request, act, message, showError, getState, cloud}) {
  let current = null, selected = null, questions = [], dirty = false, selection = 0, generation = 0;
  $('upload-date').value = new Intl.DateTimeFormat('en-CA', {timeZone:'Asia/Shanghai',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date());
  const cloudActive=()=>Boolean(cloud?.enabled && cloud.ready && cloud.user);
  async function post(path,data) {
    if(!cloudActive())return request(path,data);
    if(path==='/api/questions')return {question:await cloud.create(data)};
    if(path==='/api/questions/analyze')return {question:await cloud.analyze(current,request)};
    if(path==='/api/questions/draft')return {question:await cloud.draft(data)};
    if(path==='/api/questions/review')return {question:await cloud.review(data)};
  }
  function render() {
    const state = getState(), hosted = state.mode === 'hosted';
    $('upload-cloud-note').hidden = !hosted || cloudActive();
    $('upload-form').hidden = hosted && !cloudActive();
    $('upload-save').disabled = state.pending || !selected;
    $('analyze-question').disabled = state.pending || !state.verifiedAt || dirty || current?.imageReady===false;
    $('analyze-question').textContent = state.pending ? '正在处理，请稍候…' : 'AI 分析题目 →';
    $('save-draft').disabled = state.pending || !current?.analysis;
    $('approve-question').disabled = state.pending || !current?.analysis || !$('review-confirm').checked;
    $('analyze-note').textContent = dirty ? '你有未保存的修改，请先保存草稿。' : !state.verifiedAt ? '请先在设置完成模型连接测试。' : `使用当前模型 ${state.model} 分析，会使用 ChatGPT 订阅用量。`;
    if(hosted)$('analyze-note').textContent='云端 AI 分析等待订阅接入许可。可在已连接 ChatGPT 的 Windows 本机页面打开云端题库进行分析。';
    $('upload-storage-note').textContent=cloudActive()?'新照片和记录保存到 Supabase 私有题库。点击分析后才发送给 ChatGPT。':'原图完整保存在本机私有目录。点击分析后才发送给 ChatGPT。';
    $('repair-photo').hidden=!cloudActive() || current?.imageReady!==false;
    $('repair-photo').disabled=state.pending || !selected;
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
  function filteredList() {
    const query=$('bank-search').value.trim().toLowerCase(), status=$('bank-status').value,difficulty=$('bank-difficulty').value;
    const knowledge=$('bank-knowledge').value.trim(),method=$('bank-method').value.trim();
    listIn($('question-list'),questions.filter(item=>(!query || `${item.question} ${item.source} ${(item.knowledgePoints ?? []).join(' ')} ${(item.mathMethods ?? []).join(' ')}`.toLowerCase().includes(query))
      && (!status || item.status===status) && (!difficulty || item.difficulty===difficulty)
      && (!knowledge || (item.knowledgePoints ?? []).some(tag=>tag.includes(knowledge))) && (!method || (item.mathMethods ?? []).some(tag=>tag.includes(method)))));
  }
  for(const id of ['bank-search','bank-status','bank-difficulty','bank-knowledge','bank-method'])$(id).addEventListener('input',filteredList);
  async function loadList() {
    const owner=cloudActive()?cloud.user.id:null, ticket=generation;
    if (getState().mode === 'hosted' && !cloudActive()) {$('bank-empty-note').textContent='请在设置登录家庭账号、检查题库连接并启用云端保存。Windows 本机记录不会自动出现在云端。';return;}
    let loaded;
    if(cloudActive())loaded=await cloud.list();
    else {const response = await fetch('/api/questions', {cache:'no-store'}), value=await response.json();if (!response.ok) throw value.error;loaded=value.questions;}
    if(ticket!==generation || owner!== (cloudActive()?cloud.user.id:null))return;
    questions=loaded;
    filteredList();listIn($('recent-questions'),questions.slice(0,3));
    $('original-count').textContent=questions.length;
    $('recent-empty').hidden=questions.length>0;
    $('bank-empty-note').textContent=cloudActive()?`${questions.length} 道学校原题 · Supabase 私有题库`:`${questions.length} 道学校原题 · 本机私有记录`;
  }
  async function show(record) {
    const ticket=generation;
    if(record.ownerId && record.ownerId!==cloud.user?.id)throw new Error('家庭账号已变化，请重新打开题目。');
    current=record;dirty=false;
    $('question-review').hidden=false;$('review-fields').hidden=!record.analysis;
    const image=cloudActive() && record.imageReady ? await cloud.imageUrl(record) : cloudActive() ? '' : `/api/questions/${record.id}/image`;
    if(ticket!==generation || (record.ownerId && record.ownerId!==cloud.user?.id))return;
    if(image){$('original-image').src=image;$('original-image-link').href=image;}else{$('original-image').removeAttribute('src');$('original-image-link').removeAttribute('href');}
    $('question-status').textContent=record.imageReady===false?'原图待补传':labels[record.status];
    $('question-provenance').textContent=`${record.date} · ${record.source || '来源未填写'} · ${record.filename} · ${record.imageReady===false?'原图待补传':'原图完整保留'}`;
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
    if(cloudActive()){await show(await cloud.get(id));return;}
    const response=await fetch(`/api/questions/${id}`,{cache:'no-store'}),value=await response.json();
    if(!response.ok)throw value.error;
    await show(value.question);
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
    const value=await post('/api/questions',{...selected,source:$('upload-source').value,date:$('upload-date').value});
    await show(value.question);selected=null;$('upload-preview').hidden=true;$('photo-file').value='';$('camera-file').value='';
    await loadList();message('原图已完整保存。现在可以开始 AI 分析。');$('question-review').scrollIntoView({behavior:'smooth'});
  });});
  $('analyze-question').addEventListener('click',()=>act(async()=>{
    message('正在分析题目，请等待完整回复。原图已保留。');
    const value=await post('/api/questions/analyze',{id:current.id,revision:current.revision});await show(value.question);await loadList();
    message(current.status==='needs_clarification'?'有条件需要确认，请对照原图补全；暂不能作为已审核题目。':'分析完成。请对照原图核对题干和解答。');
  }));
  $('review-fields').addEventListener('input',event=>{if(event.target.id!=='review-confirm') {dirty=true;$('review-confirm').checked=false;}render();});
  function values() {
    const analysis={};for(const field of fields)analysis[field]=arrays.includes(field)?$('review-'+field).value.split('\n').map(x=>x.trim()).filter(Boolean):$('review-'+field).value;
    analysis.difficulty=$('review-difficulty').value;analysis.needsClarification=$('review-incomplete').checked;
    return {id:current.id,revision:current.revision,source:$('review-source').value,date:$('review-date').value,analysis,confirmed:$('review-confirm').checked};
  }
  $('save-draft').addEventListener('click',()=>act(async()=>{const value=await post('/api/questions/draft',values());await show(value.question);await loadList();message('修改已保存为待审核草稿。');}));
  $('approve-question').addEventListener('click',()=>act(async()=>{const value=await post('/api/questions/review',values());await show(value.question);await loadList();message('人工审核已保存。学校原题已确认；变式和学生练习尚未开放。');}));
  $('repair-photo').addEventListener('click',()=>act(async()=>{await show(await cloud.repair(current,selected.image));await loadList();message('原图补传完成。');}));
  return {render,reset(){generation++;selection++;current=null;selected=null;questions=[];dirty=false;$('question-review').hidden=true;$('upload-preview').hidden=true;$('original-image').removeAttribute('src');$('original-image-link').removeAttribute('href');$('upload-preview-image').removeAttribute('src');$('photo-file').value='';$('camera-file').value='';for(const field of fields)$('review-'+field).value='';$('review-source').value='';$('question-provenance').textContent='';$('ai-provenance').textContent='';$('review-confirm').checked=false;$('question-list').replaceChildren();$('recent-questions').replaceChildren();$('original-count').textContent='0';}, async enter(page){if(['home','bank','upload'].includes(page))await loadList();if(page==='upload' && current)$('question-review').scrollIntoView();}};
}
