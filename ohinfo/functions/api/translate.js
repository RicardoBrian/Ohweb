/**
 * Cloudflare Pages Function — /api/translate
 *
 * 호출부(fetch('/api/translate', ...))는 경로·요청/응답 형태가 그대로라
 * ohdlet.html / formlab.html / admin.html의 deepl()·gtranslate()·
 * translateTexts() 어느 쪽도 고칠 필요가 없다.
 *
 * DeepL 무료 API는 "월 50만자"가 아니라 "평생 100만자"(리셋 안 됨) 한도라서
 * Google Cloud Translation API(Basic v2)로 교체했다 — 이쪽은 매달 50만자가
 * 리셋되는 무료 쿼터라 학교 규모 사용량엔 이게 더 맞는다.
 *
 * API 키는 소스에 박아두지 않고 Cloudflare 환경변수(Secret)로 관리한다 —
 * Pages 프로젝트 Settings → Environment variables → GOOGLE_TRANSLATE_KEY
 * (Production/Preview 둘 다) 추가해야 동작한다. 키가 없으면 500을 반환한다.
 */

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
};

const GOOGLE_URL = 'https://translation.googleapis.com/language/translate/v2';

const json = (body, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json', ...CORS },
  });

/**
 * 호출부는 'ko' / 'zh-cn' / 'ru' / 'en' 처럼 소문자·지역변형 섞인 코드를
 * 쓴다. Google은 대부분 소문자 base 코드를 그대로 받아들이는데, 중국어
 * (간체)만 'zh-CN'을 써야 정확히 매칭된다.
 */
function toGoogleLang(code) {
  const c = String(code).toLowerCase();
  if (c === 'zh' || c === 'zh-cn') return 'zh-CN';
  return c.split('-')[0];
}

async function handle(request, env) {
  if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers: CORS });
  if (request.method !== 'POST') return json({ error: 'Method Not Allowed' }, 405);

  const apiKey = env.GOOGLE_TRANSLATE_KEY;
  if (!apiKey) return json({ error: 'GOOGLE_TRANSLATE_KEY not configured' }, 500);

  let body;
  try {
    body = await request.json();
  } catch {
    return json({ error: 'invalid JSON body' }, 400);
  }

  const { texts, targetLang, sourceLang = 'KO' } = body || {};
  if (!Array.isArray(texts) || !targetLang) return json({ error: 'missing params' }, 400);

  // 빈 문자열은 보내지 않는다 — 원래 자리에는 빈 결과를 그대로 채워 넣어서
  // texts와 translations의 개수·순서를 맞춘다.
  const nonEmpty = texts.map((t, i) => ({ t, i })).filter(x => x.t && String(x.t).trim());
  if (!nonEmpty.length) return json({ translations: texts.map(() => ({ text: '' })) });

  try {
    const r = await fetch(`${GOOGLE_URL}?key=${apiKey}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        q: nonEmpty.map(x => x.t),
        target: toGoogleLang(targetLang),
        source: toGoogleLang(sourceLang),
        format: 'text',
      }),
    });
    const raw = await r.text();

    let data;
    try { data = JSON.parse(raw); }
    catch { throw new Error(`Google: JSON 아닌 응답 (HTTP ${r.status}) — ${raw.slice(0, 200)}`); }

    if (!r.ok) throw new Error(`Google HTTP ${r.status} — ${data.error?.message || raw.slice(0, 200)}`);
    const translations = data?.data?.translations;
    if (!Array.isArray(translations)) throw new Error(`Google: 예상과 다른 응답 형태 — ${raw.slice(0, 200)}`);

    const out = texts.map(() => '');
    nonEmpty.forEach((x, idx) => { out[x.i] = translations[idx]?.translatedText || ''; });
    return json({ translations: out.map(text => ({ text })) });
  } catch (e) {
    return json({ error: e.message }, 502);
  }
}

export async function onRequest({ request, env }) {
  try {
    return await handle(request, env);
  } catch (e) {
    return json({ error: 'UNCAUGHT', name: e && e.name, message: e && e.message, stack: String(e && e.stack).slice(0, 1000) }, 200);
  }
}
