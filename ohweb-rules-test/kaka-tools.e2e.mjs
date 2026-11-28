// 도구 블록 연결 e2e(파이썬·스크래치 말고 나머지) — 하나씩 늘어난다.
//   게시판: 선생님이 반마다 ohdlet 게시판을 고름 → 학생은 우리 반 게시판으로 바로, 비운 반에는 블록이 안 보임.
import { chromium } from 'playwright-core';
import { readFileSync } from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import { initializeTestEnvironment } from '@firebase/rules-unit-testing';
import { doc, setDoc, getDoc } from 'firebase/firestore';
import { onRequest as lessonApi } from '../ohinfo/functions/api/lesson.js';

const STU_ROOT = new URL('../ohinfo/public', import.meta.url).pathname;
const ADMIN_ROOT = new URL('../ohweb/public', import.meta.url).pathname;
const FB = new URL('./.fbcdn', import.meta.url).pathname;
const ADMIN_EMAIL = 'qjatjr7575@gmail.com';
const SHOT = process.env.SHOT_DIR;
const rules = readFileSync(new URL('../ohweb-firestore.rules', import.meta.url), 'utf8');
const env = await initializeTestEnvironment({ projectId: 'ohweb-93062', firestore: { rules, host: '127.0.0.1', port: 8181 } });
await env.clearFirestore();
await fetch('http://127.0.0.1:9099/emulator/v1/projects/ohweb-93062/accounts', { method: 'DELETE' });
const B = (name, grade, group, extra = {}) => ({ name, schoolName: 'S중', grade, group, status: 'ON', ...extra });
await env.withSecurityRulesDisabled(async c => {
  const db = c.firestore();
  await setDoc(doc(db, 'students/StuA'), { name: '김학생', schoolName: 'S중', grade: '1', class: '2', number: 3, registered: true });
  await setDoc(doc(db, 'students/StuB'), { name: '박학생', schoolName: 'S중', grade: '1', class: '3', number: 5, registered: true });
  await setDoc(doc(db, 'students/StuM'), { name: '마스터', schoolName: '관산중학교', grade: '2', class: '1', number: 25, registered: true, isMaster: true });
  await setDoc(doc(db, 'courses/C1'), { name: '정보', schoolName: 'S중', grade: '1', classes: ['2', '3'], units: [{ id: 'u1', name: '생각 나누기' }], status: 'active' });
  await setDoc(doc(db, 'course_lessons/L1'), { courseId: 'C1', unitId: 'u1', order: 1, name: '내 생각 쓰기', docId: 'D1', openTo: ['2', '3'], updatedAt: '2027-03-02' });
  await setDoc(doc(db, 'docs/D1'), { kind: 'lesson', blocks: [
    { id: 'p1', type: 'paragraph', data: { text: '게시판에 내 생각을 씁니다.' } },
    { id: 'bd1', type: 'tool', data: { tool: 'board', title: '내 생각', desc: '한 줄로 쓰세요.' } },
  ], tr: { en: { bd1: { src: 'x', data: { tool: 'board', title: 'My idea', desc: 'One line.', boards: { 3: { name: '비밀' } } } } } } });
  // ohdlet 게시판(classes): 2반 것, 3반 것, 1학년 전체, 다른 학교 것, 꺼진 것, 다른 학년 것
  await setDoc(doc(db, 'classes/K2'), B('1-2 정보', '1', '2'));
  await setDoc(doc(db, 'classes/K3'), B('1-3 정보', '1', '3'));
  await setDoc(doc(db, 'classes/KG'), B('1학년 공지', '1', ''));
  await setDoc(doc(db, 'classes/KX'), { ...B('남의 학교', '1', '2'), schoolName: 'T중' });
  await setDoc(doc(db, 'classes/KO'), B('꺼진 게시판', '1', '2', { status: 'OFF' }));
  await setDoc(doc(db, 'classes/K9'), B('2학년 것', '2', '2'));
});
const signUp = async (email, password) => {
  const r = await fetch('http://127.0.0.1:9099/identitytoolkit.googleapis.com/v1/accounts:signUp?key=fake', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ email, password, returnSecureToken: true }) });
  return r.json();
};
const tok = { StuA: (await signUp('stua@ohinfo.local', 'pass99')).idToken, StuB: (await signUp('stub@ohinfo.local', 'pass99')).idToken, StuM: (await signUp('stum@ohinfo.local', 'pass99')).idToken };
const adminUid = (await signUp(ADMIN_EMAIL, 'adminpw1')).localId;
await fetch('http://127.0.0.1:9099/identitytoolkit.googleapis.com/v1/projects/ohweb-93062/accounts:update', { method: 'POST', headers: { 'content-type': 'application/json', authorization: 'Bearer owner' }, body: JSON.stringify({ localId: adminUid, emailVerified: true }) });

