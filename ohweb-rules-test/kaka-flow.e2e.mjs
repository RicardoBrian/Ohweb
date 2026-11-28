// kaká 수업 흐름 한 번에 e2e — 실제 화면만 눌러서 처음부터 끝까지.
// 선생님: 과목·단원·차시 만들기 → 차시 문서(글·파이썬 도구) → 세 언어 번역 → 반에 공개
// 학생: 오늘 차시 열기(한국어·영어) → 파이썬 [열기] → 키보드로 코드 쓰기·입력값·실행 → 자동 저장
// 선생님: [학생 작업] → 그 학생 코드·저장 기록이 보인다
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
  await setDoc(doc(db, 'students/StuC'), { name: '다른반', schoolName: 'S중', grade: '1', class: '3', number: 1, registered: true });
});
const signUp = async (email, password) => {
  const r = await fetch('http://127.0.0.1:9099/identitytoolkit.googleapis.com/v1/accounts:signUp?key=fake', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ email, password, returnSecureToken: true }) });
  return r.json();
};
await signUp('stua@ohinfo.local', 'pass99');
const tokC = (await signUp('stuc@ohinfo.local', 'pass99')).idToken;
const adminUid = (await signUp(ADMIN_EMAIL, 'adminpw1')).localId;
await fetch('http://127.0.0.1:9099/identitytoolkit.googleapis.com/v1/projects/ohweb-93062/accounts:update', { method: 'POST', headers: { 'content-type': 'application/json', authorization: 'Bearer owner' }, body: JSON.stringify({ localId: adminUid, emailVerified: true }) });

const apiEnv = { FIRESTORE_EMULATOR_HOST: '127.0.0.1:8181', FIREBASE_AUTH_EMULATOR_HOST: '127.0.0.1:9099', FIREBASE_PROJECT_ID: 'ohweb-93062' };
const all = async name => { let v = []; await env.withSecurityRulesDisabled(async c => { v = (await getDocs(collection(c.firestore(), name))).docs.map(d => ({ id: d.id, ...d.data() })); }); return v; };
const read = async p => { let v; await env.withSecurityRulesDisabled(async c => { v = (await getDoc(doc(c.firestore(), p))).data(); }); return v; };
let fails = 0;
const ok = (label, cond, extra = '') => { if (cond) console.log('✅ ' + label); else { fails++; console.log('❌ ' + label + (extra ? ' — ' + extra : '')); } };
const until = async (fn, ms = 8000) => { const t = Date.now(); while (Date.now() - t < ms) { const v = await fn(); if (v) return v; await new Promise(r => setTimeout(r, 200)); } return null; };

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
const sv1 = serve(STU_ROOT, 8099, "'stua@ohinfo.local', 'pass99'"), sv2 = serve(ADMIN_ROOT, 8098, `'${ADMIN_EMAIL}', 'adminpw1'`);
const runs = [];

