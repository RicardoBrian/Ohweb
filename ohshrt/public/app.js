import { db } from './firebase-config.js';
import {
  collection, doc, getDoc, getDocs, setDoc, deleteDoc, query, orderBy, serverTimestamp,
} from 'https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js';

const app = document.getElementById('app');
// 단축 링크가 배포되는 곳 — 관리 페이지(short.kakainfo.com)와 다른 도메인이다.
// 실제 리다이렉트는 ohinfo 프로젝트의 functions/[[code]].js가 처리한다.
const publicBase = 'https://kakainfo.com';

const CODE_RE = /^[\p{L}\p{N}_-]{2,32}$/u;
const RESERVED = new Set(['api', 'admin', 'login', 'logout', 'favicon.ico', 'style.css', 'app.js', 'firebase-config.js', 'admin-auth.js']);

function escapeHtml(str) {
  return str.replace(/[&<>"']/g, (c) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
  }[c]));
}

function formatDate(ts) {
  if (!ts) return '';
  const d = ts.toDate ? ts.toDate() : new Date(ts);
  return d.toLocaleString('ko-KR', { year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' });
}

function isValidUrl(value) {
  try {
    const u = new URL(value);
    return u.protocol === 'http:' || u.protocol === 'https:';
  } catch {
    return false;
  }
}

function randomCode(len = 6) {
  const chars = 'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
  const bytes = crypto.getRandomValues(new Uint8Array(len));
  return Array.from(bytes, (b) => chars[b % chars.length]).join('');
}

function showToast(message, type = 'success') {
  const existing = document.querySelector('.toast');
  if (existing) existing.remove();
  const toast = document.createElement('div');
  toast.className = `toast ${type}`;
  toast.textContent = message;
  document.body.appendChild(toast);
  requestAnimationFrame(() => toast.classList.add('show'));
  setTimeout(() => {
    toast.classList.remove('show');
    setTimeout(() => toast.remove(), 300);
  }, 2200);
}

function renderLogin(errorMessage = '') {
  app.innerHTML = `
    <div class="login-wrap">
      <div class="login-card">
        <p class="brand">oh sh.rt</p>
        <p class="brand-sub">계속하려면 로그인하세요</p>
        <button class="btn btn-primary" id="loginBtn">Google로 로그인</button>
        <p class="error-msg" id="loginError">${errorMessage ? escapeHtml(errorMessage) : ''}</p>
      </div>
    </div>
  `;
  document.getElementById('loginBtn').addEventListener('click', async () => {
    const errorEl = document.getElementById('loginError');
    errorEl.textContent = '';
    try {
      await window.AdminAuth.login();
      if (window.AdminAuth.isValid()) {
        await renderDashboard();
      } else {
        errorEl.textContent = '관리자 계정이 아닙니다.';
        await window.AdminAuth.logout();
      }
    } catch (e) {
      errorEl.textContent = '로그인 실패: ' + e.message;
    }
  });
}

async function renderDashboard() {
  app.innerHTML = `
    <div class="topbar">
      <p class="brand">oh sh.rt</p>
      <button class="btn btn-ghost" id="logoutBtn" style="width:auto;padding:8px 16px;font-size:13px;">로그아웃</button>
    </div>
    <div class="dashboard">
      <div class="create-card">
        <h2>새 단축 URL 만들기</h2>
        <form id="createForm">
          <div class="form-row">
            <div class="field">
              <label for="url">원본 URL</label>
              <input type="url" id="url" name="url" placeholder="https://example.com/very/long/path" required />
            </div>
            <div class="field small">
              <label for="alias">커스텀 코드 (선택)</label>
              <input type="text" id="alias" name="alias" placeholder="비워두면 자동생성" maxlength="32" />
            </div>
          </div>
          <div class="form-actions">
            <button type="submit" class="btn btn-primary" id="createBtn">단축하기</button>
          </div>
          <p class="error-msg" id="createError"></p>
        </form>
      </div>
      <div class="links-section">
        <h2>내 링크</h2>
        <div class="link-list" id="linkList">
          <div class="empty-state">불러오는 중...</div>
        </div>
      </div>
    </div>
  `;

  document.getElementById('logoutBtn').addEventListener('click', async () => {
    await window.AdminAuth.logout();
    renderLogin();
  });

  const createForm = document.getElementById('createForm');
  const createError = document.getElementById('createError');
  const createBtn = document.getElementById('createBtn');

  createForm.addEventListener('submit', async (e) => {
    e.preventDefault();
    createError.textContent = '';
    createBtn.disabled = true;
    createBtn.textContent = '생성 중...';
    try {
      const url = document.getElementById('url').value.trim();
      const alias = document.getElementById('alias').value.trim();
      if (!isValidUrl(url)) throw new Error('유효한 URL을 입력하세요 (http:// 또는 https://)');

      let code = alias;
      if (code) {
        if (!CODE_RE.test(code) || RESERVED.has(code.toLowerCase())) {
          throw new Error('커스텀 코드는 한글/영문/숫자/-/_ 2~32자여야 하며 예약어는 사용할 수 없습니다');
        }
        if ((await getDoc(doc(db, 'short_links', code))).exists()) {
          throw new Error('이미 사용 중인 코드입니다');
        }
      } else {
        for (let i = 0; i < 5; i++) {
          const candidate = randomCode();
          if (!(await getDoc(doc(db, 'short_links', candidate))).exists()) { code = candidate; break; }
        }
        if (!code) throw new Error('코드 생성에 실패했습니다. 다시 시도하세요');
      }

      await setDoc(doc(db, 'short_links', code), { url, createdAt: serverTimestamp() });
      createForm.reset();
      showToast('단축 URL이 생성되었습니다');
      await loadLinks();
    } catch (err) {
      createError.textContent = err.message;
    } finally {
      createBtn.disabled = false;
      createBtn.textContent = '단축하기';
    }
  });

  await loadLinks();
}

async function loadLinks() {
  const listEl = document.getElementById('linkList');
  if (!listEl) return;
  try {
    const snap = await getDocs(query(collection(db, 'short_links'), orderBy('createdAt', 'desc')));
    const links = snap.docs.map((d) => ({ code: d.id, ...d.data() }));
    if (!links.length) {
      listEl.innerHTML = `<div class="empty-state">아직 생성된 링크가 없습니다.</div>`;
      return;
    }
    listEl.innerHTML = links
      .map((link) => {
        const shortUrl = `${publicBase}/${link.code}`;
        const shortHost = new URL(publicBase).host;
        return `
          <div class="link-card" data-code="${escapeHtml(link.code)}">
            <div class="link-info">
              <a class="link-short" href="${escapeHtml(shortUrl)}" target="_blank" rel="noopener noreferrer">${escapeHtml(shortHost)}/${escapeHtml(link.code)}</a>
              <div class="link-original" title="${escapeHtml(link.url)}">${escapeHtml(link.url)}</div>
              <div class="link-date">${formatDate(link.createdAt)}</div>
            </div>
            <div class="link-actions">
              <button class="icon-btn copy-btn" title="복사" data-url="${escapeHtml(shortUrl)}">⧉</button>
              <button class="icon-btn danger delete-btn" title="삭제" data-code="${escapeHtml(link.code)}">✕</button>
            </div>
          </div>
        `;
      })
      .join('');

    listEl.querySelectorAll('.copy-btn').forEach((btn) => {
      btn.addEventListener('click', async () => {
        try {
          await navigator.clipboard.writeText(btn.dataset.url);
          showToast('클립보드에 복사되었습니다');
        } catch {
          showToast('복사에 실패했습니다', 'error');
        }
      });
    });

    listEl.querySelectorAll('.delete-btn').forEach((btn) => {
      btn.addEventListener('click', async () => {
        if (!confirm('이 링크를 삭제할까요?')) return;
        try {
          await deleteDoc(doc(db, 'short_links', btn.dataset.code));
          showToast('삭제되었습니다');
          await loadLinks();
        } catch (err) {
          showToast(err.message, 'error');
        }
      });
    });
  } catch (err) {
    listEl.innerHTML = `<div class="empty-state">불러오기에 실패했습니다: ${escapeHtml(err.message)}</div>`;
  }
}

async function init() {
  await window.AdminAuth.ready;
  if (window.AdminAuth.isValid()) {
    await renderDashboard();
  } else {
    renderLogin();
  }
}

init();
