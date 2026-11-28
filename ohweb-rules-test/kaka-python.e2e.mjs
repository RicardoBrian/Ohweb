// 파이썬 도구(학생 작업) e2e — ohinfo /api/lesson work-* + 학생 k/py.html + 선생님 k/work.html.
// 처음 코드 → 자동 저장 → 실행 → 저장 기록·되돌리기 → 선생님이 바로 봄. 남의 기록·닫힌 차시는 막힘.
import { chromium } from 'playwright-core';
import { readFileSync } from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import { initializeTestEnvironment } from '@firebase/rules-unit-testing';
import { doc, setDoc, getDoc, getDocs, collection } from 'firebase/firestore';
import { onRequest as lessonApi } from '../ohinfo/functions/api/lesson.js';

const STU_ROOT = new URL('../ohinfo/public', import.meta.url).pathname;
const ADMIN_ROOT = new URL('../ohweb/public', import.meta.url).pathname;
const KAKA = path.join(STU_ROOT, 'kaka');
const FB = new URL('./.fbcdn', import.meta.url).pathname;
const CM = new URL('./node_modules/codemirror', import.meta.url).pathname;
const ADMIN_EMAIL = 'qjatjr7575@gmail.com';
const SHOT = process.env.SHOT_DIR;
const rules = readFileSync(new URL('../ohweb-firestore.rules', import.meta.url), 'utf8');
const env = await initializeTestEnvironment({ projectId: 'ohweb-93062', firestore: { rules, host: '127.0.0.1', port: 8181 } });
await env.clearFirestore();
await fetch('http://127.0.0.1:9099/emulator/v1/projects/ohweb-93062/accounts', { method: 'DELETE' });

await env.withSecurityRulesDisabled(async c => {
  const db = c.firestore();
  await setDoc(doc(db, 'students/StuA'), { name: '김학생', schoolName: 'S중', grade: '1', class: '2', number: 3, registered: true });
  await setDoc(doc(db, 'students/StuB'), { name: '이학생', schoolName: 'S중', grade: '1', class: '2', number: 4, registered: true });
  await setDoc(doc(db, 'courses/C1'), { name: '정보', schoolName: 'S중', grade: '1', classes: ['2'], units: [{ id: 'u1', name: '파이썬' }], status: 'active' });
  await setDoc(doc(db, 'course_lessons/L1'), { courseId: 'C1', unitId: 'u1', order: 1, name: '첫 코드', docId: 'D1', openTo: ['2'], updatedAt: '2027-03-02' });
  await setDoc(doc(db, 'course_lessons/L2'), { courseId: 'C1', unitId: 'u1', order: 2, name: '닫힌 차시', docId: 'D2', openTo: [] });
  await setDoc(doc(db, 'docs/D1'), { kind: 'lesson', blocks: [
    { id: 'p1', type: 'paragraph', data: { text: '오늘은 print 를 씁니다.' } },
    { id: 'py1', type: 'tool', data: { tool: 'python', title: '인사하기', desc: '이름을 넣어 인사를 출력하세요.', starter: "name = '너'\nprint('안녕', name)" } },
    { id: 's1', type: 'tool', data: { tool: 'scratch', title: '스크래치', desc: '' } },
  ], tr: { en: { py1: { src: 'x', data: { title: 'Say hello', desc: 'Print a greeting.' } } } } });
  await setDoc(doc(db, 'docs/D2'), { kind: 'lesson', blocks: [{ id: 'py2', type: 'tool', data: { tool: 'python', title: 'x' } }] });
});
const signUp = async (email, password) => {
  const r = await fetch('http://127.0.0.1:9099/identitytoolkit.googleapis.com/v1/accounts:signUp?key=fake', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ email, password, returnSecureToken: true }) });
  return r.json();
};
const tok = { StuA: (await signUp('stua@ohinfo.local', 'pass99')).idToken, StuB: (await signUp('stub@ohinfo.local', 'pass99')).idToken };
const adminUid = (await signUp(ADMIN_EMAIL, 'adminpw1')).localId;
await fetch('http://127.0.0.1:9099/identitytoolkit.googleapis.com/v1/projects/ohweb-93062/accounts:update', { method: 'POST', headers: { 'content-type': 'application/json', authorization: 'Bearer owner' }, body: JSON.stringify({ localId: adminUid, emailVerified: true }) });

