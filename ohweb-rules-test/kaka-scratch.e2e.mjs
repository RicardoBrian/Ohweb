// 스크래치 도구 e2e — 선생님 시작 파일 올리기 → 학생이 열기·블록 넣기·그림 그리기·저장·자동 저장·저장 기록 → 선생님 학생 작업.
// 저장은 Firestore(scratch_projects + scratch_assets). 편집기는 실제 scratch-gui(ohinfo/public/scratch).
import { chromium } from 'playwright-core';
import { readFileSync } from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import { initializeTestEnvironment } from '@firebase/rules-unit-testing';
import { doc, setDoc, getDoc, getDocs, collection } from 'firebase/firestore';
import { onRequest as lessonApi } from '../ohinfo/functions/api/lesson.js';
import { createHash } from 'node:crypto';

const STU_ROOT = new URL('../ohinfo/public', import.meta.url).pathname;
const ADMIN_ROOT = new URL('../ohweb/public', import.meta.url).pathname;
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
  // ── 0. 서버 확인 ──
  const o0 = await call({ action: 'scratch-open', ...W });
  ok('열기: 활동·작업 없음', !o0.error && o0.block?.data?.title === '고양이 걷기' && o0.work === null, JSON.stringify(o0).slice(0, 200));
  ok('닫힌 차시·남의 블록은 못 엶', (await call({ action: 'scratch-open', lessonId: 'L2', blockId: 'sc2' })).closed === true && (await call({ action: 'scratch-open', lessonId: 'L1', blockId: 'p1' })).closed === true);
  const fake = Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"/>');
  const realId = createHash('md5').update(fake).digest('hex') + '.svg';
  ok('그림 올리기: 이름(MD5)과 내용이 다르면 거절(남의 그림 덮어쓰기 막기)', /이름과 다릅니다/.test((await call({ action: 'scratch-asset', ...W, id: '0123456789abcdef0123456789abcdef.svg', b64: fake.toString('base64') })).error || ''));
  ok('그림 올리기: 맞으면 저장', (await call({ action: 'scratch-asset', ...W, id: realId, b64: fake.toString('base64') })).ok === true && !!(await read('scratch_assets/' + realId)));
  ok('닫힌 차시에는 그림도 못 올림', (await call({ action: 'scratch-asset', lessonId: 'L2', blockId: 'sc2', id: realId, b64: fake.toString('base64') })).closed === true);
  const big = Buffer.alloc(1400 * 1024, 7), bigId = createHash('md5').update(big).digest('hex') + '.wav';
  await call({ action: 'scratch-asset', ...W, id: bigId, b64: big.toString('base64') });
  ok('큰 소리(1.4MB)는 조각 3개로', (await read('scratch_assets/' + bigId))?.parts === 3 && !!(await read(`scratch_assets/${bigId}_2`)));
  const sv0 = await call({ action: 'scratch-save', ...W, json: JSON.stringify({ targets: [{ isStage: true, blocks: {}, costumes: [{ md5ext: 'ffffffffffffffffffffffffffffffff.svg' }], sounds: [] }] }) });
  ok('저장: 서버에 없는 그림이 있으면 저장하지 않고 missing 으로 알려 줌', JSON.stringify(sv0.missing) === '["ffffffffffffffffffffffffffffffff.svg"]' && !(await read('work/StuA_L1_sc1')));

  // 시작 파일로 쓸 sb3: 실제 편집기에서 스프라이트 이름을 바꿔 저장한 것
  const gen = await ctx.newPage();
  await gen.goto('https://kakainfo.com/scratch/editor.html?locale=ko');
  const starterB64 = await gen.evaluate(async () => { await kScratch.ready; const vm = kScratch.vm; vm.renameSprite(vm.editingTarget.id, '시작고양이'); const b = await vm.saveProjectSb3(); const u = new Uint8Array(await b.arrayBuffer()); let s = ''; for (const x of u) s += String.fromCharCode(x); return btoa(s); });
  await gen.close();

  const tp = await ctx.newPage(); watchErr(tp, '선생님: ');

  // ── 2. 선생님: 차시 문서의 스크래치 블록에 시작 파일 올리기 ──
  await tp.goto('http://localhost:8098/k/lesson.html?id=L1');
  await tp.waitForSelector('.kb-tool__sb3 button', { timeout: 20000 });
  ok('편집기: 스크래치 블록에 시작 파일 올리기 단추, 파이썬 처음 코드 칸은 숨김', await tp.isVisible('.kb-tool__sb3') && !(await tp.isVisible('.kb-tool__starter')));
  await tp.setInputFiles('.kb-tool input[type=file]', { name: '고양이 시작.sb3', mimeType: 'application/octet-stream', buffer: Buffer.from(starterB64, 'base64') });
  const d1 = await until(async () => { const x = await read('docs/D1'); const t = x?.blocks?.find(b => b.id === 'sc1'); return t?.data?.starterId && x; }, 30000);
  const starterId = d1?.blocks.find(b => b.id === 'sc1').data.starterId;
  const sp0 = starterId && await read('scratch_projects/' + starterId);
  ok('시작 파일: 숨긴 편집기로 풀어 scratch_projects + 그림·소리(고양이 2·소리 2·배경 1)로, 블록에 ID·이름', !!sp0 && JSON.parse(sp0.json).targets.some(t => t.name === '시작고양이') && sp0.assets.split(',').length === 5 && d1.blocks.find(b => b.id === 'sc1').data.starterName === '고양이 시작.sb3', JSON.stringify(sp0 && sp0.assets));
  const assetsAfterStarter = (await all('scratch_assets')).length;
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
  ok('Ctrl+S → 작품(project.json) + 작업 문서(블록 수·반·번호) + 저장 기록 1', w?.projectId && !!(await read('scratch_projects/' + w.projectId)) && w.blocks >= 1 && w.sprites === 1 && w.class === '2' && w.number === 3 && w.projectInHistory === true && (await all('work_history')).length === 1, JSON.stringify(w));
  ok('같은 그림·소리는 다시 안 올림(고양이는 시작 파일 것을 같이 씀)', (await all('scratch_assets')).length === assetsAfterStarter);
  ok('저장 하나 크기 = project.json 뿐(수 KB)', w.bytes < 20000, String(w.bytes));
  const firstFile = w.projectId, firstBlocks = w.blocks;

  // 학생이 새 모양을 그리면(서버에 없는 그림) → 그 그림만 올리고 저장
  const before = (await all('scratch_assets')).length;
  await sp.evaluate(async () => {
    const fw = document.querySelector('#ed').contentWindow, vm = kStu.S.vm, st = vm.runtime.storage;
    const svg = new fw.TextEncoder().encode('<svg xmlns="http://www.w3.org/2000/svg" width="20" height="20"><rect width="20" height="20" fill="#e33"/></svg>');
    const a = st.createAsset(st.AssetType.ImageVector, 'svg', svg, null, true);
    await vm.addCostume(a.assetId + '.svg', { name: '빨간네모', asset: a, assetId: a.assetId, dataFormat: 'svg', md5: a.assetId + '.svg', rotationCenterX: 10, rotationCenterY: 10 });
  });
  await sp.evaluate(() => kStu.save('save'));
  w = await read('work/StuA_L1_sc1');
  ok('새로 그린 모양: 그 그림 하나만 올라가고 저장됨', (await all('scratch_assets')).length === before + 1 && JSON.parse((await read('scratch_projects/' + w.projectId)).json).targets.some(t => (t.costumes || []).some(c => c.name === '빨간네모')) && (await sp.textContent('#save')).startsWith('저장됨'));
  const histN = (await all('work_history')).length;

  // 자동 저장 두 번: 저장 기록은 안 늘고(10분 안), 기록에 없는 지난 자동 저장 파일은 휴지통
  await sp.evaluate(() => { const vm = kStu.S.vm; vm.renameSprite(vm.editingTarget.id, '걷는고양이'); });
  await sp.evaluate(() => kStu.save('auto'));
  w = await read('work/StuA_L1_sc1');
  const autoFile = w.projectId;
  ok('자동 저장: 작업은 바뀌고 저장 기록은 그대로, 기록에 있는 작품은 안 지움', autoFile !== firstFile && w.projectInHistory === false && (await all('work_history')).length === histN && !!(await read('scratch_projects/' + firstFile)));
  await sp.evaluate(() => { const vm = kStu.S.vm; vm.renameSprite(vm.editingTarget.id, '뛰는고양이'); });
  await sp.evaluate(() => kStu.save('auto'));
  ok('다음 자동 저장 → 기록에 없는 지난 자동 저장본은 지움', !(await read('scratch_projects/' + autoFile)));
  ok('바뀐 게 없으면 자동 저장 안 함', await sp.evaluate(async () => { const n = kStu.dirty; await kStu.save('auto'); return n === false; }) && (await read('work/StuA_L1_sc1')).saves === 4);

  // 다시 열면 마지막 작업
  await sp.reload();
  await sp.waitForFunction(() => window.kStu && !document.querySelector('#cover'), null, { timeout: 60000 });
  ok('다시 열면 마지막 작업(뛰는고양이)', (await names()).includes('뛰는고양이'), JSON.stringify(await names()));
  ok('다시 열 때 불러오기로는 "저장 안 됨"이 되지 않음', await sp.evaluate(() => !kStu.dirty) && (await sp.textContent('#save')).startsWith('저장됨'));

  // 저장 기록 → 예전 기록 열기
  await sp.click('#hist-btn');
  ok('저장 기록 메뉴: 2개, 블록 수', (await sp.locator('#hist [data-v]').count()) === 2 && (await sp.textContent('#hist')).includes(`블록 ${firstBlocks}개`));
  if (SHOT) await sp.screenshot({ path: SHOT + '/scratch-student.png' });
  await sp.click('#hist [data-v]:last-child');
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
  await tp.waitForFunction(() => /블록/.test(document.querySelector('[data-stu="StuA"]')?.textContent || ''), null, { timeout: 15000 }).catch(() => {});
  ok('학생 작업: 블록 수로 보임', (await tp.textContent('[data-stu="StuA"]')).includes('블록'), await tp.textContent('[data-stu="StuA"]'));
  await tp.click('[data-stu="StuA"]');
  await tp.waitForFunction(() => /지금 작품/.test(document.querySelector('#sstate')?.textContent || ''), null, { timeout: 60000 });
  const tf = tp.frames().find(f => f.url().includes('/scratch/editor.html'));
  ok('학생 작업: Firestore 에서 읽어 편집기에 띄움(뛰는고양이)', (await tf.evaluate(() => kScratch.vm.runtime.targets.filter(t => !t.isStage).map(t => t.sprite.name))).includes('뛰는고양이'));
  await tp.click('#hist [data-ver]:last-child');
  await tp.waitForFunction(() => /저장 기록/.test(document.querySelector('#sstate')?.textContent || ''), null, { timeout: 30000 });
  ok('학생 작업: 저장 기록 보기(시작고양이)', (await tf.evaluate(() => kScratch.vm.runtime.targets.filter(t => !t.isStage).map(t => t.sprite.name))).includes('시작고양이'));
  if (SHOT) await tp.screenshot({ path: SHOT + '/scratch-teacher.png' });

  ok('바깥으로 나가는 요청 없음(스크래치 서버 포함)', !outside.size, [...outside].join(', '));
  ok('화면 오류 없음', errors.length === 0, errors.join(' | '));
} catch (e) { fails++; console.log('❌ 진행 중 오류 — ' + e.message.split('\n')[0]); }

await browser.close(); sv1.close(); sv2.close(); await env.cleanup();
console.log(fails ? `\n실패 ${fails}건` : '\n전부 통과'); process.exit(fails ? 1 : 0);