const browser = await chromium.launch(process.env.CHROMIUM_PATH ? { executablePath: process.env.CHROMIUM_PATH } : {});
const ctx = await browser.newContext({ viewport: { width: 1280, height: 860 }, deviceScaleFactor: SHOT ? 2 : 1 });
await ctx.route('**/*', async route => {
  const u = route.request().url();
  const g = u.match(/^https:\/\/www\.gstatic\.com\/firebasejs\/10\.12\.2\/([A-Za-z0-9_-]+\.js)$/);
  if (g) return route.fulfill({ status: 200, contentType: 'text/javascript', body: readFileSync(path.join(FB, g[1])) });
  const k = u.match(/^https:\/\/kakainfo\.com\/kaka\/([a-z-]+\.(css|svg|js))(?:\?v=\w+)?$/);
  if (k) return route.fulfill({ status: 200, contentType: type(k[1]), body: readFileSync(path.join(KAKA, k[1])) });
  if (u.endsWith('/api/translate')) {
    const b = JSON.parse(route.request().postData());
    return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ translations: b.texts.map(t => ({ text: t ? `[${b.targetLang}] ${t}` : '' })) }) });
  }
  if (u.endsWith('/api/run-python')) { const b = JSON.parse(route.request().postData()); runs.push(b);
    // 간이 실행: input() 하나를 받아 print 로 인사
    const name = (b.stdin || '').split('\n')[0];
    return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ stdout: /input\(/.test(b.code) ? `안녕 ${name}\n` : '?\n', stderr: '' }) }); }
  if (u.endsWith('/api/lesson')) {
    const res = await lessonApi({ request: new Request(u, { method: 'POST', headers: { 'content-type': 'application/json' }, body: route.request().postData() }), env: apiEnv });
    return route.fulfill({ status: res.status, contentType: 'application/json', body: await res.text() });
  }
  if (u.startsWith('https://cdn.jsdelivr.net/npm/@editorjs/') || u.startsWith('http://localhost:') || u.startsWith('http://127.0.0.1')) return route.continue();
  return route.abort();
});
await ctx.addInitScript(() => {
  if (location.port === '8099' && !localStorage.getItem('ohinfo_student')) localStorage.setItem('ohinfo_student', JSON.stringify({ id: 'StuA', name: '김학생', schoolName: 'S중', grade: '1', class: '2', number: 3, _loginAt: Date.now(), _exp: Date.now() + 3600000 }));
});
const errors = [];
const watchErr = (p, tag) => { p.on('pageerror', e => errors.push(tag + e.message)); p.on('console', m => { if (m.type() === 'error' && !/ERR_FAILED|Failed to load resource|세션 확인 실패/.test(m.text())) errors.push(tag + m.text()); }); };
const tp = await ctx.newPage(); watchErr(tp, '선생님: ');
const dlg = async values => {
  await tp.waitForSelector('.k-dialog');
  for (const [k, v] of Object.entries(values)) await tp.fill(`.k-dialog [name="${k}"]`, v);
  await tp.click('.k-dialog .k-dialog__actions button:last-child');
  await tp.waitForSelector('.k-dialog', { state: 'detached' });
};
const STARTER = "name = input()\n";