const apiEnv = { FIRESTORE_EMULATOR_HOST: '127.0.0.1:8181', FIREBASE_AUTH_EMULATOR_HOST: '127.0.0.1:9099', FIREBASE_PROJECT_ID: 'ohweb-93062' };
const call = async (who, body) => {
  const res = await lessonApi({ request: new Request('http://x/api/lesson', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ idToken: tok[who], studentDocId: who, ...body }) }), env: apiEnv });
  return { status: res.status, ...(await res.json()) };
};
const all = async name => { let v = []; await env.withSecurityRulesDisabled(async c => { v = (await getDocs(collection(c.firestore(), name))).docs.map(d => ({ id: d.id, ...d.data() })); }); return v; };
const read = async p => { let v; await env.withSecurityRulesDisabled(async c => { v = (await getDoc(doc(c.firestore(), p))).data(); }); return v; };
let fails = 0;
const ok = (label, cond, extra = '') => { if (cond) console.log('✅ ' + label); else { fails++; console.log('❌ ' + label + (extra ? ' — ' + extra : '')); } };
const until = async (fn, ms = 8000) => { const t = Date.now(); while (Date.now() - t < ms) { const v = await fn(); if (v) return v; await new Promise(r => setTimeout(r, 200)); } return null; };

// ── 서버 함수 ──
const W = { lessonId: 'L1', blockId: 'py1' };
const o = await call('StuB', { action: 'work-open', ...W });
ok('처음 열면 작업 없음 + 처음 코드', o.work === null && o.block?.data?.starter?.includes("print('안녕'") && o.history.length === 0);
ok('도구 블록 번역도 같이', o.block?.tr?.en?.title === 'Say hello');
const s1 = await call('StuB', { action: 'work-save', ...W, code: 'print(1)', reason: 'auto' });
ok('첫 저장 → 작업 + 기록 1', !s1.error && s1.history.length === 1);
const s2 = await call('StuB', { action: 'work-save', ...W, code: 'print(2)', reason: 'auto' });
ok('3분 안의 자동 저장은 기록을 늘리지 않음', s2.history.length === 1);
const s3 = await call('StuB', { action: 'work-save', ...W, code: 'print(3)', reason: 'save' });
ok('[저장]은 기록을 남김', s3.history.length === 2 && s3.history[0].reason === 'save');
const s4 = await call('StuB', { action: 'work-save', ...W, code: 'print(3)', reason: 'save' });
ok('같은 코드는 기록 안 늘림', s4.history.length === 2);
const wB = await read('work/StuB_L1_py1');
ok('작업 문서: 마지막 코드·반·번호·횟수', wB.code === 'print(3)' && wB.class === '2' && wB.number === 4 && wB.saves === 4 && wB.courseId === 'C1');
const v = await call('StuB', { action: 'work-version', ...W, versionId: s3.history[1].id });
ok('예전 기록 받기', v.code === 'print(1)');
ok('남의 기록은 못 받음', (await call('StuA', { action: 'work-version', ...W, versionId: s3.history[1].id })).status === 404);
ok('파이썬이 아닌 블록은 못 엶', (await call('StuA', { action: 'work-open', lessonId: 'L1', blockId: 's1' })).closed === true);
ok('닫힌 차시 도구는 못 엶·못 저장', (await call('StuA', { action: 'work-open', lessonId: 'L2', blockId: 'py2' })).closed === true && (await call('StuA', { action: 'work-save', lessonId: 'L2', blockId: 'py2', code: 'x' })).closed === true);
ok('너무 긴 코드는 거절', (await call('StuA', { action: 'work-save', ...W, code: 'x'.repeat(20001) })).status === 400);
ok('남의 ID로 저장 → 403', (await (async () => { const res = await lessonApi({ request: new Request('http://x', { method: 'POST', body: JSON.stringify({ action: 'work-save', idToken: tok.StuA, studentDocId: 'StuB', ...W, code: 'hack' }) }), env: apiEnv }); return res.status; })()) === 403);

// ── 화면: 학생(8099) · 선생님(8098) ──
const conf = sign => `import { initializeApp } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-app.js";
import { getFirestore, connectFirestoreEmulator } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";
import { getAuth, connectAuthEmulator, signInWithEmailAndPassword } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-auth.js";
const app = initializeApp({ apiKey: 'fake', projectId: 'ohweb-93062', authDomain: 'localhost' });
export const db = getFirestore(app); connectFirestoreEmulator(db, '127.0.0.1', 8181);
export const auth = getAuth(app); connectAuthEmulator(auth, 'http://127.0.0.1:9099', { disableWarnings: true });
if (!auth.currentUser) await signInWithEmailAndPassword(auth, ${sign});`;
const type = p => p.endsWith('.js') ? 'text/javascript' : p.endsWith('.css') ? 'text/css' : p.endsWith('.svg') ? 'image/svg+xml' : 'text/html; charset=utf-8';
const serve = (root, port, sign) => http.createServer((req, res) => {
  let p = decodeURIComponent(new URL(req.url, 'http://x').pathname);
  if (p.endsWith('/')) p += 'index.html';
  if (p === '/firebase-config.js') { res.writeHead(200, { 'content-type': 'text/javascript' }); return res.end(conf(sign)); }
  try { const body = readFileSync(path.join(root, p)); res.writeHead(200, { 'content-type': type(p) }); res.end(body); }
  catch { res.writeHead(404); res.end(); }
}).listen(port);
const s1v = serve(STU_ROOT, 8099, "'stua@ohinfo.local', 'pass99'"), s2v = serve(ADMIN_ROOT, 8098, `'${ADMIN_EMAIL}', 'adminpw1'`);
const cmFile = { 'codemirror.min.js': 'lib/codemirror.js', 'codemirror.min.css': 'lib/codemirror.css', 'python.min.js': 'mode/python/python.js', 'closebrackets.min.js': 'addon/edit/closebrackets.js' };
const runs = [];

