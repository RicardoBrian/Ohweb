/**
 * Cloudflare Pages Function — /api/translate
 *
 * 호출부(fetch('/api/translate', ...))는 경로·요청/응답 형태가 그대로라
 * ohdlet.html / formlab.html / admin.html의 deepl()·gtranslate()·
 * translateTexts() 어느 쪽도 고칠 필요가 없다.
 *
 * 원래는 translate.googleapis.com(비공식 Google 엔드포인트)을 불렀는데,
 * Vercel에서는 문제없다가 Cloudflare Pages로 옮긴 뒤 결과가 비거나
 * 이상해지는 문제가 있었다 — Cloudflare Workers는 전 세계가 같은 공유 IP
 * 대역을 쓰는데, 비공식 엔드포인트가 이런 대량 트래픽을 봇으로 보고
 * 다르게(또는 빈 값으로) 응답했을 가능성이 높다. admin.html의 마이그레이션
 * 스크립트가 이미 쓰고 있던 DeepL 키를 그대로 재사용해 정식 API로 바꿨다.
 *
 * 운영에서 원인 불명의 500이 재현되는 중이라, 아래 로직 전체를 바깥에서
 * try/catch로 한 번 더 감싸 — 어떤 예외가 어디서 나든 절대 그냥 500으로
 * 삼켜지지 않고 진단 가능한 JSON(200)으로 응답 본문에 그대로 드러나게
 * 했다. 원인이 확인되면 이 래퍼는 걷어내도 된다.
 */

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
};

// admin.html의 MIG_DEEPL_KEY와 동일한 키. ":fx" 접미사가 무료 플랜 표시라
// api-free.deepl.com을 쓴다 — 유료(Pro) 키라면 api.deepl.com이어야 한다.
const DEEPL_KEY = 'cf131ad1-2cd2-455b-8915-dd32ddfce706:fx';
const DEEPL_URL = 'https://api-free.deepl.com/v2/translate';

const json = (body, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json', ...CORS },
  });

/**
 * 호출부는 'ko' / 'zh-cn' / 'ru' / 'en' 처럼 소문자·지역변형 섞인 코드를
 * 쓰는데, DeepL은 대문자 기본 코드를 쓰고 target이 영어일 때만 지역변형
 * (EN-US/EN-GB)을 요구한다. admin.html의 MIG_TGT가 이미 이 앱에서 쓰는
 * 매핑(Zh→ZH, Ru→RU, En→EN-US)을 정해뒀으므로 그것과 맞춘다.
 */
function toDeepLLang(code, isTarget) {
  const base = String(code).toUpperCase().split('-')[0]; // 'zh-cn' -> 'ZH', 'en' -> 'EN'
  if (base === 'EN' && isTarget) return 'EN-US';
  return base;
}

async function handle(request) {
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

  // 빈 문자열은 DeepL에 보내지 않는다(거부당할 수 있다) — 원래 자리에는
  // 빈 결과를 그대로 채워 넣어서 texts와 translations의 개수·순서를 맞춘다.
  const nonEmpty = texts.map((t, i) => ({ t, i })).filter(x => x.t && String(x.t).trim());
  if (!nonEmpty.length) return json({ translations: texts.map(() => ({ text: '' })) });

  try {
    const r = await fetch(DEEPL_URL, {
      method: 'POST',
      headers: { Authorization: `DeepL-Auth-Key ${DEEPL_KEY}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        text: nonEmpty.map(x => x.t),
        target_lang: toDeepLLang(targetLang, true),
        source_lang: toDeepLLang(sourceLang, false),
      }),
    });
    const raw = await r.text();

    let data;
    try { data = JSON.parse(raw); }
    catch { throw new Error(`DeepL: JSON 아닌 응답 (HTTP ${r.status}) — ${raw.slice(0, 200)}`); }

    if (!r.ok) throw new Error(`DeepL HTTP ${r.status} — ${data.message || raw.slice(0, 200)}`);
    if (!Array.isArray(data.translations)) throw new Error(`DeepL: 예상과 다른 응답 형태 — ${raw.slice(0, 200)}`);

    const out = texts.map(() => '');
    nonEmpty.forEach((x, idx) => { out[x.i] = data.translations[idx]?.text || ''; });
    return json({ translations: out.map(text => ({ text })) });
  } catch (e) {
    return json({ error: e.message }, 502);
  }
}

export async function onRequest({ request }) {
  try {
    return await handle(request);
  } catch (e) {
    // 여기 걸린다는 건 위 handle() 안의 두 try/catch가 잡지 못한,
    // 완전히 예상 밖의 예외라는 뜻 — 정확한 종류·위치를 그대로 노출한다.
    return json({ error: 'UNCAUGHT', name: e && e.name, message: e && e.message, stack: String(e && e.stack).slice(0, 1000) }, 200);
  }
}
