/**
 * Cloudflare Pages Function — notion.kakainfo.com 의 학생 화면.
 *
 *   /                 등록된 노션 페이지 목록
 *   /{주소}            그 노션 페이지
 *   /{주소}/{페이지ID}  그 안의 하위 페이지(본문 링크로 이동)
 *
 * 노션 내용은 서버가 Notion API로 읽어 HTML로 그려 보낸다(lib/notion.js,
 * 캐시는 lib/render.js). 학생 브라우저는 노션 서버에 전혀 접속하지 않는다 —
 * 학교처럼 IP 하나를 반 전체가 같이 쓰면 노션이 429로 막아 화면이 깨지거나
 * 무한 새로고침에 빠졌기 때문이다(iframe으로 notion.site를 띄우던 첫 버전에서
 * 실제로 확인).
 *
 * 연결된 노션 페이지라면 하위 페이지 ID로 무엇이든 열린다. 노션 통합(NOTION_TOKEN)을
 * 연결한 페이지는 공개한다는 뜻이므로, 공개하면 안 되는 페이지에는 연결하지 않는다.
 *
 * ⚠ 이 함수는 사이트의 모든 요청을 먼저 받는다(Pages Functions는 정적 파일보다
 * 먼저 실행). 우리 주소일 수 없는 요청(점이 들어간 파일, admin 등 예약어)은 바로
 * next()로 넘기고, 어떤 예외도 밖으로 던지지 않는다.
 */
import { escapeHtml, getPage, listPages, parsePath, recordStat } from '../lib/shared.js';
import { getRendered } from '../lib/render.js';
import { explainError } from '../lib/notion.js';

const SITE = 'notion.kakainfo.com';
// 학생 화면의 CSS/JS 주소 뒤에 붙는 버전. view.css나 view.js를 고치면 이 값을 바꾼다 —
// 그래야 브라우저·Cloudflare에 남은 예전 파일 대신 새 파일을 받는다(첫 iframe 버전의
// view.css가 남아 여백·HTML 창 크기가 다 깨져 보였던 일이 있었다).
const ASSET_V = '2026101503';

function html(body, status = 200) {
  return new Response(body, {
    status,
    headers: {
      'Content-Type': 'text/html; charset=utf-8',
      // 캐시는 함수 안에서 한다. HTML은 브라우저가 붙잡고 있지 않게.
      'Cache-Control': 'no-store',
    },
  });
}

function shell(title, body, { head = '', bodyAttrs = '' } = {}) {
  return `<!DOCTYPE html>
<html lang="ko">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>${escapeHtml(title)}</title>
<link rel="icon" type="image/svg+xml" href="/icon.svg">
<link rel="apple-touch-icon" href="/apple-touch-icon.png">
<link rel="stylesheet" href="/view.css?v=${ASSET_V}">
${head}
</head>
<body${bodyAttrs}>
${body}
</body>
</html>`;
}

function topbar(inner = '') {
  return `<header class="bar">
  <a class="brand" href="/"><img src="/logo.png" alt="" width="26" height="26"><span>kakainfo 노션</span></a>
  ${inner}
</header>`;
}

function renderIndex(pages) {
  const visible = (pages || []).filter((p) => !p.hidden);
  const items = visible.length
    ? visible.map((p) => `
      <a class="item" href="/${encodeURIComponent(p.slug)}">
        <span class="item-title">${escapeHtml(p.title || p.slug)}</span>
        <span class="item-path">${SITE}/${escapeHtml(p.slug)}</span>
      </a>`).join('')
    : `<p class="empty">${pages ? '아직 등록된 페이지가 없어요.' : '목록을 불러오지 못했어요. 잠시 후 새로고침해 주세요.'}</p>`;
  return shell('kakainfo 노션', `${topbar()}
<main class="list">
  <h1>노션 페이지</h1>
  <div class="items">${items}</div>
</main>`);
}

function renderMessage(title, message, status) {
  return html(shell(`${title} — kakainfo 노션`, `${topbar()}
<main class="list">
  <h1>${escapeHtml(title)}</h1>
  <p class="empty">${message}</p>
</main>`), status);
}

const KATEX = 'https://cdn.jsdelivr.net/npm/katex@0.16.11/dist';

