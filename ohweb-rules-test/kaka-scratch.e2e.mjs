// 스크래치 도구 e2e — 선생님 설정(드라이브 연결) → 시작 파일 올리기 → 학생이 열기·블록 넣기·저장·자동 저장·저장 기록 → 선생님 학생 작업.
// 구글 드라이브(Apps Script)는 흉내 서버(8097)가 대신한다. 편집기는 실제 scratch-gui(ohinfo/public/scratch).
import { chromium } from 'playwright-core';
import { readFileSync } from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import { initializeTestEnvironment } from '@firebase/rules-unit-testing';
import { doc, setDoc, getDoc, getDocs, collection } from 'firebase/firestore';
import { onRequest as lessonApi } from '../ohinfo/functions/api/lesson.js';
import { resetScratchStore } from '../ohinfo/lib/scratch-store.js';

const STU_ROOT = new URL('../ohinfo/public', import.meta.url).pathname;
const ADMIN_ROOT = new URL('../ohweb/public', import.meta.url).pathname;
const FB = new URL('./.fbcdn', import.meta.url).pathname;
const ADMIN_EMAIL = 'qjatjr7575@gmail.com';
const SHOT = process.env.SHOT_DIR;
const GAS = 'http://localhost:8097/exec';
const rules = readFileSync(new URL('../ohweb-firestore.rules', import.meta.url), 'utf8');
const env = await initializeTestEnvironment({ projectId: 'ohweb-93062', firestore: { rules, host: '127.0.0.1', port: 8181 } });
await env.clearFirestore();
await fetch('http://127.0.0.1:9099/emulator/v1/projects/ohweb-93062/accounts', { method: 'DELETE' });
await env.withSecurityRulesDisabled(async c => {
  const db = c.firestore();
  await setDoc(doc(db, 'students/StuA'), { name: '김학생', schoolName: 'S중', grade: '1', class: '2', number: 3, registered: true });
  await setDoc(doc(db, 'courses/C1'), { name: '정보', schoolName: 'S중', grade: '1', classes: ['2'], units: [{ id: 'u1', name: '스크래치' }], status: 'active' });
  await setDoc(doc(db, 'course_lessons/L1'), { courseId: 'C1', unitId: 'u1', order: 1, name: '고양이 걷기', docId: 'D1', openTo: ['2'], updatedAt: '2027-03-02' });
  await setDoc(doc(db, 'course_lessons/L2'), { courseId: 'C1', unitId: 'u1', order: 2, name: '닫힌 차시', docId: 'D2', openTo: [] });
  await setDoc(doc(db, 'docs/D1'), { kind: 'lesson', blocks: [
    { id: 'p1', type: 'paragraph', data: { text: '고양이를 걷게 해 봅시다.' } },
    { id: 'sc1', type: 'tool', data: { tool: 'scratch', title: '고양이 걷기', desc: '10만큼 움직이기를 넣으세요.' } },
  ], tr: {} });
  await setDoc(doc(db, 'docs/D2'), { kind: 'lesson', blocks: [{ id: 'sc2', type: 'tool', data: { tool: 'scratch', title: 'x' } }] });
});
const signUp = async (email, password) => {
  const r = await fetch('http://127.0.0.1:9099/identitytoolkit.googleapis.com/v1/accounts:signUp?key=fake', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ email, password, returnSecureToken: true }) });
  return r.json();
};
const tokA = (await signUp('stua@ohinfo.local', 'pass99')).idToken;
const adminUid = (await signUp(ADMIN_EMAIL, 'adminpw1')).localId;
await fetch('http://127.0.0.1:9099/identitytoolkit.googleapis.com/v1/projects/ohweb-93062/accounts:update', { method: 'POST', headers: { 'content-type': 'application/json', authorization: 'Bearer owner' }, body: JSON.stringify({ localId: adminUid, emailVerified: true }) });

const apiEnv = { FIRESTORE_EMULATOR_HOST: '127.0.0.1:8181', FIREBASE_AUTH_EMULATOR_HOST: '127.0.0.1:9099', FIREBASE_PROJECT_ID: 'ohweb-93062' };
const call = async body => { const res = await lessonApi({ request: new Request('http://x/api/lesson', { method: 'POST', body: JSON.stringify({ idToken: tokA, studentDocId: 'StuA', ...body }) }), env: apiEnv }); return { status: res.status, ...(await res.json()) }; };
const read = async p => { let v; await env.withSecurityRulesDisabled(async c => { v = (await getDoc(doc(c.firestore(), p))).data(); }); return v; };
const all = async name => { let v = []; await env.withSecurityRulesDisabled(async c => { v = (await getDocs(collection(c.firestore(), name))).docs.map(d => ({ id: d.id, ...d.data() })); }); return v; };
let fails = 0;
const ok = (label, cond, extra = '') => { if (cond) console.log('✅ ' + label); else { fails++; console.log('❌ ' + label + (extra ? ' — ' + extra : '')); } };
const until = async (fn, ms = 10000) => { const t = Date.now(); while (Date.now() - t < ms) { const v = await fn(); if (v) return v; await new Promise(r => setTimeout(r, 200)); } return null; };

