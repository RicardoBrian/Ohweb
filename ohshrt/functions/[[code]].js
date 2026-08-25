/**
 * Cloudflare Pages Function — catch-all for short-code redirects.
 *
 * 중요: Pages Functions는 정적 파일보다 **먼저** 요청을 가로챈다(Workers의
 * [assets]와 정반대다 — 거기선 정적 파일이 먼저였다). 그래서 이 catch-all은
 * `/`, `/app.js`, `/style.css` 까지 전부 받는다. 정적 파일을 그대로 서빙하려면
 * 반드시 next()로 넘겨줘야 한다.
 *
 * 순서:
 *   1. next()로 정적 에셋을 먼저 시도한다 → 있으면 그대로 응답(관리 페이지 등)
 *   2. 정적 에셋이 없고(404) 단일 세그먼트 GET이면 → 단축코드로 보고 조회
 *   3. 그것도 없으면 → 404
 *
 * 조회는 Firestore REST API를 그냥 fetch로 친다 — Admin SDK도, API 키도 필요
 * 없다. short_links/{code} 개별 문서는 규칙상 누구나 get 할 수 있다(레포 루트의
 * ohweb-firestore.rules). ohweb/ohinfo의 functions/api/translate.js와 같은 스타일.
 */

const PROJECT_ID = 'ohweb-93062';

function notFound() {
  return new Response('404: 존재하지 않는 링크입니다.', {
    status: 404,
    headers: { 'Content-Type': 'text/plain; charset=utf-8' },
  });
}

export async function onRequest(context) {
  const { params, next, request } = context;

  // 1. 정적 에셋 우선 — index.html / app.js / style.css / firebase-config.js 등
  const asset = await next();
  if (asset.status !== 404) return asset;

  // 2. 에셋이 없으면 단축코드 조회. 단일 세그먼트 GET만 대상.
  if (request.method !== 'GET') return asset;
  const segments = params.code;
  if (!segments || segments.length !== 1 || !segments[0]) return notFound();
  const code = segments[0];

  const url = `https://firestore.googleapis.com/v1/projects/${PROJECT_ID}/databases/(default)/documents/short_links/${encodeURIComponent(code)}`;
  let r;
  try {
    r = await fetch(url);
  } catch {
    return notFound();
  }
  if (!r.ok) return notFound();

  const data = await r.json().catch(() => null);
  const target = data?.fields?.url?.stringValue;
  if (!target) return notFound();

  return Response.redirect(target, 302);
}
