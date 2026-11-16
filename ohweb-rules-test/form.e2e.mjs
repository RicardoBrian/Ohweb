// 설문 e2e — 실제 학생 화면(ohinfo/public formlab.html·formfill.html)을 띄우고 Firebase 만
// 에뮬레이터로 바꿔서, 실제 규칙으로 "제출 후 응답 수정" 흐름을 돌려 본다.
// 만든 학생: formlab 에서 '응답 수정 허용' 켜고 저장
// 응답자: 로그인 → 제출(파일 포함) → 다시 들어오면 이전 답이 채워짐 → 고쳐서 제출(문서 1개 유지, 파일 유지)
// 수정 허용 안 한 설문·비로그인 응답은 예전처럼 새 응답으로 들어간다.
import { chromium } from 'playwright-core';
import { readFileSync } from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import { initializeTestEnvironment } from '@firebase/rules-unit-testing';
import { doc, setDoc, getDoc, getDocs, collection, query, where } from 'firebase/firestore';

const STU_ROOT = new URL('../ohinfo/public', import.meta.url).pathname;
const FB = new URL('./.fbcdn', import.meta.url).pathname;
const rules = readFileSync(new URL('../ohweb-firestore.rules', import.meta.url), 'utf8');
const env = await initializeTestEnvironment({ projectId: 'ohweb-93062', firestore: { rules, host: '127.0.0.1', port: 8181 } });
await env.clearFirestore();
await fetch('http://127.0.0.1:9099/emulator/v1/projects/ohweb-93062/accounts', { method: 'DELETE' });
const QS = [
  { id: 'q1', type: 'short', text: '이름 소개', required: true, options: [] },
  { id: 'q2', type: 'mc', text: '좋아하는 색', required: false, options: ['빨강', '파랑'] },
  { id: 'q3', type: 'file', text: '사진', required: false, options: [] },
];
await env.withSecurityRulesDisabled(async c => {
  const db = c.firestore();
  const st = (id, number, name) => Promise.all([
    setDoc(doc(db, 'students/' + id), { name, schoolName: 'S중', grade: '1', class: '2', number, registered: true }),
    setDoc(doc(db, 'student_directory/' + id), { schoolName: 'S중', grade: '1', class: '2', number, registered: true, locked: false, failedAttempts: 0 }),
  ]);
  await st('StuA', 3, '김학생'); await st('StuB', 4, '박학생');
  const base = { ownerId: 'StuA', ownerName: '김학생', status: 'open', allowAnon: true, responseCount: 0, questions: QS, i18n: {} };
  await setDoc(doc(db, 'student_forms/FE'), { ...base, title: '수정 되는 설문' });
  await setDoc(doc(db, 'student_forms/FN'), { ...base, title: '수정 안 되는 설문' });
});
const signUp = async (email, password) => {
  const r = await fetch('http://127.0.0.1:9099/identitytoolkit.googleapis.com/v1/accounts:signUp?key=fake', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ email, password, returnSecureToken: true }) });
  if (!r.ok) throw new Error('signup ' + await r.text());
};
await signUp('stua@ohinfo.local', 'pass99');
await signUp('stub@ohinfo.local', 'pass99');

const conf = `import { initializeApp } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-app.js";
import { getFirestore, connectFirestoreEmulator } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";
import { getAuth, connectAuthEmulator } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-auth.js";
const app = initializeApp({ apiKey: 'fake', projectId: 'ohweb-93062', authDomain: 'localhost' });
export const db = getFirestore(app); connectFirestoreEmulator(db, '127.0.0.1', 8181);
export const auth = getAuth(app); connectAuthEmulator(auth, 'http://127.0.0.1:9099', { disableWarnings: true });`;
const srv = http.createServer((req, res) => {
  let p = decodeURIComponent(new URL(req.url, 'http://x').pathname);
  if (p === '/') p = '/index.html';
  if (p === '/firebase-config.js') { res.writeHead(200, { 'content-type': 'text/javascript' }); return res.end(conf); }
  try { const body = readFileSync(path.join(STU_ROOT, p)); res.writeHead(200, { 'content-type': p.endsWith('.js') ? 'text/javascript' : p.endsWith('.css') ? 'text/css' : 'text/html; charset=utf-8' }); res.end(body); }
  catch { res.writeHead(404); res.end(); }
}).listen(8097);
const BASE = 'http://localhost:8097';