try {
  // ── 1. 선생님: 과목·단원·차시 ──
  await tp.goto('http://localhost:8098/k/index.html');
  await tp.waitForSelector('#new-course', { timeout: 15000 });
  await tp.click('#new-course');
  await dlg({ name: '정보', grade: '1', classes: '2, 3', schoolName: 'S중', year: '2027', semester: '1' });
  await tp.waitForURL(/course\.html\?id=/);
  const courseId = new URL(tp.url()).searchParams.get('id');
  await tp.click('#unit-add'); await dlg({ name: '파이썬 시작' });
  await tp.waitForSelector('text=1. 파이썬 시작');
  await tp.click('[data-ladd]'); await dlg({ name: '입력과 출력', standards: '9정04-01' });
  await tp.waitForSelector('a.k-lesson__title');
  const lesson0 = (await all('course_lessons'))[0];
  ok('1. 차시 만들기: 과목·단원·차시 저장(아직 비공개, 문서 없음)', lesson0?.courseId === courseId && lesson0.openTo.length === 0 && !lesson0.docId && await tp.locator('text=문서 없음').count() === 1);

  // ── 2. 차시 문서: 글 + 파이썬 도구 ──
  await tp.click('a.k-lesson__title');
  await tp.waitForFunction(() => window.kEditor && document.querySelector('.ce-paragraph'), null, { timeout: 20000 });
  await tp.click('.ce-paragraph');
  await tp.keyboard.type('input() 으로 이름을 받아 인사합니다.');
  await tp.click('#palette [aria-label="도구 넣기"]');
  await tp.waitForSelector('.kb-tool__sel');
  await tp.selectOption('.kb-tool__sel', 'python');
  ok('2. 도구에서 파이썬을 고르면 처음 코드 칸', await tp.isVisible('.kb-tool__starter'));
  await tp.fill('.kb-tool input.k-input', '이름 받아 인사하기');
  await tp.click('.kb-tool__desc'); await tp.keyboard.type('이름을 입력받아 "안녕 이름"을 출력하세요.');
  await tp.click('.kb-tool__starter'); await tp.keyboard.type(STARTER);
  let d = await until(async () => { const x = (await all('docs'))[0]; const t = x?.blocks?.find(b => b.type === 'tool'); return t?.data.starter === STARTER && t.data.desc.includes('출력') && x; }, 10000);
  ok('2. 문서 저장: 글·파이썬 도구(제목·설명·처음 코드), 차시에 이어짐', !!d && (await read(`course_lessons/${lesson0.id}`)).docId === d.id, JSON.stringify((await all('docs'))[0]?.blocks));
  const toolId = d?.blocks.find(b => b.type === 'tool')?.id;
  ok('2. 넓은 화면: 편집기 오른쪽에 학생 화면 미리 보기', await tp.waitForFunction(() => { const l = document.querySelector('#live'); return l && l.offsetWidth > 300 && l.textContent.includes('이름 받아 인사하기'); }, null, { timeout: 8000 }).then(() => true, () => false));

  // ── 3. 번역 ──
  await tp.waitForFunction(() => /\(\d+개\)/.test(document.querySelector('#tr-all')?.textContent || ''));
  await tp.click('#tr-all');
  await tp.waitForFunction(() => document.querySelector('#tr-all').textContent === '번역 다 됨', null, { timeout: 10000 });
  d = await until(async () => { const x = (await all('docs'))[0]; return ['zh', 'ru', 'en'].every(l => x.tr?.[l]?.[toolId]) && x; });
  ok('3. 세 언어 번역: 파이썬 도구 제목·설명도 번역(처음 코드는 그대로)', !!d && d.tr.en[toolId].data.title === '[en] 이름 받아 인사하기' && (d.tr.en[toolId].data.starter ?? STARTER) === STARTER, JSON.stringify(d?.tr?.en?.[toolId]));
  if (SHOT) await tp.screenshot({ path: SHOT + '/flow-doc.png' });

  // ── 4. 반에 공개 ──
  await tp.goto(`http://localhost:8098/k/course.html?id=${courseId}`);
  await tp.waitForSelector('[data-cls="2"]');
  ok('4. 문서가 생기면 "문서 없음"이 사라짐', await tp.locator('text=문서 없음').count() === 0);
  await tp.click('[data-cls="2"]');
  await tp.waitForSelector('[data-cls="2"][aria-pressed="true"]');
  ok('4. 2반에만 공개', (await until(async () => { const l = await read(`course_lessons/${lesson0.id}`); return l.openTo.join() === '2' && l; })) !== null);
  const other = await lessonApi({ request: new Request('http://x/api/lesson', { method: 'POST', body: JSON.stringify({ action: 'doc', idToken: tokC, studentDocId: 'StuC', lessonId: lesson0.id }) }), env: apiEnv }).then(r => r.json());
  ok('4. 3반 학생에게는 닫혀 있음', other.closed === true, JSON.stringify(other).slice(0, 120));

  // ── 5. 학생: 오늘 차시 → 파이썬 ──
  const sp = await ctx.newPage(); watchErr(sp, '학생: ');
  await sp.goto('http://localhost:8099/k/');
  await sp.waitForSelector('.kd-tool__slot a', { timeout: 15000 });
  const art = await sp.textContent('main');
  ok('5. 학생 오늘 화면 = 방금 공개한 차시(글·도구)', art.includes('입력과 출력') && art.includes('이름을 받아 인사합니다') && art.includes('이름 받아 인사하기'), art.slice(0, 200));
  ok('5. 넓은 화면: 왼쪽에 내 차시 목록(지금 차시 표시)', await sp.isVisible('.side a[aria-current="page"]') && (await sp.textContent('.side a[aria-current="page"]')).includes('입력과 출력'));
  await sp.evaluate(() => localStorage.setItem('ohinfo_lang', 'en')); await sp.reload();
  await sp.waitForSelector('.kd-tool__slot a');
  ok('5. 영어로 바꾸면 번역된 차시', (await sp.textContent('main')).includes('[en] input() 으로 이름을'));
  await sp.evaluate(() => localStorage.setItem('ohinfo_lang', 'ko')); await sp.reload();
  await sp.waitForSelector('.kd-tool__slot a');
  await sp.click('.kd-tool__slot a');
  await sp.waitForFunction(() => window.kCm);
  ok('5. IDE: 제목·처음 코드', (await sp.textContent('.task h1')) === '이름 받아 인사하기' && (await sp.evaluate(() => kCm.getValue())) === STARTER);
  await sp.click('.cm-content'); await sp.keyboard.press('Control+End');
  await sp.keyboard.type("print('안녕', name");
  await sp.keyboard.type(')');
  const code = await sp.evaluate(() => kCm.getValue());
  ok('5. 키보드로 쓴 코드(괄호 자동 닫기 겹침 없음)', code === "name = input()\nprint('안녕', name)", JSON.stringify(code));
  await sp.click('details.stdin summary'); await sp.fill('#stdin', '하늘');
  await sp.click('#run');
  await sp.waitForFunction(() => /안녕 하늘/.test(document.querySelector('#out').textContent));
  ok('5. 실행: 입력값이 실행 서버로 가고 결과가 보임', runs.at(-1)?.stdin?.startsWith('하늘') && runs.at(-1).code === code);
  await sp.waitForFunction(() => /^저장됨/.test(document.querySelector('#save')?.textContent || ''), null, { timeout: 10000 });
  const w = await until(async () => { const x = await read(`work/StuA_${lesson0.id}_${toolId}`); return x?.code === code && x; });
  ok('5. 학생 계정에 저장(과목·반·번호·실행 1번)', !!w && w.courseId === courseId && w.class === '2' && w.number === 3 && w.runs === 1, JSON.stringify(w));
  if (SHOT) await sp.screenshot({ path: SHOT + '/flow-student.png' });
  await sp.setViewportSize({ width: 390, height: 800 }); await sp.goto('http://localhost:8099/k/'); await sp.waitForSelector('.kd-tool__slot a');
  ok('5. 폰 너비: 가로 스크롤 없음·목록 숨김·머리글 한 줄', await sp.evaluate(() => document.documentElement.scrollWidth <= innerWidth && !document.querySelector('.side').offsetWidth && document.querySelector('.k-nav a').offsetHeight < 40));

  // ── 6. 선생님: 학생 작업 ──
  await tp.goto(`http://localhost:8098/k/lesson.html?id=${lesson0.id}`);
  await tp.waitForSelector('a[aria-label="학생 작업"]');
  await tp.click('a[aria-label="학생 작업"]');
  await tp.waitForURL(/work\.html/);
  await tp.waitForFunction(() => document.querySelectorAll('.who button').length === 2, null, { timeout: 15000 });
  ok('6. 학생 작업: 2반 학생 둘(3반 빠짐), 저장 1명', await tp.waitForFunction(() => document.querySelector('.sum')?.textContent.includes('2명 중 1명'), null, { timeout: 8000 }).then(() => true, () => false), await tp.textContent('.sum').catch(() => ''));
  await tp.click('[data-stu="StuA"]');
  await tp.waitForFunction(() => document.querySelector('#view pre')?.textContent.includes("print('안녕', name)"), null, { timeout: 8000 });
  ok('6. 학생 코드가 그대로 보임', true);
  await tp.click('#run'); await tp.waitForFunction(() => /안녕|\?/.test(document.querySelector('#out')?.textContent || ''));
  ok('6. 선생님도 학생 코드 실행', runs.length >= 2);
  if (SHOT) await tp.screenshot({ path: SHOT + '/flow-teacher.png' });
  ok('화면 오류 없음', errors.length === 0, errors.join(' | '));
} catch (e) { fails++; console.log('❌ 진행 중 오류 — ' + e.message.split('\n')[0]); if (SHOT) await tp.screenshot({ path: SHOT + '/flow-error.png' }); }

await browser.close(); sv1.close(); sv2.close(); await env.cleanup();
console.log(fails ? `\n실패 ${fails}건` : '\n전부 통과'); process.exit(fails ? 1 : 0);
