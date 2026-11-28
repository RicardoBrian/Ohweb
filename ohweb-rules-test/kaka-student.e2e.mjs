// 학생 수업 화면(ohinfo/public/k/ + /api/lesson) e2e — 에뮬레이터 + 실제 서버 함수.
// 내 반에 공개된 차시만 보임 · 다른 반/닫힌 차시는 못 엶 · 발표자 메모 빠짐 · 언어 바꾸기 · 마스터는 다 봄
import { chromium } from 'playwright-core';
import { readFileSync } from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import { initializeTestEnvironment } from '@firebase/rules-unit-testing';
import { doc, setDoc } from 'firebase/firestore';
import { onRequest as lessonApi } from '../ohinfo/functions/api/lesson.js';

const ROOT = new URL('../ohinfo/public', import.meta.url).pathname;
const FB = new URL('./.fbcdn', import.meta.url).pathname;
const SHOT = process.env.SHOT_DIR;
const rules = readFileSync(new URL('../ohweb-firestore.rules', import.meta.url), 'utf8');
const env = await initializeTestEnvironment({ projectId: 'ohweb-93062', firestore: { rules, host: '127.0.0.1', port: 8181 } });
await env.clearFirestore();
await fetch('http://127.0.0.1:9099/emulator/v1/projects/ohweb-93062/accounts', { method: 'DELETE' });

await env.withSecurityRulesDisabled(async c => {
  const db = c.firestore();
  await setDoc(doc(db, 'students/StuA'), { name: '김학생', schoolName: 'S중', grade: '1', class: '2', number: 3, registered: true });
  await setDoc(doc(db, 'students/StuB'), { name: '이학생', schoolName: 'S중', grade: '1', class: '3', number: 4, registered: true });
  await setDoc(doc(db, 'students/Master'), { name: '선생님', schoolName: 'S중', grade: '', class: '', number: 0, isMaster: true, registered: true });
  await setDoc(doc(db, 'courses/C1'), { name: '정보', i18n: { en: 'Informatics' }, year: 2027, semester: 1, schoolName: 'S중', grade: '1', classes: ['2', '3'], units: [{ id: 'u1', name: '알고리즘', i18n: { en: 'Algorithms' } }, { id: 'u2', name: '데이터' }], status: 'active' });
  await setDoc(doc(db, 'courses/C2'), { name: '다른 학교 정보', schoolName: 'T중', grade: '1', classes: ['2'], units: [{ id: 'x', name: 'x' }], status: 'active' });
  await setDoc(doc(db, 'courses/C3'), { name: '지난 학기', schoolName: 'S중', grade: '1', classes: ['2'], units: [{ id: 'x', name: 'x' }], status: 'archived' });
  await setDoc(doc(db, 'course_lessons/L1'), { courseId: 'C1', unitId: 'u1', order: 1, name: '반복문', i18n: { en: 'Loops' }, docId: 'D1', openTo: ['2'], updatedAt: '2027-03-02' });
  await setDoc(doc(db, 'course_lessons/L2'), { courseId: 'C1', unitId: 'u1', order: 2, name: '조건문', docId: 'D2', openTo: ['2'], updatedAt: '2027-03-09' });
  await setDoc(doc(db, 'course_lessons/L3'), { courseId: 'C1', unitId: 'u2', order: 1, name: '자료형', docId: null, openTo: [], updatedAt: '2027-03-10' });
  await setDoc(doc(db, 'course_lessons/X1'), { courseId: 'C2', unitId: 'x', order: 1, name: '남의 차시', docId: null, openTo: ['2'] });
  await setDoc(doc(db, 'docs/D1'), { kind: 'lesson', courseId: 'C1', lessonId: 'L1', blocks: [
    { id: 'b1', type: 'header', data: { text: '반복문이란', level: 2 } },
    { id: 'b2', type: 'paragraph', data: { text: '<b>반복</b>은 같은 일을 여러 번 하는 것' } },
    { id: 'b3', type: 'note', data: { text: '메모비밀: 3분 안에 끝내기' } },
  ], tr: { en: { b1: { src: 'x', data: { text: 'What is a loop', level: 2 } }, b3: { src: 'x', data: { text: 'secret note' } } } } });
  await setDoc(doc(db, 'docs/D2'), { kind: 'lesson', courseId: 'C1', lessonId: 'L2', blocks: [{ id: 'c1', type: 'paragraph', data: { text: '조건문 첫 글' } }], tr: {} });
});
const signUp = async (email, password) => {
  const r = await fetch('http://127.0.0.1:9099/identitytoolkit.googleapis.com/v1/accounts:signUp?key=fake', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ email, password, returnSecureToken: true }) });
  return (await r.json()).idToken;
};
const tok = { StuA: await signUp('stua@ohinfo.local', 'pass99'), StuB: await signUp('stub@ohinfo.local', 'pass99'), Master: await signUp('master@ohinfo.local', 'pass99') };

