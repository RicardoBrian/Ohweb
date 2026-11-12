// 발표 따라가기 — 선생님이 발표 모드에서 "학생 고정"을 켜면, 그 학습지를 연 학생 화면이
// 자동으로 발표 모드로 바뀌고 선생님이 넘기는 슬라이드만 보여 준다(학생은 못 넘기고 못 끈다).
// 선생님이 고정을 풀거나 발표를 끝내면 학생은 다시 마음대로 볼 수 있다.
//
// 상태: appSettings/ohnotion_follow_{주소} = { on, path, slide, total, blank, at }
//       (appSettings 규칙 그대로 — 공개 읽기·관리자 쓰기. 규칙 변경 없음.)
//   - 주소(slug) 하나에 하나. 선생님이 하위 페이지에서 발표하면 path 로 학생도 그 페이지로 옮긴다.
//   - 고정 중에 선생님이 슬라이드 안의 하위 페이지 링크를 누르면, 고정을 풀지 않고 새 path 와 함께
//     from(떠난 페이지)·link(그 페이지 본문에서 몇 번째 하위 페이지 링크인지)를 먼저 쓴 뒤 옮겨 가서
//     그 페이지에서 발표·고정을 그대로 이어 간다. 다른 언어로 보는 학생은 link 번호로 자기 언어 페이지의
//     같은 자리 링크를 찾아간다(언어별 페이지의 하위 페이지 순서가 같아야 함).
//   - 선생님이 고정 중에 새로고침·뒤로 가기를 해도 같은 탭이면 1분 안에 다시 켜진다(sessionStorage).
//   - 학생 화면은 onSnapshot 으로 듣는다 — 슬라이드를 넘길 때마다 학생 1명당 읽기 1번.
//     Cloudflare 요청은 늘지 않는다(학생이 Firestore 에 바로 붙음).
//   - 선생님이 탭을 그냥 닫아도 학생이 묶여 있지 않게, 켜 둔 동안 2분마다 at 을 새로 쓰고
//     학생은 5분 넘게 소식이 없으면 저절로 풀린다. 학교 PC 시계가 틀린 경우가 있어 "5분"은
//     학생 PC가 소식을 받은 시각으로 잰다(at 은 처음 열 때 아주 오래된 것만 거르는 데 쓴다).
//
// 학생 화면이 다른 탭에 가려져 있으면 브라우저가 그 탭을 느리게 돌리거나 연결을 끊어 "풀림" 소식을
// 못 받는 일이 있었다. 그래서 탭이 다시 보이면 서버에서 지금 상태를 바로 다시 읽는다.
// 선생님 화면의 👥/🔒 는 이 창의 기억이 아니라 저장된 상태(sid = 켠 창)를 따른다 — 다른 창이나
// 이전 페이지에서 켜 둔 고정이 남아 있으면 🔒 로 보이고, 누르면 푼다.
//
// 선생님 판별: 관리 페이지에서 로그인하면 이 브라우저에 kakanotion-teacher 표시가 남는다(admin.js).
// 표시가 있고 실제로 관리자 계정으로 로그인돼 있을 때만 버튼이 보인다. 쓰기는 규칙이 다시 막는다.
import { db, auth } from './firebase-config.js';
import { doc, onSnapshot, setDoc, getDocFromServer, serverTimestamp } from 'https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js';
import { onAuthStateChanged } from 'https://www.gstatic.com/firebasejs/10.12.2/firebase-auth.js';
// 발표 필기(선생님 쓰기 → 따라가는 학생에게 보임). 이 파일의 ?v=버전을 그대로 붙여 불러온다 —
// 그냥 './ink.js' 로 부르면 버전이 안 붙어 태블릿 브라우저가 예전 필기 코드를 계속 쓰는 일이 있었다.
const { teacherInk, studentInk } = await import(`./ink.js${new URL(import.meta.url).search}`);

