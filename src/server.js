import http from 'node:http';
import {readFile} from 'node:fs/promises';
import {fileURLToPath} from 'node:url';
import {resolve, join} from 'node:path';
import {randomBytes} from 'node:crypto';
import {Vault} from './vault.js';
import {ChatGPTOAuth, DIRECT_SCOPE} from './oauth.js';
import {ChatGPTProvider, MathAI} from './provider.js';
import {QuestionStore} from './questions.js';
import {AppError, publicError} from './errors.js';

const PUBLIC = fileURLToPath(new URL('../public/', import.meta.url));
const assets = new Map([
  ['/', ['index.html', 'text/html']], ['/index.html', ['index.html', 'text/html']],
  ['/app.js', ['app.js', 'text/javascript']], ['/styles.css', ['styles.css', 'text/css']],
  ['/questions-ui.js', ['questions-ui.js', 'text/javascript']],
  ['/sw.js', ['sw.js', 'text/javascript']], ['/manifest.webmanifest', ['manifest.webmanifest', 'application/manifest+json']],
  ['/icon.svg', ['icon.svg', 'image/svg+xml']], ['/icon-192.png', ['icon-192.png', 'image/png']],
  ['/icon-512.png', ['icon-512.png', 'image/png']], ['/apple-touch-icon.png', ['apple-touch-icon.png', 'image/png']],
]);