const apiEnv = { FIRESTORE_EMULATOR_HOST: '127.0.0.1:8181', FIREBASE_AUTH_EMULATOR_HOST: '127.0.0.1:9099', FIREBASE_PROJECT_ID: 'ohweb-93062' };
const call = async body => {
  const res = await lessonApi({ request: new Request('http://localhost:8099/api/lesson', { method: 'POST', headers: { 'content-type': 'application/json', origin: 'https://kakainfo.com' }, body: JSON.stringify(body) }), env: apiEnv });
  return { status: res.status, cors: res.headers.get('access-control-allow-origin'), ...(await res.json()) };
};
let fails = 0;
const ok = (label, cond, extra = '') => { if (cond) console.log('✅ ' + label); else { fails++; console.log('❌ ' + label + (extra ? ' — ' + extra : '')); } };

// ── 서버 함수 ──
const a = await call({ action: 'today', idToken: tok.StuA, studentDocId: 'StuA' });
ok('내 과목만(다른 학교·지난 학기 빠짐)', a.courses?.map(c => c.id).join() === 'C1', JSON.stringify(a));
ok('내 반에 공개된 차시만, 번호는 선생님 화면과 같게', a.courses?.[0]?.lessons.map(l => `${l.id}:${l.no}`).join() === 'L1:1,L2:2');
ok('지금 차시 = 가장 최근에 공개된 것', a.current === 'L2');
ok('CORS 는 kakainfo.com', a.cors === 'https://kakainfo.com');
const d1 = await call({ action: 'doc', idToken: tok.StuA, studentDocId: 'StuA', lessonId: 'L1' });
ok('차시 문서를 받는다', d1.doc?.blocks?.length === 2 && d1.lesson?.no === 1);
ok('발표자 메모는 원문·번역 모두 빠진다', !JSON.stringify(d1).includes('메모비밀') && !JSON.stringify(d1).includes('secret note'));
ok('닫힌 차시는 못 연다', (await call({ action: 'doc', idToken: tok.StuA, studentDocId: 'StuA', lessonId: 'L3' })).closed === true);
ok('다른 학교 차시는 못 연다', (await call({ action: 'doc', idToken: tok.StuA, studentDocId: 'StuA', lessonId: 'X1' })).closed === true);
const b = await call({ action: 'today', idToken: tok.StuB, studentDocId: 'StuB' });
ok('3반은 아직 공개된 차시 없음', b.courses?.[0]?.lessons.length === 0 && b.current === null);
ok('3반은 2반에만 연 차시를 못 연다', (await call({ action: 'doc', idToken: tok.StuB, studentDocId: 'StuB', lessonId: 'L1' })).closed === true);
const spoof = await call({ action: 'today', idToken: tok.StuB, studentDocId: 'StuA' });
ok('남의 학생 ID로 요청 → 403 다시 로그인', spoof.status === 403 && spoof.relogin === true);
ok('엉터리 토큰 → 403', (await call({ action: 'today', idToken: 'bad', studentDocId: 'StuA' })).status === 403);
const m = await call({ action: 'today', idToken: tok.Master, studentDocId: 'Master' });
ok('마스터는 진행 중인 과목의 모든 차시', m.courses?.map(c => c.id).sort().join() === 'C1,C2' && m.courses.find(c => c.id === 'C1').lessons.length === 3);

// ── 화면 ──
const conf = `import { initializeApp } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-app.js";
import { getFirestore, connectFirestoreEmulator } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";
import { getAuth, connectAuthEmulator, signInWithEmailAndPassword } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-auth.js";
const app = initializeApp({ apiKey: 'fake', projectId: 'ohweb-93062', authDomain: 'localhost' });
export const db = getFirestore(app); connectFirestoreEmulator(db, '127.0.0.1', 8181);
export const auth = getAuth(app); connectAuthEmulator(auth, 'http://127.0.0.1:9099', { disableWarnings: true });
if (!auth.currentUser) await signInWithEmailAndPassword(auth, 'stua@ohinfo.local', 'pass99');`;
const type = p => p.endsWith('.js') ? 'text/javascript' : p.endsWith('.css') ? 'text/css' : p.endsWith('.svg') ? 'image/svg+xml' : 'text/html; charset=utf-8';
const srv = http.createServer((req, res) => {
  let p = decodeURIComponent(new URL(req.url, 'http://x').pathname);
  if (p.endsWith('/')) p += 'index.html';
  if (p === '/firebase-config.js') { res.writeHead(200, { 'content-type': 'text/javascript' }); return res.end(conf); }
  try { const body = readFileSync(path.join(ROOT, p)); res.writeHead(200, { 'content-type': type(p) }); res.end(body); }
  catch { res.writeHead(404); res.end(); }
}).listen(8099);