const ADMIN_EMAIL = 'qjatjr7575@gmail.com';
const HEARTBEAT_MS = 2 * 60 * 1000;
const STALE_MS = 5 * 60 * 1000;
const OLD_MS = 30 * 60 * 1000;   // 처음 열었을 때 at 이 이보다 오래면 꺼진 걸로(시계 오차 여유 포함)
const RESUME_MS = 60 * 1000;     // 선생님이 고정 중에 페이지를 옮기면 이 안에 열린 새 페이지에서 이어 간다

const ss = {
  get(k) { try { return sessionStorage.getItem(k); } catch { return null; } },
  set(k, v) { try { sessionStorage.setItem(k, v); } catch { /* 무시 */ } },
  del(k) { try { sessionStorage.removeItem(k); } catch { /* 무시 */ } },
};
const loaded = new Promise((r) => { if (document.readyState === 'complete') r(); else window.addEventListener('load', r); });

const slug = document.body.dataset.slug;
const P = window.KakaPresent;
if (slug && P) start();

// 이 학습지 본문(발표 슬라이드 말고 원래 본문)의 하위 페이지 링크들 — 문서 순서대로.
function subLinks() {
  const root = document.querySelector('main.doc > .notion');
  if (!root) return [];
  const base = `/${encodeURIComponent(slug)}/`;
  return [...root.querySelectorAll('a[href]')].filter((a) => {
    try { const u = new URL(a.href, location.href); return u.origin === location.origin && u.pathname.startsWith(base); } catch { return false; }
  });
}

function start() {
  const ref = doc(db, 'appSettings', `ohnotion_follow_${slug}`);
  let isTeacher = false;
  try { isTeacher = localStorage.getItem('kakanotion-teacher') === '1'; } catch { /* 학생 */ }
  if (isTeacher) {
    let started = false;
    onAuthStateChanged(auth, (user) => {
      if (started) return;
      started = true;
      if (user?.email === ADMIN_EMAIL) { teacher(ref); teacherInk(slug); }
      else student(ref);   // 표시만 남고 로그아웃된 브라우저는 학생처럼
    });
  } else {
    student(ref);
  }
}

