import {AppError, readJson} from './errors.js';
import {RESOURCE} from './oauth.js';

// Stream parser handles CRLF and UTF-8 split across network chunks.
export async function consumeStream(response) {
  if (!response.ok) await readJson(response, 'inference');
  if (!response.body) throw new AppError('推理返回空数据。', 'empty_stream', 'inference');
  const reader = response.body.getReader(), decoder = new TextDecoder();
  let buffer = '', output = '', completed = false, usage;
  const frame = value => {
    const data = value.split('\n').filter(line => line.startsWith('data:')).map(line => line.slice(5).trimStart()).join('\n');
    if (!data || data === '[DONE]') return;
    let event; try { event = JSON.parse(data); } catch { throw new AppError('推理事件格式错误。', 'invalid_stream', 'inference'); }
    if (['error', 'response.failed', 'response.incomplete'].includes(event.type)) {
      const raw = event.response?.error?.code ?? event.code ?? event.type;
      const code = typeof raw === 'string' && /^[a-z0-9_.:-]{1,100}$/i.test(raw) ? raw : 'inference_failed';
      throw new AppError(/usage_limit|usage_unavailable/.test(code) ? 'ChatGPT 用量暂不可用，请查看用量管理。' : '推理未完成，请重试。', code, 'inference');
    }
    if (event.type === 'response.output_text.delta') output += event.delta ?? '';
    if (event.type === 'response.completed') {
      completed = true; usage = event.response?.usage;
      if (!output) output = (event.response?.output ?? []).flatMap(item => item.content ?? []).filter(item => item.type === 'output_text').map(item => item.text).join('');
    }
  };
  const drain = final => {
    buffer = buffer.replace(/\r\n/g, '\n');
    let index;
    while ((index = buffer.indexOf('\n\n')) !== -1) { frame(buffer.slice(0, index)); buffer = buffer.slice(index + 2); }
    if (final && buffer.trim()) frame(buffer);
  };
  try {
    for (;;) {
      const {value, done} = await reader.read();
      if (done) { buffer += decoder.decode(); drain(true); break; }
      buffer += decoder.decode(value, {stream: true});
      if (buffer.length + output.length > 1_000_000) throw new AppError('推理输出过大。', 'stream_limit', 'inference');
      drain(false);
    }
  } finally { await reader.cancel().catch(() => {}); reader.releaseLock(); }
  if (!completed) throw new AppError('数据流中断，尚未收到推理完成事件。', 'interrupted_stream', 'inference');
  if (!output.trim()) throw new AppError('模型未返回测试文本。', 'empty_output', 'inference');
  return {text: output, usage};
}

export class ChatGPTProvider {
  constructor({oauth, vault, fetchImpl = fetch}) {
    this.oauth = oauth; this.vault = vault; this.fetch = fetchImpl; this.models = [];
  }
  async listModels() {
    const token = await this.oauth.access();
    const data = await readJson(await this.fetch(`${RESOURCE}/models`, {
      headers: {Authorization: `Bearer ${token}`}, redirect: 'error', signal: AbortSignal.timeout(25_000),
    }), 'model_catalog');
    if (!Array.isArray(data.models)) throw new AppError('账户模型目录格式发生变化。', 'invalid_catalog', 'model_catalog');
    this.models = data.models.filter(m => m.visibility === 'list' && typeof m.slug === 'string')
      .map(m => ({id: m.slug, name: m.display_name || m.slug}));
    return this.models;
  }
  async test(model) {
    // Validate against a fresh account catalog, never a hardcoded model guess.
    const models = await this.listModels();
    if (!models.some(m => m.id === model)) throw new AppError('请选择账户当前可用的模型。', 'model_unavailable', 'model_catalog', 400);
    const token = await this.oauth.access();
    const started = Date.now();
    const result = await consumeStream(await this.fetch(`${RESOURCE}/responses`, {
      method: 'POST', redirect: 'error', signal: AbortSignal.timeout(90_000),
      headers: {Authorization: `Bearer ${token}`, 'Content-Type': 'application/json'},
      body: JSON.stringify({model, input: [{role: 'user', content: '请仅回复：数学题库连接成功'}], store: false, stream: true}),
    }));
    Object.assign(this.vault.data, {model, verifiedAt: new Date().toISOString()}); await this.vault.save();
    return {...result, model, durationMs: Date.now() - started, completed: true};
  }
}

// V0.1+ contract. Separate generation from verification, use one chosen model.
export class MathAI {
  analyzeQuestion() { throw new AppError('V0.1 开放题目分析。', 'not_implemented', 'math', 501); }
  generateVariant() { throw new AppError('V0.3 开放变式生成。', 'not_implemented', 'math', 501); }
  verifyQuestion() { throw new AppError('V0.3 独立验证生成题。', 'not_implemented', 'math', 501); }
  gradeAnswer() { throw new AppError('后续版本开放批改。', 'not_implemented', 'math', 501); }
}
