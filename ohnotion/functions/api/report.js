/**
 * Cloudflare Pages Function — POST /api/report
 *
 * 학생 화면(public/view.js)이 보내는 기록을 그날 통계에 +1 한다.
 *   ok      페이지를 열었음(열람 수)
 *   report  학생이 "이상해요" 버튼을 누름
 * 서버 쪽 결과(예전 내용으로 대신 보여줌 stale / 못 불러옴 error)는
 * functions/[[slug]].js가 직접 기록한다.
 *
 * notion_stats/{YYYY-MM-DD}_{주소} 문서에 카운터가 쌓이고, 관리 페이지가 최근
 * 7일치를 보여 준다. 학생 브라우저가 Firestore에 직접 쓰지 않고 여기(서비스
 * 계정)를 거쳐서, 규칙에서는 notion_stats 쓰기를 전부 막아 둘 수 있다.
 *
 * 필요한 환경변수: FIREBASE_SERVICE_ACCOUNT_KEY (없으면 통계만 안 쌓임).
 */
import { getPage, recordStat, SLUG_RE } from '../../lib/shared.js';

const RESULTS = new Set(['ok', 'report']);
const noContent = (status = 204) => new Response(null, { status, headers: { 'Cache-Control': 'no-store' } });

export async function onRequestPost(context) {
  const { request, env } = context;
  try {
    // 같은 사이트의 화면에서만 받는다(다른 사이트가 통계를 부풀리지 못하게).
    const origin = request.headers.get('Origin');
    if (origin && origin !== new URL(request.url).origin) return noContent(403);

    const body = await request.json().catch(() => null);
    const slug = typeof body?.slug === 'string' ? body.slug.normalize('NFC') : '';
    const result = body?.result;
    if (!SLUG_RE.test(slug) || !RESULTS.has(result)) return noContent(400);
    if (!(await getPage(context, slug))) return noContent(404);

    if (!env.FIREBASE_SERVICE_ACCOUNT_KEY) return noContent(503);
    return noContent((await recordStat(env, slug, result)) ? 204 : 500);
  } catch (e) {
    console.error('notion report 실패:', e?.message || e);
    return noContent(500);
  }
}
