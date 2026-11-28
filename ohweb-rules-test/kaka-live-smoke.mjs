// 배포 뒤 점검(kaká): **실제 배포된 파일**(admin.kakainfo.com, kakainfo.com)을 브라우저로 연다.
// 로그인·DB 만 에뮬레이터로 바꾸고(firebase-config.js 바꿔치기, /api/lesson 은 이 레포 서버 코드를 에뮬레이터에 붙임) 나머지는 진짜다.
// 로컬 e2e 가 못 잡는 것(배포 누락, 캐시 헤더, 다른 도메인 모듈·CORS, 리다이렉트)을 잡으려는 것.
// 실행: npm run smoke:kaka  (배포가 끝난 뒤)
import { chromium } from 'playwright-core';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { initializeTestEnvironment } from '@firebase/rules-unit-testing';
import { doc, setDoc } from 'firebase/firestore';
import { onRequest as lessonApi } from '../ohinfo/functions/api/lesson.js';

const FB = new URL('./.fbcdn', import.meta.url).pathname;
const ADMIN_EMAIL = 'qjatjr7575@gmail.com';
const rules = readFileSync(new URL('../ohweb-firestore.rules', import.meta.url), 'utf8');
const env = await initializeTestEnvironment({ projectId: 'ohweb-93062', firestore: { rules, host: '127.0.0.1', port: 8181 } });
await env.clearFirestore();
await fetch('http://127.0.0.1:9099/emulator/v1/projects/ohweb-93062/accounts', { method: 'DELETE' });
await env.withSecurityRulesDisabled(async c => {
  const db = c.firestore();
  await setDoc(doc(db, 'students/StuA'), { name: '김학생', schoolName: 'S중', grade: '1', class: '2', number: 3, registered: true });
  await setDoc(doc(db, 'courses/C1'), { name: '정보', year: 2027, semester: 1, schoolName: 'S중', grade: '1', classes: ['2'], units: [{ id: 'u1', name: '파이썬' }], status: 'active' });
  await setDoc(doc(db, 'course_lessons/L1'), { courseId: 'C1', unitId: 'u1', order: 1, name: '첫 코드', docId: 'D1', openTo: ['2'], standards: [], updatedAt: '2027-03-02' });
  await setDoc(doc(db, 'docs/D1'), { kind: 'lesson', courseId: 'C1', lessonId: 'L1', tr: {}, blocks: [
    { id: 'p1', type: 'paragraph', data: { text: '오늘은 print 를 씁니다.' } },
    { id: 'py1', type: 'tool', data: { tool: 'python', title: '인사하기', desc: '', starter: "print('안녕')" } },
  ] });
});
const signUp = async (email, password) => (await (await fetch('http://127.0.0.1:9099/identitytoolkit.googleapis.com/v1/accounts:signUp?key=fake', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ email, password, returnSecureToken: true }) })).json()).localId;
await signUp('stua@ohinfo.local', 'pass99');
const adminUid = await signUp(ADMIN_EMAIL, 'adminpw1');
await fetch('http://127.0.0.1:9099/identitytoolkit.googleapis.com/v1/projects/ohweb-93062/accounts:update', { method: 'POST', headers: { 'content-type': 'application/json', authorization: 'Bearer owner' }, body: JSON.stringify({ localId: adminUid, emailVerified: true }) });

const conf = sign => `import { initializeApp } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-app.js";
import { getFirestore, connectFirestoreEmulator } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";
import { getAuth, connectAuthEmulator, signInWithEmailAndPassword } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-auth.js";
const app = initializeApp({ apiKey: 'fake', projectId: 'ohweb-93062', authDomain: 'localhost' });
export const db = getFirestore(app); connectFirestoreEmulator(db, '127.0.0.1', 8181);
export const auth = getAuth(app); connectAuthEmulator(auth, 'http://127.0.0.1:9099', { disableWarnings: true });
if (!auth.currentUser) await signInWithEmailAndPassword(auth, ${sign});`;
const apiEnv = { FIRESTORE_EMULATOR_HOST: '127.0.0.1:8181', FIREBASE_AUTH_EMULATOR_HOST: '127.0.0.1:9099', FIREBASE_PROJECT_ID: 'ohweb-93062' };

