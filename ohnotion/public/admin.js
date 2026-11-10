// note.kakainfo.com (첫 화면 = 이 관리 페이지) — kakanotion: 정보 학습지(노션 페이지) 등록 + 모니터링.
// 학생용 목록 화면은 없다. 학생은 여기서 복사한 /{주소} 링크로만 들어온다.
//
// 등록: notion_pages/{주소} 문서 = { title, url, pageId, category, createdAt, updatedAt }.
//       목록은 최신 등록순(createdAt 내림차순) + 카테고리 필터·검색. (order는 예전 수동 순서 — 지금은 안 씀)
//       (hidden은 학생 목록이 있던 시절의 필드 — 예전 문서엔 남아 있을 수 있고 규칙도 허용한다.)
//       학생 화면은 서버가 Notion API로 pageId의 내용을 읽어 그린다(lib/notion.js).
//       등록 정보는 최대 2분, 노션 내용은 2분마다 새로 반영된다.
// 모니터링: 두 가지를 같이 본다.
//   - 점검(/api/check): 노션 API로 그 페이지를 읽을 수 있는지(통합 연결·토큰).
//     ⟳ 버튼은 지금 바로 새로 불러와 학생 화면 캐시도 갈아 끼운다.
//   - 학생 기록(notion_stats): 열람 수, "이상해요" 신고, 노션 장애로 예전 내용을
//     대신 보여준 횟수, 못 불러온 횟수의 일별 카운터.
import { db } from './firebase-config.js';
import {
  collection, doc, getDoc, getDocs, setDoc, deleteDoc, query, where, serverTimestamp,
} from 'https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js';

const app = document.getElementById('app');
const PUBLIC_BASE = 'https://note.kakainfo.com';
const PUBLIC_HOST = new URL(PUBLIC_BASE).host;
const REFRESH_MS = 60 * 1000;

