/*
 * 모든 견본 화면의 <head> 맨 앞에서 불러오는 공통 스크립트 (일반 스크립트).
 *
 * 1) 저장 공간 분리: 견본은 실제 학생 사이트와 같은 kakainfo.com 주소에서 돌아간다.
 *    견본 앱이 localStorage에 쓰는 이름 앞에 'vibe~'를 붙여서, 실제 사이트의 로그인
 *    정보·설정과 절대 섞이지 않게 한다. ('vibe'로 시작하는 이름은 그대로 둔다.)
 * 2) 화면 아래 작은 표시줄: "견본" 표시, 목록으로 돌아가기, 견본 데이터 처음으로.
 */
(function () {
  const P = 'vibe~';
  const map = (k) => (String(k).startsWith('vibe') ? String(k) : P + k);
  const SP = Storage.prototype;
  const get = SP.getItem, set = SP.setItem, rm = SP.removeItem;
  SP.getItem = function (k) { return get.call(this, map(k)); };
  SP.setItem = function (k, v) { return set.call(this, map(k), v); };
  SP.removeItem = function (k) { return rm.call(this, map(k)); };
  SP.clear = function () {
    for (let i = this.length - 1; i >= 0; i--) { const k = SP.key.call(this, i); if (k && k.startsWith(P)) rm.call(this, k); }
  };

  // 서버 기능(/api/...) 가로채기: 견본은 실제 서버(번역·코드 실행·AI 채점)를 부르지 않는다.
  // 브라우저 안에서 흉내 낼 수 있는 것(LOCAL_API)만 shared/api/<이름>.js로 돌린다.
  const LOCAL_API = ['exam', 'comci', 'version'];
  const API_RE = /\/api\/([a-z0-9-]+)/;
  const realFetch = window.fetch.bind(window);
  const sharedBase = new URL('.', document.currentScript ? document.currentScript.src : location.href).href;
  // 실제 앱의 Apps Script(파일 업로드·선생님 알림) 주소는 견본 사본에서 이 가짜 주소로 바꿔 둔다.
  // 업로드한 파일은 서버로 보내지 않고 브라우저 안의 data: 주소로 돌려준다(작은 파일만).
  const FAKE_UPLOAD_HOST = 'demo-upload.invalid';
  async function fakeUpload(init) {
    let body = {};
    try { body = JSON.parse(init && init.body || '{}'); } catch { body = {}; }
    const ok = (o) => new Response(JSON.stringify(o), { status: 200, headers: { 'Content-Type': 'application/json' } });
    if (body.action) return ok({ ok: true, demo: true });
    if (!body.base64) return ok({ error: '견본에서는 사용할 수 없는 기능입니다.' });
    if (body.base64.length > 700000) return ok({ error: '견본에서는 500KB가 넘는 파일은 올릴 수 없습니다.' });
    return ok({ url: `data:${body.mimeType || 'application/octet-stream'};base64,${body.base64}`, demo: true });
  }

  window.fetch = function (input, init) {
    const url = new URL(typeof input === 'string' ? input : input.url, location.href);
    if (url.hostname === FAKE_UPLOAD_HOST) return fakeUpload(init);
    const m = url.origin === location.origin && url.pathname.match(API_RE);
    if (!m) return realFetch(input, init);
    const req = new Request(url.href, init || (typeof input === 'string' ? undefined : input));
    if (LOCAL_API.includes(m[1])) return import(sharedBase + 'api/' + m[1] + '.js').then((mod) => mod.handle(req));
    const msg = '견본에서는 사용할 수 없는 기능입니다. (실제 앱에서는 서버에서 처리합니다)';
    return Promise.resolve(new Response(JSON.stringify({ error: msg, detail: msg }), { status: 200, headers: { 'Content-Type': 'application/json' } }));
  };

  function resetAll() {
    if (!confirm('모든 견본 앱의 데이터를 처음 상태로 되돌릴까요?\n(이 브라우저에 저장된 견본 데이터만 지워집니다)')) return;
    for (const store of [localStorage, sessionStorage]) {
      for (let i = store.length - 1; i >= 0; i--) {
        const k = SP.key.call(store, i);
        if (k && k.startsWith('vibe')) rm.call(store, k);
      }
    }
    location.reload();
  }
  window.VibeDemo = { resetAll };

  const root = (document.currentScript && document.currentScript.dataset.root) || '/vibe/';
  if (document.currentScript && document.currentScript.dataset.bar === 'off') return;

  function mount() {
    if (document.getElementById('vibe-demo-bar')) return;
    const css = document.createElement('style');
    css.textContent = `
      #vibe-demo-bar { position: fixed; left: 50%; transform: translateX(-50%); bottom: calc(12px + env(safe-area-inset-bottom)); z-index: 2147483000; display: flex; align-items: center; gap: 2px;
        padding: 4px; border-radius: 999px; background: rgba(29,31,63,0.88); color: #fff; box-shadow: 0 6px 20px rgba(20,20,60,0.28);
        font: 600 12px/1 -apple-system, BlinkMacSystemFont, 'Pretendard', 'Apple SD Gothic Neo', 'Malgun Gothic', sans-serif; letter-spacing: 0; }
      #vibe-demo-bar * { box-sizing: border-box; }
      #vibe-demo-bar .vb-tag { padding: 6px 9px; border-radius: 999px; background: #8f7bff; color: #fff; }
      #vibe-demo-bar a, #vibe-demo-bar button { all: unset; cursor: pointer; padding: 6px 9px; border-radius: 999px; color: #fff; }
      #vibe-demo-bar a:hover, #vibe-demo-bar button:hover { background: rgba(255,255,255,0.16); }
      #vibe-demo-bar.min .vb-more { display: none; }
      @media print { #vibe-demo-bar { display: none !important; } }`;
    document.head.appendChild(css);
    const bar = document.createElement('div');
    bar.id = 'vibe-demo-bar';
    bar.setAttribute('role', 'region');
    bar.setAttribute('aria-label', '견본 안내');
    bar.innerHTML = `<span class="vb-tag" title="개인정보를 빼고 견본 데이터를 넣은 체험용 사본입니다. 입력한 내용은 이 브라우저에만 저장됩니다.">견본</span>`
      + `<span class="vb-more"><a href="${root}">목록</a><button type="button" class="vb-reset">처음으로</button></span>`
      + `<button type="button" class="vb-toggle" aria-label="접기">‹</button>`;
    bar.querySelector('.vb-reset').addEventListener('click', resetAll);
    const tg = bar.querySelector('.vb-toggle');
    tg.addEventListener('click', () => { const m = bar.classList.toggle('min'); tg.textContent = m ? '›' : '‹'; tg.setAttribute('aria-label', m ? '펼치기' : '접기'); });
    document.body.appendChild(bar);
    // 모바일 하단 탭바(관리자 화면 등)가 보이면 그 위로 띄운다
    const lift = () => {
      let h = 0;
      document.querySelectorAll('.tabbar, .bottom-nav, .tab-bar, nav').forEach((el) => {
        const r = el.getBoundingClientRect();
        if (r.height && getComputedStyle(el).display !== 'none' && r.bottom >= innerHeight - 40 && r.top > innerHeight * 0.6) h = Math.max(h, innerHeight - r.top);
      });
      bar.style.bottom = h ? `calc(${h + 10}px + env(safe-area-inset-bottom))` : '';
    };
    lift();
    addEventListener('resize', lift);
    setTimeout(lift, 800);
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', mount);
  else mount();
})();
