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
 * 안 풀릴 때까지 계속 kakainfo.com 홈으로만 수렴하는 것처럼 보인다. 그래서
 * 실패/미존재 응답(next())엔 항상 Cache-Control: no-store를 붙인다.
 *
 * ⚠ Firestore 무료 읽기 한도(하루 5만 건) 초과 문제: 이 함수는 "점 없는
 * 단일 세그먼트 경로"를 전부 단축코드로 보고 Firestore를 읽는데, 봇/스캐너가
 * 무작위로 찔러보는 경로(/wp-login, /config, /.env 시도 등)도 전부 여기
 * 걸려서 매번 진짜 Firestore 읽기 1건씩을 써버렸다. 실사용 콘솔 그래프에서
 * 하루 읽기가 무료 한도(5만)를 넘겨 6.9만까지 찍힌 걸 확인했다 — 한도를
 * 넘으면 그 날은 Firestore가 모든 읽기를 RESOURCE_EXHAUSTED로 거부하고,
 * 그러면 진짜 단축코드 조회까지 전부 실패해서 매 요청이 next()로 떨어져
 * "단축 URL이 자꾸 kakainfo.com 홈으로 수렴한다"는 신고로 이어졌다.
 * 두 가지로 읽기 낭비를 막는다:
 *   1. ohshrt/public/app.js가 코드 생성에 쓰는 것과 같은 형식(CODE_RE)에
 *      안 맞으면 Firestore를 아예 안 건드리고 next() — 봇 노이즈 대부분을
 *      읽기 비용 0으로 차단한다.
 *   2. 찾아낸 매핑은 Cache API에 5분 캐싱한다 — 같은 코드가 반복 조회돼도
 *      (봇이 같은 경로를 반복하든, 실제로 인기 있는 링크든) 5분에 Firestore
 *      읽기 1건으로 버틴다. 실패/미존재는 캐싱하지 않으므로 막 생성한
 *      링크가 "캐시된 실패" 때문에 늦게 뜨는 일은 없다.
 * 이 두 가지로도 한도를 넘길 만큼 트래픽이 크다면, 근본적으로는 Firebase
 * Blaze(종량제) 요금제로 바꾸는 걸 권장한다 — 무료 5만 건까지는 그대로
 * 공짜고, 넘는 만큼만 10만 건당 약 $0.036이 과금된다. Blaze에서는 한도
 * 초과가 "그 날 전체 서비스 정지"가 아니라 그냥 약간의 과금으로 끝난다.
 */

const PROJECT_ID = 'ohweb-93062';

// ohshrt/public/app.js에서 코드를 생성/검증할 때 쓰는 것과 반드시 같아야
// 한다 — 여기서 더 느슨하면 봇 노이즈를 못 거르고, 더 빡빡하면 정상 코드를
// 오탐으로 걸러 버린다.
const CODE_RE = /^[\p{L}\p{N}_-]{2,32}$/u;
// ohshrt/public/app.js의 RESERVED와 반드시 같이 유지한다 — 저긴 "이 이름으로
// 코드를 못 만들게" 막고, 여긴 "그러니 이 이름으로 온 요청은 Firestore에
// 물어볼 필요도 없다"로 그 보장을 활용한다. CODE_RE만으로는 못 거르는
// 순수 영단어형 봇 프로브(admin, wp-json, graphql 등)가 여기서 걸린다.
const RESERVED = new Set([
  'api', 'admin', 'login', 'logout', 'favicon.ico', 'style.css', 'app.js', 'firebase-config.js', 'admin-auth.js', '견본', '프롬프트',
  'wp-admin', 'wp-login', 'wp-content', 'wp-includes', 'wp-json', 'xmlrpc', 'graphql', 'phpmyadmin',
  'config', 'backup', 'env', 'robots', 'sitemap', 'ads', 'author', 'feed', 'rss', 'license', 'readme',
  'setup', 'install', 'test', 'debug', 'console', 'server-status', 'actuator', 'swagger',
]);
const CACHE_TTL_SECONDS = 300;

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

    // 코드 형식에 안 맞으면(봇이 찔러보는 무작위 경로 등) Firestore를 아예
    // 안 읽는다 — 이게 무료 읽기 한도를 지키는 가장 큰 방어선이다.
    if (!CODE_RE.test(code)) return next();
    // 형식은 맞지만(순수 영단어) 절대 실제 코드일 수 없는 예약어도 조회 없이 차단.
    if (RESERVED.has(code.toLowerCase())) return next();

    // 성공한 조회는 Cache API에 잠깐 캐싱해서, 같은 코드가 반복 조회돼도
    // Firestore 읽기를 매번 새로 쓰지 않는다. 실패/미존재는 절대 캐싱하지
    // 않는다(막 만든 링크가 캐시된 실패 때문에 안 뜨는 걸 막기 위해).
    const cache = caches.default;
    const cacheKey = new Request(new URL(`/__shortlink-cache/${encodeURIComponent(code)}`, request.url));
    const cachedHit = await cache.match(cacheKey);
    if (cachedHit) {
      const cachedTarget = await cachedHit.text();
      return new Response(null, { status: 302, headers: { Location: cachedTarget, 'Cache-Control': 'no-store' } });
    }

    const url = `https://firestore.googleapis.com/v1/projects/${PROJECT_ID}/databases/(default)/documents/short_links/${encodeURIComponent(code)}`;
    const r = await fetch(url, { cache: 'no-store' });
    if (!r.ok) return withNoStore(await next());

    const data = await r.json();
    const target = data?.fields?.url?.stringValue;
    if (!target) return withNoStore(await next());

    context.waitUntil(cache.put(cacheKey, new Response(target, { headers: { 'Cache-Control': `max-age=${CACHE_TTL_SECONDS}` } })));
    return new Response(null, { status: 302, headers: { Location: target, 'Cache-Control': 'no-store' } });
  } catch {
    // 단축 링크 조회가 어떤 이유로 실패하든 평소의 사이트가 그대로 떠야 한다.
    try { return withNoStore(await next()); } catch { return next(); }
  }
}