// ⚠ lib/shared.js의 SLUG_RE / RESERVED, lib/notion.js의 extractPageId와 같아야 한다(브라우저라 import 불가).
const SLUG_RE = /^[\p{L}\p{N}_-]{1,40}$/u;
const RESERVED = new Set([
  'admin', 'api', 'login', 'logout',
  'wp-admin', 'wp-login', 'wp-content', 'wp-includes', 'wp-json', 'xmlrpc', 'graphql', 'phpmyadmin',
  'config', 'backup', 'env', 'robots', 'sitemap', 'feed', 'rss', 'server-status', 'actuator', 'swagger',
]);
// 노션 링크(notion.so / notion.site / 임베드 /ebd/ / 공유 iframe 코드)나 ID 자체에서
// 32자리 페이지 ID를 꺼낸다. 없으면 null(예: 사이트 첫 화면 주소).
const UUID_RE = /([0-9a-f]{8})-([0-9a-f]{4})-([0-9a-f]{4})-([0-9a-f]{4})-([0-9a-f]{12})/i;
function extractPageId(input) {
  if (!input) return null;
  let s = String(input).trim();
  const src = s.match(/\bsrc\s*=\s*["']?([^"'\s>]+)/i);
  if (/<iframe/i.test(s) && src) s = src[1];
  const uuid = s.match(UUID_RE);
  if (uuid) return uuid.slice(1).join('').toLowerCase();
  if (/^[0-9a-f]{32}$/i.test(s)) return s.toLowerCase();
  let path = s;
  try { path = new URL(s).pathname; } catch { /* 주소가 아니면 문자열 그대로 */ }
  for (const seg of path.split('/').reverse()) {
    const m = seg.match(/([0-9a-f]{32})$/i);
    if (m) return m[1].toLowerCase();
  }
  return null;
}
// 저장할 원본 링크: iframe 코드면 src만.
function linkFromInput(raw) {
  const v = raw.trim();
  const m = v.match(/\bsrc\s*=\s*["']?([^"'\s>]+)/i);
  return (/<iframe/i.test(v) && m ? m[1] : v).replace(/&amp;/g, '&');
}

// slow/timeout/loop는 iframe으로 띄우던 첫 버전의 기록 — 남아 있는 옛 통계를 위해 둔다.
const RESULT_LABELS = {
  ok: '열람', report: '이상해요 신고', stale: '예전 내용으로 대신', error: '불러오기 실패',
  slow: '느림(옛)', timeout: '안 열림(옛)', loop: '무한 새로고침(옛)',
};
const PROBLEM_KEYS = ['error', 'report', 'timeout', 'loop'];

let pages = [];
let stats = {};            // slug → { today: {...}, week: {...}, lastAt }
let checks = {};           // slug → /api/check 결과
let statsEnabled = true;
let notionEnabled = true;
let editing = null;
// '' = 전체, NONE = 미분류, 그 밖 = 카테고리 이름. NONE을 보이지 않는 문자(\u0000)로 했더니
// HTML 속성(data-cat)에 들어가며 브라우저가 다른 글자로 바꿔 버려, 미분류를 누르면 전체로 돌아갔다.
const NONE = '__none__';
let catFilter = '';
let searchText = '';        // 수정 중인 주소
let refreshTimer = null;

// ── 유틸 ──
function escapeHtml(str) {
  return String(str ?? '').replace(/[&<>"']/g, (c) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
  }[c]));
}
function kstDay(date = new Date()) {
  return new Date(date.getTime() + 9 * 3600 * 1000).toISOString().slice(0, 10);
}
function timeAgo(ts) {
  if (!ts) return '';
  const d = ts.toDate ? ts.toDate() : new Date(ts);
  const s = Math.round((Date.now() - d.getTime()) / 1000);
  if (s < 60) return '방금';
  if (s < 3600) return `${Math.floor(s / 60)}분 전`;
  if (s < 86400) return `${Math.floor(s / 3600)}시간 전`;
  return `${Math.floor(s / 86400)}일 전`;
}
function showToast(message, type = 'success') {
  document.querySelector('.toast')?.remove();
  const toast = document.createElement('div');
  toast.className = `toast ${type}`;
  toast.textContent = message;
  document.body.appendChild(toast);
  requestAnimationFrame(() => toast.classList.add('show'));
  setTimeout(() => { toast.classList.remove('show'); setTimeout(() => toast.remove(), 300); }, 2400);
}
const sum = (o, keys) => keys.reduce((n, k) => n + (o?.[k] || 0), 0);
const total = (o) => sum(o, Object.keys(RESULT_LABELS));

// ── 로그인 ──
function renderLogin(errorMessage = '') {
  stopRefresh();
  app.innerHTML = `
    <div class="login-wrap">
      <div class="auth-card">
        <div class="auth-head">
          <img class="auth-logo" src="/logo.png" alt="kakainfo">
          <div class="auth-word">kakainfo</div>
          <div class="auth-sub">kakanotion · 관리자 로그인</div>
        </div>
        <button class="auth-btn" id="loginBtn">Google로 로그인</button>
        <p class="error-msg" id="loginError">${escapeHtml(errorMessage)}</p>
      </div>
    </div>`;
  document.getElementById('loginBtn').addEventListener('click', async () => {
    const errorEl = document.getElementById('loginError');
    errorEl.textContent = '';
    try {
      await window.AdminAuth.login();
      if (window.AdminAuth.isValid()) await renderDashboard();
      else { errorEl.textContent = '관리자 계정이 아닙니다.'; await window.AdminAuth.logout(); }
    } catch (e) {
      errorEl.textContent = '로그인 실패: ' + e.message;
    }
  });
}

// ── 대시보드 뼈대 ──
async function renderDashboard() {
  app.innerHTML = `
    <div class="topbar">
      <a class="nav-brand" href="/"><img src="/logo.png" alt="kakainfo"><span class="nav-brand-title">kakanotion</span></a>
      <div class="topbar-actions">
        <div class="dark-toggle" id="darkToggle" title="다크모드"></div>
        <button class="btn ghost sm" id="logoutBtn">로그아웃</button>
      </div>
    </div>
    <div class="dashboard">
      <div class="token-info" id="tokenInfo" hidden></div>
      <div class="banner" id="notionBanner" hidden>
        <b>노션 연결이 아직 안 됐어요.</b> 노션 → 설정 → <b>연결(통합) → 새 통합 만들기</b>(내부)로 시크릿을 받아
        Cloudflare Pages 프로젝트 <b>ohnotion</b>에 <code>NOTION_TOKEN</code>(Secret)으로 넣고 재배포해 주세요.
        그다음 학생에게 보여줄 노션 페이지마다 오른쪽 위 <b>··· → 연결 → 그 통합 추가</b>를 해야 읽을 수 있어요(하위 페이지는 자동 포함).
      </div>
      <div class="banner" id="statsBanner" hidden>
        학생 기록(모니터링)이 꺼져 있어요. Cloudflare Pages 프로젝트 <b>ohnotion</b>에
        <code>FIREBASE_SERVICE_ACCOUNT_KEY</code>를 넣고 재배포하면 켜져요. 등록과 학생 화면은 지금도 동작해요.
      </div>

      <div class="site-switch" id="siteSwitch">
        <div class="site-switch-text">
          <b id="siteState">학생 화면 상태 확인 중…</b>
          <span class="hint" id="siteHint">시험 때 누르면 모든 학생 주소가 막혀요(페이지는 지워지지 않아요). 열려 있던 학생 화면도 1분 안에 자동 새로고침돼 닫혀요.</span>
          <input id="siteMessage" class="inp" maxlength="300" placeholder="학생에게 보일 문구 (비우면: 선생님이 잠시 닫아 두었어요…)">
        </div>
        <button type="button" class="btn" id="siteToggle" disabled>…</button>
      </div>

      <div class="tiles" id="tiles"></div>

      <div class="create-card">
        <h2 id="formTitle">새 페이지 등록</h2>
        <form id="pageForm" autocomplete="off">
          <div class="form-row">
            <div class="field">
              <label for="slug">주소</label>
              <div class="slug-input"><span class="slug-prefix">${PUBLIC_HOST}/</span><input id="slug" class="inp" placeholder="공지" maxlength="40" required></div>
            </div>
            <div class="field">
              <label for="title">제목</label>
              <input id="title" class="inp" placeholder="비우면 노션 페이지 제목" maxlength="100">
            </div>
          </div>
          <div class="field">
            <label for="category">카테고리</label>
            <div class="cat-input">
              <input id="category" class="inp" placeholder="예: 1학년 AI, 수행평가 (비우면 미분류)" maxlength="40" list="categoryList">
              <select id="categoryPick" class="inp" title="기존 카테고리에서 고르기"><option value="">기존 카테고리 ▾</option></select>
            </div>
            <datalist id="categoryList"></datalist>
          </div>
          <div class="field">
            <label for="pagePassword">비밀번호 (선택)</label>
            <input id="pagePassword" class="inp" type="text" placeholder="비우면 누구나 열 수 있어요" maxlength="100" autocomplete="off">
            <p class="hint">정하면 학생이 이 주소를 열 때 비밀번호를 물어요(맞히면 그 PC에서 12시간 동안 다시 안 물어요). 지우고 저장하면 잠금이 풀려요.
            비밀번호를 바꾸면 이미 들어온 학생도 다시 입력해야 해요. 바뀐 잠금은 학생 화면에 최대 2분 뒤 반영돼요.</p>
          </div>
          <div class="field">
            <label for="url">노션 페이지 링크</label>
            <input id="url" class="inp" type="text" placeholder="https://www.notion.so/…  또는  https://xxx.notion.site/…" required>
            <p class="hint">노션에서 그 페이지를 열고 <b>공유 → 링크 복사</b>한 주소면 돼요(<code>notion.so</code>, <code>notion.site</code>, 임베드 iframe 코드 모두 OK). 사이트 첫 화면 주소(<code>xxx.notion.site/</code>)에는 페이지 ID가 없어서 안 돼요.
            <b>그 페이지에 통합이 연결돼 있어야</b> 읽을 수 있어요(··· → 연결). 웹에 게시는 안 해도 돼요.</p>
          </div>
          <div class="form-actions">
            <button type="button" class="btn ghost" id="cancelEdit" hidden>취소</button>
            <button type="submit" class="btn accent" id="saveBtn">등록</button>
          </div>
          <p class="error-msg" id="formError"></p>
        </form>
      </div>

      <div class="links-section">
        <div class="section-head">
          <h2>등록된 페이지</h2>
          <div class="section-actions">
            <span class="updated" id="updatedAt"></span>
            <button class="btn sm" id="recheckBtn">전체 다시 점검</button>
          </div>
        </div>
        <div class="list-tools">
          <div class="cat-chips" id="catChips"></div>
          <input id="search" class="inp search" type="search" placeholder="제목·주소 검색">
        </div>
        <div class="link-list" id="pageList"><div class="empty-state">불러오는 중...</div></div>
        <p class="legend">학생 화면은 학생 PC가 노션에 직접 접속하지 않고, 서버가 노션 API로 읽어 둔 내용을 보여줘요(2분마다 새로 반영).
          <b>⟳</b>를 누르면 지금 바로 새로 불러와요. 학생 기록(오늘 / 최근 7일):
          <b>열람</b> 연 횟수(탭당 1번), <b>이상해요 신고</b> 학생이 누른 횟수,
          <b>예전 내용으로 대신</b> 노션 API 장애로 마지막 저장본을 보여준 횟수, <b>불러오기 실패</b> 저장본도 없어 못 보여준 횟수.</p>
      </div>
    </div>`;

  document.getElementById('logoutBtn').addEventListener('click', async () => { await window.AdminAuth.logout(); renderLogin(); });
  document.getElementById('darkToggle').addEventListener('click', () => {
    document.body.classList.toggle('dark');
    try { localStorage.setItem('dark', document.body.classList.contains('dark') ? '1' : '0'); } catch { /* 무시 */ }
  });
  document.getElementById('pageForm').addEventListener('submit', onSave);
  document.getElementById('categoryPick').addEventListener('change', (e) => {
    if (e.target.value) document.getElementById('category').value = e.target.value;
    e.target.value = '';
  });
  document.getElementById('search').addEventListener('input', (e) => { searchText = e.target.value; renderList(); });
  document.getElementById('cancelEdit').addEventListener('click', resetForm);
  document.getElementById('recheckBtn').addEventListener('click', () => runChecks(true));

  document.getElementById('siteToggle').addEventListener('click', toggleSite);
  loadSite();

  await refresh({ withChecks: true });
  startRefresh();
}

// ── 학생 화면 닫기(시험 기간) — appSettings/ohnotion_site (lib/shared.js getSiteStatus) ──
const SITE_DOC = 'ohnotion_site';
let siteClosed = false;
function renderSite() {
  const box = document.getElementById('siteSwitch');
  if (!box) return;
  box.classList.toggle('closed', siteClosed);
  document.getElementById('siteState').textContent = siteClosed
    ? '⏸ 학생 화면이 닫혀 있어요 — 지금 학생은 어떤 주소도 열 수 없어요'
    : '▶ 학생 화면이 열려 있어요';
  const btn = document.getElementById('siteToggle');
  btn.disabled = false;
  btn.textContent = siteClosed ? '다시 열기' : '학생 화면 닫기';
  btn.className = siteClosed ? 'btn accent' : 'btn danger';
}
async function loadSite() {
  try {
    const snap = await getDoc(doc(db, 'appSettings', SITE_DOC));
    const d = snap.exists() ? snap.data() : {};
    siteClosed = d.closed === true;
    document.getElementById('siteMessage').value = d.message || '';
    renderSite();
  } catch (e) {
    document.getElementById('siteState').textContent = `상태를 못 읽었어요: ${e.message}`;
  }
}
async function toggleSite() {
  const next = !siteClosed;
  if (next && !confirm('학생 화면을 닫을까요?\n모든 주소가 막히고, 열려 있던 학생 화면도 1분 안에 닫혀요.')) return;
  const btn = document.getElementById('siteToggle');
  btn.disabled = true;
  try {
    await setDoc(doc(db, 'appSettings', SITE_DOC), {
      closed: next,
      message: document.getElementById('siteMessage').value.trim().slice(0, 300),
      updatedAt: serverTimestamp(),
    });
    siteClosed = next;
  } catch (e) {
    alert(`바꾸지 못했어요: ${e.message}`);
  }
  renderSite();
}

function startRefresh() {
  stopRefresh();
  // 학생 기록만 주기적으로 다시 읽는다(서버 점검은 버튼/처음 한 번).
  refreshTimer = setInterval(() => { if (!document.hidden) refresh({ withChecks: false }); }, REFRESH_MS);
}
function stopRefresh() { clearInterval(refreshTimer); refreshTimer = null; }

// ── 데이터 ──
const tsMillis = (t) => t?.toMillis?.() ?? (t ? Date.parse(t) || 0 : 0);
const categories = () => [...new Set(pages.map((p) => (p.category || '').trim()).filter(Boolean))].sort((a, b) => a.localeCompare(b, 'ko'));

async function loadPages() {
  const snap = await getDocs(collection(db, 'notion_pages'));
  pages = snap.docs.map((d) => ({ slug: d.id, ...d.data() }))
    // 최신 등록이 맨 위(만든 시각 → 없으면 수정 시각).
    .sort((a, b) => tsMillis(b.createdAt ?? b.updatedAt) - tsMillis(a.createdAt ?? a.updatedAt));
}

async function loadStats() {
  const today = kstDay();
  const from = kstDay(new Date(Date.now() - 6 * 86400 * 1000));
  const snap = await getDocs(query(collection(db, 'notion_stats'), where('day', '>=', from)));
  const out = {};
  snap.forEach((d) => {
    const s = d.data();
    const row = out[s.slug] ||= { today: {}, week: {}, lastAt: null, lastResult: null };
    for (const k of Object.keys(RESULT_LABELS)) {
      row.week[k] = (row.week[k] || 0) + (s[k] || 0);
      if (s.day === today) row.today[k] = (row.today[k] || 0) + (s[k] || 0);
    }
    const at = s.lastAt?.toMillis?.() || 0;
    if (at > (row.lastAt?.toMillis?.() || 0)) { row.lastAt = s.lastAt; row.lastResult = s.lastResult; }
  });
  stats = out;
}

function applyFlags(data) {
  if (data.token) showToken(data.token);
  if (typeof data.statsEnabled === 'boolean') statsEnabled = data.statsEnabled;
  if (typeof data.notionEnabled === 'boolean') notionEnabled = data.notionEnabled;
}

// 서버에 들어 있는 NOTION_TOKEN이 어느 워크스페이스의 어떤 통합인지 보여 준다.
// 등록한 페이지가 다른 워크스페이스에 있거나, 이 통합이 연결되지 않았으면 "찾을 수 없어요"가 난다.
function showToken(t) {
  const el = document.getElementById('tokenInfo');
  if (!el) return;
  el.hidden = false;
  el.className = `token-info ${t.ok ? 'ok' : 'bad'}`;
  el.innerHTML = t.ok
    ? `노션 연결: <b>${escapeHtml(t.workspace || '(워크스페이스 이름 없음)')}</b> 워크스페이스의 <b>${escapeHtml(t.integration || '통합')}</b> 통합.
       학습지 페이지가 <b>이 워크스페이스</b>에 있고, 페이지 ··· → 연결에 <b>${escapeHtml(t.integration || '이 통합')}</b>이 추가돼 있어야 읽을 수 있어요.`
    : `노션 토큰 오류: ${escapeHtml(t.message)} — Cloudflare의 NOTION_TOKEN 값을 확인하고 재배포해 주세요.`;
}

async function checkOne(p, refresh = false) {
  checks[p.slug] = { level: 'pending', message: refresh ? '새로 불러오는 중…' : '점검 중…' };
  renderList();
  try {
    const r = await fetch(`/api/check?slug=${encodeURIComponent(p.slug)}${refresh ? '&refresh=1' : ''}`, { cache: 'no-store' });
    const data = await r.json();
    applyFlags(data);
    checks[p.slug] = data;
  } catch (e) {
    checks[p.slug] = { level: 'unknown', message: '점검 요청 실패(관리 페이지 네트워크)' };
  }
}

async function runChecks(force = false) {
  const todo = pages.filter((p) => force || !checks[p.slug]);
  // 노션 API에 한꺼번에 몰리지 않게 3개씩.
  for (let i = 0; i < todo.length; i += 3) {
    await Promise.all(todo.slice(i, i + 3).map((p) => checkOne(p)));
    renderAll();
  }
  if (!pages.length) {
    // 페이지가 없어도 통계 키 상태는 알려 준다.
    try { applyFlags(await (await fetch('/api/check', { cache: 'no-store' })).json()); } catch { /* 무시 */ }
    renderAll();
  }
}

async function refresh({ withChecks }) {
  try {
    await Promise.all([loadPages(), loadStats().catch((e) => { console.warn('통계 읽기 실패', e); })]);
  } catch (e) {
    document.getElementById('pageList').innerHTML = `<div class="empty-state">불러오기에 실패했어요: ${escapeHtml(e.message)}</div>`;
    return;
  }
  renderAll();
  if (withChecks) {
    runChecks();
    // 토큰 진단은 페이지 수와 상관없이 한 번.
    fetch('/api/check', { cache: 'no-store' }).then((r) => r.json()).then(applyFlags).then(renderAll).catch(() => {});
  }
}

// ── 상태 판정 ──
function statusOf(p) {
  const c = checks[p.slug];
  const s = stats[p.slug];
  const week = s?.week || {};
  const visits = total(week);
  const problems = sum(week, PROBLEM_KEYS);
  if (c?.level === 'bad') return { cls: 'bad', label: '문제 있음', why: c.message };
  if ((s?.today?.error || 0) > 0) return { cls: 'bad', label: '오늘 불러오기 실패', why: `오늘 ${s.today.error}회 못 보여줌` };
  if (visits >= 3 && problems / visits >= 0.2) {
    return { cls: 'warn', label: '문제 신고가 많아요', why: `최근 7일 ${visits}회 중 ${problems}회 문제` };
  }
  if ((s?.today?.report || 0) > 0) return { cls: 'warn', label: '오늘 신고 있음', why: `오늘 "이상해요" ${s.today.report}회` };
  if ((s?.today?.stale || 0) > 0) return { cls: 'warn', label: '노션 연결 불안정', why: `오늘 ${s.today.stale}회 예전 내용으로 대신 보여줌` };
  if (c?.level === 'slow') return { cls: 'warn', label: '느림', why: c.message };
  if (c?.level === 'pending' || !c) return { cls: 'pending', label: '점검 중', why: '' };
  if (c?.level === 'unknown') return { cls: 'pending', label: '확인 제한', why: c.message };
  return { cls: 'ok', label: '정상', why: [c.title && `노션 제목: ${c.title}`, c.message].filter(Boolean).join(' · ') };
}

// ── 그리기 ──
function renderAll() {
  renderTiles();
  renderList();
  const banner = document.getElementById('statsBanner');
  if (banner) banner.hidden = statsEnabled;
  const nb = document.getElementById('notionBanner');
  if (nb) nb.hidden = notionEnabled;
  const up = document.getElementById('updatedAt');
  if (up) up.textContent = `갱신 ${new Date().toLocaleTimeString('ko-KR', { hour: '2-digit', minute: '2-digit' })}`;
}

function renderTiles() {
  const el = document.getElementById('tiles');
  if (!el) return;
  let todayVisits = 0, todayProblems = 0;
  for (const p of pages) {
    const t = stats[p.slug]?.today || {};
    todayVisits += total(t);
    todayProblems += sum(t, PROBLEM_KEYS);
  }
  const bad = pages.filter((p) => ['bad', 'warn'].includes(statusOf(p).cls)).length;
  const tiles = [
    ['등록된 페이지', pages.length, ''],
    ['오늘 열람', todayVisits, ''],
    ['오늘 실패·신고', todayProblems, todayProblems ? 'warn' : ''],
    ['주의 필요한 페이지', bad, bad ? 'bad' : 'ok'],
  ];
  el.innerHTML = tiles.map(([label, n, cls]) => `
    <div class="tile ${cls}"><div class="tile-n">${n}</div><div class="tile-label">${label}</div></div>`).join('');
}

function countsHtml(o) {
  const parts = Object.entries(RESULT_LABELS)
    .filter(([k]) => o?.[k])
    .map(([k, label]) => `<span class="cnt ${PROBLEM_KEYS.includes(k) ? 'cnt-bad' : k === 'slow' ? 'cnt-warn' : ''}">${label} ${o[k]}</span>`);
  return parts.length ? parts.join('') : '<span class="cnt muted">기록 없음</span>';
}

function renderChips() {
  const chips = document.getElementById('catChips');
  if (!chips) return;
  const cats = categories();
  const count = (c) => pages.filter((p) => (c === NONE ? !(p.category || '').trim() : (p.category || '').trim() === c)).length;
  const items = [['', `전체 ${pages.length}`], ...cats.map((c) => [c, `${c} ${count(c)}`])];
  const uncategorized = count(NONE);
  if (uncategorized && cats.length) items.push([NONE, `미분류 ${uncategorized}`]);
  if (catFilter && !items.some(([k]) => k === catFilter)) catFilter = '';
  chips.innerHTML = items.map(([k, label]) => `<button type="button" class="chip${k === catFilter ? ' on' : ''}" data-cat="${escapeHtml(k)}">${escapeHtml(label)}</button>`).join('');
  chips.querySelectorAll('.chip').forEach((b) => b.addEventListener('click', () => { catFilter = b.dataset.cat; renderList(); }));

  // 등록 폼의 카테고리 고르기(드롭다운 + 입력 자동완성)
  const pick = document.getElementById('categoryPick');
  const dl = document.getElementById('categoryList');
  if (pick) pick.innerHTML = '<option value="">기존 카테고리 ▾</option>' + cats.map((c) => `<option>${escapeHtml(c)}</option>`).join('');
  if (dl) dl.innerHTML = cats.map((c) => `<option value="${escapeHtml(c)}">`).join('');
}

function visiblePages() {
  const q = searchText.trim().toLowerCase();
  return pages.filter((p) => {
    const cat = (p.category || '').trim();
    if (catFilter === NONE ? cat : catFilter && cat !== catFilter) return false;
    if (!q) return true;
    return [p.title, p.slug, cat].some((v) => String(v || '').toLowerCase().includes(q));
  });
}

function fmtDate(t) {
  const ms = tsMillis(t);
  return ms ? new Date(ms).toLocaleDateString('ko-KR', { year: 'numeric', month: 'numeric', day: 'numeric' }) : '';
}

function renderList() {
  const listEl = document.getElementById('pageList');
  if (!listEl) return;
  renderChips();
  if (!pages.length) {
    listEl.innerHTML = '<div class="empty-state">아직 등록된 페이지가 없어요. 위에서 첫 페이지를 등록해 보세요.</div>';
    return;
  }
  const shown = visiblePages();
  if (!shown.length) {
    listEl.innerHTML = '<div class="empty-state">조건에 맞는 페이지가 없어요.</div>';
    return;
  }
  listEl.innerHTML = shown.map((p) => {
    const st = statusOf(p);
    const s = stats[p.slug];
    const publicUrl = `${PUBLIC_BASE}/${p.slug}`;
    const cat = (p.category || '').trim();
    const slugAttr = escapeHtml(p.slug);
    return `
      <div class="page-card">
        <div class="page-main">
          <div class="page-top">
            <span class="pill ${st.cls}">${escapeHtml(st.label)}</span>
            ${cat ? `<span class="pill cat">${escapeHtml(cat)}</span>` : ''}
            ${p.locked ? '<span class="pill muted" title="비밀번호가 걸려 있어요">🔒 비밀번호</span>' : ''}
            <span class="page-title">${escapeHtml(p.title || p.slug)}</span>
          </div>
          <a class="page-public" href="${escapeHtml(publicUrl)}" target="_blank" rel="noopener">${PUBLIC_HOST}/${escapeHtml(p.slug)}</a>
          <div class="page-url" title="${escapeHtml(p.url)}">${escapeHtml(p.url)}</div>
          ${st.why ? `<div class="page-why">${escapeHtml(st.why)}</div>` : ''}
          <div class="page-stats">
            <div><span class="stat-k">오늘</span>${countsHtml(s?.today)}</div>
            <div><span class="stat-k">7일</span>${countsHtml(s?.week)}</div>
            <div class="muted small">등록 ${fmtDate(p.createdAt ?? p.updatedAt)}${s?.lastAt ? ` · 마지막 기록 ${timeAgo(s.lastAt)} · ${escapeHtml(RESULT_LABELS[s.lastResult] || '')}` : ''}</div>
          </div>
        </div>
        <div class="page-actions">
          <button class="icon-btn" data-act="present" data-slug="${slugAttr}" title="발표 모드로 열기">▶</button>
          <button class="icon-btn" data-act="copy" data-slug="${slugAttr}" title="주소 복사">⧉</button>
          <button class="icon-btn" data-act="check" data-slug="${slugAttr}" title="지금 새로 불러오기">⟳</button>
          <button class="icon-btn" data-act="edit" data-slug="${slugAttr}" title="수정">✎</button>
          <button class="icon-btn danger" data-act="delete" data-slug="${slugAttr}" title="삭제">✕</button>
        </div>
      </div>`;
  }).join('');

  listEl.querySelectorAll('[data-act]').forEach((btn) => {
    btn.addEventListener('click', () => onAction(btn.dataset.act, pages.find((p) => p.slug === btn.dataset.slug)));
  });
}

// ── 동작 ──
async function onAction(act, p) {
  if (!p) return;
  try {
    if (act === 'present') {
      window.open(`${PUBLIC_BASE}/${encodeURIComponent(p.slug)}#present`, '_blank', 'noopener');
    } else if (act === 'copy') {
      await navigator.clipboard.writeText(`${PUBLIC_BASE}/${p.slug}`);
      showToast('주소를 복사했어요');
    } else if (act === 'check') {
      await checkOne(p, true);
      renderAll();
      if (checks[p.slug]?.ok) showToast('새로 불러왔어요 — 학생 화면에 바로 반영돼요');
    } else if (act === 'edit') {
      startEdit(p);
    } else if (act === 'delete') {
      if (!confirm(`"${p.title || p.slug}" 페이지를 삭제할까요?\n노션 원본은 그대로 남고, ${PUBLIC_HOST}/${p.slug} 주소만 사라져요.`)) return;
      await deleteDoc(doc(db, 'notion_pages', p.slug));
      if (p.locked) await deleteDoc(doc(db, 'notion_secrets', p.slug)).catch(() => {});
      delete checks[p.slug];
      showToast('삭제했어요');
      if (editing === p.slug) resetForm();
      await refresh({ withChecks: false });
    }
  } catch (e) {
    showToast(e.message, 'error');
  }
}

function startEdit(p) {
  editing = p.slug;
  const slugEl = document.getElementById('slug');
  slugEl.value = p.slug;
  slugEl.disabled = true;
  document.getElementById('title').value = p.title || '';
  document.getElementById('url').value = p.url || '';
  document.getElementById('category').value = p.category || '';
  const pw = document.getElementById('pagePassword');
  pw.value = '';
  pw.dataset.original = '';
  if (p.locked) {
    pw.placeholder = '불러오는 중…';
    getDoc(doc(db, 'notion_secrets', p.slug)).then((d) => {
      if (editing !== p.slug) return;
      const v = d.exists() ? d.data().password || '' : '';
      pw.value = v;
      pw.dataset.original = v;
      pw.placeholder = '비우면 누구나 열 수 있어요';
    }).catch(() => { pw.placeholder = '비밀번호를 불러오지 못했어요(규칙 확인)'; });
  }
  document.getElementById('formTitle').textContent = `수정: ${p.slug}`;
  document.getElementById('saveBtn').textContent = '저장';
  document.getElementById('cancelEdit').hidden = false;
  document.getElementById('formError').textContent = '';
  document.querySelector('.create-card').scrollIntoView({ behavior: 'smooth', block: 'start' });
}

function resetForm() {
  editing = null;
  document.getElementById('pageForm').reset();
  document.getElementById('pagePassword').placeholder = '비우면 누구나 열 수 있어요';
  document.getElementById('slug').disabled = false;
  document.getElementById('formTitle').textContent = '새 페이지 등록';
  document.getElementById('saveBtn').textContent = '등록';
  document.getElementById('cancelEdit').hidden = true;
  document.getElementById('formError').textContent = '';
}

// "그래도 저장" 버튼으로 다시 제출할 때 노션 점검 결과를 건너뛰기 위한 표시.
let forceSave = false;

// Firestore 오류를 알아들을 말로(영어 원문만 뜨면 원인을 알기 어렵다).
function explainSaveError(err) {
  const code = err?.code || '';
  if (code === 'permission-denied' || /insufficient permissions/i.test(err?.message || '')) {
    return '저장 권한이 없어요(Firestore 규칙). Firebase 콘솔 규칙에 최신 notion 블록(pageId 포함)이 들어 있는지, 관리자 계정으로 로그인했는지 확인해 주세요.';
  }
  if (code === 'unavailable') return '인터넷 연결이 불안정해 저장하지 못했어요. 잠시 후 다시 눌러 주세요.';
  return err?.message || String(err);
}

async function onSave(e) {
  e.preventDefault();
  const errEl = document.getElementById('formError');
  const btn = document.getElementById('saveBtn');
  errEl.textContent = '';
  const slug = document.getElementById('slug').value.trim().replace(/\s+/g, '-').normalize('NFC');
  let title = document.getElementById('title').value.trim();
  const category = document.getElementById('category').value.trim().replace(/\s+/g, ' ').slice(0, 40);
  const password = document.getElementById('pagePassword').value.trim();
  const url = linkFromInput(document.getElementById('url').value);
  const pageId = extractPageId(url);

  try {
    if (!SLUG_RE.test(slug)) throw new Error('주소는 한글/영문/숫자/-/_ 로 40자까지 쓸 수 있어요');
    if (RESERVED.has(slug.toLowerCase())) throw new Error(`"${slug}"은(는) 쓸 수 없는 주소예요`);
    if (!/^https:\/\/([a-z0-9-]+\.)*notion\.(so|site)(\/|$)/i.test(url)) throw new Error('노션 페이지 링크(https://www.notion.so/… 또는 https://….notion.site/…)를 넣어 주세요');
    if (!pageId) throw new Error('링크에서 페이지 ID를 찾지 못했어요. 사이트 첫 화면 주소 말고, 그 페이지를 열고 "공유 → 링크 복사"한 주소를 넣어 주세요');

    btn.disabled = true;
    btn.textContent = '확인 중...';

    if (!editing && (await getDoc(doc(db, 'notion_pages', slug))).exists()) {
      throw new Error('이미 쓰고 있는 주소예요');
    }

    // 저장 전에 노션 API로 읽히는지 확인한다. 안 읽히면 묻고 진행(통합 연결은 나중에 해도 되니까).
    try {
      const r = await fetch(`/api/check?url=${encodeURIComponent(url)}&slug=${encodeURIComponent(slug)}`, { cache: 'no-store' });
      const c = await r.json();
      applyFlags(c);
      // 브라우저 확인창(confirm)은 차단되면 아무 말 없이 false가 돼서 "등록이 안 되는" 것처럼
      // 보였다. 화면에 이유와 "그래도 저장" 버튼을 띄운다.
      if (c.level === 'bad' && !forceSave) {
        errEl.innerHTML = `이 페이지를 아직 노션에서 읽을 수 없어요: ${escapeHtml(c.message)}
          <br><button type="button" class="btn sm" id="forceSaveBtn" style="margin-top:8px">그래도 저장</button>`;
        document.getElementById('forceSaveBtn').addEventListener('click', () => {
          forceSave = true;
          document.getElementById('pageForm').requestSubmit();
        });
        return;
      }
      if (!title && c.title) title = c.title.slice(0, 100);
      checks[slug] = c;
    } catch { /* 점검 실패는 저장을 막지 않는다 */ }
    if (!title) title = slug;

    btn.textContent = '저장 중...';
    const existing = editing ? pages.find((p) => p.slug === editing) : null;
    const data = {
      title, url, pageId,
      ...(category ? { category } : {}),
      ...(password ? { locked: true } : {}),
      ...(existing && 'hidden' in existing ? { hidden: existing.hidden } : {}),
      order: existing?.order ?? (pages.length ? Math.max(...pages.map((p) => p.order ?? 0)) + 1 : 0),
      createdAt: existing?.createdAt ?? serverTimestamp(),
      updatedAt: serverTimestamp(),
    };
    // 비밀번호는 공개 읽기인 notion_pages가 아니라 관리자 전용 notion_secrets에.
    // 잠그는 경우엔 비밀번호를 먼저 저장해야 잠긴 순간 비밀번호가 없는 틈이 안 생긴다.
    if (password) await setDoc(doc(db, 'notion_secrets', slug), { password, updatedAt: serverTimestamp() });
    await setDoc(doc(db, 'notion_pages', slug), data);
    if (!password && existing?.locked) await deleteDoc(doc(db, 'notion_secrets', slug)).catch(() => {});
    showToast(editing ? '저장했어요 (학생 화면엔 최대 2분 뒤 반영)' : '등록했어요');
    resetForm();
    await refresh({ withChecks: false });
  } catch (err) {
    console.error('저장 실패:', err);
    errEl.textContent = explainSaveError(err);
  } finally {
    forceSave = false;
    btn.disabled = false;
    btn.textContent = editing ? '저장' : '등록';
  }
}

try { if (localStorage.getItem('dark') === '1') document.body.classList.add('dark'); } catch { /* 무시 */ }

(async function init() {
  await window.AdminAuth.ready;
  if (window.AdminAuth.isValid()) await renderDashboard();
  else renderLogin();
})();
