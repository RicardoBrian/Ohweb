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
 * 조회는 Firestore REST API를 그냥 fetch로 친다 — Admin SDK도 API 키도 필요
 * 없다. short_links/{code} 개별 문서는 규칙상 누구나 get 할 수 있다(레포 루트의
 * ohweb-firestore.rules).
 */

const PROJECT_ID = 'ohweb-93062';

export async function onRequest(context) {
  const { params, next, request } = context;
  try {
    const segments = params.code;
    // 루트("/")거나 여러 단계 경로면 단축코드가 아니다.
    if (!segments || segments.length !== 1 || !segments[0]) return next();

    const code = segments[0];
    // 점이 있으면 정적 파일(*.html, *.css, *.js, favicon.ico ...) — 코드가 아니다.
    if (code.includes('.')) return next();
    if (request.method !== 'GET') return next();

    const url = `https://firestore.googleapis.com/v1/projects/${PROJECT_ID}/databases/(default)/documents/short_links/${encodeURIComponent(code)}`;
    const r = await fetch(url);
    if (!r.ok) return next();

    const data = await r.json();
    const target = data?.fields?.url?.stringValue;
    if (!target) return next();

    return Response.redirect(target, 302);
  } catch {
    // 단축 링크 조회가 어떤 이유로 실패하든 평소의 사이트가 그대로 떠야 한다.
    return next();
  }
}
