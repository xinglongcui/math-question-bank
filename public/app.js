const $ = id => document.getElementById(id);
const local = location.hostname === '127.0.0.1';
let state = {mode: local ? 'local' : 'hosted', connected: false, planEnabled: false, models: []};
let pending = false;
const titles = {home: '学习首页', settings: '设置', upload: '上传题目', bank: '我的题库', progress: '学习进度'};
const descriptions = {upload: '拍照、相册和 PDF，保留每一道学校原题。V0.1 开放。', bank: '学校原题与 AI 变式分开保存，人工审核后入库。V0.2 开放。', progress: '学校教学进度与学生 S0–S3 掌握状态分别记录。V0.4 开放。'};
const stageLabels = {authorization:'授权', callback:'回调', token_exchange:'令牌交换', identity:'身份校验', permission:'计划权限', refresh:'授权续期', model_catalog:'模型目录', inference:'模型调用', connection:'网络连接', request:'请求校验'};

function route() {
  const candidate = location.hash.slice(1), page = titles[candidate] ? candidate : 'home';
  document.querySelectorAll('[data-nav]').forEach(a => {
    a.classList.toggle('active', a.dataset.nav === page);
    if (a.dataset.nav === page) a.setAttribute('aria-current', 'page'); else a.removeAttribute('aria-current');
  });
  $('breadcrumb').textContent = titles[page];
  $('view-home').hidden = page !== 'home'; $('view-settings').hidden = page !== 'settings';
  $('view-future').hidden = page === 'home' || page === 'settings';
  $('future-title').textContent = titles[page]; $('future-description').textContent = descriptions[page] ?? '';
  document.title = `${titles[page]} · 数学题库`;
  window.scrollTo({top: 0});
}
function message(text, error = false) {
  $('message').hidden = false; $('message').className = `notice${error ? ' error' : ''}`;
  $('message').textContent = text;
}
function showError(error) {
  message(`${error.message || '请求失败。'}${error.stage ? ` 阶段：${stageLabels[error.stage] ?? error.stage}。` : ''}${error.code ? `（${error.code}）` : ''}`, true);
}
async function request(path, data) {
  const response = await fetch(path, {method: 'POST', credentials:'same-origin',
    headers: {'Content-Type':'application/json', 'X-CSRF-Token':state.csrf}, body:JSON.stringify(data ?? {})});
  const value = await response.json();
  if (!response.ok) throw value.error ?? new Error('请求失败');
  return value;
}
function render() {
  const hosted = state.mode === 'hosted', ready = !hosted && state.connected && state.planEnabled;
  $('hosted-notice').hidden = !hosted;
  $('local-browser-notice').hidden = hosted;
  $('local-address').textContent = `${location.origin}/#settings`;
  $('connection-status').textContent = hosted ? '等待云端接入' : !state.connected ? '未连接' : !state.planEnabled ? '未授权用量' : state.verifiedAt ? '调用已验证' : '已授权 · 待验证';
  $('connection-status').classList.toggle('success', ready);
  $('connection-description').textContent = hosted ? '请先完成本机订阅验证，并申请远程托管接入。' : !state.connected ? '在官方页面登录，并授权使用你的 ChatGPT 计划。' : !state.planEnabled ? '身份已确认，但没有订阅使用权限。请重新注册并授权计划使用。' : state.verifiedAt ? '已完成一次真实模型调用。可以继续推进一道题的完整流程。' : '订阅使用权限已确认。选择模型并测试一次真实调用。';
  $('side-status').textContent = hosted ? '云端接入待申请' : state.verifiedAt ? 'ChatGPT 调用已验证' : state.connected ? 'ChatGPT 已登录' : 'ChatGPT 尚未连接';
  $('account-email').textContent = state.email ?? '尚未连接';
  $('connect').disabled = hosted || pending;
  $('connect').hidden = state.connected;
  $('new-account').hidden = !state.connected; $('disconnect').hidden = !state.connected;
  $('new-account').disabled = hosted || pending; $('disconnect').disabled = pending;
  $('refresh-models').disabled = !ready || pending;
  const picker = $('model'), selected = picker.value || state.model;
  picker.replaceChildren();
  const placeholder = new Option(state.models.length ? '请选择一个模型' : ready ? '点击刷新模型获取账户目录' : '连接账号后获取可用模型', '');
  picker.add(placeholder);
  for (const model of state.models) picker.add(new Option(model.name, model.id));
  if (state.models.some(m => m.id === selected)) picker.value = selected;
  picker.disabled = !ready || !state.models.length || pending;
  $('test').disabled = !ready || !picker.value || pending;
  $('step-login').classList.toggle('done', ready);
  $('step-model').classList.toggle('done', Boolean(picker.value));
  $('step-test').classList.toggle('done', Boolean(state.verifiedAt));
  $('last-verified').textContent = state.verifiedAt ? `上次成功验证：${new Date(state.verifiedAt).toLocaleString('zh-CN', {timeZone:'Asia/Shanghai'})}（北京时间）` : '尚未完成真实模型调用测试。';
  $('runtime-note').textContent = hosted ? '运行环境：云端静态 PWA。订阅接入等待许可；当前不会调用 AI。' : '运行环境：Windows 本机授权验证。此阶段需保持本机服务运行。iPad 独立运行将在云端接入完成后验证。';
}
async function refresh() {
  if (!local) { render(); return; }
  const response = await fetch('/api/status', {cache:'no-store'});
  const data = await response.json(); if (!response.ok) throw data.error;
  state = data; render();
}
async function act(fn) {
  if (pending) return;
  pending = true; $('message').hidden = true; render();
  try { await fn(); } catch (error) { showError(error); }
  finally { pending = false; render(); }
}
async function connect(newAccount) {
  await act(async () => {
    const value = await request('/api/connect', {newAccount});
    const url = new URL(value.url);
    if (url.origin !== 'https://auth.openai.com') throw new Error('授权地址不可信。');
    location.assign(url.href); // Same tab preserves iPad/Safari compatibility; no popup dependency.
  });
}
$('connect').addEventListener('click', () => connect(false));
$('copy-address').addEventListener('click', async () => {
  try { await navigator.clipboard.writeText(`${location.origin}/#settings`); message('题库地址已复制。请粘贴到 Edge 或 Chrome，在那里重新发起授权。'); }
  catch { message(`请复制这个地址到 Edge 或 Chrome：${location.origin}/#settings`); }
});
document.querySelector('.skip').addEventListener('click', event => {event.preventDefault(); $('main').focus(); $('main').scrollIntoView();});
$('new-account').addEventListener('click', () => connect(true));
$('refresh-models').addEventListener('click', () => act(async () => {
  const data = await request('/api/models'); state.models = data.models;
  if (!data.models.length) message('当前账户没有可展示的模型，请检查计划权限。', true);
  else message(`已从账户获取 ${data.models.length} 个可用模型。`);
}));
$('model').addEventListener('change', () => {
  const model = $('model').value;
  if (!model) { render(); return; }
  act(async () => { await request('/api/model', {model}); state.model = model; state.verifiedAt = null; $('test-result').hidden = true; });
});
$('test').addEventListener('click', () => act(async () => {
  $('test-result').hidden = true; message('正在等待模型完整回复…');
  const data = await request('/api/test', {model:$('model').value});
  $('test-output').textContent = data.text;
  $('test-meta').textContent = `${data.model} · ${(data.durationMs / 1000).toFixed(1)} 秒 · 已收到 response.completed`;
  $('test-result').hidden = false; await refresh(); message('真实模型调用已验证成功。');
}));
$('disconnect').addEventListener('click', () => act(async () => {
  const value = await request('/api/disconnect'); $('test-result').hidden = true; await refresh(); message(value.message);
}));
window.addEventListener('hashchange', route);
window.addEventListener('online', () => refresh().catch(showError));
$('today').textContent = new Intl.DateTimeFormat('zh-CN', {timeZone:'Asia/Shanghai', month:'long', day:'numeric', weekday:'long'}).format(new Date());
route(); render();
try {
  await refresh();
  if (local) {
    const result = await (await fetch('/api/login-result', {cache:'no-store'})).json();
    if (result.error) showError(result.error);
  }
} catch (error) { showError(error); }
if ('serviceWorker' in navigator) navigator.serviceWorker.register('/sw.js').catch(() => {});
