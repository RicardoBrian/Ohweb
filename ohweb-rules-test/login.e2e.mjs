import { readFileSync } from 'node:fs';
import { initializeTestEnvironment } from '@firebase/rules-unit-testing';
import { doc, setDoc, getDoc } from 'firebase/firestore';
import { signOut, createUserWithEmailAndPassword } from 'firebase/auth';
const PHASE = process.env.PHASE === '2' ? 2 : 1;
import { writeFileSync } from 'node:fs';
// 실제 학생 로그인 코드(ohinfo/public/student-auth.js)를 그대로 가져와 CDN import만
// npm 패키지로 바꿔서 돌린다 — 테스트용 사본이 아니라 배포되는 코드를 검증한다.
const src = readFileSync(new URL('../ohinfo/public/student-auth.js', import.meta.url), 'utf8')
  .replaceAll('https://www.gstatic.com/firebasejs/10.12.2/firebase-auth.js', 'firebase/auth')
  .replaceAll('https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js', 'firebase/firestore')
  .replaceAll("'./firebase-config.js'", "'./login-e2e-fbconf.mjs'");
writeFileSync(new URL('./.student-auth.e2e.mjs', import.meta.url), src);
let rules = readFileSync(new URL('../ohweb-firestore.rules', import.meta.url), 'utf8');
if (PHASE === 2) rules = rules.replace(/allow read: if true; \/\/ PHASE2: (allow read: if [^;]+;)/, '$1');
const env = await initializeTestEnvironment({ projectId: 'ohweb-93062', firestore: { rules, host: '127.0.0.1', port: 8181 } });
await env.clearFirestore();
await fetch('http://127.0.0.1:9099/emulator/v1/projects/ohweb-93062/accounts', { method: 'DELETE' });
const dir = (o) => ({ schoolName: 'S', grade: '1', class: '2', registered: false, locked: false, failedAttempts: 0, ...o });
await env.withSecurityRulesDisabled(async c => {
  const db = c.firestore();
  await setDoc(doc(db, 'students/NewKid'), { name: '홍 길동', schoolName: 'S', grade: '1', class: '2', number: 1, registered: false });
  await setDoc(doc(db, 'student_directory/NewKid'), dir({ number: 1 }));
  await setDoc(doc(db, 'students/Legacy'), { name: '옛학생', schoolName: 'S', grade: '1', class: '2', number: 2, registered: true, password: '1234' });
  await setDoc(doc(db, 'student_directory/Legacy'), dir({ number: 2, registered: true }));
  await setDoc(doc(db, 'students/Normal'), { name: '보통', schoolName: 'S', grade: '1', class: '2', number: 3, registered: true });
  await setDoc(doc(db, 'student_directory/Normal'), dir({ number: 3, registered: true }));
  // 교사가 등록(또는 초기화)한 학생 — 서버가 계정을 1234로 만들고 mustChangePassword 표시
  await setDoc(doc(db, 'students/Fresh'), { name: '새학생', schoolName: 'S', grade: '1', class: '2', number: 4, registered: true, mustChangePassword: true });
  await setDoc(doc(db, 'student_directory/Fresh'), dir({ number: 4, registered: true }));
});
const { db, auth } = await import('./login-e2e-fbconf.mjs');
await createUserWithEmailAndPassword(auth, 'normal@ohinfo.local', 'pass99'); await signOut(auth);
await createUserWithEmailAndPassword(auth, 'fresh@ohinfo.local', '123400'); await signOut(auth); // 1234 → padPassword
const SA = await import('./.student-auth.e2e.mjs');
let fails = 0; const ok = (c, l) => { if (!c) fails++; console.log((c ? '✅ ' : '❌ ') + l); };
const list = await SA.loadLoginDirectory();
ok(list.length === 4 && list.every(x => !('name' in x) && !('password' in x)), `로그인 화면 명단 로드(이름·비번 없음) ${list.length}명`);
const entry = id => list.find(x => x.id === id);
// 회원가입 없음: 등록 안 된 학생은 로그인 거부
try { await SA.loginStudent('NewKid', entry('NewKid'), 'abcd'); ok(false, '미등록 학생 로그인 거부'); } catch (e) { ok(e.code === 'not-registered', '미등록 학생 → not-registered'); }
ok(typeof SA.registerStudent === 'undefined', '학생 회원가입 함수 없음');
// 첫 로그인: 1234 → 새 비밀번호
await SA.loginStudent('Fresh', entry('Fresh'), '1234');
ok(auth.currentUser?.email === 'fresh@ohinfo.local', '기본 비밀번호 1234로 첫 로그인');
ok((await SA.fetchOwnStudent('Fresh')).mustChangePassword === true, '첫 로그인 → 비밀번호 변경 필요 표시');
await SA.completeFirstPassword('Fresh', '1234', 'mine77');
await env.withSecurityRulesDisabled(async c => { const d = (await getDoc(doc(c.firestore(), 'students/Fresh'))).data(); ok(d.mustChangePassword === false, '새 비밀번호 저장 후 표시 해제(본인 쓰기 허용)'); });
await signOut(auth);
try { await SA.loginStudent('Fresh', entry('Fresh'), '1234'); ok(false, '옛 기본 비밀번호 거부'); } catch (e) { ok(e.code === 'wrong-password', '바꾼 뒤 1234 → wrong-password'); }
await SA.loginStudent('Fresh', { ...entry('Fresh'), failedAttempts: 1 }, 'mine77');
ok(auth.currentUser?.email === 'fresh@ohinfo.local', '새 비밀번호로 로그인');
await signOut(auth);
// 일반 로그인: 비번 틀림 → 카운트
try { await SA.loginStudent('Normal', entry('Normal'), 'wrong'); ok(false, '비번 틀림 거부'); } catch (e) { ok(e.code === 'wrong-password', '비번 틀림 → wrong-password'); }
await env.withSecurityRulesDisabled(async c => { const d = (await getDoc(doc(c.firestore(), 'student_directory/Normal'))).data(); ok(d.failedAttempts === 1, '실패 카운트가 공개 명단에 기록됨'); });
await SA.loginStudent('Normal', { ...entry('Normal'), failedAttempts: 1 }, 'pass99');
ok(auth.currentUser?.email === 'normal@ohinfo.local', '일반 로그인 성공');
const sess = await SA.fetchOwnStudent('Normal'); ok(sess.name === '보통', '로그인 후 본인 문서로 세션 생성');
await env.withSecurityRulesDisabled(async c => { const d = (await getDoc(doc(c.firestore(), 'student_directory/Normal'))).data(); ok(d.failedAttempts === 0, '로그인 성공 후 카운트 0'); });
await signOut(auth);
// 옛 평문 계정 로그인 (1단계에서만 가능 — 2단계 전에 admin 정리 필수)
try {
  await SA.loginStudent('Legacy', entry('Legacy'), '1234');
  ok(PHASE === 1, `[${PHASE}단계] 옛 평문 계정 로그인 → 성공(자동 전환)`);
  await env.withSecurityRulesDisabled(async c => { const d = (await getDoc(doc(c.firestore(), 'students/Legacy'))).data(); ok(!('password' in d), '자동 전환 후 평문 삭제됨'); });
} catch (e) { ok(PHASE === 2, `[${PHASE}단계] 옛 평문 계정 로그인 → ${e.code} (2단계는 admin 정리 후 적용해야 함)`); }
await signOut(auth);
// 잠긴 계정
try { await SA.loginStudent('Normal', { ...entry('Normal'), locked: true }, 'pass99'); ok(false, '잠긴 계정 거부'); } catch (e) { ok(e.code === 'locked', '잠긴 계정 → locked'); }
console.log(fails ? `실패 ${fails}건` : '전부 통과');
await env.cleanup(); process.exit(fails ? 1 : 0);
