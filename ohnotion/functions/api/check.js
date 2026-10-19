/**
 * Cloudflare Pages Function — GET /api/check
 *
 * 관리 페이지의 "점검". 노션 API로 그 페이지를 실제로 읽을 수 있는지 본다.
 *   ?slug=공지            등록된 페이지 점검(페이지 정보만 읽음 — 노션 요청 1건)
 *   ?slug=공지&refresh=1  지금 전체를 새로 그려 캐시를 갈아 끼움("지금 갱신")
 *   ?url=…(&slug=…)       등록 전 링크 확인(링크·iframe 코드에서 페이지 ID를 꺼냄)
 *   (인자 없음)            설정 상태 + 토큰 진단: 토큰이 유효한지, 어느 워크스페이스의 어떤 통합인지
 *                         (워크스페이스를 옮긴 뒤 예전 토큰이 남아 "페이지를 찾을 수 없어요"가 나던 걸 바로 보이게)
 *
 * 값은 절대 돌려주지 않는다 — 환경변수가 "있는지"만 알려 준다.
 */
import { getPage, SLUG_RE } from '../../lib/shared.js';
import { extractPageId, makeClient, pageTitle, explainError } from '../../lib/notion.js';
import { getRendered } from '../../lib/render.js';

const json = (body, status = 200) => new Response(JSON.stringify(body), {
  status,
  headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' },
});

export async function onRequestGet(context) {
  const { request, env } = context;
  const q = new URL(request.url).searchParams;
  const base = { notionEnabled: !!env.NOTION_TOKEN, statsEnabled: !!env.FIREBASE_SERVICE_ACCOUNT_KEY };
  const slugParam = (q.get('slug') || '').normalize('NFC');
  const urlParam = q.get('url') || '';
  if (!slugParam && !urlParam) {
    if (!env.NOTION_TOKEN) return json(base);
    try {
      const me = await makeClient(env.NOTION_TOKEN).me();
      return json({ ...base, token: { ok: true, integration: me.name || '', workspace: me.bot?.workspace_name || '' } });
    } catch (e) {
      return json({ ...base, token: { ok: false, message: explainError(e) } });
    }
  }
  if (!env.NOTION_TOKEN) return json({ ...base, ok: false, level: 'bad', message: 'NOTION_TOKEN이 설정되지 않았어요' });

  let pageId = null;
  const slug = SLUG_RE.test(slugParam) ? slugParam : '_check';
  if (urlParam) {
    pageId = extractPageId(urlParam);
    if (!pageId) {
      return json({ ...base, ok: false, level: 'bad', message: '링크에서 노션 페이지 ID를 찾지 못했어요. 노션에서 그 페이지를 열고 "링크 복사"한 주소를 넣어 주세요' });
    }
  } else {
    const page = await getPage(context, slug).catch(() => null);
    if (!page) return json({ ...base, ok: false, level: 'bad', message: '등록된 주소가 아니에요(또는 링크에 페이지 ID가 없어요)' });
    pageId = page.pageId;
  }

  const t0 = Date.now();
  try {
    if (q.get('refresh') === '1') {
      const { data } = await getRendered(context, pageId, slug, { force: true });
      return json({ ...base, ok: true, level: data.renderMs > 8000 ? 'slow' : 'ok', pageId, title: data.title,
        blocks: data.blocks, ms: Date.now() - t0, lastEdited: data.lastEdited,
        message: `새로 불러왔어요 · 블록 ${data.blocks}개 · ${data.renderMs}ms` });
    }
    const page = await makeClient(env.NOTION_TOKEN).page(pageId);
    return json({ ...base, ok: true, level: 'ok', pageId, title: pageTitle(page), ms: Date.now() - t0,
      lastEdited: page.last_edited_time, message: '노션 연결 정상' });
  } catch (e) {
    return json({ ...base, ok: false, level: 'bad', pageId, ms: Date.now() - t0, message: explainError(e) });
  }
}
