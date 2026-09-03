/**
 * Cloudflare Pages Function — 단축 URL 리다이렉트 (kakainfo.com/{코드}).
 *
 * 단축 링크를 학생용 도메인(kakainfo.com)에서 바로 열 수 있어야 해서, 관리
 * 페이지(ohshrt, short.kakainfo.com)가 아니라 이 프로젝트에 리다이렉트를 둔다.
 * 관리 페이지에서 만든 링크가 가리키는 곳이 바로 여기다.
 *
 * ⚠ 이 파일은 kakainfo.com의 **모든** 요청을 가로챈다(Pages Functions는 정적
 * 파일보다 먼저 실행된다 — Workers의 [assets]와 정반대다). 학생 사이트 전체가
 * 여기 걸리므로 아래 두 가지를 반드시 지킨다:
 *
 *   1. 단축코드로 볼 수 없는 요청은 무조건 next()로 넘긴다. 코드에는 점(.)을
 *      쓸 수 없으므로(ohshrt/public/app.js의 CODE_RE) 점이 있으면 전부 정적
 *      파일 요청이다 — ohdlet.html, theme.css, session.js 등이 전부 여기 걸린다.
 *   2. 무슨 일이 있어도 예외를 밖으로 던지지 않는다. 조회가 실패하든 Firestore가
 *      죽어있든 next()로 넘겨서, 이 기능의 장애가 학생 사이트를 못 깨뜨리게 한다.
 *
 * 한글 코드는 실패하고 영문 코드만 되던 문제 — URL.pathname은 비-ASCII 구간을
 * 디코딩하지 않고 퍼센트 인코딩된 채로 돌려준다(node -e로 직접 확인함:
 * new URL('.../한글').pathname === '/%ED%95%9C%EA%B8%80', 디코딩된 문자열이
 * 아니다). 그 상태로 다시 encodeURIComponent를 씌우면 %가 %25로 한 번 더
 * 인코딩되어 Firestore가 전혀 다른 경로를 조회하게 된다. 그래서 반드시
 * decodeURIComponent로 한 번 푼 뒤에 NFC 정규화하고, 그 순수 문자열을
 * encodeURIComponent로 다시 인코딩해서 Firestore REST 경로에 넣는다.
 * 영문 코드는 퍼센트 인코딩될 게 없어서 이 문제가 안 보였을 뿐이다.
 *
 * 조회는 Firestore REST API를 그냥 fetch로 친다 — Admin SDK도 API 키도 필요
 * 없다. short_links/{code} 개별 문서는 규칙상 누구나 get 할 수 있다(레포 루트의
 * ohweb-firestore.rules).
 *
 * ⚠ 캐싱 주의: 링크를 막 만든 직후라 아직 전파 전이거나 일시적으로 조회가
 * 실패해서 next()로 넘어간 경우, Cloudflare 엣지가 그 "홈으로 폴백" 응답을
 * 그 코드 경로에 대해 캐싱해버리면 — 이후 문서가 실제로 만들어져도 캐시가
 * 안 풀릴 때까지 계속 kakainfo.com 홈으로만 수렴하는 것처럼 보인다. 이게
 * "분명 고쳤는데 자꾸 다시 kakainfo.com으로 간다"는 반복 신고의 유력한
 * 원인이라, 이 함수가 관여하는 모든 응답(성공 리다이렉트/폴백 둘 다)에
 * Cache-Control: no-store를 강제로 붙인다. Firestore 조회 자체도
 * cache:'no-store'로 요청해서 Workers 런타임의 fetch 캐시까지 배제한다.
 */

const PROJECT_ID = 'ohweb-93062';

function withNoStore(res) {
  const out = new Response(res.body, res);
  out.headers.set('Cache-Control', 'no-store');
  return out;
}

export async function onRequest(context) {
  const { next, request } = context;
  try {
    if (request.method !== 'GET') return next();

    const { pathname } = new URL(request.url);
    const stripped = pathname.replace(/^\/+|\/+$/g, '');
    if (!stripped || stripped.includes('/')) return next();

    let code;
    try { code = decodeURIComponent(stripped); } catch { return next(); }
    code = code.normalize('NFC');

    // 점이 있으면 정적 파일(*.html, *.css, *.js, favicon.ico ...) — 코드가 아니다.
    if (code.includes('.')) return next();

    const url = `https://firestore.googleapis.com/v1/projects/${PROJECT_ID}/databases/(default)/documents/short_links/${encodeURIComponent(code)}`;
    const r = await fetch(url, { cache: 'no-store' });
    if (!r.ok) return withNoStore(await next());

    const data = await r.json();
    const target = data?.fields?.url?.stringValue;
    if (!target) return withNoStore(await next());

    return new Response(null, { status: 302, headers: { Location: target, 'Cache-Control': 'no-store' } });
  } catch {
    // 단축 링크 조회가 어떤 이유로 실패하든 평소의 사이트가 그대로 떠야 한다.
    try { return withNoStore(await next()); } catch { return next(); }
  }
}