export function createApp({vault, origin, fetchImpl = fetch, verifyIdentity, questionStore}) {
  const oauth = new ChatGPTOAuth({vault, origin, fetchImpl, verifyIdentity});
  const provider = new ChatGPTProvider({vault, oauth, fetchImpl});
  const math = new MathAI(provider);
  const questions = questionStore ?? new QuestionStore(join(vault.directory ?? '.local', 'questions'), vault.protector);
  const sessions = new Map();
  let busy = false;
  const send = (res, status, body) => {
    res.statusCode = status; res.setHeader('Content-Type', 'application/json; charset=utf-8'); res.end(JSON.stringify(body));
  };
  const sessionFor = (req, res) => {
    for (const [id, session] of sessions) if (session.expires < Date.now()) sessions.delete(id);
    const cookie = req.headers.cookie?.match(/(?:^|;\s*)mqb_session=([a-z0-9_-]{43})(?:;|$)/i)?.[1];
    if (cookie && sessions.has(cookie)) return [cookie, sessions.get(cookie)];
    if (sessions.size >= 100) throw new AppError('浏览器会话过多，请重启测试服务。', 'session_limit', 'session', 429);
    const id = randomBytes(32).toString('base64url');
    const session = {csrf: randomBytes(32).toString('base64url'), expires: Date.now() + 86_400_000};
    sessions.set(id, session); res.setHeader('Set-Cookie', `mqb_session=${id}; HttpOnly; SameSite=Lax; Path=/; Max-Age=86400`);
    return [id, session];
  };
  async function body(req, limit = 8192) {
    if (!/^application\/json(?:;|$)/i.test(req.headers['content-type'] ?? '')) throw new AppError('请求格式不正确。', 'content_type', 'request', 415);
    const chunks = []; let length = 0;
    for await (const chunk of req) { length += chunk.length; if (length > limit) throw new AppError('请求过大。', 'body_limit', 'request', 413); chunks.push(chunk); }
    try { return JSON.parse(Buffer.concat(chunks).toString('utf8')); } catch { throw new AppError('请求数据不正确。', 'invalid_json', 'request', 400); }
  }
  const handler = async (req, res) => {
    res.setHeader('Cache-Control', 'no-store');
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Referrer-Policy', 'no-referrer');
    res.setHeader('Content-Security-Policy', "default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' data:; connect-src 'self'; base-uri 'none'; frame-ancestors 'none'; form-action 'none'");
    let locked = false;
    try {
      if (req.headers.host !== new URL(origin).host) throw new AppError('访问地址不匹配，请使用启动时显示的地址。', 'host_mismatch', 'request', 403);
      const url = new URL(req.url, origin);
      if (url.origin !== origin) throw new AppError('访问地址不匹配。', 'origin_mismatch', 'request', 403);
      if (url.pathname.startsWith('/api/') && req.headers['sec-fetch-site'] === 'cross-site') throw new AppError('请求来源不允许。', 'origin_mismatch', 'request', 403);
      if (req.method === 'GET' && assets.has(url.pathname)) {
        const [path, type] = assets.get(url.pathname);
        res.setHeader('Content-Type', `${type}${type.startsWith('text/') ? '; charset=utf-8' : ''}`);
        return res.end(await readFile(join(PUBLIC, path)));
      }
      const [sid, session] = sessionFor(req, res);
      if (req.method === 'GET' && url.pathname === '/api/status') {
        const credential = vault.data.credential;
        return send(res, 200, {mode: 'local', version: '0.1.0', csrf: session.csrf,
          connected: Boolean(credential), planEnabled: credential?.scopes?.includes(DIRECT_SCOPE) ?? false,
          email: credential?.email ? credential.email.replace(/^(.{1,2}).*(@.*)$/, '$1***$2') : null,
          expiresAt: credential?.expires ?? null, model: vault.data.model,
          verifiedAt: vault.data.verifiedAt, models: provider.models,
          authResult: session.authResult ?? null});
      }
      if (req.method === 'GET' && url.pathname === '/auth/callback') {
        if (busy) throw new AppError('有请求正在处理，请稍后重新连接。', 'busy', 'callback', 409);
        busy = true; locked = true;
        try {
          await oauth.finish(url, sid); provider.models = [];
          session.authResult = {phase: 'connected', at: new Date().toISOString()};
          res.statusCode = 303; res.setHeader('Location', '/#settings'); return res.end();
        } catch (error) {
          // Strip code/token from address bar, retain sanitized error in browser session only.
          session.callbackError = publicError(error);
          session.authResult = {phase: 'failed', error: session.callbackError, at: new Date().toISOString()};
          res.statusCode = 303; res.setHeader('Location', '/#settings'); return res.end();
        }
      }
      if (req.method === 'GET' && url.pathname === '/api/login-result') {
        const error = session.callbackError ?? null; return send(res, 200, {error});
      }
      if (req.method === 'GET' && url.pathname === '/api/questions') return send(res, 200, {questions:await questions.list()});
      if (req.method === 'GET' && /^\/api\/questions\/[a-f0-9-]+(?:\/image)?$/.test(url.pathname)) {
        const id = url.pathname.split('/')[3];
        if (url.pathname.endsWith('/image')) {
          const image = await questions.image(id); res.setHeader('Content-Type', image.mime); return res.end(image.bytes);
        }
        return send(res, 200, {question:await questions.get(id)});
      }
      if (req.method !== 'POST' || !['/api/connect', '/api/models', '/api/model', '/api/test', '/api/disconnect', '/api/questions', '/api/questions/analyze', '/api/questions/review', '/api/questions/draft'].includes(url.pathname))
        throw new AppError('页面不存在。', 'not_found', 'routing', 404);
      if (req.headers.origin !== origin || req.headers['x-csrf-token'] !== session.csrf)
        throw new AppError('请求来源或会话校验失败，请刷新页面。', 'csrf', 'request', 403);
      const data = await body(req, url.pathname === '/api/questions' ? 12 * 1024 * 1024 : /\/api\/questions\/(review|draft)$/.test(url.pathname) ? 200_000 : 8192);
      if (busy) throw new AppError('正在处理其他请求，请稍后重试。', 'busy', 'request', 409);
      busy = true; locked = true;
      if (url.pathname === '/api/questions') return send(res, 201, {question:await questions.create(data)});
      if (url.pathname === '/api/questions/analyze') {
        if (!vault.data.verifiedAt || !vault.data.model) throw new AppError('请先在设置选择模型并完成一次连接测试。', 'model_not_verified', 'analysis', 400);
        return send(res, 200, {question:await questions.analyze(data.id, data.revision, math, vault.data.model)});
      }
      if (url.pathname === '/api/questions/review') return send(res, 200, {question:await questions.review(data)});
      if (url.pathname === '/api/questions/draft') return send(res, 200, {question:await questions.draft(data)});
      if (url.pathname === '/api/connect') {
        delete session.callbackError;
        session.authResult = {phase: 'awaiting_callback', at: new Date().toISOString()};
        return send(res, 200, {url: oauth.start(sid, data.newAccount === true)});
      }
      if (url.pathname === '/api/models') return send(res, 200, {models: await provider.listModels()});
      if (url.pathname === '/api/test') return send(res, 200, await provider.test(data.model));
      if (url.pathname === '/api/model') {
        if (!provider.models.some(m => m.id === data.model)) throw new AppError('请刷新并选择可用模型。', 'model_unavailable', 'model_catalog', 400);
        Object.assign(vault.data, {model: data.model, verifiedAt: null}); await vault.save(); return send(res, 200, {model: data.model});
      }
      if (url.pathname === '/api/disconnect') { provider.models = []; return send(res, 200, await oauth.disconnect()); }
    } catch (error) { send(res, error instanceof AppError ? error.status : 502, {error: publicError(error)}); }
    finally { if (locked) busy = false; }
  };
  return {handler, oauth, provider, questions};
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const port = Number(process.env.MATHBANK_PORT ?? 8010);
  if (!Number.isInteger(port) || port < 1024 || port > 65535) throw new Error('MATHBANK_PORT must be 1024–65535');
  const origin = `http://127.0.0.1:${port}`;
  const vault = await new Vault(process.env.MATHBANK_DATA_DIR || fileURLToPath(new URL('../.local/', import.meta.url))).load();
  const {handler} = createApp({vault, origin});
  const server = http.createServer(handler);
  server.on('error', error => { console.error(`启动失败（${error.code ?? 'unknown'}），请更换 MATHBANK_PORT 后重试。`); process.exitCode = 1; });
  server.listen(port, '127.0.0.1', () => console.log(`数学题库 V0.1：${origin}\n上传一道题，分析后人工审核。当前为本机服务，云端接入等待许可。`));
}
