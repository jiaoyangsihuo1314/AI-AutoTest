function browserOrigin() {
  if (typeof window === 'undefined') return 'http://127.0.0.1:8001';
  return window.location.origin;
}

export const API_BASE = (import.meta.env.VITE_API_BASE || browserOrigin()).replace(/\/$/, '');
export const WS_BASE = API_BASE.replace(/^http:/, 'ws:').replace(/^https:/, 'wss:');

export function isAuthRequiredError(error) {
  return error?.message === '请先登录' || error?.status === 401;
}

function responseError(response, text) {
  let payload;
  try {
    payload = JSON.parse(text);
  } catch {
    payload = null;
  }
  const detail = payload?.detail;
  const message = typeof detail === 'string'
    ? detail
    : detail?.message || text || `请求失败（HTTP ${response.status}）`;
  const error = new Error(message);
  error.status = response.status;
  error.code = typeof detail === 'object' ? detail?.code || '' : '';
  error.detail = detail;
  return error;
}

export async function fetchJson(path, options, onAuthExpired) {
  const response = await fetch(`${API_BASE}${path}`, { credentials: 'include', ...(options || {}) });
  if (response.status === 401) {
    onAuthExpired?.();
    const error = new Error('请先登录');
    error.status = 401;
    throw error;
  }
  if (!response.ok) {
    const text = await response.text();
    throw responseError(response, text);
  }
  return response.json();
}

export async function streamNdjson(path, options, onEvent, onAuthExpired) {
  const response = await fetch(`${API_BASE}${path}`, { credentials: 'include', ...(options || {}) });
  if (response.status === 401) {
    onAuthExpired?.();
    const error = new Error('请先登录');
    error.status = 401;
    throw error;
  }
  if (!response.ok) {
    const text = await response.text();
    throw responseError(response, text);
  }
  if (!response.body) throw new Error('浏览器不支持流式响应');

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';

  const consumeLine = async (line) => {
    const normalized = line.trim();
    if (!normalized) return;
    let event;
    try {
      event = JSON.parse(normalized);
    } catch {
      throw new Error('流式响应包含无效 NDJSON 数据');
    }
    await onEvent(event);
  };

  while (true) {
    const { done, value } = await reader.read();
    buffer += decoder.decode(value || new Uint8Array(), { stream: !done });
    const lines = buffer.split('\n');
    buffer = lines.pop() || '';
    for (const line of lines) await consumeLine(line);
    if (done) break;
  }
  if (buffer.trim()) await consumeLine(buffer);
}