// ── 선생님 ──
function teacher(ref) {
  let on = false;
  let beat = null;
  let pending = null;
  let btn = null;
  let moving = false;        // 하위 페이지로 옮겨 가는 중 — 떠날 때 고정을 풀지 않는다
  const resumeKey = `kakanotion-follow-on:${slug}`;
  const sid = Math.random().toString(36).slice(2, 10);   // 이 창(이 페이지)이 켠 고정인지 가리는 표
  let remote = null;         // 저장된 상태(마지막으로 받은 것)
  let remoteAt = 0;          // 켜진 상태를 마지막으로 받은 시각(이 PC 시계)
  let myAt = 0;              // 이 창이 쓴 것이 서버에 저장된 시각(서버 시계)
  // 다른 창·이전 페이지에서 켠 고정이 아직 살아 있나
  const otherOn = () => !on && !!remote?.on && remote.sid !== sid && Date.now() - remoteAt < STALE_MS;

  const write = (data) => setDoc(ref, { ...data, sid, at: serverTimestamp() }, { merge: true })
    .catch((e) => { console.error('따라가기 저장 실패', e); alert(`학생 고정을 바꾸지 못했어요: ${e.message}`); });
  const state = () => ({
    on: true,
    path: location.pathname,
    slide: P.index(),
    total: P.total(),
    blank: !(P.deck()?.querySelector('.deck-blank')?.hidden ?? true),
  });

  function render() {
    if (!btn) return;
    const other = otherOn();
    btn.textContent = on || other ? '🔒' : '👥';
    btn.title = on ? '학생 고정 풀기 (L)' : other ? '다른 기기·창에서 켠 학생 고정이 있어요 — 누르면 이 화면으로 가져와요 (L)' : '학생 화면 고정 — 내 화면을 따라오게 (L)';
    btn.classList.toggle('on', on || other);
    const deck = P.deck();
    deck?.classList.toggle('teacher-on', on);
    let badge = deck?.querySelector('.deck-teacher');
    if (deck && !badge) {
      badge = document.createElement('div');
      badge.className = 'deck-teacher';
      deck.appendChild(badge);
    }
    if (badge) { badge.hidden = !on && !other; badge.textContent = on ? '🔒 학생 화면 고정 중' : '🔒 다른 기기·창에서 켠 학생 고정 중 — 누르면 이 화면으로'; }
  }
  // 👥/🔒 버튼·L: 켜져 있으면 풀고, 아니면 이 화면에서 켠다. 다른 기기·창의 고정이 있어도 그냥 켜면
  // 이 창 것이 새 고정이 되고, 그쪽은 이 저장을 보고 신호를 멈춘다(takenOver). 풀려면 한 번 더 누른다.
  function toggle() {
    if (on) setOn(false);
    else setOn(true);
  }
  // 저장된 상태를 듣는다 — 다른 창이 켜거나 풀면 이 창은 신호 보내기를 멈춘다(마지막에 쓴 창이 이김).
  onSnapshot(ref, (snap) => {
    remote = snap.exists() ? snap.data() : null;
    const at = remote?.at?.toMillis?.();
    remoteAt = remote?.on && (at == null || Math.abs(Date.now() - at) < OLD_MS) ? Date.now() : 0;
    if (remote?.sid === sid && at) myAt = Math.max(myAt, at);
    // 내 마지막 저장보다 나중에 다른 창이 쓴 것일 때만 물러난다(이전 페이지의 늦게 온 저장은 무시).
    if (on && !moving && takenOver(remote)) stepDown();
    render();
  }, (e) => console.warn('따라가기 듣기 실패', e?.message || e));
  setInterval(render, 30 * 1000);   // 남은 고정이 5분 지나 끝나면 버튼도 👥 로
  // 내 마지막 저장보다 나중에 다른 창(다른 기기·브라우저)이 쓴 것이면 그쪽이 새 고정이다.
  function takenOver(d) {
    const at = d?.at?.toMillis?.();
    return !!d && d.sid !== sid && !!at && !!myAt && at > myAt;
  }
  // 물러나기 — 쓰지 않고 이 창의 고정만 끈다(새로 켠 창의 고정을 건드리지 않음).
  function stepDown() {
    on = false;
    clearInterval(beat);
    clearTimeout(pending);
    ss.del(resumeKey);
    render();
  }
  // 2분마다 보내는 신호: 보내기 전에 서버의 지금 상태를 먼저 본다. 잠자던 태블릿·노트북이 깨어나
  // 새 고정 소식을 받기도 전에 예전 신호를 써서 고정을 도로 가져가는 일이 없게. 서버에 못 닿으면 이번엔 건너뛴다.
  async function heartbeat() {
    let d;
    try { d = (await getDocFromServer(ref)).data(); } catch { return; }
    if (!on || moving) return;
    if (takenOver(d)) { stepDown(); return; }
    write(state());
  }
  function setOn(v) {
    on = v;
    clearInterval(beat);
    if (on) {
      write(state());
      beat = setInterval(heartbeat, HEARTBEAT_MS);
    } else {
      // 넘기자마자(0.25초 안) 풀면 늦게 쓰는 슬라이드 저장이 on:true 로 덮어써 학생이 안 풀렸다.
      clearTimeout(pending);
      ss.del(resumeKey);
      write({ on: false });
    }
    render();
  }

  function addButton() {
    const ui = P.deck()?.querySelector('.deck-ui');
    if (!ui) return;
    btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'deck-follow';
    btn.addEventListener('click', toggle);
    ui.insertBefore(btn, ui.querySelector('[data-a="close"]'));
    render();
  }
  document.addEventListener('present:open', addButton);
  if (P.isOpen()) addButton();   // #present 로 열려 로그인 확인보다 먼저 발표가 시작된 경우
  document.addEventListener('present:slide', () => {
    if (!on) return;
    // 빨리 여러 장 넘기면 마지막 것만 쓴다(문서 하나에 초당 1번 정도가 Firestore 권장).
    clearTimeout(pending);
    pending = setTimeout(() => { if (on) write(state()); }, 250);
  });
  document.addEventListener('present:blank', () => { if (on) write(state()); });
  document.addEventListener('present:close', () => { if (on) setOn(false); btn = null; });
  document.addEventListener('keydown', (e) => {
    if (!P.isOpen() || e.ctrlKey || e.metaKey || e.altKey) return;
    if (e.key === 'l' || e.key === 'L') { e.preventDefault(); toggle(); }
  }, true);
  // 고정 중에 슬라이드(또는 본문)의 하위 페이지 링크를 누르면: 고정을 풀지 않고 학생에게 새 페이지를
  // 먼저 알린 뒤 옮겨 가서, 그 페이지에서도 발표·고정을 그대로 이어 간다.
  document.addEventListener('click', (e) => {
    if (!on || e.defaultPrevented || e.button !== 0 || e.ctrlKey || e.metaKey || e.shiftKey || e.altKey) return;
    const a = e.target.closest?.('a[href]');
    if (!a || (a.target && a.target !== '_self')) return;
    let u;
    try { u = new URL(a.href, location.href); } catch { return; }
    const root = `/${encodeURIComponent(slug)}`;
    if (u.origin !== location.origin || !(u.pathname === root || u.pathname.startsWith(`${root}/`))) return;
    if (u.pathname === location.pathname) return;   // 같은 페이지 안 이동(#목차 등)
    e.preventDefault();
    const href = a.getAttribute('href');
    const link = subLinks().findIndex((x) => x.getAttribute('href') === href);
    moving = true;
    clearInterval(beat);
    clearTimeout(pending);
    ss.set(resumeKey, String(Date.now()));
    const go = () => location.assign(`${u.pathname}#present=1`);
    const timeout = new Promise((r) => setTimeout(r, 2000));   // 저장이 늦어도 2초 뒤엔 옮겨 간다
    Promise.race([write({ on: true, path: u.pathname, from: location.pathname, link, slide: 0, total: 0, blank: false }), timeout]).then(go, go);
  }, true);

  // 탭을 닫을 때도 풀어 본다(못 쓰고 닫혀도 학생은 5분 뒤 저절로 풀림).
  // 같은 탭에서 새로고침·뒤로 가기였다면 새 페이지가 1분 안에 다시 켠다.
  window.addEventListener('pagehide', () => {
    if (!on || moving) return;
    ss.set(resumeKey, String(Date.now()));
    write({ on: false });
  });

  // 방금 고정 중에 이 탭에서 페이지를 옮겨 왔으면 발표를 열고 고정을 다시 켠다.
  const resume = (force) => {
    const t = Number(ss.get(resumeKey) || 0);
    ss.del(resumeKey);
    if (!force && !(t && Date.now() - t < RESUME_MS)) return;
    loaded.then(() => {
      if (!P.isOpen()) P.open(0);
      on = false;
      setOn(true);
    });
  };
  resume(false);
  // 뒤로 가기로 예전 페이지가 그대로 되살아나면(bfcache) 위 코드가 다시 돌지 않는다 — 여기서 이어 간다.
  window.addEventListener('pageshow', (e) => {
    if (!e.persisted) return;
    const was = on;
    moving = false;
    resume(was);
  });
}

