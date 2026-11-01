// 관리자 로그인 — Firebase Auth(Google 로그인) 기반. ohweb/public/admin-auth.js와
// 동일한 패턴(같은 관리자 계정 하나만 허용) — 자체 비밀번호/세션 쿠키는 안 쓴다.
(function () {
  const ADMIN_EMAIL = 'teacher@example.com';

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
        import('/vibe/shared/fake-firebase/firebase-auth.js'),
      ]);
      await signInWithPopup(auth, new GoogleAuthProvider());
    },
    async logout() {
      const [{ auth }, { signOut }] = await Promise.all([
        import('./firebase-config.js'),
        import('/vibe/shared/fake-firebase/firebase-auth.js'),
      ]);
      await signOut(auth);
    },
  };

  (async () => {
    const [{ auth }, { onAuthStateChanged }] = await Promise.all([
      import('./firebase-config.js'),
      import('/vibe/shared/fake-firebase/firebase-auth.js'),
    ]);
    onAuthStateChanged(auth, user => {
      _user = user;
      _resolveReady();
    });
  })();
})();