// 진짜 사이트(https)에서 에뮬레이터(127.0.0.1)로 가는 요청을 막지 않게
const browser = await chromium.launch({ args: ['--disable-features=LocalNetworkAccessChecks,PrivateNetworkAccessSendPreflights,PrivateNetworkAccessRespectPreflightResults,BlockInsecurePrivateNetworkRequests'] });
const ctx = await browser.newContext({ viewport: { width: 1280, height: 860 } });
await ctx.route('**/*', async r => {
  const u = r.request().url();
  if (u === 'https://admin.kakainfo.com/firebase-config.js') return r.fulfill({ status: 200, contentType: 'text/javascript', body: conf(`'${ADMIN_EMAIL}', 'adminpw1'`) });
  if (u === 'https://kakainfo.com/firebase-config.js') return r.fulfill({ status: 200, contentType: 'text/javascript', body: conf("'stua@ohinfo.local', 'pass99'") });
  const g = u.match(/^https:\/\/www\.gstatic\.com\/firebasejs\/10\.12\.2\/([A-Za-z0-9_-]+\.js)$/);
  if (g) return r.fulfill({ status: 200, contentType: 'text/javascript', body: readFileSync(path.join(FB, g[1])) });
  if (u === 'https://kakainfo.com/api/lesson') {
    const res = await lessonApi({ request: new Request(u, { method: 'POST', headers: { 'content-type': 'application/json' }, body: r.request().postData() }), env: apiEnv });
    return r.fulfill({ status: res.status, contentType: 'application/json', body: await res.text() });
  }
  if (u.includes('/api/')) return r.abort(); // 번역·코드 실행은 점검에서 부르지 않는다
  return r.continue();
});
await ctx.addInitScript(() => {
  if (location.host === 'kakainfo.com' && !localStorage.getItem('ohinfo_student')) localStorage.setItem('ohinfo_student', JSON.stringify({ id: 'StuA', name: '김학생', schoolName: 'S중', grade: '1', class: '2', number: 3, _loginAt: Date.now(), _exp: Date.now() + 3600000 }));
});
const page = await ctx.newPage();
let errors = [];
page.on('pageerror', e => errors.push(e.message));
page.on('console', m => { if (m.type() === 'error' && !/Failed to load resource|ERR_FAILED|cdn-cgi|세션 확인 실패/.test(m.text())) errors.push(m.text()); });
let fails = 0;
const check = async (label, url, ready) => {
  errors = [];
  const t = Date.now();
  await page.goto(url);
  const ok = await page.waitForFunction(ready, null, { timeout: 20000 }).then(() => true, () => false);
  const bad = !ok || errors.length;
  if (bad) fails++;
  console.log(`${bad ? '❌' : '✅'} ${label} (${Date.now() - t}ms)${!ok ? ' — 화면이 안 뜸' : ''}${errors.length ? ' — ' + errors.join(' | ').slice(0, 300) : ''}`);
};

await check('선생님 오늘', 'https://admin.kakainfo.com/k/', () => document.body.textContent.includes('정보') && !document.querySelector('[aria-busy="true"]'));
await check('선생님 과목', 'https://admin.kakainfo.com/k/course.html?id=C1', () => document.querySelector('.k-lesson__title')?.textContent === '첫 코드');
await check('선생님 차시 문서', 'https://admin.kakainfo.com/k/lesson.html?id=L1', () => window.kEditor && document.querySelector('.ce-paragraph') && document.querySelector('#present svg'));
await check('선생님 학생 작업', 'https://admin.kakainfo.com/k/work.html?lesson=L1', () => document.querySelector('.who button') && document.querySelector('.sum'));
await check('학생 오늘 차시', 'https://kakainfo.com/k/', () => document.querySelector('.kd-tool__slot a'));
await check('학생 파이썬', 'https://kakainfo.com/k/py.html?lesson=L1&block=py1', () => window.kCm && kCm.getValue().includes("print('안녕')") && document.querySelector('#run svg'));

await browser.close(); await env.cleanup();
console.log(fails ? `\n${fails}개 실패` : '\n모두 통과');
process.exit(fails ? 1 : 0);