// ── 구글 드라이브(Apps Script) 흉내 ──
const drive = { secret: '', files: new Map(), trashed: new Set(), n: 0 };
const gasSrv = http.createServer((req, res) => {
  const send = o => { res.writeHead(200, { 'content-type': 'application/json', 'access-control-allow-origin': '*' }); res.end(JSON.stringify(o)); };
  if (req.method === 'OPTIONS') { res.writeHead(204, { 'access-control-allow-origin': '*', 'access-control-allow-headers': '*' }); return res.end(); }
  let b = ''; req.on('data', d => b += d); req.on('end', () => {
    const q = JSON.parse(b || '{}');
    if (q.action === 'ping') return send({ ok: true, ready: !!drive.secret });
    if (q.action === 'register') { if (drive.secret) return send({ error: '이미 연결되어 있습니다', code: 'already' }); drive.secret = q.secret; return send({ ok: true }); }
    if (!drive.secret || q.secret !== drive.secret) return send({ error: '비밀값이 맞지 않습니다', code: 'auth' });
    if (q.action === 'save') { const id = 'F' + String(++drive.n).padStart(10, '0'); drive.files.set(id, { b64: q.b64, name: q.name, folders: q.folders }); return send({ fileId: id, bytes: Buffer.from(q.b64, 'base64').length }); }
    const f = drive.files.get(q.fileId);
    if (!f || drive.trashed.has(q.fileId)) return send({ error: '파일 없음' });
    if (q.action === 'load') return send({ b64: f.b64, name: f.name });
    if (q.action === 'trash') { drive.trashed.add(q.fileId); return send({ ok: true }); }
    send({ error: 'unknown' });
  });
}).listen(8097);

// ── 화면: 학생(8099) · 선생님(8098) ──
const conf = sign => `import { initializeApp } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-app.js";
import { getFirestore, connectFirestoreEmulator } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";
import { getAuth, connectAuthEmulator, signInWithEmailAndPassword } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-auth.js";
const app = initializeApp({ apiKey: 'fake', projectId: 'ohweb-93062', authDomain: 'localhost' });
export const db = getFirestore(app); connectFirestoreEmulator(db, '127.0.0.1', 8181);
export const auth = getAuth(app); connectAuthEmulator(auth, 'http://127.0.0.1:9099', { disableWarnings: true });
if (!auth.currentUser) await signInWithEmailAndPassword(auth, ${sign});`;
const type = p => p.endsWith('.js') ? 'text/javascript' : p.endsWith('.css') ? 'text/css' : p.endsWith('.svg') ? 'image/svg+xml' : p.endsWith('.png') ? 'image/png' : p.endsWith('.jpg') ? 'image/jpeg' : p.endsWith('.json') ? 'application/json' : 'text/html; charset=utf-8';
const serve = (root, port, sign) => http.createServer((req, res) => {
  let p = decodeURIComponent(new URL(req.url, 'http://x').pathname);
  if (p.endsWith('/')) p += 'index.html';
  if (p === '/firebase-config.js') { res.writeHead(200, { 'content-type': 'text/javascript' }); return res.end(conf(sign)); }
  try { const body = readFileSync(path.join(root, p)); res.writeHead(200, { 'content-type': type(p) }); res.end(body); }
  catch { res.writeHead(404); res.end(); }
}).listen(port);
const sv1 = serve(STU_ROOT, 8099, "'stua@ohinfo.local', 'pass99'"), sv2 = serve(ADMIN_ROOT, 8098, `'${ADMIN_EMAIL}', 'adminpw1'`);

