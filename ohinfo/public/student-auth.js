// 학생 로그인/가입 — 진짜 Firebase Auth 기반.
//
// 화면(학교/학년/반/번호 + 비밀번호)은 그대로 두고, 뒤에서 학번을 합성
// 이메일로 바꿔 Firebase Auth의 이메일/비밀번호 로그인에 태운다. 비밀번호
// 비교는 더 이상 클라이언트가 하지 않는다 — Firebase가 서버에서 검증한다.
//
// 기존에 이미 가입한 학생들(아직 Auth 계정이 없는)은 로그인을 시도하는
// 순간 자동으로 전환된다: Auth 로그인이 실패하면 Firestore의 예전 평문
// password로 한 번만 검증하고, 맞으면 그 자리에서 Auth 계정을 만들고
// 평문 password 필드를 지운다. 대량 마이그레이션 스크립트로 미리 돌려둔
// 계정은 이 경로를 안 타고 바로 Auth 로그인에서 성공한다.
import { auth, db } from './firebase-config.js';
import {
  signInWithEmailAndPassword, createUserWithEmailAndPassword,
  updatePassword, EmailAuthProvider, reauthenticateWithCredential,
} from 'https://www.gstatic.com/firebasejs/10.12.2/firebase-auth.js';
import { doc, getDoc, getDocs, collection, updateDoc, deleteField, increment, serverTimestamp } from 'https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js';

// ── 공개용 학생 명단 ──
// 로그인 화면은 로그인 "전"에 학교/학년/반/번호 목록과 가입·잠금 상태가
// 필요하다. 예전엔 이걸 위해 students 컬렉션 전체(이름·사진·옛 평문 비밀번호
// 포함)를 누구나 읽을 수 있게 열어뒀다. 이제 그 최소 정보만 담은
// student_directory(문서 ID = 학생 문서 ID)를 따로 두고, students는 본인·
// 관리자만 읽는다. 명단은 admin.html의 학생 화면이 자동으로 맞춰 쓴다.
//
// 전환기 대비: student_directory가 아직 비어 있으면(관리자가 학생 화면을 한 번도
// 안 열었으면) 예전처럼 students를 읽는다 — 규칙이 아직 열려 있는 동안은 이걸로
// 로그인이 끊기지 않는다. 이름·사진·비밀번호는 어느 쪽이든 여기서 버린다.
const DIR_FIELDS = ['schoolName', 'grade', 'class', 'number', 'registered', 'locked', 'failedAttempts'];
function pickDir(id, d) {
  const o = { id };
  DIR_FIELDS.forEach(k => { if (d[k] !== undefined) o[k] = d[k]; });
  return o;
}
export async function loadLoginDirectory() {
  try {
    const snap = await getDocs(collection(db, 'student_directory'));
    if (!snap.empty) return snap.docs.map(d => pickDir(d.id, d.data()));
  } catch (e) { console.error('student_directory 읽기 실패 — students로 대체:', e); }
  const snap = await getDocs(collection(db, 'students'));
  return snap.docs.map(d => pickDir(d.id, d.data()));
}

// 로그인·가입에 성공한 직후(= 본인 인증 상태) 본인 문서를 읽어 세션을 만든다.
// 공개 명단엔 이름 등이 없으므로 세션은 반드시 이걸로 채운다.
export async function fetchOwnStudent(studentDocId) {
  const snap = await getDoc(doc(db, 'students', studentDocId));
  const data = snap.exists() ? snap.data() : {};
  delete data.password;
  return { id: studentDocId, ...data };
}

// 비밀번호를 5회 이상 틀리면 계정을 잠근다(locked:true) — 무차별 대입 시도
// 방어용. 잠긴 계정은 admin.html(학생 관리)에서만 풀 수 있다 — 학생 쪽
// 클라이언트가 스스로 못 푸는 건 Firestore 규칙(ohweb-firestore.rules,
// students/{id})이 강제한다: 로그인 안 된 상태의 쓰기는 failedAttempts를
// 늘리거나 locked를 true로 세팅하는 것만 허용하고, 낮추거나 false로
// 되돌리는 건 인증된 본인(로그인 성공 후)이나 관리자만 가능하다.
const MAX_FAILED_LOGIN_ATTEMPTS = 5;

