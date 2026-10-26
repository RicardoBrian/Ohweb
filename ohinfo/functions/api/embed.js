/**
 * Cloudflare Pages Function — /api/embed
 *
 * AI 실험실 문장 분류의 "뜻을 이해하는 AI"용. 문장을 다국어 문장 모델(BAAI bge-m3, Workers AI)에
 * 넣어 "뜻 숫자"(벡터)로 바꿔 돌려준다. 한국어·중국어·러시아어·영어 문장이 같은 뜻이면 비슷한 숫자가 된다.
 * 학습(레이블별 평균과 비교)은 학생 브라우저에서 한다 — 여기서는 숫자로 바꾸기만 하고 아무것도 저장하지 않는다.
 *
 * 필요한 설정: Pages 프로젝트(ohinfo) → Settings → Bindings → Workers AI, 이름 `AI`.
 *
 *  GET  /api/embed            연결 확인 { ok, dim }
 *  POST /api/embed { texts }  → { dim, vecs: [base64 Int8 벡터] }  (최대 64문장, 문장당 200자)
 *
 * 벡터는 길이 1로 맞춘 뒤 -127~127 정수(Int8)로 줄여 보낸다(1024개 → 1KB). 코사인 비교에는 충분하다.
 * 같은 문장은 Cloudflare 캐시에 30일 둬서 다시 평가할 때 사용량이 늘지 않게 한다.
 */

const MODEL = '@cf/baai/bge-m3';
const MAX_TEXTS = 64;
const MAX_LEN = 200;
const ALLOWED_ORIGINS = ['https://kakainfo.com', 'https://www.kakainfo.com', 'https://info.kakainfo.com'];

function corsFor(request) {
  const origin = request.headers.get('Origin') || '';
  const ok = ALLOWED_ORIGINS.includes(origin) || /^https:\/\/[a-z0-9-]+\.pages\.dev$/.test(origin) || /^http:\/\/localhost(:\d+)?$/.test(origin);
  return { 'Access-Control-Allow-Origin': ok ? origin : ALLOWED_ORIGINS[0], 'Access-Control-Allow-Methods': 'GET, POST, OPTIONS', 'Access-Control-Allow-Headers': 'Content-Type', Vary: 'Origin' };
}
const json = (body, request, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store', ...corsFor(request) } });

function toB64(vec) {
  let n = 0;
  for (const v of vec) n += v * v;
  n = Math.sqrt(n) || 1;
  const q = new Int8Array(vec.length);
  for (let i = 0; i < vec.length; i++) q[i] = Math.max(-127, Math.min(127, Math.round(vec[i] / n * 127)));
  let s = '';
  const u = new Uint8Array(q.buffer);
  for (let i = 0; i < u.length; i++) s += String.fromCharCode(u[i]);
  return btoa(s);
}
async function keyFor(text) {
  const h = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(MODEL + '\n' + text));
  const hex = [...new Uint8Array(h)].map(b => b.toString(16).padStart(2, '0')).join('');
  return new Request('https://embed-cache.kakainfo.internal/' + hex);
}

export async function onRequest({ request, env }) {
  if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers: corsFor(request) });
  if (!env.AI) return json({ error: 'AI binding not configured', code: 'noBinding' }, request);
  try {
    if (request.method === 'GET') {
      const r = await env.AI.run(MODEL, { text: ['테스트'] });
      return json({ ok: true, model: MODEL, dim: r && r.data && r.data[0] ? r.data[0].length : 0 }, request);
    }
    if (request.method !== 'POST') return json({ error: 'Method Not Allowed' }, request, 405);
    let body;
    try { body = await request.json(); } catch { return json({ error: 'invalid JSON' }, request, 400); }
    const texts = Array.isArray(body && body.texts) ? body.texts.map(t => String(t == null ? '' : t).normalize('NFC').trim().slice(0, MAX_LEN)) : null;
    if (!texts || !texts.length || texts.length > MAX_TEXTS) return json({ error: `texts: 1~${MAX_TEXTS}` }, request, 400);
    const cache = typeof caches !== 'undefined' ? caches.default : null;
    const out = new Array(texts.length).fill(null);
    const keys = await Promise.all(texts.map(keyFor));
    if (cache) {
      await Promise.all(keys.map(async (k, i) => { const hit = await cache.match(k); if (hit) out[i] = await hit.text(); }));
    }
    const need = texts.map((t, i) => ({ t, i })).filter(x => out[x.i] == null && x.t);
    if (need.length) {
      const r = await env.AI.run(MODEL, { text: need.map(x => x.t) });
      const data = r && r.data;
      if (!Array.isArray(data) || data.length !== need.length) throw new Error('unexpected model output');
      need.forEach((x, k) => { out[x.i] = toB64(data[k]); });
      if (cache) await Promise.all(need.map(x => cache.put(keys[x.i], new Response(out[x.i], { headers: { 'Cache-Control': 'public, max-age=2592000' } })).catch(() => {})));
    }
    const dim = out.find(Boolean) ? atob(out.find(Boolean)).length : 0;
    return json({ dim, vecs: out.map(v => v || '') }, request);
  } catch (e) {
    console.error('embed:', e);
    return json({ error: 'embed failed', code: 'aiFail' }, request);
  }
}
