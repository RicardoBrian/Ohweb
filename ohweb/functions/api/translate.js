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
      const raw = await r.text();

      // translate_a/single은 비공식 엔드포인트라 문서화된 계약이 없다.
      // 대량 공유 IP(Cloudflare Workers 등)에서 오는 요청은 봇 트래픽으로
      // 보고 정상 200에 다른 모양(또는 빈 배열, HTML)을 얹어 돌려줄 수
      // 있다 — 이걸 그냥 "번역 없음"으로 조용히 넘기면 프론트엔드는 빈
      // 결과를 정상 응답처럼 받는다. 그래서 모양이 기대와 다르면 여기서
      // 바로 에러로 터뜨리고, 원문 앞부분을 실어 보내 원인을 바로 보이게 한다.
      let data;
      try { data = JSON.parse(raw); }
      catch { throw new Error(`translate: JSON 아닌 응답 (HTTP ${r.status}) — ${raw.slice(0, 200)}`); }

      if (!r.ok) throw new Error(`translate HTTP ${r.status} — ${raw.slice(0, 200)}`);
      if (!Array.isArray(data[0])) throw new Error(`translate: 예상과 다른 응답 형태 — ${raw.slice(0, 200)}`);

      return data[0].map(s => s[0] || '').join('');
    }));
    return json({ translations: results.map(text => ({ text })) });
  } catch (e) {
    return json({ error: e.message }, 502);
  }
}
