// 수행평가 e2e — 실제 교사 화면(ohweb/public/score.html)과 학생 화면(ohinfo/public)을 띄우고
// Firebase 만 에뮬레이터로 바꿔서, 실제 규칙(ohweb-firestore.rules)으로 처음부터 끝까지 돌려 본다.
// 교사: 템플릿 올리기 → 평가 만들기 → 점수 파일 올리기 → 화면에서 고치기(이력) → 반 공개 → 이의신청 확인함
// 학생: 로그인 → 홈 타일 → 내 결과·감점사유 → 이의신청
import { chromium } from 'playwright-core';
import { readFileSync } from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import { initializeTestEnvironment } from '@firebase/rules-unit-testing';
import { doc, setDoc, getDoc, getDocs, collection, query, where } from 'firebase/firestore';

const ADMIN_ROOT = new URL('../ohweb/public', import.meta.url).pathname;
const STU_ROOT = new URL('../ohinfo/public', import.meta.url).pathname;
const FB = new URL('./.fbcdn', import.meta.url).pathname;
const ADMIN_EMAIL = 'qjatjr7575@gmail.com';
const rules = readFileSync(new URL('../ohweb-firestore.rules', import.meta.url), 'utf8');
const env = await initializeTestEnvironment({ projectId: 'ohweb-93062', firestore: { rules, host: '127.0.0.1', port: 8181 } });
await env.clearFirestore();
await fetch('http://127.0.0.1:9099/emulator/v1/projects/ohweb-93062/accounts', { method: 'DELETE' });
await env.withSecurityRulesDisabled(async c => {
  const db = c.firestore();
  const st = (id, number, name, cls = '2') => Promise.all([
    setDoc(doc(db, 'students/' + id), { name, schoolName: 'S중', grade: '1', class: cls, number, registered: true }),
    setDoc(doc(db, 'student_directory/' + id), { schoolName: 'S중', grade: '1', class: cls, number, registered: true, locked: false, failedAttempts: 0 }),
  ]);
  await st('StuA', 3, '김학생'); await st('StuB', 4, '박학생'); await st('StuC', 1, '이학생', '3');
  await setDoc(doc(db, 'appSettings/S중__g1__c2'), { schoolName: 'S중', grade: '1', class: '2', apps: { score: true } });
});
const signUp = async (email, password) => {
  const r = await fetch('http://127.0.0.1:9099/identitytoolkit.googleapis.com/v1/accounts:signUp?key=fake', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ email, password, returnSecureToken: true }) });
  if (!r.ok) throw new Error('signup ' + await r.text());
  return (await r.json()).localId;
};
await signUp('stua@ohinfo.local', 'pass99');
// 관리자는 원래 Google 로그인 — 에뮬레이터에선 이메일 계정을 만들고 인증됨(email_verified)으로 표시한다.
const adminUid = await signUp(ADMIN_EMAIL, 'adminpw1');
await fetch('http://127.0.0.1:9099/identitytoolkit.googleapis.com/v1/projects/ohweb-93062/accounts:update', { method: 'POST', headers: { 'content-type': 'application/json', authorization: 'Bearer owner' }, body: JSON.stringify({ localId: adminUid, emailVerified: true }) });

const conf = signIn => `import { initializeApp } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-app.js";
import { getFirestore, connectFirestoreEmulator } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";
import { getAuth, connectAuthEmulator, signInWithEmailAndPassword } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-auth.js";
const app = initializeApp({ apiKey: 'fake', projectId: 'ohweb-93062', authDomain: 'localhost' });
export const db = getFirestore(app); connectFirestoreEmulator(db, '127.0.0.1', 8181);
export const auth = getAuth(app); connectAuthEmulator(auth, 'http://127.0.0.1:9099', { disableWarnings: true });
${signIn ? `if (!auth.currentUser) await signInWithEmailAndPassword(auth, '${ADMIN_EMAIL}', 'adminpw1');` : ''}`;
const serve = (root, port, signIn) => http.createServer((req, res) => {
  let p = decodeURIComponent(new URL(req.url, 'http://x').pathname);
  if (p === '/') p = '/index.html';
  if (p === '/firebase-config.js') { res.writeHead(200, { 'content-type': 'text/javascript' }); return res.end(conf(signIn)); }
  try { const body = readFileSync(path.join(root, p)); res.writeHead(200, { 'content-type': p.endsWith('.js') ? 'text/javascript' : p.endsWith('.css') ? 'text/css' : 'text/html; charset=utf-8' }); res.end(body); }
  catch { res.writeHead(404); res.end(); }
}).listen(port);
const adminSrv = serve(ADMIN_ROOT, 8098, true), stuSrv = serve(STU_ROOT, 8099, false);