// ── 학생 ──
function student(ref) {
  let data = null;
  let following = false;
  let heardAt = 0;          // 켜진 소식을 마지막으로 받은 시각(이 PC 시계)

  const active = () => !!data?.on && Date.now() - heardAt < STALE_MS;
  const norm = (a) => { try { return decodeURIComponent(a).normalize('NFC'); } catch { return a; } };
  const samePath = (a, b) => norm(a) === norm(b);

  // 다른 언어로 보는 학생: 선생님(한국어) 페이지 주소 → 내 언어의 같은 페이지 주소.
  // 선생님이 링크를 눌러 옮길 때(from, link) 내가 from 에 해당하는 페이지에 있으면 내 본문의 같은 번째
  // 링크를 따라가고, 그 짝을 이 탭에 기억해 둔다(새로고침·되돌아오기에도 쓰도록).
  const lang = new URLSearchParams(location.search).get('lang') || '';
  const mapKey = `kakanotion-follow-map:${slug}:${lang}`;
  const map = (() => { try { return JSON.parse(ss.get(mapKey) || '{}') || {}; } catch { return {}; } })();
  map[norm(`/${encodeURIComponent(slug)}`)] = `/${encodeURIComponent(slug)}`;
  function target(path) {
    if (!lang || lang === 'ko') return path;
    const known = map[norm(path)];
    if (known) return known;
    if (data.from && Number.isInteger(data.link) && data.link >= 0 && samePath(map[norm(data.from)] || '', location.pathname)) {
      const a = subLinks()[data.link];
      if (a) {
        const mine = new URL(a.href, location.href).pathname;
        map[norm(path)] = mine;
        ss.set(mapKey, JSON.stringify(map));
        return mine;
      }
    }
    return path;   // 모르면 선생님 페이지(한국어)로
  }

  const ink = studentInk(slug, { following: () => following, teacherPath: () => data?.path || '' });
  function unlock() {
    following = false;
    P.setLocked(false);
    ink.update();   // 따라가기가 끝나면 필기도 안 보이게
  }
  function apply() {
    if (!active()) {
      if (following) unlock();
      return;
    }
    // 선생님이 다른(하위) 페이지에서 발표 중이면 그 페이지로 옮겨 간다.
    const to = data.path ? target(data.path) : '';
    if (to && !samePath(to, location.pathname)) {
      // ?lang=en(다국어 학습지에서 고른 언어)은 그대로 들고 간다.
      location.replace(`${to}${location.search}#present=${(data.slide || 0) + 1}`);
      return;
    }
    following = true;
    P.setLocked(true);
    if (!P.isOpen()) P.open(data.slide || 0);
    if (P.index() !== data.slide) P.go(data.slide || 0);
    P.setBlank(!!data.blank);
    ink.update();
  }

  // 수식·글꼴이 다 그려진 뒤에 슬라이드를 만들어야 해서(present.js 와 같은 이유) 로드 뒤에 적용한다.
  const take = (snap) => {
    data = snap.exists() ? snap.data() : null;
    const at = data?.at?.toMillis?.() ?? 0;
    heardAt = data?.on && Math.abs(Date.now() - at) < OLD_MS ? Date.now() : 0;
    loaded.then(apply);
  };
  onSnapshot(ref, take, (e) => console.warn('따라가기 듣기 실패', e?.message || e));
  // 다른 탭을 보다가 돌아오면(가려진 동안 소식을 놓쳤을 수 있음) 서버에서 바로 다시 읽는다.
  const recheck = () => {
    if (document.visibilityState !== 'visible') return;
    getDocFromServer(ref).then(take).catch((e) => console.warn('따라가기 다시 읽기 실패', e?.message || e));
  };
  document.addEventListener('visibilitychange', recheck);
  window.addEventListener('pageshow', (e) => { if (e.persisted) recheck(); });   // 뒤로 가기로 되살아난 페이지
  window.addEventListener('focus', recheck);
  window.addEventListener('online', recheck);
  // 선생님 소식이 끊기면(탭을 그냥 닫음) 5분 뒤 저절로 풀리게 가끔 다시 본다.
  setInterval(() => { if (following) apply(); }, 30 * 1000);
}