let uploads = 0;
const browser = await chromium.launch(process.env.CHROMIUM_PATH ? { executablePath: process.env.CHROMIUM_PATH } : {});
const errors = [];
async function newPage() {
  const ctx = await browser.newContext();
  await ctx.route('**/*', route => {
    const u = route.request().url();
    const m = u.match(/^https:\/\/www\.gstatic\.com\/firebasejs\/10\.12\.2\/([A-Za-z0-9_-]+\.js)$/);
    if (m) return route.fulfill({ status: 200, contentType: 'text/javascript', body: readFileSync(path.join(FB, m[1])) });
    // 가짜 파일 업로드(Apps Script)
    if (/^https:\/\/script\.google\.com\/macros\//.test(u)) { uploads++; const b = JSON.parse(route.request().postData() || '{}'); return route.fulfill({ status: 200, contentType: 'application/json', headers: { 'access-control-allow-origin': '*' }, body: JSON.stringify({ url: 'https://drive.example/' + encodeURIComponent(b.filename) }) }); }
    if (u.startsWith('http://localhost:') || u.startsWith('http://127.0.0.1')) return route.continue();
    return route.abort();
  });
  const page = await ctx.newPage();
  page.on('pageerror', e => errors.push(e.message));
  page.on('console', m => { if (m.type() === 'error' && !/ERR_FAILED|net::|404|translate/.test(m.text())) errors.push('console: ' + m.text()); });
  page.on('dialog', d => d.accept());
  return page;
}
const shot = async (page, name) => { if (process.env.SHOT) await page.screenshot({ path: path.join(process.env.SHOT, name + '.png'), fullPage: true }); };
let fails = 0; const ok = (c, l) => { if (!c) fails++; console.log((c ? '✅ ' : '❌ ') + l); };
const read = async fn => { let v; await env.withSecurityRulesDisabled(async c => { v = await fn(c.firestore()); }); return v; };
const responsesOf = (formId, who) => read(async db => (await getDocs(query(collection(db, 'student_form_responses'), where('formId', '==', formId), where('respondentId', '==', who)))).docs.map(d => ({ id: d.id, ...d.data() })));
async function login(page, number) {
  await page.goto(BASE + '/index.html');
  await page.waitForFunction(() => document.querySelectorAll('#loginSchool option').length > 1, null, { timeout: 15000 });
  await page.selectOption('#loginSchool', 'S중'); await page.waitForTimeout(300);
  await page.selectOption('#loginGrade', '1'); await page.waitForTimeout(200);
  await page.selectOption('#loginClass', '2'); await page.waitForTimeout(300);
  await page.selectOption('#loginNumber', String(number));
  await page.fill('#loginPw', 'pass99');
  await page.evaluate(() => window.doLogin());
  await page.waitForURL(/home\.html/, { timeout: 15000 });
}
const openFill = async (page, id) => { await page.goto(`${BASE}/formfill.html?id=${id}`); await page.waitForSelector('#pageFill:not(.hidden), #pageError:not(.hidden)', { timeout: 15000 }); };
const submit = async page => { await page.click('#btnNext'); await page.waitForSelector('#pageDone:not(.hidden)', { timeout: 15000 }); };

try {
  // ── 만든 학생: 응답 수정 허용 켜기 ──
  const A = await newPage();
  await login(A, 3);
  await A.goto(BASE + '/formlab.html');
  await A.waitForFunction(() => typeof window.initBuilder === 'function', null, { timeout: 15000 });
  await A.evaluate(() => window.initBuilder('FE'));
  await A.waitForFunction(() => document.getElementById('bTitle').value === '수정 되는 설문', null, { timeout: 10000 });
  ok(!(await A.isChecked('#bAllowEdit')), 'formlab: 기존 설문은 응답 수정 허용 꺼짐');
  await A.check('#bAllowEdit');
  await shot(A, '1-formlab-setting');
  await A.evaluate(() => window.saveForm());
  await A.waitForFunction(() => /저장되었습니다/.test(document.getElementById('bSaveMsg').innerText), null, { timeout: 15000 });
  const fe = await read(async db => (await getDoc(doc(db, 'student_forms/FE'))).data());
  ok(fe.allowEdit === true && fe.questions.length === 3, 'formlab: 저장하면 allowEdit=true');
  await A.waitForFunction(() => /응답 수정 허용/.test(document.getElementById('resMeta')?.innerText || ''), null, { timeout: 10000 });
  ok(true, 'formlab: 결과 화면에 "응답 수정 허용" 표시');

  // ── 응답자: 첫 제출 ──
  const B = await newPage();
  await login(B, 4);
  await openFill(B, 'FE');
  ok(!(await B.innerText('#fillMeta')).includes('수정 중'), '처음 들어오면 수정 표시 없음');
  await B.fill('#questionsArea input.inp[type=text]', '첫 답');
  await B.check('input[name=q1][value="빨강"]');
  await B.evaluate(() => { const dt = new DataTransfer(); dt.items.add(new File(['hello'], 'a.png', { type: 'image/png' })); window._ffDrop({ preventDefault() {}, dataTransfer: dt }, 2); });
  await submit(B);
  ok(await B.isVisible('#editAgainWrap'), '제출 완료 화면에 "응답 수정하기" 버튼');
  let rs = await responsesOf('FE', 'StuB');
  ok(rs.length === 1 && rs[0].answers[0].answer === '첫 답' && rs[0].answers[2].answer?.[0]?.url, '첫 제출 저장(파일 포함)');
  const firstSubmittedAt = rs[0].submittedAt?.toMillis?.();

  // ── 다시 들어오면 이전 답이 채워짐 → 고쳐서 제출 ──
  await B.click('#editAgainWrap button');
  await B.waitForSelector('#pageFill:not(.hidden)', { timeout: 15000 });
  ok((await B.inputValue('#questionsArea input.inp[type=text]')) === '첫 답', '다시 열면 단답이 채워짐');
  ok(await B.isChecked('input[name=q1][value="빨강"]'), '다시 열면 객관식 선택이 채워짐');
  ok((await B.innerText('#filelist_2')).includes('a.png'), '다시 열면 올린 파일이 보임');
  ok((await B.innerText('#fillMeta')).includes('이전 응답 수정 중'), '수정 중 표시');
  ok((await B.innerText('#btnNextTxt')) === '수정 제출', '버튼이 "수정 제출"');
  await shot(B, '2-formfill-edit');
  await B.fill('#questionsArea input.inp[type=text]', '고친 답');
  await B.check('input[name=q1][value="파랑"]');
  const uploadsBefore = uploads;
  await submit(B);
  ok((await B.innerText('#doneTitle')) === '수정 완료!', '수정 완료 화면');
  rs = await responsesOf('FE', 'StuB');
  ok(rs.length === 1, '수정해도 응답은 1개');
  ok(rs[0].answers[0].answer === '고친 답' && rs[0].answers[1].answer === '파랑', '답이 고쳐짐');
  ok(rs[0].answers[2].answer?.[0]?.name === 'a.png' && uploads === uploadsBefore, '예전 파일 유지, 다시 올리지 않음');
  ok(rs[0].editedAt && rs[0].submittedAt?.toMillis?.() === firstSubmittedAt, '수정 시각 기록, 처음 제출 시각 그대로');
  const cnt = await read(async db => (await getDoc(doc(db, 'student_forms/FE'))).data().responseCount);
  ok(cnt === 1, '응답 수는 1 그대로');

  // ── 만든 학생 결과 화면: (수정됨) ──
  await A.evaluate(() => window.openResults('FE'));
  await A.click('.res-tab:has-text("개별 응답")');
  await A.waitForSelector('#resContent .resp-row', { timeout: 10000 });
  const ind = await A.innerText('#pageResults');
  ok(/수정됨/.test(ind), '결과(개별 응답)에 "(수정됨)" 표시');

  // ── 수정 허용 안 한 설문: 예전처럼 매번 새 응답 ──
  await openFill(B, 'FN');
  await B.fill('#questionsArea input.inp[type=text]', '하나');
  await submit(B);
  ok(!(await B.isVisible('#editAgainWrap')), '수정 허용 안 한 설문: 수정 버튼 없음');
  await openFill(B, 'FN');
  ok((await B.inputValue('#questionsArea input.inp[type=text]')) === '', '수정 허용 안 한 설문: 다시 열면 빈 칸');
  await B.fill('#questionsArea input.inp[type=text]', '둘');
  await submit(B);
  ok((await responsesOf('FN', 'StuB')).length === 2, '수정 허용 안 한 설문: 새 응답으로 쌓임');

  // ── 비로그인: 수정 허용 설문이어도 새 익명 응답 ──
  const N = await newPage();
  await openFill(N, 'FE');
  ok((await N.inputValue('#questionsArea input.inp[type=text]')) === '', '비로그인: 빈 칸으로 시작');
  await N.fill('#questionsArea input.inp[type=text]', '익명 답');
  await submit(N);
  ok(!(await N.isVisible('#editAgainWrap')), '비로그인: 수정 버튼 없음');
  ok((await responsesOf('FE', 'anonymous')).length === 1, '비로그인: 익명 응답 저장');

  ok(errors.length === 0, '페이지 오류 없음' + (errors.length ? ' — ' + errors.join(' | ') : ''));
} catch (e) {
  fails++; console.log('❌ 중단: ' + e.message);
  if (errors.length) console.log('   페이지 오류: ' + errors.join(' | '));
} finally {
  await browser.close(); srv.close(); await env.cleanup();
}
console.log(fails ? `\n실패 ${fails}건` : '\n전부 통과'); process.exitCode = fails ? 1 : 0;
