// 관리자 로그인 — Firebase Auth(Google 로그인) 기반.
// 이 화면/다른 admin 페이지들이 여는 시점엔 아직 로그인 상태 복원이 끝나지
// 않았을 수 있어서(비동기), AdminAuth.ready를 await 한 뒤에 isValid()를
// 확인해야 한다 — 그 전에 확인하면 로그인된 사람도 튕겨나간다.
(function () {
  const ADMIN_EMAIL = 'qjatjr7575@gmail.com';

  let _user = null;
  let _resolveReady;
  const ready = new Promise(res => { _resolveReady = res; });

  window.AdminAuth = {
    ready,
    isValid() {
      return !!_user && _user.email === ADMIN_EMAIL;
    },
    async login() {
      const [{ auth }, { GoogleAuthProvider, signInWithPopup }] = await Promise.all([
        import('./firebase-config.js'),
        import('https://www.gstatic.com/firebasejs/10.12.2/firebase-auth.js'),
      ]);
      await signInWithPopup(auth, new GoogleAuthProvider());
    },
    async logout() {
      const [{ auth }, { signOut }] = await Promise.all([
        import('./firebase-config.js'),
        import('https://www.gstatic.com/firebasejs/10.12.2/firebase-auth.js'),
      ]);
      await signOut(auth);
    },
  };

  (async () => {
    const [{ auth }, { onAuthStateChanged }] = await Promise.all([
      import('./firebase-config.js'),
      import('https://www.gstatic.com/firebasejs/10.12.2/firebase-auth.js'),
    ]);
    onAuthStateChanged(auth, user => {
      _user = user;
      _resolveReady();
    });
  })();
})();