const browser = await chromium.launch(process.env.CHROMIUM_PATH ? { executablePath: process.env.CHROMIUM_PATH } : {});
async function newPage() {
  const ctx = await browser.newContext();
  await ctx.route('**/*', route => {
    const u = route.request().url();
    const m = u.match(/^https:\/\/www\.gstatic\.com\/firebasejs\/10\.12\.2\/([A-Za-z0-9_-]+\.js)$/);
    if (m) return route.fulfill({ status: 200, contentType: 'text/javascript', body: readFileSync(path.join(FB, m[1])) });
    if (u.startsWith('http://localhost:') || u.startsWith('http://127.0.0.1')) return route.continue();
    return route.abort(); // 글꼴 등 외부 요청은 막는다
  });
  const page = await ctx.newPage();
  page.on('pageerror', e => errors.push(e.message));
  page.on('console', m => { if (m.type() === 'error' && !/ERR_FAILED|net::/.test(m.text())) errors.push('console: ' + m.text()); });
  page.on('dialog', d => d.accept());
  return page;
}
const errors = [];
// SHOT=폴더 를 주면 주요 화면을 찍어 둔다(눈으로 확인용).
const shot = async (page, name) => { if (process.env.SHOT) await page.screenshot({ path: path.join(process.env.SHOT, name + '.png'), fullPage: true }); };
let fails = 0; const ok = (c, l) => { if (!c) fails++; console.log((c ? '✅ ' : '❌ ') + l); };
const read = async fn => { let v; await env.withSecurityRulesDisabled(async c => { v = await fn(c.firestore()); }); return v; };
const upload = async (page, clickSel, name, text) => {
  const [fc] = await Promise.all([page.waitForEvent('filechooser'), page.click(clickSel)]);
  await fc.setFiles({ name, mimeType: 'text/csv', buffer: Buffer.from('﻿' + text, 'utf8') });
};

