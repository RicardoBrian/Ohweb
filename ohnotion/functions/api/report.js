/**
 * Cloudflare Pages Function — POST /api/report
 *
 * 뷰어(public/view.js)가 "노션이 열렸는지"를 한 번 보내면 그날의 통계에 +1 한다.
 * notion_stats/{YYYY-MM-DD}_{주소} 문서에 ok/slow/timeout/loop/report 카운터가
 * 쌓이고, 관리 페이지가 최근 7일치를 모아 보여준다.
 *
 * 학생 브라우저가 Firestore에 직접 쓰지 않고 여기(서비스 계정)를 거친다 — 그래야
 * 규칙에서 notion_stats 쓰기를 전부 막아둘 수 있다(관리자만 읽기).
 *
 * 필요한 Cloudflare 환경변수 — Pages 프로젝트 `ohnotion`:
 *   FIREBASE_SERVICE_ACCOUNT_KEY (Secret) = 서비스 계정 JSON 전체.
 *   ohweb/ohinfo에 넣은 것과 같은 값이면 된다(프로젝트가 달라 따로 넣어야 함).
 * 키가 없으면 통계만 안 쌓이고 학생 화면은 그대로 동작한다. 관리 페이지에
 * "통계 꺼짐" 안내가 뜬다(/api/check의 statsEnabled).
 */
import { getAccessToken, getPage, incrementStat, kstDay, SLUG_RE } from '../../lib/shared.js';

const RESULTS = new Set(['ok', 'slow', 'timeout', 'loop', 'report']);

// 토큰은 1시간짜리라 isolate가 살아 있는 동안 재사용한다.
let tokenCache = { token: null, exp: 0 };
async function token(env) {
  if (tokenCache.token && Date.now() < tokenCache.exp) return tokenCache.token;
  const sa = JSON.parse(env.FIREBASE_SERVICE_ACCOUNT_KEY);
  const t = await getAccessToken(sa);
  tokenCache = { token: t, exp: Date.now() + 50 * 60 * 1000 };
  return t;
}

const noContent = (status = 204) => new Response(null, { status, headers: { 'Cache-Control': 'no-store' } });

export async function onRequestPost(context) {
  const { request, env } = context;
  try {
    // 같은 사이트의 뷰어에서만 받는다(다른 사이트가 통계를 부풀리지 못하게).
    const origin = request.headers.get('Origin');
    if (origin && origin !== new URL(request.url).origin) return noContent(403);

    const body = await request.json().catch(() => null);
    const slug = typeof body?.slug === 'string' ? body.slug.normalize('NFC') : '';
    const result = body?.result;
    if (!SLUG_RE.test(slug) || !RESULTS.has(result)) return noContent(400);

    // 등록된 페이지에 대한 기록만 남긴다(캐시된 조회라 대개 Firestore 읽기 없음).
    if (!(await getPage(context, slug))) return noContent(404);

    if (!env.FIREBASE_SERVICE_ACCOUNT_KEY) return noContent(503);
    await incrementStat(await token(env), { slug, day: kstDay(), result });
    return noContent();
  } catch (e) {
    console.error('notion report 실패:', e?.message || e);
    return noContent(500);
  }
}
