// 발표 따라가기 — 선생님이 발표 모드에서 "학생 고정"을 켜면, 그 학습지를 연 학생 화면이
// 자동으로 발표 모드로 바뀌고 선생님이 넘기는 슬라이드만 보여 준다(학생은 못 넘기고 못 끈다).
// 선생님이 고정을 풀거나 발표를 끝내면 학생은 다시 마음대로 볼 수 있다.
//
// 상태: appSettings/ohnotion_follow_{주소} = { on, path, slide, total, blank, at }
//       (appSettings 규칙 그대로 — 공개 읽기·관리자 쓰기. 규칙 변경 없음.)
//   - 주소(slug) 하나에 하나. 선생님이 하위 페이지에서 발표하면 path 로 학생도 그 페이지로 옮긴다.
//   - 학생 화면은 onSnapshot 으로 듣는다 — 슬라이드를 넘길 때마다 학생 1명당 읽기 1번.
//     Cloudflare 요청은 늘지 않는다(학생이 Firestore 에 바로 붙음).
//   - 선생님이 탭을 그냥 닫아도 학생이 묶여 있지 않게, 켜 둔 동안 2분마다 at 을 새로 쓰고
//     학생은 5분 넘게 소식이 없으면 저절로 풀린다. 학교 PC 시계가 틀린 경우가 있어 "5분"은
//     학생 PC가 소식을 받은 시각으로 잰다(at 은 처음 열 때 아주 오래된 것만 거르는 데 쓴다).
//
// 선생님 판별: 관리 페이지에서 로그인하면 이 브라우저에 kakanotion-teacher 표시가 남는다(admin.js).
// 표시가 있고 실제로 관리자 계정으로 로그인돼 있을 때만 버튼이 보인다. 쓰기는 규칙이 다시 막는다.
import { db, auth } from './firebase-config.js';
import { doc, onSnapshot, setDoc, serverTimestamp } from 'https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js';
import { onAuthStateChanged } from 'https://www.gstatic.com/firebasejs/10.12.2/firebase-auth.js';

const ADMIN_EMAIL = 'qjatjr7575@gmail.com';
const HEARTBEAT_MS = 2 * 60 * 1000;
const STALE_MS = 5 * 60 * 1000;
const OLD_MS = 30 * 60 * 1000;   // 처음 열었을 때 at 이 이보다 오래면 꺼진 걸로(시계 오차 여유 포함)

const slug = document.body.dataset.slug;
const P = window.KakaPresent;
if (slug && P) start();

function start() {
  const ref = doc(db, 'appSettings', `ohnotion_follow_${slug}`);
  let isTeacher = false;
  try { isTeacher = localStorage.getItem('kakanotion-teacher') === '1'; } catch { /* 학생 */ }
  if (isTeacher) {
    let started = false;
    onAuthStateChanged(auth, (user) => {
      if (started) return;
      started = true;
      if (user?.email === ADMIN_EMAIL) teacher(ref);
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

  const write = (data) => setDoc(ref, { ...data, at: serverTimestamp() }, { merge: true })
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
    btn.textContent = on ? '🔒' : '👥';
    btn.title = on ? '학생 고정 풀기 (L)' : '학생 화면 고정 — 내 화면을 따라오게 (L)';
    btn.classList.toggle('on', on);
    const deck = P.deck();
    deck?.classList.toggle('teacher-on', on);
    let badge = deck?.querySelector('.deck-teacher');
    if (deck && !badge) {
      badge = document.createElement('div');
      badge.className = 'deck-teacher';
      deck.appendChild(badge);
    }
    if (badge) { badge.hidden = !on; badge.textContent = '🔒 학생 화면 고정 중'; }
  }
  function setOn(v) {
    on = v;
    clearInterval(beat);
    if (on) {
      write(state());
      beat = setInterval(() => write(state()), HEARTBEAT_MS);
    } else {
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
    btn.addEventListener('click', () => setOn(!on));
    ui.insertBefore(btn, ui.querySelector('[data-a="close"]'));
    render();
  }
  document.addEventListener('present:open', addButton);
  if (P.isOpen()) addButton();   // #present 로 열려 로그인 확인보다 먼저 발표가 시작된 경우
  document.addEventListener('present:slide', () => {
    if (!on) return;
    // 빨리 여러 장 넘기면 마지막 것만 쓴다(문서 하나에 초당 1번 정도가 Firestore 권장).
    clearTimeout(pending);
    pending = setTimeout(() => write(state()), 250);
  });
  document.addEventListener('present:blank', () => { if (on) write(state()); });
  document.addEventListener('present:close', () => { if (on) setOn(false); btn = null; });
  document.addEventListener('keydown', (e) => {
    if (!P.isOpen() || e.ctrlKey || e.metaKey || e.altKey) return;
    if (e.key === 'l' || e.key === 'L') { e.preventDefault(); setOn(!on); }
  }, true);
  // 탭을 닫을 때도 풀어 본다(못 쓰고 닫혀도 학생은 5분 뒤 저절로 풀림).
  window.addEventListener('pagehide', () => { if (on) write({ on: false }); });
}

// ── 학생 ──
function student(ref) {
  let data = null;
  let following = false;
  let heardAt = 0;          // 켜진 소식을 마지막으로 받은 시각(이 PC 시계)

  const active = () => !!data?.on && Date.now() - heardAt < STALE_MS;
  const samePath = (a, b) => { try { return decodeURIComponent(a).normalize('NFC') === decodeURIComponent(b).normalize('NFC'); } catch { return a === b; } };

  function apply() {
    if (!active()) {
      if (following) { following = false; P.setLocked(false); }
      return;
    }
    // 선생님이 다른(하위) 페이지에서 발표 중이면 그 페이지로 옮겨 간다.
    if (data.path && !samePath(data.path, location.pathname)) {
      // ?lang=en(다국어 학습지에서 고른 언어)은 그대로 들고 간다.
      location.replace(`${data.path}${location.search}#present=${(data.slide || 0) + 1}`);
      return;
    }
    following = true;
    P.setLocked(true);
    if (!P.isOpen()) P.open(data.slide || 0);
    if (P.index() !== data.slide) P.go(data.slide || 0);
    P.setBlank(!!data.blank);
  }

  // 수식·글꼴이 다 그려진 뒤에 슬라이드를 만들어야 해서(present.js 와 같은 이유) 로드 뒤에 적용한다.
  const loaded = new Promise((r) => { if (document.readyState === 'complete') r(); else window.addEventListener('load', r); });
  onSnapshot(ref, (snap) => {
    data = snap.exists() ? snap.data() : null;
    const at = data?.at?.toMillis?.() ?? 0;
    heardAt = data?.on && Math.abs(Date.now() - at) < OLD_MS ? Date.now() : 0;
    loaded.then(apply);
  }, (e) => console.warn('따라가기 듣기 실패', e?.message || e));
  // 선생님 소식이 끊기면(탭을 그냥 닫음) 5분 뒤 저절로 풀리게 가끔 다시 본다.
  setInterval(() => { if (following) apply(); }, 30 * 1000);
}
