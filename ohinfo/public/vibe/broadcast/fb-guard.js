/* ─────────────────────────────────────────────────────────────
   Firebase 공통 설정 + 연결 진단
   ─ 모든 페이지(index / admin / request / migrate)가 이 파일 하나의
     설정을 사용합니다. Firebase 프로젝트를 바꿀 때는 FB_CONFIG만
     수정하면 됩니다.
   ───────────────────────────────────────────────────────────── */

window.FB_CONFIG = { projectId: 'vibe-broadcast' }; // 견본: 가짜 Firebase

(function () {
  'use strict';

  // Firestore 오류 코드 → 사람이 읽을 수 있는 원인 설명
  var CODE_MSG = {
    'permission-denied':
      'Firestore 보안 규칙이 요청을 거부했습니다. Firebase 콘솔 → Firestore Database → 규칙 탭에 ' +
      '저장소의 firestore.rules 내용을 붙여넣고 “게시”하세요. ' +
      '(테스트 모드로 만든 규칙은 30일 뒤 자동으로 차단됩니다.)',
    'unauthenticated':
      'Firebase 인증이 필요합니다. Firestore 규칙이 로그인한 사용자만 허용하도록 되어 있는지 확인하세요.',
    'unavailable':
      'Firestore 서버에 연결하지 못했습니다. 인터넷 연결, 광고 차단 확장 프로그램, ' +
      '학교/기관 방화벽(firestore.googleapis.com 차단)을 확인하세요.',
    'failed-precondition':
      '필요한 Firestore 색인이 없습니다. 브라우저 개발자 도구 콘솔에 찍힌 “Create index” 링크를 열어 색인을 만들어 주세요.',
    'resource-exhausted':
      'Firestore 무료 할당량을 초과했습니다. Firebase 콘솔 → 사용량 및 결제를 확인하세요.',
    'not-found':
      '요청한 문서를 찾을 수 없습니다.',
    'invalid-argument':
      '잘못된 요청입니다. 저장하려는 값에 undefined가 섞여 있지 않은지 확인하세요.'
  };

  function code(e) {
    return (e && (e.code || e.name)) ? String(e.code || e.name) : '';
  }

  /** 오류 객체 → 화면에 띄울 한국어 메시지 */
  function message(e) {
    var c = code(e);
    if (c === 'permission-denied' && !identity) {
      return '쓰기 권한이 없습니다. 페이지를 새로고침해 다시 입장하거나, ' +
             '관리자 페이지는 구글 로그인이 되어 있는지 확인하세요.';
    }
    if (CODE_MSG[c]) return CODE_MSG[c];
    return (e && e.message) ? e.message : '알 수 없는 오류';
  }

  // 사이트 입장 게이트를 통과해 얻은 신원(staff). null 이면 읽기 전용.
  // 관리자(admin) 권한은 이 값과 무관하게 각 페이지가 Firebase Auth
  // 구글 로그인으로 직접 받는다 (admin.html 참고).
  var identity = null;
  var authReady = Promise.resolve(null);

  var bannerEl = null;

  /** 화면 상단에 지워지지 않는 경고 배너를 띄운다 (한 번만 생성) */
  function banner(text) {
    if (bannerEl) { bannerEl.querySelector('.fbg-text').textContent = text; return; }
    bannerEl = document.createElement('div');
    bannerEl.setAttribute('role', 'alert');
    bannerEl.style.cssText = [
      'position:fixed', 'top:0', 'left:0', 'right:0', 'z-index:99999',
      'background:#b3261e', 'color:#fff',
      'font:500 13px/1.5 system-ui,-apple-system,"IBM Plex Sans KR",sans-serif',
      'padding:10px 44px 10px 16px', 'box-shadow:0 2px 12px rgba(0,0,0,.25)',
      'display:flex', 'gap:8px', 'align-items:flex-start'
    ].join(';');
    bannerEl.innerHTML =
      '<span style="flex:0 0 auto">⚠️</span>' +
      '<span class="fbg-text" style="flex:1 1 auto"></span>' +
      '<button type="button" aria-label="닫기" style="position:absolute;top:6px;right:10px;' +
      'background:none;border:0;color:#fff;font-size:18px;line-height:1;cursor:pointer">×</button>';
    bannerEl.querySelector('.fbg-text').textContent = text;
    bannerEl.querySelector('button').onclick = function () { bannerEl.remove(); bannerEl = null; };
    (document.body || document.documentElement).appendChild(bannerEl);
  }

  /**
   * 읽기 권한이 살아 있는지 가벼운 요청 한 번으로 확인한다.
   * 규칙이 막혀 있으면(=가장 흔한 장애) 곧바로 배너로 알려 준다.
   */
  function check(db) {
    if (!db) return;
    db.collection('__health').doc('__probe').get().catch(function (e) {
      var c = code(e);
      if (c === 'permission-denied' || c === 'unavailable' ||
          c === 'unauthenticated' || c === 'resource-exhausted') {
        console.error('[FBGuard]', c, e);
        banner('Firebase 연결 문제: ' + message(e));
      }
    });
  }

  /**
   * Firestore를 못 쓰는 상황에서 쓰는 더미 핸들.
   * db가 null이면 페이지마다 "Cannot read properties of null" 이 쏟아지지만,
   * 이 스텁은 모든 쿼리를 reject 시키므로 각 화면의 기존 catch 블록이
   * "불러오지 못했습니다" 안내를 정상적으로 그려 줍니다.
   */
  function offlineStub(reason) {
    var err = new Error(reason);
    err.code = 'unavailable';
    var TERMINAL = { get: 1, set: 1, add: 1, update: 1, delete: 1, commit: 1 };
    var proxy = new Proxy(function () {}, {
      get: function (_t, prop) {
        if (typeof prop === 'symbol' || prop === 'then') return undefined;
        if (prop === 'onSnapshot') {
          return function (a, b) {
            var onErr = (typeof b === 'function') ? b
                      : (a && typeof a.error === 'function') ? a.error.bind(a) : null;
            if (onErr) setTimeout(function () { onErr(err); }, 0);
            return function () {};
          };
        }
        if (TERMINAL[prop]) return function () { return Promise.reject(err); };
        return function () { return proxy; };
      }
    });
    return proxy;
  }

  /**
   * Cloudflare Function이 발급한 커스텀 토큰으로 Firebase에 로그인한다.
   * 입장 비밀번호(SITE_PASSWORD)를 통과한 브라우저만 이 토큰을 받을 수
   * 있으므로, Firestore 쓰기 권한이 게이트와 묶입니다. 이 로그인은
   * staff 권한만 준다 — admin 권한은 이 흐름과 별개다.
   *
   * 로그인에 실패해도 읽기는 그대로 동작합니다(규칙상 읽기는 공개).
   */
  async function signIn() {
    if (!firebase.auth) {
      console.warn('[FBGuard] firebase-auth-compat.js 가 없어 편집 권한을 받을 수 없습니다.');
      return null;
    }
    var res;
    try {
      res = await fetch('/api/token', { credentials: 'same-origin' });
    } catch (e) {
      console.warn('[FBGuard] 토큰 요청 실패 (로컬 실행?)', e);
      return null;
    }
    if (res.status === 404) return null;          // Cloudflare Pages 밖에서 실행 중
    if (!res.ok) {
      var body = await res.json().catch(function () { return {}; });
      if (body.error === 'no_service_account') {
        banner('Firebase 서비스 계정이 설정되지 않아 편집이 불가능합니다. ' +
               'Cloudflare Pages 설정에서 FIREBASE_SERVICE_ACCOUNT 시크릿을 확인하세요.');
      } else if (res.status === 401) {
        banner('편집 권한을 받지 못했습니다(읽기 전용). 입장 인증이 만료됐다면 새로고침해 ' +
               '다시 입장하시고, 그래도 같다면 Cloudflare Pages에 SITE_PASSWORD 시크릿이 ' +
               '설정돼 있는지 확인하세요.');
      }
      return null;
    }
    var data = await res.json();
    try {
      await firebase.auth().signInWithCustomToken(data.token);
    } catch (e) {
      console.error('[FBGuard] signInWithCustomToken 실패', e);
      banner('Firebase 로그인에 실패했습니다: ' + message(e));
      return null;
    }
    identity = { staff: true };
    return identity;
  }

  /**
   * SDK 로드 확인 → 앱 초기화 → 진단. 실패해도 항상 쓸 수 있는 핸들을 반환.
   * options.auth 가 true 인 페이지만 편집 권한(커스텀 토큰)을 요청합니다.
   * 학생용 신청 페이지는 신청곡 등록만 하면 되고 그건 규칙상 공개입니다.
   */
  function init(options) {
    if (typeof firebase === 'undefined' || !firebase.initializeApp) {
      var msg = 'Firebase SDK를 불러오지 못했습니다. 네트워크 상태를 확인하거나, ' +
                '광고 차단 확장 프로그램·학교 방화벽이 gstatic.com을 막고 있는지 확인하세요.';
      banner(msg);
      return offlineStub(msg);
    }
    try {
      if (!firebase.apps.length) firebase.initializeApp(window.FB_CONFIG);
      var db = firebase.firestore();
      check(db);
      if (options && options.auth) authReady = signIn();
      return db;
    } catch (e) {
      console.error('[FBGuard] init failed', e);
      banner('Firebase 초기화에 실패했습니다: ' + message(e));
      return offlineStub(message(e));
    }
  }

  window.FBGuard = {
    init: init, check: check, message: message, banner: banner, offlineStub: offlineStub,
    /** staff 로그인이 끝날 때까지 기다린다. 결과는 신원 객체 또는 null. */
    ready: function () { return authReady; },
    /** 현재 신원 (null = 읽기 전용) */
    identity: function () { return identity; }
  };
})();
