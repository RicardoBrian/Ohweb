const app = document.getElementById("app");

// Origin the short links are handed out under. The admin page may be served
// from a different hostname, so /api/session tells us the public one.
let publicBase = location.origin;

function escapeHtml(str) {
  return str.replace(/[&<>"']/g, (c) => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    '"': "&quot;",
    "'": "&#39;",
  }[c]));
}

function formatDate(ts) {
  const d = new Date(ts);
  return d.toLocaleString("ko-KR", {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function showToast(message, type = "success") {
  const existing = document.querySelector(".toast");
  if (existing) existing.remove();
  const toast = document.createElement("div");
  toast.className = `toast ${type}`;
  toast.textContent = message;
  document.body.appendChild(toast);
  requestAnimationFrame(() => toast.classList.add("show"));
  setTimeout(() => {
    toast.classList.remove("show");
    setTimeout(() => toast.remove(), 300);
  }, 2200);
}

async function api(path, options = {}) {
  const res = await fetch(path, {
    ...options,
    headers: { "Content-Type": "application/json", ...(options.headers || {}) },
  });
  let data = null;
  try {
    data = await res.json();
  } catch {
    // no body
  }
  if (!res.ok) {
    const message = (data && data.error) || `요청 실패 (${res.status})`;
    throw new Error(message);
  }
  return data;
}

function renderLogin(errorMessage = "") {
  app.innerHTML = `
    <div class="login-wrap">
      <div class="login-card">
        <p class="brand">oh sh.rt</p>
        <p class="brand-sub">계속하려면 비밀번호를 입력하세요</p>
        <form id="loginForm">
          <div class="field">
            <label for="password">비밀번호</label>
            <input type="password" id="password" name="password" placeholder="••••••••" autocomplete="current-password" autofocus required />
          </div>
          <button type="submit" class="btn btn-primary" id="loginBtn">입장하기</button>
          <p class="error-msg" id="loginError">${errorMessage ? escapeHtml(errorMessage) : ""}</p>
        </form>
      </div>
    </div>
  `;

  const form = document.getElementById("loginForm");
  const errorEl = document.getElementById("loginError");
  const btn = document.getElementById("loginBtn");

  form.addEventListener("submit", async (e) => {
    e.preventDefault();
    errorEl.textContent = "";
    btn.disabled = true;
    btn.textContent = "확인 중...";
    try {
      const password = document.getElementById("password").value;
      await api("/api/login", { method: "POST", body: JSON.stringify({ password }) });
      await renderDashboard();
    } catch (err) {
      errorEl.textContent = err.message;
      btn.disabled = false;
      btn.textContent = "입장하기";
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

  document.getElementById("logoutBtn").addEventListener("click", async () => {
    await api("/api/logout", { method: "POST" });
    renderLogin();
  });

  const createForm = document.getElementById("createForm");
  const createError = document.getElementById("createError");
  const createBtn = document.getElementById("createBtn");

  createForm.addEventListener("submit", async (e) => {
    e.preventDefault();
    createError.textContent = "";
    createBtn.disabled = true;
    createBtn.textContent = "생성 중...";
    const url = document.getElementById("url").value.trim();
    const alias = document.getElementById("alias").value.trim();
    try {
      await api("/api/links", { method: "POST", body: JSON.stringify({ url, alias: alias || undefined }) });
      createForm.reset();
      showToast("단축 URL이 생성되었습니다");
      await loadLinks();
    } catch (err) {
      createError.textContent = err.message;
    } finally {
      createBtn.disabled = false;
      createBtn.textContent = "단축하기";
    }
  });

  await loadLinks();
}

async function loadLinks() {
  const listEl = document.getElementById("linkList");
  if (!listEl) return;
  try {
    const { links } = await api("/api/links");
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
      .join("");

    listEl.querySelectorAll(".copy-btn").forEach((btn) => {
      btn.addEventListener("click", async () => {
        try {
          await navigator.clipboard.writeText(btn.dataset.url);
          showToast("클립보드에 복사되었습니다");
        } catch {
          showToast("복사에 실패했습니다", "error");
        }
      });
    });

    listEl.querySelectorAll(".delete-btn").forEach((btn) => {
      btn.addEventListener("click", async () => {
        if (!confirm("이 링크를 삭제할까요?")) return;
        try {
          await api(`/api/links/${encodeURIComponent(btn.dataset.code)}`, { method: "DELETE" });
          showToast("삭제되었습니다");
          await loadLinks();
        } catch (err) {
          showToast(err.message, "error");
        }
      });
    });
  } catch (err) {
    listEl.innerHTML = `<div class="empty-state">불러오기에 실패했습니다: ${escapeHtml(err.message)}</div>`;
  }
}

async function init() {
  try {
    const { authenticated, baseUrl } = await api("/api/session");
    if (baseUrl) publicBase = baseUrl.replace(/\/+$/, "");
    if (authenticated) {
      await renderDashboard();
    } else {
      renderLogin();
    }
  } catch {
    renderLogin();
  }
}

init();