async function recordFailedLogin(studentDocId, currentFailedAttempts) {
  const next = (currentFailedAttempts || 0) + 1;
  const updates = { failedAttempts: increment(1) };
  if (next >= MAX_FAILED_LOGIN_ATTEMPTS) {
    updates.locked = true;
    updates.lockedAt = serverTimestamp();
  }
  try {
    await updateDoc(doc(db, 'student_directory', studentDocId), updates);
  } catch (e) {
    // 카운트 기록이 실패해도(오프라인 등) 로그인 자체는 이미 아래에서
    // wrong-password로 막힌다 — 카운트만 못 늘어날 뿐.
  }
}

const EMAIL_SUFFIX = '@ohinfo.local';
const emailFor = id => `${id}${EMAIL_SUFFIX}`;

// Firebase Auth의 이메일/비밀번호 방식은 6자 미만을 받지 않는데, 기존 앱은
// "4자리 이상"을 허용해왔다(회원가입 화면 문구 그대로). 짧은 비밀번호를
// 쓰던 학생에게 재설정을 강요하지 않으려고, 6자 미만이면 고정 문자로
// 오른쪽을 채워서 Firebase에 넘긴다 — 학생은 원래 비밀번호를 그대로 입력하면
// 되고, 이 패딩 로직은 로그인/가입/마이그레이션 스크립트 전부 동일해야
// 한다(하나라도 다르면 그 계정만 로그인이 안 됨).
const MIN_LEN = 6;
const PAD_CHAR = '0';
function padPassword(pw) {
  return pw.length >= MIN_LEN ? pw : pw.padEnd(MIN_LEN, PAD_CHAR);
}

// 이메일 열거 보호가 켜진 프로젝트는 틀린 비밀번호·없는 계정을 구분하지 않고
// invalid-credential(예전 버전은 invalid-login-credentials)로 돌려준다.
const CREDENTIAL_ERRORS = new Set([
  'auth/invalid-credential', 'auth/invalid-login-credentials',
  'auth/wrong-password', 'auth/user-not-found',
]);

export class AuthError extends Error {
  constructor(code) { super(code); this.code = code; }
}

export async function loginStudent(studentDocId, data, pw) {
  if (!data.registered) throw new AuthError('not-registered');
  if (data.locked) throw new AuthError('locked');

  try {
    await signInWithEmailAndPassword(auth, emailFor(studentDocId), padPassword(pw));
  } catch (e) {
    // "비밀번호가 틀렸거나 계정이 없음"일 때만 아래(옛 계정 전환·실패 횟수)로 간다.
    // 예전엔 어떤 오류든 이 경로로 보냈는데, 한 교실이 같은 학교 IP로 동시에
    // 로그인하면 Firebase가 auth/too-many-requests로 잠시 막고, 와이파이가
    // 끊기면 auth/network-request-failed가 난다 — 그게 전부 "비밀번호 틀림"으로
    // 표시되고 실패 횟수까지 올라가서, 비밀번호를 맞게 넣은 학생이 몇 번 재시도
    // 하다 계정이 잠겼다.
    if (!CREDENTIAL_ERRORS.has(e?.code)) {
      console.error('login:', e?.code, e);
      if (e?.code === 'auth/too-many-requests') throw new AuthError('busy');
      throw new AuthError('network');
    }
    return await loginFallback(studentDocId, data, pw);
  }

  // 여기 왔으면 비밀번호는 맞은 것이다. 실패 카운터 리셋은 부가 작업일 뿐이라
  // 실패해도 로그인을 막으면 안 된다 — 예전엔 이 updateDoc이 같은 try 안에
  // 있어서, 규칙에 막혀 throw되면 아래 "비밀번호 틀림" 경로로 떨어졌다.
  // 그래서 한 번이라도 비밀번호를 틀린 학생은(failedAttempts > 0) 그 뒤로
  // 올바른 비밀번호를 넣어도 영영 로그인이 안 됐다.
  if (data.failedAttempts) {
    try {
      await updateDoc(doc(db, 'student_directory', studentDocId), { failedAttempts: 0 });
    } catch (e) {
      console.error('failedAttempts 리셋 실패(로그인은 정상):', e);
    }
  }
}

