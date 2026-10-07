export class AppError extends Error {
  constructor(message, code = 'request_failed', stage = 'application', status = 502) {
    super(message); Object.assign(this, {code, stage, status});
  }
}

export async function readJson(response, stage) {
  const raw = await response.text();
  let data; try { data = JSON.parse(raw); } catch { /* upstream HTML is not an account error */ }
  if (!response.ok) {
    const candidate = data?.error?.code ?? data?.error;
    const code = typeof candidate === 'string' && /^[a-z0-9_.:-]{1,100}$/i.test(candidate)
      ? candidate : `http_${response.status}`;
    const message = /usage_limit|usage_unavailable|rate_limit/.test(code)
      ? 'ChatGPT 用量暂不可用，请查看用量管理或稍后重试。'
      : /invalid_grant|invalid_token/.test(code) ? '授权已过期或撤销，请重新连接。'
      : `服务连接失败（HTTP ${response.status}）。请检查网络与此阶段的接入权限。`;
    const error = new AppError(message, code, stage, response.status);
    const id = response.headers.get('x-request-id');
    if (id && /^[a-z0-9_-]{1,120}$/i.test(id)) error.requestId = id;
    throw error;
  }
  if (!data || typeof data !== 'object') throw new AppError('服务返回了无法识别的数据。', 'invalid_response', stage);
  return data;
}

export function publicError(error) {
  if (error instanceof AppError) return {message: error.message, code: error.code, stage: error.stage, requestId: error.requestId};
  return {message: '请求未完成，请检查网络或重新连接。', code: 'connection_failed', stage: 'connection'};
}
