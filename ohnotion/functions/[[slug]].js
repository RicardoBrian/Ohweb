/**
 * Cloudflare Pages Function — note.kakainfo.com 학생 화면(상단 바: 카테고리 / 페이지 제목).
 *
 *   /                 관리 페이지(admin.html). 학생용 목록은 따로 없다 —
 *                     학생은 선생님이 준 /{주소} 링크로만 들어온다.
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
import { escapeHtml, getPage, parsePath, recordStat } from '../lib/shared.js';
import { getRendered } from '../lib/render.js';
import { explainError } from '../lib/notion.js';
import { getPassword, isUnlocked, passwordMatches, unlockCookie } from '../lib/lock.js';

// 학생 화면의 CSS/JS 주소 뒤에 붙는 버전. view.css나 view.js를 고치면 이 값을 바꾼다 —
// 그래야 브라우저·Cloudflare에 남은 예전 파일 대신 새 파일을 받는다(첫 iframe 버전의
// view.css가 남아 여백·HTML 창 크기가 다 깨져 보였던 일이 있었다).
const ASSET_V = '2026110303';

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
<link rel="icon" type="image/svg+xml" href="/icon.svg?v=${ASSET_V}">
<link rel="apple-touch-icon" href="/apple-touch-icon.png?v=${ASSET_V}">
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=IBM+Plex+Sans+KR:wght@400;500;600;700&family=IBM+Plex+Mono:wght@400;500&display=swap">
<link rel="stylesheet" href="/view.css?v=${ASSET_V}">
${head}
</head>
<body${bodyAttrs}>
${body}
</body>
</html>`;
}

// 상단 바: [로고] 카테고리 / 페이지 제목. 사이트 이름은 따로 넣지 않는다(학생에겐 필요 없는 말).
// 학생용 목록 화면이 없으므로 로고·카테고리는 링크가 아니다.
function topbar(inner = '', category = '') {
  return `<header class="bar">
  <span class="brand"><img src="/logo.png" alt="" width="26" height="26">${category ? `<span>${escapeHtml(category)}</span>` : ''}</span>
  ${inner}
</header>`;
}

function renderMessage(title, message, status) {
  return html(shell(title, `${topbar()}
<main class="list">
  <h1>${escapeHtml(title)}</h1>
  <p class="empty">${message}</p>
</main>`), status);
}

// 비밀번호를 걸어 둔 페이지(lib/lock.js)의 입력 화면
function renderLock(page, { wrong = false } = {}) {
  return html(shell(page.title || page.slug, `${topbar('', page.category)}
<main class="list lock">
  <form method="post" class="lock-card" autocomplete="off">
    <div class="lock-icon">🔒</div>
    <h1>${escapeHtml(page.title || page.slug)}</h1>
    <p class="empty">선생님이 알려 준 비밀번호를 입력하세요.</p>
    <input type="password" name="password" class="lock-input" placeholder="비밀번호" required autofocus maxlength="100">
    ${wrong ? '<p class="lock-error">비밀번호가 맞지 않아요.</p>' : ''}
    <button type="submit" class="lock-btn">열기</button>
  </form>
</main>`), wrong ? 401 : 200);
}

// 큰 페이지를 나눠 읽는 동안 보여 주는 화면 — 1초 뒤 스스로 새로고침해서 이어 읽는다.
function renderLoading(done) {
  return html(shell('불러오는 중…', `${topbar()}
<main class="list loading-page">
  <div class="spinner"></div>
  <h1>페이지를 불러오는 중이에요</h1>
  <p class="empty">내용이 많은 페이지라 나눠서 불러오고 있어요. 잠시만 기다려 주세요.<br><span class="muted">읽은 블록 묶음 ${Number(done) || 0}개</span></p>
</main>
<script>setTimeout(function () { location.reload(); }, 1000);</script>`, { head: '<meta name="robots" content="noindex">' }));
}

const KATEX = 'https://cdn.jsdelivr.net/npm/katex@0.16.11/dist';
const PRISM = 'https://cdnjs.cloudflare.com/ajax/libs/prism/1.29.0';
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
  // 수식·코드가 있는 페이지에서만 KaTeX / Prism(코드 색칠)을 불러온다.
  let head = '';
  if (data.hasEquation) head += `<link rel="stylesheet" href="${KATEX}/katex.min.css">
<script defer src="${KATEX}/katex.min.js"></script>`;
  if (data.hasCode) head += `<script defer src="${PRISM}/components/prism-core.min.js"></script>
<script defer src="${PRISM}/plugins/autoloader/prism-autoloader.min.js"></script>`;
  const icon = data.icon ? escapeHtml(data.icon) : (data.iconImg || '');
  const category = (page.category || '').trim();
  return shell(category ? `${pageTitle} — ${category}` : pageTitle, `${topbar(`
  <span class="bar-title${category ? '' : ' no-sep'}">${escapeHtml(page.title || page.slug)}</span>
  <div class="bar-actions">
    <button type="button" class="btn" id="presentBtn" title="슬라이드로 발표하기 (구분선/제목 1마다 한 장)">▶ 발표</button>
    <button type="button" class="btn warn" id="reportBtn">이상해요</button>
  </div>`, category)}
${staleNote}
${data.coverUrl ? `<div class="cover" style="background-image:url('${escapeHtml(data.coverUrl)}')"></div>` : ''}
<main class="doc">
  ${crumbs ? `<nav class="crumbs">${crumbs}</nav>` : ''}
  ${icon ? `<div class="doc-icon${data.coverUrl ? ' on-cover' : ''}">${icon}</div>` : ''}
  <h1 class="doc-title">${escapeHtml(pageTitle)}</h1>
  <div class="notion">${data.html}</div>
  <footer class="doc-foot">노션 수정 ${escapeHtml(fmt(data.lastEdited))} · 동기화 ${escapeHtml(fmt(data.renderedAt))}</footer>
</main>
<div class="notice floating" id="notice" hidden><span id="noticeText"></span><button type="button" class="btn ghost" id="closeNotice" aria-label="닫기">✕</button></div>
<script src="/view.js?v=${ASSET_V}" defer></script>
<script src="/present.js?v=${ASSET_V}" defer></script>
<script src="/lightbox.js?v=${ASSET_V}" defer></script>`, { head, bodyAttrs: ` class="doc-page" data-slug="${escapeHtml(page.slug)}"` });
}

export async function onRequest(context) {
  const { request, next, env } = context;
  try {
    const isPost = request.method === 'POST';
    if (request.method !== 'GET' && request.method !== 'HEAD' && !isPost) return next();
    const { pathname } = new URL(request.url);

    // 첫 화면은 관리 페이지. Pages의 정적 파일(admin.html)을 그대로 내려 준다.
    if (pathname === '/' || pathname === '') {
      return env.ASSETS ? env.ASSETS.fetch(new URL('/admin', request.url)) : next();
    }

    const route = parsePath(pathname);
    if (!route) return next();

    const page = await getPage(context, route.slug).catch(() => null);
    if (!page) {
      return renderMessage('페이지를 찾을 수 없어요',
        `<b>${escapeHtml(route.slug)}</b> 주소로 등록된 노션 페이지가 없어요.<br>주소를 다시 확인하거나 선생님께 받은 링크로 다시 들어와 주세요.`, 404);
    }
    // 비밀번호가 걸린 페이지: 맞는 쿠키가 없으면 입력 화면. POST는 비밀번호 확인.
    if (page.locked) {
      if (!env.FIREBASE_SERVICE_ACCOUNT_KEY) {
        return renderMessage('잠긴 페이지예요', '비밀번호 확인 설정이 아직 안 됐어요(FIREBASE_SERVICE_ACCOUNT_KEY). 선생님께 알려 주세요.', 503);
      }
      let password;
      try { password = await getPassword(env, page.slug); } catch (e) {
        console.error('비밀번호 읽기 실패:', e?.message || e);
        return renderMessage('잠긴 페이지예요', '지금은 비밀번호를 확인할 수 없어요. 잠시 후 다시 시도해 주세요.', 503);
      }
      if (!password) return renderMessage('잠긴 페이지예요', '이 페이지의 비밀번호가 아직 정해지지 않았어요. 선생님께 알려 주세요.', 403);
      if (isPost) {
        const form = await request.formData().catch(() => null);
        if (passwordMatches(form?.get('password'), password)) {
          return new Response(null, { status: 303, headers: { Location: pathname, 'Set-Cookie': await unlockCookie(env, page.slug, password), 'Cache-Control': 'no-store' } });
        }
        await new Promise((r) => setTimeout(r, 600));   // 마구 대입하기 어렵게 조금 늦춘다
        return renderLock(page, { wrong: true });
      }
      if (!(await isUnlocked(request, env, page.slug, password))) return renderLock(page);
    } else if (isPost) {
      return new Response(null, { status: 303, headers: { Location: pathname } });
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
      // 큰 페이지: 이번 요청에서 읽은 데까지 저장해 뒀으니 잠시 뒤 자동으로 다시 열어 이어 읽는다.
      if (e?.name === 'Incomplete') return renderLoading(e.done);
      console.error(`노션 그리기 실패 ${page.slug}/${pageId}:`, e?.message || e);
      context.waitUntil(recordStat(env, page.slug, 'error'));
      // 상태 코드를 5xx로 내면 Cloudflare 오류 화면처럼 보일 수 있어, 안내 화면은 200으로 보낸다.
      return renderMessage('노션 내용을 불러오지 못했어요',
        `잠시 후 새로고침해 주세요.<br><span class="muted">${escapeHtml(explainError(e))}</span>`, 200);
    }
    if (result.source === 'stale' && result.error) context.waitUntil(recordStat(env, page.slug, 'stale'));
    return html(renderDoc(page, route.sub, result));
  } catch (e) {
    console.error('notion 페이지 오류:', e?.message || e);
    try { return await next(); } catch { return new Response('일시적인 오류예요. 새로고침해 주세요.', { status: 500 }); }
  }
}