// Auth 로그인이 실패했을 때의 경로 — 아직 Auth로 전환되지 않은 옛 계정이면
// Firestore의 평문 password로 한 번만 검증하고 그 자리에서 전환한다.
async function loginFallback(studentDocId, data, pw) {
  // 옛 평문 비밀번호는 공개 명단에 없다 — students 문서에서 직접 본다(규칙이 아직
  // 열려 있는 전환기에만 읽힌다. 잠근 뒤엔 읽기가 거부되는데, 그 전에 admin의
  // "평문 비밀번호 정리"로 전부 계정 전환해 둔다).
  let legacyPw = data.password;
  if (legacyPw === undefined) {
    try {
      const snap = await getDoc(doc(db, 'students', studentDocId));
      legacyPw = snap.exists() ? snap.data().password : undefined;
    } catch (e) { legacyPw = undefined; }
  }
  // 이미 전환된 계정인데 위에서 실패했다면 password 필드가 없으니 여기서 걸러진다.
  if (typeof legacyPw !== 'string' || legacyPw !== pw) {
    await recordFailedLogin(studentDocId, data.failedAttempts);
    throw new AuthError('wrong-password');
  }

  try {
    await createUserWithEmailAndPassword(auth, emailFor(studentDocId), padPassword(pw));
  } catch (e) {
    // Auth 계정이 이미 있는데(예: 관리자가 어드민에서 비밀번호를 재설정함)
    // Firestore의 레거시 password 필드가 미처 안 지워진 경우 여기로 온다.
    // 위 signIn이 실패했다는 건 지금 Auth 비밀번호가 이 pw가 아니라는
    // 뜻이므로 그냥 wrong-password로 처리한다. (password 필드 자체를 여기서
    // 지우고 싶어도 아직 미인증 상태라 Firestore 규칙상 못 지운다 —
    // students/{id}의 미인증 쓰기는 failedAttempts/locked/lockedAt만 허용됨.
    // 어차피 이 낡은 필드는 이후 로그인엔 영향 없으므로 그냥 둔다.)
    if (e.code === 'auth/email-already-in-use') {
      await recordFailedLogin(studentDocId, data.failedAttempts);
      throw new AuthError('wrong-password');
    }
    throw e;
  }
  await updateDoc(doc(db, 'students', studentDocId), { password: deleteField() });
  updateDoc(doc(db, 'student_directory', studentDocId), { failedAttempts: 0 }).catch(() => {});
}

// 마이페이지의 "비밀번호 변경" — Firestore엔 password를 쓰지 않고
// Firebase Auth 계정 자체의 비밀번호를 바꾼다. 현재 비밀번호는 Firestore
// 필드와 비교하는 대신 재인증(reauthenticate)으로 검증한다.
export async function changeStudentPassword(studentDocId, currentPw, newPw) {
  const user = auth.currentUser;
  if (!user) throw new AuthError('not-signed-in');
  try {
    await reauthenticateWithCredential(user, EmailAuthProvider.credential(emailFor(studentDocId), padPassword(currentPw)));
  } catch (e) {
    throw new AuthError('wrong-password');
  }
  await updatePassword(user, padPassword(newPw));
}

// 첫 로그인 — 학생 회원가입은 없고, 교사가 등록하거나 초기화하면 기본 비밀번호(1234)로
// 계정이 만들어진다(students 문서에 mustChangePassword: true). 그 상태로 로그인하면
// 로그인 화면이 새 비밀번호를 받아 여기로 보낸다. 표시 지우기는 부가 작업이라 실패해도
// 비밀번호 변경은 그대로 두고(다음 로그인 때 다시 묻는다) 로그만 남긴다.
export async function completeFirstPassword(studentDocId, currentPw, newPw) {
  await changeStudentPassword(studentDocId, currentPw, newPw);
  try {
    await updateDoc(doc(db, 'students', studentDocId), { mustChangePassword: false });
  } catch (e) {
    console.error('mustChangePassword 해제 실패(비밀번호는 바뀜):', e);
  }
}