const browser = await chromium.launch(process.env.CHROMIUM_PATH ? { executablePath: process.env.CHROMIUM_PATH } : {});
const ctx = await browser.newContext({ viewport: { width: 1280, height: 860 }, deviceScaleFactor: SHOT ? 2 : 1 });
await ctx.route('**/*', async route => {
  const u = route.request().url();
  const g = u.match(/^https:\/\/www\.gstatic\.com\/firebasejs\/10\.12\.2\/([A-Za-z0-9_-]+\.js)$/);
  if (g) return route.fulfill({ status: 200, contentType: 'text/javascript', body: readFileSync(path.join(FB, g[1])) });
  const c = u.match(/^https:\/\/cdnjs\.cloudflare\.com\/ajax\/libs\/codemirror\/5\.65\.16\/.*?([a-z]+\.min\.(js|css))$/);
  if (c && cmFile[c[1]]) return route.fulfill({ status: 200, contentType: c[2] === 'css' ? 'text/css' : 'text/javascript', body: readFileSync(path.join(CM, cmFile[c[1]])) });
  const k = u.match(/^https:\/\/kakainfo\.com\/kaka\/([a-z-]+\.(css|svg|js))$/);
  if (k) return route.fulfill({ status: 200, contentType: type(k[1]), body: readFileSync(path.join(KAKA, k[1])) });
  if (u.endsWith('/api/run-python')) { const b = JSON.parse(route.request().postData()); runs.push(b);
    return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(b.code.includes('boom') ? { stdout: '', stderr: 'NameError: boom' } : { stdout: `출력:${b.code.length}\n`, stderr: '' }) }); }
  if (u.endsWith('/api/lesson')) {
    const res = await lessonApi({ request: new Request(u, { method: 'POST', headers: { 'content-type': 'application/json' }, body: route.request().postData() }), env: apiEnv });
    return route.fulfill({ status: res.status, contentType: 'application/json', body: await res.text() });
  }
  if (u.startsWith('http://localhost:') || u.startsWith('http://127.0.0.1')) return route.continue();
  return route.abort();
});
await ctx.addInitScript(() => {
  if (location.port === '8099' && !localStorage.getItem('ohinfo_student')) localStorage.setItem('ohinfo_student', JSON.stringify({ id: 'StuA', name: '김학생', schoolName: 'S중', grade: '1', class: '2', number: 3, _loginAt: Date.now(), _exp: Date.now() + 3600000 }));
});
const errors = [];
const watchErr = (p, tag) => { p.on('pageerror', e => errors.push(tag + e.message)); p.on('console', m => { if (m.type() === 'error' && !/ERR_FAILED|Failed to load resource|세션 확인 실패/.test(m.text())) errors.push(tag + m.text()); }); };
const page = await ctx.newPage(); watchErr(page, '학생: ');
const savedText = () => page.waitForFunction(() => /^저장됨/.test(document.querySelector('#save')?.textContent || ''), null, { timeout: 10000 });

