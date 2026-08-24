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
import { doc, updateDoc, deleteField } from 'https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js';

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

export class AuthError extends Error {
  constructor(code) { super(code); this.code = code; }
}

export async function loginStudent(studentDocId, data, pw) {
  if (!data.registered) throw new AuthError('not-registered');

  try {
    await signInWithEmailAndPassword(auth, emailFor(studentDocId), padPassword(pw));
    return;
  } catch (e) {
    // 계정이 아직 없거나(미전환) 비밀번호가 틀렸을 수 있음 — 아래에서 판별
  }

  // 이미 전환된 계정인데 위에서 실패했다면 password 필드가 없으니 여기서 걸러진다.
  if (data.password === undefined || data.password !== pw) throw new AuthError('wrong-password');

  await createUserWithEmailAndPassword(auth, emailFor(studentDocId), padPassword(pw));
  await updateDoc(doc(db, 'students', studentDocId), { password: deleteField() });
}

// 신규 가입 — Firestore엔 password를 아예 쓰지 않는다.
export async function registerStudent(studentDocId, extraFields, pw) {
  await createUserWithEmailAndPassword(auth, emailFor(studentDocId), padPassword(pw));
  const updates = { ...extraFields, registered: true };
  await updateDoc(doc(db, 'students', studentDocId), updates);
  return updates;
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