const browser = await chromium.launch(process.env.CHROMIUM_PATH ? { executablePath: process.env.CHROMIUM_PATH } : {});
const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 1 });
const outside = new Set();
await ctx.route('**/*', async route => {
  const u = route.request().url();
  const g = u.match(/^https:\/\/www\.gstatic\.com\/firebasejs\/10\.12\.2\/([A-Za-z0-9_-]+\.js)$/);
  if (g) return route.fulfill({ status: 200, contentType: 'text/javascript', body: readFileSync(path.join(FB, g[1])) });
  const k = u.match(/^https:\/\/kakainfo\.com\/((?:kaka|scratch)\/[^?#]+)(?:\?[^#]*)?$/);
  if (k) { try { return route.fulfill({ status: 200, contentType: type(k[1]), body: readFileSync(path.join(STU_ROOT, k[1])) }); } catch { return route.fulfill({ status: 404, body: '' }); } }
  if (u.endsWith('/api/lesson')) {
    const res = await lessonApi({ request: new Request(u, { method: 'POST', headers: { 'content-type': 'application/json' }, body: route.request().postData() }), env: apiEnv });
    return route.fulfill({ status: res.status, contentType: 'application/json', body: await res.text() });
  }
  if (u.startsWith('https://cdn.jsdelivr.net/npm/@editorjs/') || u.startsWith('http://localhost:') || u.startsWith('http://127.0.0.1')) return route.continue();
  if (!u.startsWith('https://fonts.')) outside.add(u.slice(0, 90)); // 글꼴은 원래 구글 글꼴
  return route.abort();
});
await ctx.addInitScript(() => {
  if (location.port === '8099' && !localStorage.getItem('ohinfo_student')) localStorage.setItem('ohinfo_student', JSON.stringify({ id: 'StuA', name: '김학생', schoolName: 'S중', grade: '1', class: '2', number: 3, _loginAt: Date.now(), _exp: Date.now() + 3600000 }));
});
const errors = [];
const watchErr = (p, tag) => { p.on('pageerror', e => errors.push(tag + e.message)); p.on('console', m => { if (m.type() === 'error' && !/ERR_FAILED|Failed to load resource|세션 확인 실패/.test(m.text())) errors.push(tag + m.text().slice(0, 200)); }); };
const W = { lessonId: 'L1', blockId: 'sc1' };

try {
  // ── 0. 연결 전: 열 수는 있지만 저장은 안 됨 ──
  const o0 = await call({ action: 'scratch-open', ...W });
  ok('연결 전: 열면 ready=false', !o0.error && o0.ready === false && o0.block?.data?.title === '고양이 걷기', JSON.stringify(o0).slice(0, 200));
  ok('연결 전: 저장은 안내와 함께 거절', (await call({ action: 'scratch-save', ...W, b64: 'AAAA' })).setup === true);
  ok('닫힌 차시·남의 블록은 못 엶', (await call({ action: 'scratch-open', lessonId: 'L2', blockId: 'sc2' })).closed === true && (await call({ action: 'scratch-open', lessonId: 'L1', blockId: 'p1' })).closed === true);

  // 시작 파일로 쓸 sb3: 실제 편집기에서 스프라이트 이름을 바꿔 저장한 것
  const gen = await ctx.newPage();
  await gen.goto('https://kakainfo.com/scratch/editor.html?locale=ko');
  const starterB64 = await gen.evaluate(async () => { await kScratch.ready; const vm = kScratch.vm; vm.renameSprite(vm.editingTarget.id, '시작고양이'); const b = await kScratch.save(); const u = new Uint8Array(await b.arrayBuffer()); let s = ''; for (const x of u) s += String.fromCharCode(x); return btoa(s); });
  await gen.close();

  // ── 1. 선생님: 설정 → 드라이브 연결 ──
  const tp = await ctx.newPage(); watchErr(tp, '선생님: ');
  await tp.goto('http://localhost:8098/k/settings.html');
  await tp.waitForSelector('#url', { timeout: 15000 });
  ok('설정: 연결 안 됨 표시', (await tp.textContent('#state')).includes('연결 안 됨'));
  await tp.fill('#url', GAS); await tp.click('#go');
  await tp.waitForSelector('#check', { timeout: 15000 });
  const cfg = await read('kaka_config/scratch');
  ok('설정: 연결 → 비밀값을 드라이브와 Firestore 에 같이, 시험 파일은 휴지통', cfg?.url === GAS && cfg.secret === drive.secret && cfg.secret.length === 64 && drive.trashed.size === 1);
  resetScratchStore();

  // ── 2. 선생님: 차시 문서의 스크래치 블록에 시작 파일 올리기 ──
  await tp.goto('http://localhost:8098/k/lesson.html?id=L1');
  await tp.waitForSelector('.kb-tool__sb3 button', { timeout: 20000 });
  ok('편집기: 스크래치 블록에 시작 파일 올리기 단추, 파이썬 처음 코드 칸은 숨김', await tp.isVisible('.kb-tool__sb3') && !(await tp.isVisible('.kb-tool__starter')));
  await tp.setInputFiles('.kb-tool input[type=file]', { name: '고양이 시작.sb3', mimeType: 'application/octet-stream', buffer: Buffer.from(starterB64, 'base64') });
  const d1 = await until(async () => { const x = await read('docs/D1'); const t = x?.blocks?.find(b => b.id === 'sc1'); return t?.data?.starterFileId && x; }, 15000);
  const starterId = d1?.blocks.find(b => b.id === 'sc1').data.starterFileId;
  ok('시작 파일: 드라이브 "시작 파일" 폴더에 올라가고 블록에 ID·이름 저장', !!starterId && drive.files.get(starterId)?.folders?.[0] === '시작 파일' && d1.blocks.find(b => b.id === 'sc1').data.starterName === '고양이 시작.sb3');
  if (SHOT) await tp.screenshot({ path: SHOT + '/scratch-block.png' });

  // ── 3. 학생: 차시 → [열기] → 시작 파일로 시작 ──
  const sp = await ctx.newPage(); watchErr(sp, '학생: ');
  await sp.goto('http://localhost:8099/k/#lesson=L1');
  await sp.waitForSelector('.kd-tool__slot a');
  ok('차시 화면: 스크래치 블록에 [열기] → scratch.html', (await sp.getAttribute('.kd-tool__slot a', 'href')).startsWith('/k/scratch.html?lesson=L1&block=sc1'));
  await sp.click('.kd-tool__slot a');
  await sp.waitForFunction(() => window.kStu && !document.querySelector('#cover'), null, { timeout: 60000 });
  const names = () => sp.evaluate(() => kStu.S.vm.runtime.targets.filter(t => !t.isStage && t.isOriginal).map(t => t.sprite.name));
  ok('학생: 처음 열면 시작 파일(시작고양이)', (await names()).includes('시작고양이'), JSON.stringify(await names()));
  ok('학생: 편집기 언어 = 학생 언어(한국어)', (await sp.getAttribute('#ed', 'src')).endsWith('locale=ko'));
  ok('학생: 머리글에 활동 이름', (await sp.textContent('.k-header')).includes('고양이 걷기'));

  // 블록 하나를 끌어다 놓기(진짜 마우스)
  const fr = sp.frameLocator('#ed');
  const fb = await fr.getByText('만큼 움직이기').first().boundingBox();
  const eb = await sp.locator('#ed').boundingBox();
  await sp.mouse.move(fb.x - 20, fb.y + fb.height / 2); await sp.mouse.down();
  await sp.mouse.move(eb.x + eb.width * 0.4, eb.y + eb.height * 0.4, { steps: 25 }); await sp.mouse.up();
  await sp.waitForFunction(() => kStu.dirty, null, { timeout: 5000 }).catch(() => {});
  ok('블록을 넣으면 "저장 안 됨"', (await sp.textContent('#save')) === '저장 안 됨' && await sp.evaluate(() => kStu.S.stats().blocks) >= 1);
  await fr.locator('.blocklyMainBackground').click({ position: { x: 600, y: 500 } });
  await sp.keyboard.press('ControlOrMeta+s');
  await sp.waitForFunction(() => /^저장됨/.test(document.querySelector('#save').textContent), null, { timeout: 15000 });
  let w = await read('work/StuA_L1_sc1');
  ok('Ctrl+S → 드라이브 파일 + 작업 문서(블록 수·반·번호) + 저장 기록 1', w?.fileId && drive.files.has(w.fileId) && w.blocks >= 1 && w.sprites === 1 && w.class === '2' && w.number === 3 && w.fileInHistory === true && (await all('work_history')).length === 1, JSON.stringify(w));
  ok('드라이브 폴더: 과목/차시/반 번호 이름', JSON.stringify(drive.files.get(w.fileId).folders) === JSON.stringify(['1학년 정보', '1차시 고양이 걷기', '2반 03 김학생']), JSON.stringify(drive.files.get(w.fileId).folders));
  const firstFile = w.fileId, firstBlocks = w.blocks;

  // 자동 저장 두 번: 저장 기록은 안 늘고(10분 안), 기록에 없는 지난 자동 저장 파일은 휴지통
  await sp.evaluate(() => { const vm = kStu.S.vm; vm.renameSprite(vm.editingTarget.id, '걷는고양이'); });
  await sp.evaluate(() => kStu.save('auto'));
  w = await read('work/StuA_L1_sc1');
  const autoFile = w.fileId;
  ok('자동 저장: 작업은 바뀌고 저장 기록은 그대로, 기록에 있는 파일은 안 지움', autoFile !== firstFile && w.fileInHistory === false && (await all('work_history')).length === 1 && !drive.trashed.has(firstFile));
  await sp.evaluate(() => { const vm = kStu.S.vm; vm.renameSprite(vm.editingTarget.id, '뛰는고양이'); });
  await sp.evaluate(() => kStu.save('auto'));
  ok('다음 자동 저장 → 지난 자동 저장 파일은 휴지통', drive.trashed.has(autoFile));
  ok('바뀐 게 없으면 자동 저장 안 함', await sp.evaluate(async () => { const n = kStu.dirty; await kStu.save('auto'); return n === false; }) && (await read('work/StuA_L1_sc1')).saves === 3);

  // 다시 열면 마지막 작업
  await sp.reload();
  await sp.waitForFunction(() => window.kStu && !document.querySelector('#cover'), null, { timeout: 60000 });
  ok('다시 열면 마지막 작업(뛰는고양이)', (await names()).includes('뛰는고양이'), JSON.stringify(await names()));
  ok('다시 열 때 불러오기로는 "저장 안 됨"이 되지 않음', await sp.evaluate(() => !kStu.dirty) && (await sp.textContent('#save')).startsWith('저장됨'));

  // 저장 기록 → 예전 기록 열기
  await sp.click('#hist-btn');
  ok('저장 기록 메뉴: 1개, 블록 수', (await sp.locator('#hist [data-v]').count()) === 1 && (await sp.textContent('#hist')).includes(`블록 ${firstBlocks}개`));
  if (SHOT) await sp.screenshot({ path: SHOT + '/scratch-student.png' });
  await sp.click('#hist [data-v]');
  await sp.waitForFunction(() => /예전 기록/.test(document.querySelector('#save').textContent), null, { timeout: 15000 });
  ok('예전 기록 열기 → 그때 이름(시작고양이)', (await names()).includes('시작고양이'));

  // 영어
  await sp.evaluate(() => localStorage.setItem('ohinfo_lang', 'en')); await sp.reload();
  await sp.waitForFunction(() => window.kStu && !document.querySelector('#cover'), null, { timeout: 60000 });
  ok('영어: 편집기 locale=en, 단추 이름', (await sp.getAttribute('#ed', 'src')).endsWith('locale=en') && (await sp.getAttribute('#save-btn', 'aria-label')) === 'Save');
  await sp.evaluate(() => localStorage.setItem('ohinfo_lang', 'ko'));

  // ── 4. 선생님: 학생 작업 ──
  await tp.goto('http://localhost:8098/k/work.html?lesson=L1');
  await tp.waitForSelector('[data-stu="StuA"]', { timeout: 15000 });
  ok('학생 작업: 블록 수로 보임', (await tp.textContent('[data-stu="StuA"]')).includes('블록'), await tp.textContent('[data-stu="StuA"]'));
  await tp.click('[data-stu="StuA"]');
  await tp.waitForFunction(() => /지금 작품/.test(document.querySelector('#sstate')?.textContent || ''), null, { timeout: 60000 });
  const tf = tp.frames().find(f => f.url().includes('/scratch/editor.html'));
  ok('학생 작업: 드라이브에서 받아 편집기에 띄움(뛰는고양이)', (await tf.evaluate(() => kScratch.vm.runtime.targets.filter(t => !t.isStage).map(t => t.sprite.name))).includes('뛰는고양이'));
  await tp.click('#hist [data-ver]:last-child');
  await tp.waitForFunction(() => /저장 기록/.test(document.querySelector('#sstate')?.textContent || ''), null, { timeout: 30000 });
  ok('학생 작업: 저장 기록 보기(시작고양이)', (await tf.evaluate(() => kScratch.vm.runtime.targets.filter(t => !t.isStage).map(t => t.sprite.name))).includes('시작고양이'));
  if (SHOT) await tp.screenshot({ path: SHOT + '/scratch-teacher.png' });

  ok('바깥으로 나가는 요청 없음(스크래치 서버 포함)', !outside.size, [...outside].join(', '));
  ok('화면 오류 없음', errors.length === 0, errors.join(' | '));
} catch (e) { fails++; console.log('❌ 진행 중 오류 — ' + e.message.split('\n')[0]); }

await browser.close(); sv1.close(); sv2.close(); gasSrv.close(); await env.cleanup();
console.log(fails ? `\n실패 ${fails}건` : '\n전부 통과'); process.exit(fails ? 1 : 0);
