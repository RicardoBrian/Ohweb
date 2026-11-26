// 학생 로그인 세션 — localStorage 기반, 로그인하고 1시간 뒤 끝난다 (쓰는 중이어도 연장 안 함).
// 예전엔 5일 유지 + 쓸 때마다 연장이라, 컴퓨터실에서 앞 시간 반 학생이 쓴 기기를
// 다음 반 학생이 열면 앞 반 학생으로 로그인된 채라 그 반 게시판이 열렸다.
// 한 차시는 버티고 다음 반 수업 때는 꼭 새로 로그인하도록 로그인 시각부터 1시간.
const KEY = 'ohinfo_student';
const TTL_MS = 60 * 60 * 1000; // 1시간

function readRaw() {
  try { return JSON.parse(localStorage.getItem(KEY) || 'null'); } catch { return null; }
}

export function saveSession(data) {
  // 정보만 새로 덮어쓸 때(본인 확인·마이페이지 등)는 처음 로그인한 시각을 그대로 둔다.
  const prev = readRaw();
  const loginAt = prev && prev.id === data.id && prev._loginAt ? prev._loginAt : Date.now();
  const withExp = { ...data, _loginAt: loginAt, _exp: loginAt + TTL_MS };
  localStorage.setItem(KEY, JSON.stringify(withExp));
}

export function loadSession() {
  const raw = localStorage.getItem(KEY);
  if (!raw) return null;
  let parsed;
  try { parsed = JSON.parse(raw); } catch { localStorage.removeItem(KEY); return null; }
  // _loginAt 없는 옛 세션(5일짜리)은 바로 끝낸다 — 지금 남아 있는 남의 로그인도 정리된다.
  if (!parsed._loginAt || Date.now() > parsed._loginAt + TTL_MS) { localStorage.removeItem(KEY); return null; }
  return parsed;
}

export function clearSession() {
  localStorage.removeItem(KEY);
}

// 이 세션 블롭은 브라우저에서 그대로 고칠 수 있다 — 개발자 도구에서 id를
// 다른 학생 것으로 바꾸거나 isMaster를 true로 세워도 화면은 그대로 통과한다.
// 로그인 자체는 Firebase Auth로 제대로 검증하는데 그 결과를 안 쓰고 있었다.
//
// 그래서 페이지가 뜬 직후 이걸 호출해서 "지금 로그인된 Firebase 계정"과
// 세션의 id가 같은지 확인하고, 학생 정보도 Firestore에서 다시 읽어 캐시를
// 덮어쓴다. 안 맞으면 세션을 지우고 로그인 화면으로 보낸다.
//
// 페이지 초기화는 건드리지 않는다(동기 loadSession() 그대로) — 렌더는 즉시
// 하고 검증은 뒤따라 붙는 형태다. 화면 가드는 어차피 편의 장치이고, 실제
// 강제는 Firestore 보안 규칙에서 한다.
export async function verifyStudentAuth(session, { redirectTo = 'index.html' } = {}) {
  const fail = () => { clearSession(); location.replace(redirectTo); return null; };
  if (!session || !session.id) return fail();

  try {
    const [{ auth, db }, { onAuthStateChanged }, { doc, getDoc }] = await Promise.all([
      import('./firebase-config.js'),
      import('https://www.gstatic.com/firebasejs/10.12.2/firebase-auth.js'),
      import('https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js'),
    ]);

    // 로그인 상태 복원은 비동기다 — 처음 한 번 값이 올 때까지 기다린다.
    const user = await new Promise(resolve => {
      const stop = onAuthStateChanged(auth, u => { stop(); resolve(u); });
    });
    if (!user) return fail();

    // Firebase Auth는 이메일을 소문자로 정규화하고 Firestore 문서 ID는
    // 대소문자를 구분하므로, 비교는 양쪽을 소문자로 맞춰서 한다.
    const expected = `${session.id}@ohinfo.local`.toLowerCase();
    if ((user.email || '').toLowerCase() !== expected) return fail();

    // 권한과 표시용 정보는 localStorage가 아니라 Firestore를 믿는다.
    const snap = await getDoc(doc(db, 'students', session.id));
    if (!snap.exists()) return fail();
    const fresh = { id: session.id, ...snap.data() };
    delete fresh.password;
    saveSession(fresh);
    return fresh;
  } catch (e) {
    // 네트워크 문제로 확인을 못 한 것뿐이면 쓰던 사람을 쫓아내지 않는다 —
    // 위조된 세션이라도 Firestore 규칙에서 막히므로 여기서 실패해도 안전하다.
    console.error('세션 확인 실패(계속 진행):', e);
    return session;
  }
}

// Firebase Auth의 로그인 상태 복원(새로고침 후 저장된 로그인 불러오기)은
// 비동기다. 1:1 질문·시험 진행 기록처럼 "본인만" 읽을 수 있게 잠근 데이터는
// 복원이 끝나기 전에 요청하면 비로그인으로 취급돼 거부될 수 있으므로, 그런
// 요청 전에 이걸 기다린다. 한 번 풀리면 이후 호출은 바로 넘어간다.
let _authReadyPromise = null;
export function authReady() {
  if (!_authReadyPromise) {
    _authReadyPromise = Promise.all([
      import('./firebase-config.js'),
      import('https://www.gstatic.com/firebasejs/10.12.2/firebase-auth.js'),
    ]).then(([{ auth }, { onAuthStateChanged }]) => new Promise(resolve => {
      const stop = onAuthStateChanged(auth, u => { stop(); resolve(u); });
    })).catch(() => null);
  }
  return _authReadyPromise;
}
