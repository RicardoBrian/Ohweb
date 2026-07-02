// 관리자 로그인 세션 — localStorage 기반, 30일 유지
(function () {
  const KEY = 'ohweb_admin';
  const TTL_MS = 30 * 24 * 60 * 60 * 1000; // 30일

  window.AdminAuth = {
    login() {
      localStorage.setItem(KEY, JSON.stringify({ exp: Date.now() + TTL_MS }));
    },
    isValid() {
      let d;
      try { d = JSON.parse(localStorage.getItem(KEY) || 'null'); } catch { d = null; }
      if (!d || !d.exp || Date.now() > d.exp) { localStorage.removeItem(KEY); return false; }
      return true;
    },
    logout() {
      localStorage.removeItem(KEY);
    },
  };
})();