const apiEnv = { FIRESTORE_EMULATOR_HOST: '127.0.0.1:8181', FIREBASE_AUTH_EMULATOR_HOST: '127.0.0.1:9099', FIREBASE_PROJECT_ID: 'ohweb-93062' };
const call = async (who, body) => { const res = await lessonApi({ request: new Request('http://x/api/lesson', { method: 'POST', body: JSON.stringify({ idToken: tok[who], studentDocId: who, ...body }) }), env: apiEnv }); return res.json(); };
const read = async p => { let v; await env.withSecurityRulesDisabled(async c => { v = (await getDoc(doc(c.firestore(), p))).data(); }); return v; };
let fails = 0;
const ok = (label, cond, extra = '') => { if (cond) console.log('✅ ' + label); else { fails++; console.log('❌ ' + label + (extra ? ' — ' + extra : '')); } };
const until = async (fn, ms = 10000) => { const t = Date.now(); while (Date.now() - t < ms) { const v = await fn(); if (v) return v; await new Promise(r => setTimeout(r, 200)); } return null; };

const conf = sign => `import { initializeApp } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-app.js";
import { getFirestore, connectFirestoreEmulator } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";
import { getAuth, connectAuthEmulator, signInWithEmailAndPassword } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-auth.js";
const app = initializeApp({ apiKey: 'fake', projectId: 'ohweb-93062', authDomain: 'localhost' });
export const db = getFirestore(app); connectFirestoreEmulator(db, '127.0.0.1', 8181);
export const auth = getAuth(app); connectAuthEmulator(auth, 'http://127.0.0.1:9099', { disableWarnings: true });
if (!auth.currentUser) await signInWithEmailAndPassword(auth, ${sign});`;
const type = p => p.endsWith('.js') ? 'text/javascript' : p.endsWith('.css') ? 'text/css' : p.endsWith('.svg') ? 'image/svg+xml' : p.endsWith('.png') ? 'image/png' : p.endsWith('.json') ? 'application/json' : 'text/html; charset=utf-8';
const serve = (root, port, sign) => http.createServer((req, res) => {
  let p = decodeURIComponent(new URL(req.url, 'http://x').pathname);
  if (p.endsWith('/')) p += 'index.html';
  if (p === '/firebase-config.js') { res.writeHead(200, { 'content-type': 'text/javascript' }); return res.end(conf(sign)); }
  try { const body = readFileSync(path.join(root, p)); res.writeHead(200, { 'content-type': type(p) }); res.end(body); }
  catch { res.writeHead(404); res.end(); }
}).listen(port);
const sv1 = serve(STU_ROOT, 8099, "'stua@ohinfo.local', 'pass99'"), sv2 = serve(ADMIN_ROOT, 8098, `'${ADMIN_EMAIL}', 'adminpw1'`);

