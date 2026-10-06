/**
 * Cloudflare Pages Function — /api/img-proxy
 *
 * AI 실험실에서 구글 이미지 검색 결과를 끌어다 놓으면 브라우저가 사진 파일이
 * 아니라 "사진 주소"만 넘겨주는 경우가 많다. 다른 사이트 사진은 브라우저가 직접
 * 읽을 수 없어서(CORS) 이 함수가 대신 받아 돌려준다.
 *
 * 남용 막기: 우리 사이트에서만, 이미지 응답만, 8MB까지, 8초 안에.
 * 내부망 주소(localhost, 사설 IP)는 거절한다.
 */

const ALLOWED_ORIGINS = [
  'https://kakainfo.com',
  'https://www.kakainfo.com',
  'https://info.kakainfo.com',
];
const MAX_BYTES = 8 * 1024 * 1024;

function originOk(request) {
  const origin = request.headers.get('Origin') || '';
  return ALLOWED_ORIGINS.includes(origin) || /^https:\/\/[a-z0-9-]+\.pages\.dev$/.test(origin);
}
function cors(request) {
  const origin = request.headers.get('Origin') || '';
  return {
    'Access-Control-Allow-Origin': originOk(request) ? origin : ALLOWED_ORIGINS[0],
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
    'Vary': 'Origin',
  };
}
const fail = (request, status, msg) =>
  new Response(JSON.stringify({ error: msg }), { status, headers: { 'Content-Type': 'application/json', ...cors(request) } });

export function isBlockedHost(host) {
  const h = String(host || '').toLowerCase().replace(/^\[|\]$/g, '');
  if (!h || h === 'localhost' || h.endsWith('.localhost') || h.endsWith('.local') || h.endsWith('.internal')) return true;
  if (/^(127\.|10\.|0\.|169\.254\.|192\.168\.)/.test(h)) return true;
  if (/^172\.(1[6-9]|2\d|3[01])\./.test(h)) return true;
  if (/^(::1|::|f[cd][0-9a-f]{2}:|fe80:)/.test(h)) return true;
  return false;
}

export async function onRequest({ request }) {
  if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers: cors(request) });
  if (request.method !== 'POST') return fail(request, 405, 'Method Not Allowed');
  // 같은 사이트에서 부를 때 Origin이 붙는다. 다른 사이트에서 이 함수를 대신 쓰지 못하게.
  if (!originOk(request)) return fail(request, 403, 'forbidden');

  let url;
  try { url = new URL((await request.json()).url); } catch { return fail(request, 400, 'bad url'); }
  if (!/^https?:$/.test(url.protocol) || isBlockedHost(url.hostname)) return fail(request, 400, 'bad url');

  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 8000);
  try {
    const r = await fetch(url.href, {
      signal: ctrl.signal,
      redirect: 'follow',
      headers: { 'User-Agent': 'Mozilla/5.0 (compatible; OHinfo-AILab/1.0)', Accept: 'image/*' },
    });
    const type = (r.headers.get('Content-Type') || '').split(';')[0].trim().toLowerCase();
    if (!r.ok || !type.startsWith('image/') || type === 'image/svg+xml') return fail(request, 415, 'not an image');
    const len = Number(r.headers.get('Content-Length') || 0);
    if (len > MAX_BYTES) return fail(request, 413, 'too large');
    // Content-Length가 없거나 거짓이어도 8MB에서 끊는다.
    const reader = r.body.getReader();
    const chunks = [];
    let total = 0;
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      total += value.byteLength;
      if (total > MAX_BYTES) { ctrl.abort(); return fail(request, 413, 'too large'); }
      chunks.push(value);
    }
    const body = new Uint8Array(total);
    let off = 0;
    for (const c of chunks) { body.set(c, off); off += c.byteLength; }
    return new Response(body, { status: 200, headers: { 'Content-Type': type, 'Cache-Control': 'no-store', ...cors(request) } });
  } catch (e) {
    return fail(request, 502, 'fetch failed');
  } finally {
    clearTimeout(timer);
  }
}
