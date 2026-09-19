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

// 이 API들은 전부 같은 도메인의 페이지에서만 부른다. '*'로 열어두면
// 아무 사이트나 브라우저에서 호출해 번역 쿼터(유료)와 코드 실행 쿼터를
// 대신 태울 수 있어서, 우리 도메인으로 좁힌다. (curl 같은 직접 호출은
// CORS로 못 막는다 — 그건 Cloudflare 대시보드의 Rate Limiting 규칙으로
// 따로 걸어야 한다.)
const ALLOWED_ORIGINS = [
  'https://kakainfo.com',
  'https://www.kakainfo.com',
  'https://info.kakainfo.com',
  'https://admin.kakainfo.com',
  'https://short.kakainfo.com',
];
function corsFor(request) {
  const origin = request.headers.get('Origin') || '';
  // *.pages.dev은 커스텀 도메인을 붙이기 전 미리보기 배포에서 쓴다.
  const ok = ALLOWED_ORIGINS.includes(origin) || /^https:\/\/[a-z0-9-]+\.pages\.dev$/.test(origin);
  return {
    'Access-Control-Allow-Origin': ok ? origin : ALLOWED_ORIGINS[0],
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
    'Vary': 'Origin',
  };
}
const CORS = {
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

// 응답에 CORS 헤더를 붙인다 — 핸들러 안의 json() 호출을 전부 고치지 않아도
// 되도록 여기서 한 번에 씌운다.
function withCors(res, request) {
  const out = new Response(res.body, res);
  for (const [k, v] of Object.entries(corsFor(request))) out.headers.set(k, v);
  return out;
}

export async function onRequest({ request, env }) {
  try {
    return withCors(await handle(request, env), request);
  } catch (e) {
    // 스택을 응답에 실어 보내면 내부 구조가 노출되고, 200으로 내보내면
    // 호출부가 실패를 성공으로 오해한다. 상세는 Cloudflare 로그에만 남긴다.
    console.error('translate uncaught:', e);
    return withCors(json({ error: '번역 서버에 문제가 발생했습니다.' }, 500), request);
  }
}