const browser = await chromium.launch(process.env.CHROMIUM_PATH ? { executablePath: process.env.CHROMIUM_PATH } : {});
const ctx = await browser.newContext({ viewport: { width: 1280, height: 860 }, deviceScaleFactor: SHOT ? 2 : 1 });
const apiLog = [];
await ctx.route('**/*', async route => {
  const u = route.request().url();
  const g = u.match(/^https:\/\/www\.gstatic\.com\/firebasejs\/10\.12\.2\/([A-Za-z0-9_-]+\.js)$/);
  if (g) return route.fulfill({ status: 200, contentType: 'text/javascript', body: readFileSync(path.join(FB, g[1])) });
  if (u.endsWith('/api/lesson')) {
    const res = await lessonApi({ request: new Request(u, { method: 'POST', headers: { 'content-type': 'application/json' }, body: route.request().postData() }), env: apiEnv });
    const text = await res.text(); apiLog.push(text);
    return route.fulfill({ status: res.status, contentType: 'application/json', body: text });
  }
  if (u.startsWith('http://localhost:8099') || u.startsWith('http://127.0.0.1')) return route.continue();
  return route.abort();
});
await ctx.addInitScript(() => {
  if (!localStorage.getItem('ohinfo_student')) localStorage.setItem('ohinfo_student', JSON.stringify({ id: 'StuA', name: '김학생', schoolName: 'S중', grade: '1', class: '2', number: 3, _loginAt: Date.now(), _exp: Date.now() + 3600000 }));
});
const page = await ctx.newPage();
const errors = [];
page.on('pageerror', e => errors.push(e.message));
page.on('console', m => { if (m.type() === 'error' && !/ERR_FAILED|Failed to load resource|세션 확인 실패/.test(m.text())) errors.push(m.text()); });
const h1 = () => page.waitForFunction(() => document.querySelector('main h1')).then(() => page.textContent('main h1'));

try {
  const raw = await (await fetch('http://localhost:8099/k/')).text();
  ok('불러오는 동안 스켈레톤', raw.includes('class="sk '));
  await page.goto('http://localhost:8099/k/');
  ok('처음엔 지금 차시(2차시)', (await h1()).includes('2차시 조건문'));
  ok('로고·번호 아바타', await page.evaluate(() => !!document.querySelector('.k-logo svg') && document.querySelector('.k-avatar').textContent === '10203'));
  await page.click('text=이전 차시');
  await page.waitForFunction(() => document.querySelector('main h1')?.textContent.includes('반복문'));
  ok('이전 차시로 넘어간다', true);
  ok('굵은 글씨가 살아 있다', await page.evaluate(() => document.querySelector('.kd b')?.textContent === '반복'));
  ok('화면에 메모 없음', !(await page.content()).includes('메모비밀'));
  if (SHOT) await page.screenshot({ path: path.join(SHOT, 'student-lesson.png'), fullPage: true });
  await page.click('#lang-btn');
  await page.click('[data-lang="en"]');
  await page.waitForFunction(() => document.querySelector('main h1')?.textContent.includes('Lesson 1 Loops'));
  ok('영어로: 차시 이름·과목·단원', (await page.textContent('.k-page__eyebrow')).includes('Informatics · Algorithms'));
  ok('영어로: 번역된 블록, 번역 없는 블록은 원문', await page.evaluate(() => document.querySelector('.kd .kd-h')?.textContent === 'What is a loop' && document.querySelector('.kd').textContent.includes('같은 일을')));
  ok('영어로: 화면 글', (await page.textContent('.k-nav')).includes("Today's lesson"));
  ok('언어가 저장된다', await page.evaluate(() => localStorage.getItem('ohinfo_lang') === 'en'));
  await page.click('text=My subjects');
  await page.waitForFunction(() => document.querySelectorAll('.k-lesson').length);
  const list = await page.$$eval('.k-lesson__title', els => els.map(e => e.textContent));
  ok('내 과목: 공개된 차시만', list.join() === 'Loops,조건문', list.join());
  ok('내 과목: 지금 차시 표시', await page.evaluate(() => document.querySelector('.k-lesson--today .k-lesson__title')?.textContent === '조건문'));
  if (SHOT) await page.screenshot({ path: path.join(SHOT, 'student-list.png'), fullPage: true });
  await page.goto('http://localhost:8099/k/#lesson=L3');
  await page.waitForFunction(() => document.querySelector('.k-callout'));
  ok('닫힌 차시 주소로 와도 안 보인다', (await page.textContent('main')).includes('cannot be opened'));
  ok('한 번 받은 문서는 다시 안 받는다(언어 바꿔도)', apiLog.filter(t => t.includes('"doc"') || t.includes('"blocks"')).length <= 3);
  ok('페이지 오류 없음', errors.length === 0, errors.join(' | '));
} catch (e) { fails++; console.log('❌ 예외: ' + e.message); }

await browser.close(); srv.close(); await env.cleanup();
console.log(fails ? `\n${fails}개 실패` : '\n모두 통과');
process.exit(fails ? 1 : 0);