function renderDoc(page, sub, { data, source }) {
  const pageTitle = data.title;
  const fmt = (iso) => iso ? new Date(iso).toLocaleString('ko-KR', { timeZone: 'Asia/Seoul', month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' }) : '';
  const crumbs = sub
    ? `<a href="/${encodeURIComponent(page.slug)}">← ${escapeHtml(page.title || page.slug)}</a>`
    : '';
  // 예비본은 평소에도 2분마다 한 번씩 나간다(그동안 뒤에서 새로 그림). 30분 넘게
  // 못 갈아 끼웠을 때만 "예전 내용"이라고 알린다.
  const old = source === 'stale' && Date.now() - Date.parse(data.renderedAt || 0) > 30 * 60 * 1000;
  const staleNote = old
    ? '<div class="notice">노션 연결이 잠시 원활하지 않아 마지막으로 저장된 내용을 보여 주고 있어요.</div>' : '';
  const head = data.hasEquation
    ? `<link rel="stylesheet" href="${KATEX}/katex.min.css">
<script defer src="${KATEX}/katex.min.js"></script>` : '';
  return shell(`${pageTitle} — kakainfo 노션`, `${topbar(`
  <span class="bar-title">${escapeHtml(page.title || page.slug)}</span>
  <div class="bar-actions">
    <button type="button" class="btn warn" id="reportBtn">이상해요</button>
  </div>`)}
${staleNote}
${data.coverUrl ? `<div class="cover" style="background-image:url('${escapeHtml(data.coverUrl)}')"></div>` : ''}
<main class="doc">
  ${crumbs ? `<nav class="crumbs">${crumbs}</nav>` : ''}
  ${data.icon ? `<div class="doc-icon${data.coverUrl ? ' on-cover' : ''}">${escapeHtml(data.icon)}</div>` : ''}
  <h1 class="doc-title">${escapeHtml(pageTitle)}</h1>
  <div class="notion">${data.html}</div>
  <footer class="doc-foot">노션 수정 ${escapeHtml(fmt(data.lastEdited))} · 동기화 ${escapeHtml(fmt(data.renderedAt))}</footer>
</main>
<div class="notice floating" id="notice" hidden><span id="noticeText"></span><button type="button" class="btn ghost" id="closeNotice" aria-label="닫기">✕</button></div>
<script src="/view.js?v=${ASSET_V}" defer></script>`, { head, bodyAttrs: ` class="doc-page" data-slug="${escapeHtml(page.slug)}"` });
}

export async function onRequest(context) {
  const { request, next, env } = context;
  try {
    if (request.method !== 'GET' && request.method !== 'HEAD') return next();
    const { pathname } = new URL(request.url);

    if (pathname === '/' || pathname === '') {
      return html(renderIndex(await listPages(context).catch(() => null)));
    }

    const route = parsePath(pathname);
    if (!route) return next();

    const page = await getPage(context, route.slug).catch(() => null);
    if (!page) {
      return renderMessage('페이지를 찾을 수 없어요',
        `<b>${escapeHtml(route.slug)}</b> 주소로 등록된 노션 페이지가 없어요.<br>주소를 다시 확인하거나 <a href="/">전체 목록</a>에서 찾아보세요.`, 404);
    }
    if (!env.NOTION_TOKEN) {
      return renderMessage('준비 중이에요', '관리자가 노션 연결 설정을 마치면 열려요. (NOTION_TOKEN 없음)', 503);
    }

    const pageId = route.sub || page.pageId;
    let result;
    try {
      result = await getRendered(context, pageId, page.slug, {
        onBackgroundError: () => recordStat(env, page.slug, 'stale'),
      });
    } catch (e) {
      console.error(`노션 그리기 실패 ${page.slug}/${pageId}:`, e?.message || e);
      context.waitUntil(recordStat(env, page.slug, 'error'));
      return renderMessage('노션 내용을 불러오지 못했어요',
        `잠시 후 새로고침해 주세요.<br><span class="muted">${escapeHtml(explainError(e))}</span>`, 502);
    }
    if (result.source === 'stale' && result.error) context.waitUntil(recordStat(env, page.slug, 'stale'));
    return html(renderDoc(page, route.sub, result));
  } catch (e) {
    console.error('notion 페이지 오류:', e?.message || e);
    try { return await next(); } catch { return new Response('일시적인 오류예요. 새로고침해 주세요.', { status: 500 }); }
  }
}
