export const VERSION = '0.1.0-preview';
export class ApiError extends Error {
  constructor(status, code, message) { super(message); this.status = status; this.code = code; }
}
export function fail(message) { throw new ApiError(400, 'INVALID_INPUT', message); }
export function object(value, allowed) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) fail('Expected a JSON object.');
  for (const key of Object.keys(value)) if (!allowed.includes(key)) fail(`Unknown field: ${key.slice(0, 40)}.`);
  return value;
}
export function string(value, name, max = 100) {
  if (typeof value !== 'string' || !value.trim() || value.length > max || !value.isWellFormed() || /[\u0000-\u001f\u007f]/u.test(value)) fail(`${name} must be a nonempty string of at most ${max} characters without control characters.`);
  return value.trim();
}
export function integer(value, name, min, max, fallback) {
  if (value === undefined) return fallback;
  if (typeof value !== 'number' || !Number.isInteger(value) || value < min || value > max) fail(`${name} must be an integer from ${min} to ${max}.`);
  return value;
}
export function query(url, allowed) {
  const output = {};
  for (const [key, value] of url.searchParams) {
    if (!allowed.includes(key) || Object.hasOwn(output, key)) fail('Unknown or repeated query parameter.');
    output[key] = value;
  }
  return output;
}
export async function boundedText(body, max = 8192, timeoutMs = 3000) {
  if (!body) return '';
  const reader = body.getReader();
  let total = 0, timer;
  const chunks = [];
  const timeout = new Promise((_, reject) => {
    timer = setTimeout(() => { void reader.cancel().catch(() => {}); reject(new ApiError(408, 'BODY_TIMEOUT', 'Request body timed out.')); }, timeoutMs);
  });
  try {
    await Promise.race([timeout, (async () => {
      while (true) {
        const {done, value} = await reader.read();
        if (done) break;
        total += value.byteLength;
        if (total > max) { void reader.cancel().catch(() => {}); throw new ApiError(413, 'BODY_TOO_LARGE', `Body limit is ${max} bytes.`); }
        chunks.push(value);
      }
    })()]);
    const bytes = new Uint8Array(total);
    let offset = 0;
    for (const part of chunks) { bytes.set(part, offset); offset += part.byteLength; }
    try { return new TextDecoder('utf-8', {fatal: true}).decode(bytes); }
    catch { fail('Body must be valid UTF-8.'); }
  } finally { clearTimeout(timer); reader.releaseLock(); }
}
export async function bodyJson(request) {
  if (!/^application\/json(?:\s*;\s*charset=utf-8)?$/i.test(request.headers.get('content-type') ?? '')) throw new ApiError(415, 'UNSUPPORTED_MEDIA_TYPE', 'Use application/json with UTF-8.');
  if (request.headers.has('content-encoding')) throw new ApiError(415, 'UNSUPPORTED_ENCODING', 'Compressed request bodies are not supported.');
  const length = request.headers.get('content-length');
  if (length !== null && (!/^\d+$/.test(length) || Number(length) > 8192)) throw new ApiError(413, 'BODY_TOO_LARGE', 'Body limit is 8192 bytes.');
  const text = await boundedText(request.body);
  try { return JSON.parse(text); } catch { fail('Body must contain valid JSON.'); }
}
async function authenticate(request, env) {
  if (typeof env.API_KEY !== 'string' || !/^[A-Za-z0-9._~+/-]{1,512}={0,2}$/.test(env.API_KEY)) throw new ApiError(503, 'AUTH_NOT_CONFIGURED', 'Authentication is not configured.');
  const authorization = request.headers.get('Authorization');
  const supplied = authorization && authorization.length <= 521 ? /^Bearer ([A-Za-z0-9._~+/-]{1,512}={0,2})$/i.exec(authorization)?.[1] : undefined;
  if (!supplied) throw new ApiError(401, 'UNAUTHORIZED', 'Send your API key as Authorization: Bearer YOUR_API_KEY.');
  const enc = new TextEncoder();
  const digests = await Promise.all([env.API_KEY, supplied].map(v => crypto.subtle.digest('SHA-256', enc.encode(v))));
  const a = new Uint8Array(digests[0]), b = new Uint8Array(digests[1]);
  let difference = 0;
  for (let i = 0; i < a.length; i++) difference |= a[i] ^ b[i];
  if (difference) throw new ApiError(401, 'UNAUTHORIZED', 'Send your API key as Authorization: Bearer YOUR_API_KEY.');
}
export function app(name, routes) {
  return {async fetch(request, env = {}, ctx = {}) {
    const requestId = crypto.randomUUID();
    let payload, status = 200, extra = {};
    try {
      const url = new URL(request.url);
      if (url.pathname === '/api/health' && request.method === 'GET') {
        query(url, []); payload = {status: 'ok', name, version: VERSION};
      } else {
        await authenticate(request, env);
        const route = routes.find(r => r.path instanceof RegExp ? r.path.test(url.pathname) : r.path === url.pathname);
        if (!route) throw new ApiError(404, 'NOT_FOUND', 'Unknown endpoint.');
        if (request.method !== route.method) { extra.Allow = route.method; throw new ApiError(405, 'METHOD_NOT_ALLOWED', 'Method not supported.'); }
        payload = await route.handle({request, url, env, ctx});
      }
    } catch (error) {
      status = error instanceof ApiError ? error.status : 500;
      if (status === 401) extra['WWW-Authenticate'] = 'Bearer';
      payload = {error: {code: error instanceof ApiError ? error.code : 'INTERNAL_ERROR', message: error instanceof ApiError ? error.message : 'An unexpected error occurred.'}};
    }
    return new Response(JSON.stringify({...payload, requestId}), {status, headers: {'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff', 'Referrer-Policy': 'no-referrer', 'X-Request-ID': requestId, ...extra}});
  }};
}
export async function upstreamText(url, {accept = 'application/json', max = 32768, timeoutMs = 4000} = {}) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    // Workers accepts manual/follow; Node also accepts error, which hid a
    // deployment-only failure in the first implementation. Never follow redirects.
    const response = await fetch(url, {headers: {Accept: accept, 'User-Agent': 'GlobalUtilityAPIs/1.0'}, signal: controller.signal, redirect: 'manual'});
    if (!response.ok) { void response.body?.cancel().catch(() => {}); throw new Error('upstream status'); }
    return await boundedText(response.body, max, timeoutMs);
  } finally { clearTimeout(timer); }
}