const browser = await chromium.launch(process.env.CHROMIUM_PATH ? { executablePath: process.env.CHROMIUM_PATH } : {});
const ctx = await browser.newContext({ viewport: { width: 1280, height: 860 } });
await ctx.route('**/*', async route => {
  const u = route.request().url();
  const g = u.match(/^https:\/\/www\.gstatic\.com\/firebasejs\/10\.12\.2\/([A-Za-z0-9_-]+\.js)$/);
  if (g) return route.fulfill({ status: 200, contentType: 'text/javascript', body: readFileSync(path.join(FB, g[1])) });
  const k = u.match(/^https:\/\/kakainfo\.com\/(kaka\/[^?#]+)(?:\?[^#]*)?$/);
  if (k) { try { return route.fulfill({ status: 200, contentType: type(k[1]), body: readFileSync(path.join(STU_ROOT, k[1])) }); } catch { return route.fulfill({ status: 404, body: '' }); } }
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
const watchErr = (p, tag) => { p.on('pageerror', e => errors.push(tag + e.message)); p.on('console', m => { if (m.type() === 'error' && !/ERR_FAILED|Failed to load resource|세션 확인 실패/.test(m.text())) errors.push(tag + m.text().slice(0, 200)); }); };

try {
  // ── 게시판 ──
  const tp = await ctx.newPage(); watchErr(tp, '선생님: ');
  await tp.goto('http://localhost:8098/k/lesson.html?id=L1');
  await tp.waitForSelector('.kb-tool__boards select', { timeout: 20000 });
  const opts = await tp.$$eval('.kb-tool__boards select', ss => ss.map(s => [s.dataset.cls, [...s.options].map(o => o.textContent)]));
  ok('편집기: 과목 반(2·3)마다 고르기, 그 반에 맞는 게시판만(반 것·학년 전체, 다른 학교·꺼진·다른 학년 빼고)',
    JSON.stringify(opts) === JSON.stringify([['2', ['비움(이 반에는 안 보임)', '1-2 정보', '1학년 공지 · 학년 전체']], ['3', ['비움(이 반에는 안 보임)', '1-3 정보', '1학년 공지 · 학년 전체']]]), JSON.stringify(opts));
  ok('편집기: 게시판 블록에는 스크래치 시작 파일·파이썬 처음 코드 칸이 안 보임', !(await tp.isVisible('.kb-tool__sb3')) && !(await tp.isVisible('.kb-tool__starter')));
  await tp.selectOption('.kb-tool__boards select[data-cls="2"]', { label: '1-2 정보' });
  const d1 = await until(async () => { const x = await read('docs/D1'); return x?.blocks?.find(b => b.id === 'bd1')?.data?.boards?.['2'] && x; }, 15000);
  const bd = d1?.blocks.find(b => b.id === 'bd1').data;
  ok('편집기: 2반에 1-2 정보 → 저장, 3반은 비움', bd?.boards?.['2']?.name === '1-2 정보' && bd.boards['2'].group === '2' && !bd.boards['3'], JSON.stringify(bd?.boards));
  if (SHOT) await tp.locator('.kb-tool').screenshot({ path: SHOT + '/board-block.png' });

  const a = await call('StuA', { action: 'doc', lessonId: 'L1' });
  const ab = a.doc?.blocks?.find(b => b.id === 'bd1');
  ok('서버: 2반 학생에게는 우리 반 게시판 하나(board)만, 반별 목록(boards)은 안 보냄', ab?.data?.board?.name === '1-2 정보' && !ab.data.boards && !JSON.stringify(a.doc.tr).includes('boards'), JSON.stringify(ab));
  const b = await call('StuB', { action: 'doc', lessonId: 'L1' });
  ok('서버: 비운 3반 학생에게는 블록이 안 보임(번역본도)', !b.doc.blocks.some(x => x.id === 'bd1') && !b.doc.tr.en?.bd1 && b.doc.blocks.some(x => x.id === 'p1'));
  const m = await call('StuM', { action: 'doc', lessonId: 'L1' });
  ok('서버: 마스터 계정은 고른 게시판 아무거나 하나로 확인', m.doc?.blocks?.find(x => x.id === 'bd1')?.data?.board?.name === '1-2 정보');

  const sp = await ctx.newPage(); watchErr(sp, '학생: ');
  await sp.goto('http://localhost:8099/k/#lesson=L1');
  await sp.waitForSelector('.kd-tool__slot a', { timeout: 15000 });
  const href = await sp.getAttribute('.kd-tool__slot a', 'href');
  ok('학생: [열기] → ohdlet 우리 반 게시판 주소', href === '/ohdlet.html?board=1-2+%EC%A0%95%EB%B3%B4&school=S%EC%A4%91&grade=1&group=2', href);
  if (SHOT) await sp.locator('.kd-tool').screenshot({ path: SHOT + '/board-student.png' });
  await sp.click('.kd-tool__slot a');
  // 테스트용 firebase-config 는 로그인을 기다리느라(top-level await) load 뒤에 window.onload 가 걸린다 — 운영처럼 한 번 불러 준다
  await sp.waitForFunction(() => typeof window.onload === 'function' && document.readyState === 'complete', null, { timeout: 20000 });
  await sp.evaluate(() => { if (document.getElementById('step2')?.classList.contains('hidden')) window.onload(); });
  await sp.waitForFunction(() => !document.getElementById('step2')?.classList.contains('hidden'), null, { timeout: 20000 });
  ok('ohdlet: 그 게시판으로 바로 들어감', (await sp.evaluate(() => document.getElementById('f_class')?.value)) === '1-2 정보');

  ok('화면 오류 없음', errors.length === 0, errors.join(' | '));
} catch (e) { fails++; console.log('❌ 진행 중 오류 — ' + e.message.split('\n')[0]); }

await browser.close(); sv1.close(); sv2.close(); await env.cleanup();
console.log(fails ? `\n실패 ${fails}건` : '\n전부 통과'); process.exit(fails ? 1 : 0);
