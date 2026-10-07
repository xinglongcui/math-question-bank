import {randomBytes, createHash} from 'node:crypto';
import {createRemoteJWKSet, jwtVerify} from 'jose';
import {AppError, readJson} from './errors.js';

export const ISSUER = 'https://auth.openai.com';
export const RESOURCE = 'https://api.openai.com/v1';
export const DIRECT_SCOPE = 'chatgpt.tokens.use.direct';
const random = () => randomBytes(32).toString('base64url');

export class ChatGPTOAuth {
  constructor({vault, origin, fetchImpl = fetch, verifyIdentity} = {}) {
    this.vault = vault; this.origin = origin; this.fetch = fetchImpl;
    this.verifyIdentity = verifyIdentity;
    this.pending = new Map();
    this.jwks = createRemoteJWKSet(new URL(`${ISSUER}/.well-known/jwks.json`));
    this.callback = `${origin}/auth/callback`;
  }
  start(session, newAccount = false) {
    for (const [key, tx] of this.pending) if (tx.expires < Date.now() || tx.session === session) this.pending.delete(key);
    if (this.pending.size >= 20) throw new AppError('登录请求过多，请稍后重试。', 'too_many_attempts', 'authorization', 429);
    const registration = newAccount ? null : this.vault.data.registration;
    const state = random(), verifier = random(), nonce = random();
    const clientId = registration?.clientId ?? 'dynamic_agent_client';
    this.pending.set(state, {session, verifier, nonce, clientId, registration, expires: Date.now() + 600_000});
    // Official fixed endpoint: starting login needs no discovery HTTP request.
    const url = new URL(`${ISSUER}/api/accounts/authorize`);
    url.search = new URLSearchParams({
      client_id: clientId, response_type: 'code', redirect_uri: this.callback,
      ext_agent_host_id: this.vault.data.hostId,
      scope: `openid profile email offline_access resource.invoke ${DIRECT_SCOPE}`,
      resource: RESOURCE, state, nonce, code_challenge_method: 'S256',
      code_challenge: createHash('sha256').update(verifier).digest('base64url'),
    }).toString();
    if (clientId === 'dynamic_agent_client') url.searchParams.set('agent_name_hint', 'Math Question Bank');
    else {
      if (registration.email) url.searchParams.set('login_hint', registration.email);
      if (this.vault.data.credential?.idToken) url.searchParams.set('id_token_hint', this.vault.data.credential.idToken);
    }
    return url.href;
  }
  async token(params) {
    return readJson(await this.fetch(`${ISSUER}/api/accounts/oauth/token`, {
      method: 'POST', redirect: 'error', signal: AbortSignal.timeout(25_000),
      headers: {'Content-Type': 'application/x-www-form-urlencoded', Accept: 'application/json'},
      body: new URLSearchParams({...params, resource: RESOURCE}),
    }), 'token_exchange');
  }
  async finish(url, session) {
    const state = url.searchParams.get('state');
    const tx = this.pending.get(state);
    if (!tx || tx.session !== session || tx.expires < Date.now())
      throw new AppError('登录会话已过期或不匹配，请重新连接。', 'invalid_state', 'callback', 400);
    this.pending.delete(state); // Consume once, before any network operation.
    if (url.searchParams.has('error')) throw new AppError('你已取消授权，可随时重新连接。', 'access_denied', 'authorization', 400);
    const code = url.searchParams.get('code');
    const clientId = url.searchParams.get('client_id') ?? (tx.clientId === 'dynamic_agent_client' ? null : tx.clientId);
    if (!code || !clientId || !/^oaiapp_[a-z0-9_-]+$/i.test(clientId))
      throw new AppError('回调缺少有效的授权码或签发 client ID。', 'invalid_callback', 'callback', 400);
    if (tx.clientId !== 'dynamic_agent_client' && tx.clientId !== clientId)
      throw new AppError('授权注册与发起连接的账户不匹配。', 'client_mismatch', 'callback', 400);
    // Save issued registration before exchange so invalid_grant can be recovered.
    // A failed switch leaves the existing validated account untouched.
    if (!this.vault.data.registration || tx.registration) {
      this.vault.data.registration = {...tx.registration, clientId}; await this.vault.save();
    }
    const token = await this.token({grant_type: 'authorization_code', client_id: clientId,
      code, code_verifier: tx.verifier, redirect_uri: this.callback});
    if (typeof token.id_token !== 'string') throw new AppError('服务未返回身份凭据。', 'invalid_identity', 'identity');
    let identity;
    try {
      identity = this.verifyIdentity ? await this.verifyIdentity(token.id_token, clientId, tx.nonce)
        : (await jwtVerify(token.id_token, this.jwks, {
          issuer: ISSUER, audience: clientId, requiredClaims: ['sub', 'exp', 'iat', 'nonce'],
          algorithms: ['RS256', 'ES256'], clockTolerance: 5,
        })).payload;
    } catch {
      throw new AppError('账户身份验证未完成。请检查签名校验网络连接或重新登录。', 'identity_verification_failed', 'identity');
    }
    if (identity.nonce !== tx.nonce || typeof identity.sub !== 'string' || !identity.sub)
      throw new AppError('账户身份校验失败。', 'invalid_identity', 'identity');
    if (tx.registration?.subject && tx.registration.subject !== identity.sub)
      throw new AppError('请选择原账户，或使用连接其他账号。', 'account_mismatch', 'identity');
    const credential = this.fromToken(token, {clientId, subject: identity.sub, email: identity.email});
    Object.assign(this.vault.data, {registration: {clientId, subject: identity.sub, email: identity.email},
      credential, model: null, verifiedAt: null});
    await this.vault.save();
  }
  fromToken(token, prior = {}) {
    if (typeof token.access_token !== 'string' || !Number.isFinite(token.expires_in) || token.expires_in <= 0 || token.token_type?.toLowerCase() !== 'bearer')
      throw new AppError('服务未返回完整的访问凭据。', 'invalid_token_response', 'token_exchange');
    return {...prior, access: token.access_token, refresh: token.refresh_token ?? prior.refresh,
      idToken: token.id_token ?? prior.idToken,
      scopes: typeof token.scope === 'string' ? token.scope.split(/\s+/) : prior.scopes ?? [],
      expires: Date.now() + token.expires_in * 1000};
  }
  async access() {
    let credential = this.vault.data.credential;
    if (!credential) throw new AppError('请先连接 ChatGPT。', 'not_connected', 'authorization', 401);
    if (credential.expires < Date.now() + 60_000) {
      if (!credential.refresh) throw new AppError('请重新连接 ChatGPT。', 'reauth_required', 'refresh', 401);
      const token = await this.token({grant_type: 'refresh_token', client_id: credential.clientId, refresh_token: credential.refresh});
      credential = this.fromToken(token, credential);
      this.vault.data.credential = credential; await this.vault.save();
    }
    if (!credential.scopes.includes(DIRECT_SCOPE))
      throw new AppError('账户已登录，但未授权使用 ChatGPT 订阅额度。请连接其他账号重新授权。', 'scope_missing', 'permission', 403);
    return credential.access;
  }
  async disconnect() {
    this.pending.clear();
    Object.assign(this.vault.data, {credential: null, registration: null, model: null, verifiedAt: null});
    await this.vault.save();
    return {message: '本机凭据已删除。请到 ChatGPT 用量管理中撤销应用访问权限。'};
  }
}
