/**
 * Cloudflare Pages Function — /api/translate
 *
 * Vercel의 api/translate.js를 웹 표준 시그니처로 옮긴 것.
 * 호출부(fetch('/api/translate', ...))는 경로가 같아 수정할 필요가 없다.
 *
 * Vercel:     export default async function handler(req, res)   // Node 스타일
 * Cloudflare: export async function onRequest({ request })       // Request -> Response
 *
 * 메서드 분기는 onRequestPost 같은 메서드별 export 대신 이 안에서 처리한다.
 * 한 파일에서 onRequest와 onRequestPost를 함께 export하면 핸들러 체인이
 * 어느 쪽을 타는지 모호해지기 때문. (원본 Vercel 구현과도 같은 구조)
 */

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
};

const json = (body, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json', ...CORS },
  });

export async function onRequest({ request }) {
  if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers: CORS });
  if (request.method !== 'POST') return json({ error: 'Method Not Allowed' }, 405);

  let body;
  try {
    body = await request.json();
  } catch {
    return json({ error: 'invalid JSON body' }, 400);
  }

  const { texts, targetLang, sourceLang = 'KO' } = body || {};
  if (!Array.isArray(texts) || !targetLang) return json({ error: 'missing params' }, 400);

  try {
    const results = await Promise.all(texts.map(async text => {
      if (!text || !text.trim()) return '';
      const url = 'https://translate.googleapis.com/translate_a/single'
        + `?client=gtx&sl=${encodeURIComponent(sourceLang.toLowerCase())}`
        + `&tl=${encodeURIComponent(targetLang.toLowerCase())}`
        + `&dt=t&q=${encodeURIComponent(text)}`;
      const r = await fetch(url);
      if (!r.ok) throw new Error(`translate HTTP ${r.status}`);
      const data = await r.json();
      return (data[0] || []).map(s => s[0] || '').join('');
    }));
    return json({ translations: results.map(text => ({ text })) });
  } catch (e) {
    return json({ error: e.message }, 500);
  }
}