try {
  // ── 교사 ──
  const T = await newPage();
  await T.goto('http://localhost:8098/score.html');
  await T.waitForSelector('#assessList .empty', { timeout: 15000 });
  ok(true, '교사: 수행평가 화면이 열림(빈 목록)');

  await T.click('#tabSeg button[data-tab="tmpl"]');
  await upload(T, '#btnTmplUpload', '감점사유.csv', '과목,코드,사유\n정보,A1,분량 미달\n정보,A2,<b>기한</b> 초과\n정보,A2,중복 줄\n');
  await T.waitForSelector('#tmplOk');
  ok(/4줄.*A2.*두 번/.test(await T.innerText('.msg-list.err')),'교사: 템플릿 미리보기가 잘못된 줄(코드 중복)을 알려줌');
  await T.click('#tmplOk');
  await T.waitForFunction(() => document.querySelectorAll('#tmplList .card').length === 1);
  const tmpl = await read(async db => (await getDocs(collection(db, 'score_templates'))).docs.map(d => d.data()));
  ok(tmpl.length === 1 && tmpl[0].subject === '정보' && tmpl[0].items.length === 2, '교사: 템플릿 저장(정보 2개)');
  ok((await T.innerHTML('#tmplList')).includes('&lt;b&gt;기한'), '교사: 사유 문구의 HTML 은 글자로 보임');

  await T.click('#tabSeg button[data-tab="assess"]');
  await T.click('#btnNewAssess');
  await T.fill('#fTitle', '1차 수행평가');
  await T.fill('#fSubject', '정보');
  await T.fill('#fMax', '20');
  await T.check('.chk-list input[value="S중__g1__c2"]');
  await T.click('#fOk');
  await T.waitForSelector('#dTable table.sc', { timeout: 10000 });
  const aid = await read(async db => (await getDocs(collection(db, 'score_assessments'))).docs[0].id);
  ok(T.url().includes('#a=' + aid), '교사: 평가를 만들면 상세 화면으로 이동');
  ok((await T.$$('#dTable tbody tr[data-sid]')).length === 2, '교사: 대상 반(1-2) 학생 2명이 표에 나옴');

  // 점수 파일 — 1-3반 학생도 있으면 대상 반에 추가된다. 없는 학생·만점 초과는 오류로 빠진다.
  await upload(T, '#btnScoreUpload', '점수.csv', [
    '학교,학년,반,번호,이름,점수,상태,감점코드,메모',
    'S중,1,2,3,김학생,17,,A1;A2,<img src=x onerror=alert(1)>',
    'S중,1,2,4,박학생,,미제출,,',
    'S중,1학년,3반,1,이학생,20,,,',
    'S중,1,2,9,없는애,10,,,',
    'S중,1,2,3,김학생,25,,,',
  ].join('\n'));
  await T.waitForSelector('#upOk');
  const prev = await T.innerText('.modal-body');
  ok(/새로 입력 3/.test(prev) && /오류 2줄/.test(prev) && /대상 반에 추가/.test(prev), '교사: 점수 미리보기(새로 3, 오류 2, 반 추가 안내)');
  await T.click('#upOk');
  await T.waitForFunction(() => !document.getElementById('modal').classList.contains('open'));
  await T.waitForSelector('#dClasses [data-cls="S중__g1__c3"]');
  const rA = await read(async db => (await getDoc(doc(db, 'score_results', `${aid}_StuA`))).data());
  ok(rA.score === 17 && rA.deductions.map(d => d.label).join('|') === '분량 미달|<b>기한</b> 초과' && rA.published === false && rA.title === '1차 수행평가', '교사: 결과 저장(점수·감점 문구 복사·비공개)');
  const rB = await read(async db => (await getDoc(doc(db, 'score_results', `${aid}_StuB`))).data());
  ok(rB.status === 'missing' && rB.score === null, '교사: 미제출 상태는 점수와 따로 저장');

  // 화면에서 고치기 → 이력
  const scoreInput = '#dTable tr[data-sid="StuA"] input[data-f="score"]';
  await T.fill(scoreInput, '30');
  ok(await T.$eval(scoreInput, e => e.classList.contains('bad')), '교사: 만점 초과 점수는 빨간 칸');
  await T.fill(scoreInput, '18');
  await T.waitForSelector('#savebar:not(.hidden)');
  await T.click('#btnSave');
  await T.waitForFunction(() => document.getElementById('savebar').classList.contains('hidden'));
  const hist = await read(async db => (await getDocs(collection(db, 'score_results', `${aid}_StuA`, 'history'))).docs.map(d => d.data()));
  ok(hist.length === 1 && hist[0].before.score === 17 && hist[0].after.score === 18 && /17 → 18/.test(hist[0].summary), '교사: 점수를 고치면 이전 값이 이력에 남음');

  // 반 공개(1-2만)
  await T.click('#dClasses [data-pub="S중__g1__c2"]');
  await T.waitForSelector('#dClasses [data-pub="S중__g1__c2"].on');
  const pubs = await read(async db => Object.fromEntries((await getDocs(query(collection(db, 'score_results'), where('assessmentId', '==', aid)))).docs.map(d => [d.data().studentId, d.data().published])));
  await shot(T, '1-teacher-detail');
  ok(pubs.StuA === true && pubs.StuB === true && pubs.StuC === false, '교사: 1-2반만 공개(1-3반은 비공개 유지)');

  // ── 학생 ──
  const S = await newPage();
  await S.goto('http://localhost:8099/index.html');
  await S.waitForFunction(() => document.querySelectorAll('#loginSchool option').length > 1, null, { timeout: 15000 });
  await S.selectOption('#loginSchool', 'S중'); await S.waitForTimeout(300);
  await S.selectOption('#loginGrade', '1'); await S.waitForTimeout(200);
  await S.selectOption('#loginClass', '2'); await S.waitForTimeout(300);
  await S.selectOption('#loginNumber', '3');
  await S.fill('#loginPw', 'pass99');
  await S.evaluate(() => window.doLogin());
  await S.waitForURL(/home\.html/, { timeout: 15000 });
  await S.waitForSelector('#appGrid a[href="score.html"]', { timeout: 10000 });
  ok(true, '학생: 홈에 수행평가 타일(반별 앱 설정)');
  await S.click('#appGrid a[href="score.html"]');
  await S.waitForSelector('#list .item', { timeout: 10000 });
  const listText = await S.innerText('#list');
  await shot(S, '2-student-list');
  ok(/1차 수행평가/.test(listText) && /18/.test(listText) && /\/ 20/.test(listText), '학생: 목록에 공개된 내 점수 18/20');
  await S.click('#list .item');
  await S.waitForSelector('#detail .d-score');
  const det = await S.innerText('#detail');
  ok(/분량 미달/.test(det) && /<b>기한<\/b> 초과/.test(det), '학생: 감점사유 문구가 그대로 보임');
  ok((await S.innerHTML('#detail')).includes('&lt;img src=x'), '학생: 메모의 HTML 은 실행되지 않고 글자로 보임');
  await S.fill('#dispText', 'A2 기한 초과가 아닌 것 같아요');
  await S.click('#dispSend');
  await S.waitForFunction(() => /보냈어요/.test(document.getElementById('dispMsg')?.innerText || ''), null, { timeout: 10000 });
  const disp = await read(async db => (await getDoc(doc(db, 'score_results', `${aid}_StuA`))).data().dispute);
  await shot(S, '3-student-detail');
  ok(disp && disp.text === 'A2 기한 초과가 아닌 것 같아요' && disp.checked === false, '학생: 이의신청 저장');

  // ── 교사: 이의신청 확인함 ──
  await T.reload();
  await T.waitForSelector('#dTable tr[data-sid="StuA"] [data-act="disp"]', { timeout: 10000 });
  await T.click('#dTable tr[data-sid="StuA"] [data-act="disp"]');
  ok(/기한 초과가 아닌 것 같아요/.test(await T.innerText('.quote')), '교사: 이의신청 내용이 보임');
  await T.click('#dispOk');
  await T.waitForSelector('#dTable tr[data-sid="StuA"] [data-act="disp"]:not(.warn)', { timeout: 10000 });
  const disp2 = await read(async db => (await getDoc(doc(db, 'score_results', `${aid}_StuA`))).data().dispute);
  ok(disp2.checked === true, '교사: 확인함 표시 저장');

  // 학생 화면에도 반영
  await S.reload();
  await S.waitForSelector('#detail .d-score', { timeout: 10000 });
  ok(/선생님 확인함/.test(await S.innerText('#detail')), '학생: 이의신청이 "선생님 확인함"으로 바뀜');

  ok(errors.length === 0, '페이지 오류 없음' + (errors.length ? ' — ' + errors.join(' | ') : ''));
} catch (e) {
  fails++; console.log('❌ 중단: ' + e.message);
  if (errors.length) console.log('   페이지 오류: ' + errors.join(' | '));
} finally {
  await browser.close(); adminSrv.close(); stuSrv.close(); await env.cleanup();
}
console.log(fails ? `\n실패 ${fails}건` : '\n전부 통과'); process.exitCode = fails ? 1 : 0;