try {
  await page.goto('http://localhost:8099/k/#lesson=L1');
  await page.waitForSelector('.kd-tool__slot a');
  const href = await page.getAttribute('.kd-tool__slot a', 'href');
  ok('차시 화면: 파이썬 블록에만 [열기]', (await page.$$('.kd-tool__slot a')).length === 1 && href.includes('block=py1'));
  await page.click('.kd-tool__slot a');
  await page.waitForFunction(() => window.kCm);
  ok('IDE: 처음 코드가 들어 있다', (await page.evaluate(() => kCm.getValue())).includes("print('안녕', name)"));
  ok('IDE: 활동 제목·설명', (await page.textContent('.task h1')) === '인사하기' && (await page.textContent('.task')).includes('이름을 넣어'));
  await page.click('#run');
  await page.waitForFunction(() => /출력:/.test(document.querySelector('#out').textContent));
  ok('실행 → 결과', runs.length === 1);
  await savedText();
  let w = await until(() => read('work/StuA_L1_py1'));
  ok('실행하면 저장도 된다', w?.code?.includes("print('안녕'") && w.runs === 1);
  await page.evaluate(() => { kCm.setValue("print('boom')"); });
  await savedText();
  w = await until(async () => { const x = await read('work/StuA_L1_py1'); return x?.code === "print('boom')" && x; });
  ok('고치고 2초 쉬면 자동 저장', !!w);
  await page.click('#run');
  await page.waitForFunction(() => document.querySelector('#out .err'));
  ok('오류는 빨간 글씨로', (await page.textContent('#out')).includes('NameError'));
  await page.click('.CodeMirror'); await page.keyboard.press('Control+s');
  await page.waitForFunction(() => document.querySelectorAll('#hist [data-v]').length >= 2, null, { timeout: 10000 });
  ok('저장 기록이 보인다', (await page.$$('#hist [data-v]')).length >= 2);
  // 가장 오래된 기록 → 되돌리기
  await page.click('#hist li:last-child [data-v]');
  await page.waitForSelector('#viewing:not([hidden])');
  ok('예전 코드 보기(읽기 전용)', (await page.evaluate(() => kCm.getValue())).includes("print('안녕'") && await page.evaluate(() => kCm.getOption('readOnly')));
  if (SHOT) await page.screenshot({ path: path.join(SHOT, 'py-student.png') });
  await page.click('#restore');
  await savedText();
  w = await until(async () => { const x = await read('work/StuA_L1_py1'); return x?.code.includes("print('안녕'") && x; });
  ok('되돌리기 → 그 코드로 저장', !!w && !(await page.evaluate(() => kCm.getOption('readOnly'))));
  await page.reload(); await page.waitForFunction(() => window.kCm);
  ok('다시 열면 마지막 코드', (await page.evaluate(() => kCm.getValue())).includes("print('안녕'"));
  await page.evaluate(() => localStorage.setItem('ohinfo_lang', 'en')); await page.reload(); await page.waitForFunction(() => window.kCm);
  ok('영어: 버튼·제목', (await page.textContent('#run')) === 'Run' && (await page.textContent('.task h1')) === 'Say hello');
  await page.evaluate(() => localStorage.setItem('ohinfo_lang', 'ko'));
  await page.goto('http://localhost:8099/k/py.html?lesson=L2&block=py2');
  await page.waitForSelector('.k-callout');
  ok('닫힌 차시 도구 주소 → 못 엶', (await page.textContent('.k-callout')).includes('열 수 없는'));

  // 선생님
  const tp = await ctx.newPage(); watchErr(tp, '선생님: ');
  await tp.goto('http://localhost:8098/k/work.html?lesson=L1');
  await tp.waitForFunction(() => document.querySelectorAll('.who button').length === 2, null, { timeout: 15000 });
  ok('선생님: 반 학생 둘, 저장한 사람 수', (await tp.textContent('.sum')).includes('2명 중 2명'));
  await tp.click('[data-stu="StuA"]');
  await tp.waitForFunction(() => document.querySelectorAll('#hist [data-ver]').length >= 3);
  ok('선생님: 학생 코드와 저장 기록', (await tp.textContent('#view pre')).includes("print('안녕', name)"));
  await tp.click('#hist [data-ver]:last-child');
  ok('선생님: 예전 기록 보기', (await tp.textContent('#view pre')).includes('안녕') && (await tp.textContent('.k-code__file')).startsWith('저장 기록'));
  await tp.click('#run'); await tp.waitForFunction(() => /출력:/.test(document.querySelector('#out')?.textContent || ''));
  ok('선생님: 학생 코드 실행', true);
  await call('StuA', { action: 'work-save', ...W, code: "print('live')\nprint(2)", reason: 'save' });
  await tp.click('#hist [data-ver=""]');
  await tp.waitForFunction(() => document.querySelector('#view pre')?.textContent.includes('live'), null, { timeout: 8000 });
  ok('선생님: 학생이 저장하면 바로 바뀜', true);
  if (SHOT) await tp.screenshot({ path: path.join(SHOT, 'py-teacher.png') });
  ok('페이지 오류 없음', errors.length === 0, errors.join(' | '));
} catch (e) { fails++; console.log('❌ 예외: ' + e.message); }

await browser.close(); s1v.close(); s2v.close(); await env.cleanup();
console.log(fails ? `\n${fails}개 실패` : '\n모두 통과');
process.exit(fails ? 1 : 0);
