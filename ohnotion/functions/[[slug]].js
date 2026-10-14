/**
 * Cloudflare Pages Function — notion.kakainfo.com 의 학생용 화면 두 가지.
 *
 *   /          등록된 노션 페이지 목록
 *   /{주소}     그 노션 페이지를 화면 가득 iframe으로 띄운 뷰어
 *
 * 학생 화면은 서버에서 HTML을 다 만들어 보낸다 — Firebase SDK 같은 무거운
 * 스크립트를 학생 PC에 안 내려보내려고. "노션이 학생 PC에서 안 열린다"가 이
 * 사이트의 출발점이라, 우리 쪽 화면만큼은 무조건 가볍고 확실하게 떠야 한다.
 *
 * 노션을 직접 링크하면 노션 앱 모드로 열리면서(로그인 확인·워크스페이스 이동)
 * 학교 PC에서 무한 새로고침에 빠지는 경우가 있었는데, "웹에 게시" 링크
 * (*.notion.site)를 iframe으로 넣으면 잘 열렸다(구글 사이트 임베드로 확인).
 *
 * 뷰어는 iframe이 실제로 열렸는지 지켜보고 결과를 /api/report로 보낸다 —
 * 관리 페이지(/admin)의 "모니터링"이 이 기록을 모아 보여준다:
 *   ok       20초 안에 열림(8초 이내)
 *   slow     열리긴 했는데 8초 넘게 걸림
 *   timeout  20초가 지나도 안 열림
 *   loop     40초 안에 iframe이 4번 이상 다시 로드됨 = 무한 새로고침
 *   report   학생이 "안 열려요" 버튼을 누름
 * 교차 출처 iframe이라 안쪽 내용은 볼 수 없다. 그래서 "네트워크가 막혀
 * 브라우저 오류 화면이 뜬 경우"는 load 이벤트가 정상처럼 와서 ok로 잡힐 수
 * 있다 — 그 경우를 위해 학생이 직접 누르는 "안 열려요" 버튼을 둔다.
 *
 * ⚠ 이 함수는 사이트의 모든 요청을 먼저 받는다(Pages Functions는 정적 파일보다
 * 먼저 실행). 주소일 수 없는 요청(점이 들어간 파일, admin 등 예약어)은 바로
 * next()로 넘기고, 어떤 예외도 밖으로 던지지 않는다.
 */
import { escapeHtml, getPage, listPages, slugFromPath } from '../lib/shared.js';

const SITE = 'notion.kakainfo.com';

function html(body, status = 200) {
  return new Response(body, {
    status,
    headers: {
      'Content-Type': 'text/html; charset=utf-8',
      // 페이지 정보는 함수 안에서 따로 캐싱한다. HTML 자체는 브라우저가 붙잡고
      // 있지 않게 해서, 관리 페이지에서 고친 게 새로고침 한 번에 보이게 한다.
      'Cache-Control': 'no-store',
    },
  });
}

function shell(title, body, { bodyClass = '' } = {}) {
  return `<!DOCTYPE html>
<html lang="ko">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>${escapeHtml(title)}</title>
<link rel="icon" type="image/svg+xml" href="/icon.svg">
<link rel="apple-touch-icon" href="/apple-touch-icon.png">
<link rel="stylesheet" href="/view.css">
</head>
<body class="${bodyClass}">
${body}
</body>
</html>`;
}

function topbar(inner) {
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
  return shell('kakainfo 노션', `${topbar('')}
<main class="list">
  <h1>노션 페이지</h1>
  <div class="items">${items}</div>
</main>`);
}

function renderNotFound(slug) {
  return shell('페이지를 찾을 수 없어요 — kakainfo 노션', `${topbar('')}
<main class="list">
  <h1>페이지를 찾을 수 없어요</h1>
  <p class="empty"><b>${escapeHtml(slug)}</b> 주소로 등록된 노션 페이지가 없어요.<br>
  주소를 다시 확인하거나 <a href="/">전체 목록</a>에서 찾아보세요.</p>
</main>`);
}

function renderViewer(page) {
  const title = page.title || page.slug;
  return shell(`${title} — kakainfo 노션`, `${topbar(`
  <h1 class="bar-title">${escapeHtml(title)}</h1>
  <div class="bar-actions">
    <button type="button" class="btn" id="reloadBtn" title="노션 다시 불러오기">새로고침</button>
    <a class="btn" href="${escapeHtml(page.url)}" target="_blank" rel="noopener" title="노션 게시 페이지를 새 탭에서 열기">새 탭</a>
    <button type="button" class="btn warn" id="reportBtn">안 열려요</button>
  </div>`)}
<div class="notice" id="notice" hidden>
  <span id="noticeText"></span>
  <span class="notice-actions">
    <button type="button" class="btn" id="retryBtn">다시 시도</button>
    <a class="btn primary" href="${escapeHtml(page.url)}" target="_blank" rel="noopener">새 탭에서 열기</a>
    <button type="button" class="btn ghost" id="closeNotice" aria-label="닫기">✕</button>
  </span>
</div>
<div class="frame-wrap" id="frameWrap" data-slug="${escapeHtml(page.slug)}">
  <div class="loading" id="loading"><div class="spinner"></div><p>노션을 불러오는 중…</p></div>
  <iframe id="frame" src="${escapeHtml(page.url)}" title="${escapeHtml(title)}"
    allow="clipboard-write; fullscreen" referrerpolicy="no-referrer-when-downgrade"
    onload="(window.__frameLoads=window.__frameLoads||[]).push(Date.now())"></iframe>
</div>
<script src="/view.js" defer></script>`, { bodyClass: 'viewer' });
}

export async function onRequest(context) {
  const { request, next } = context;
  try {
    if (request.method !== 'GET' && request.method !== 'HEAD') return next();
    const { pathname } = new URL(request.url);

    if (pathname === '/' || pathname === '') {
      return html(renderIndex(await listPages(context).catch(() => null)));
    }

    const slug = slugFromPath(pathname);
    if (!slug) return next();

    const page = await getPage(context, slug).catch(() => null);
    if (!page) return html(renderNotFound(slug), 404);
    return html(renderViewer(page));
  } catch {
    try { return await next(); } catch { return new Response('일시적인 오류예요. 새로고침해 주세요.', { status: 500 }); }
  }
}
