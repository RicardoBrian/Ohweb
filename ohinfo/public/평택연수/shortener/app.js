/**
 * ohshort (견본) — 원본은 Firestore + 관리자 Google 로그인을 쓰지만,
 * 이 견본은 로그인 없이 바로 쓸 수 있고 데이터는 이 브라우저의
 * localStorage에만 저장된다(서버로 전송하지 않음). UI/동작은 원본과 동일하게 유지.
 */

const app = document.getElementById('app');
const STORE_KEY = 'ohshrt.demo.links';
const publicBase = 'https://kakainfo.com';

const CODE_RE = /^[\p{L}\p{N}_-]{2,32}$/u;
const RESERVED = new Set(['api', 'admin', 'login', 'logout', 'favicon.ico', 'style.css', 'app.js']);

function loadLinksStore() {
  try {
    return JSON.parse(localStorage.getItem(STORE_KEY) || '[]');
  } catch {
    return [];
  }
}
function saveLinksStore(links) {
  localStorage.setItem(STORE_KEY, JSON.stringify(links));
}

function escapeHtml(str) {
  return str.replace(/[&<>"']/g, (c) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
  }[c]));
}

function formatDate(ts) {
  if (!ts) return '';
  return new Date(ts).toLocaleString('ko-KR', { year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' });
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

async function renderDashboard() {
  app.innerHTML = `
    <div class="topbar">
      <p class="brand">oh sh.rt <span style="opacity:.6;font-weight:500;">(견본)</span></p>
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
        <h2>내 링크 <span style="opacity:.5;font-weight:500;font-size:0.8em;">(이 브라우저에만 저장됨)</span></h2>
        <div class="link-list" id="linkList">
          <div class="empty-state">불러오는 중...</div>
        </div>
      </div>
    </div>
  `;

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

      const links = loadLinksStore();
      let code = alias.normalize('NFC');
      if (code) {
        if (!CODE_RE.test(code) || RESERVED.has(code.toLowerCase())) {
          throw new Error('커스텀 코드는 한글/영문/숫자/-/_ 2~32자여야 하며 예약어는 사용할 수 없습니다');
        }
        if (links.some((l) => l.code === code)) {
          throw new Error('이미 사용 중인 코드입니다');
        }
      } else {
        for (let i = 0; i < 5; i++) {
          const candidate = randomCode();
          if (!links.some((l) => l.code === candidate)) { code = candidate; break; }
        }
        if (!code) throw new Error('코드 생성에 실패했습니다. 다시 시도하세요');
      }

      links.unshift({ code, url, createdAt: Date.now() });
      saveLinksStore(links);
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
    const links = loadLinksStore().slice().sort((a, b) => b.createdAt - a.createdAt);
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
              <span class="link-short">${escapeHtml(shortHost)}/${escapeHtml(link.code)} <span style="opacity:.5;font-size:0.85em;">(견본 — 실제 이동 안됨)</span></span>
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
        const links = loadLinksStore().filter((l) => l.code !== btn.dataset.code);
        saveLinksStore(links);
        showToast('삭제되었습니다');
        await loadLinks();
      });
    });
  } catch (err) {
    listEl.innerHTML = `<div class="empty-state">불러오기에 실패했습니다: ${escapeHtml(err.message)}</div>`;
  }
}

renderDashboard();
