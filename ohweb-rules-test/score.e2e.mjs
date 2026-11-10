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

// 가짜 Apps Script(score-drive.gs 와 같은 판단): 부른 사람의 토큰으로 에뮬레이터 Firestore 를
// 읽어 보고(=실제 규칙이 판단), 결과 문서의 files 에 있는 파일만 돌려준다.
const PNG = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==';
const FAKE_FILES = [
  { id: 'F_A2', name: '20261104_10203_김학생_2.png', mimeType: 'image/png', size: 70, path: '스크래치2/2반' },
  { id: 'F_A1', name: '20261104_10203_김학생.png', mimeType: 'image/png', size: 70, path: '스크래치2/2반' },
  { id: 'F_B', name: '20261104_10204_박학생.txt', mimeType: 'text/plain', size: 20, path: '스크래치2/2반' },
  { id: 'F_X', name: '안내.png', mimeType: 'image/png', size: 70, path: '스크래치2' },
];
async function fakeGas(req) {
  const read = p => fetch(`http://127.0.0.1:8181/v1/projects/ohweb-93062/databases/(default)/documents/${p}`, { headers: { Authorization: 'Bearer ' + req.idToken } });
  if (req.action === 'list') {
    const r = await read('score_assessments/' + req.aid);
    return r.ok ? { folders: [{ id: 'FOLDER', name: '스크래치 2차' }], files: FAKE_FILES, truncated: false } : { error: 'auth: 볼 수 있는 권한이 없습니다', code: 'auth' };
  }
  if (req.action === 'file') {
    const r = await read('score_results/' + req.rid);
    if (!r.ok) return { error: 'auth: 볼 수 있는 권한이 없습니다', code: 'auth' };
    const d = await r.json();
    const ids = (d.fields?.files?.arrayValue?.values || []).map(v => v.mapValue.fields.id.stringValue);
    if (!ids.includes(req.fileId)) return { error: 'auth: 이 결과에 연결된 파일이 아닙니다', code: 'auth' };
    const f = FAKE_FILES.find(x => x.id === req.fileId);
    return f.mimeType.startsWith('text/') ? { name: f.name, mimeType: f.mimeType, text: '학생이 쓴 설명글' } : { name: f.name, mimeType: f.mimeType, size: f.size, data: PNG };
  }
  return { error: 'badRequest', code: 'badRequest' };
}
const idTokenOf = async (email, password) => (await (await fetch('http://127.0.0.1:9099/identitytoolkit.googleapis.com/v1/accounts:signInWithPassword?key=fake', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ email, password, returnSecureToken: true }) })).json()).idToken;

const browser = await chromium.launch(process.env.CHROMIUM_PATH ? { executablePath: process.env.CHROMIUM_PATH } : {});
async function newPage() {
  const ctx = await browser.newContext();
  await ctx.route('**/*', route => {
    const u = route.request().url();
    const m = u.match(/^https:\/\/www\.gstatic\.com\/firebasejs\/10\.12\.2\/([A-Za-z0-9_-]+\.js)$/);
    if (m) return route.fulfill({ status: 200, contentType: 'text/javascript', body: readFileSync(path.join(FB, m[1])) });
    if (/^https:\/\/script\.google\.com\/macros\//.test(u)) return fakeGas(JSON.parse(route.request().postData() || '{}')).then(out => route.fulfill({ status: 200, contentType: 'application/json', headers: { 'access-control-allow-origin': '*' }, body: JSON.stringify(out) }));
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

  // ── 2차: 채점 시트(상세 탭) 그대로 올리기 + 제출물 연결 ──
  await T.goto('http://localhost:8098/score.html');
  await T.waitForSelector('#assessList .a-card', { timeout: 15000 });
  await T.click('#btnNewAssess');
  await T.fill('#fTitle', '2차 수행평가');
  await T.fill('#fSubject', '정보');
  await T.check('.chk-list input[value="S중__g1__c2"]');
  await T.click('#fOk');
  await T.waitForSelector('#dTable table.sc', { timeout: 10000 });
  const aid2 = await read(async db => (await getDocs(query(collection(db, 'score_assessments'), where('title', '==', '2차 수행평가')))).docs[0].id);
  await upload(T, '#btnScoreUpload', '2차 상세.csv', [
    '학번,이름,① 알고리즘 설계(10),② 중첩 제어 구조(10),③ 프로그램 완성(10),2차 합계(30),① 감점 사유,② 감점 사유,③ 감점 사유,비고',
    '10203,김학생,10,10,8,28,감점 없음,감점 없음,함수 호출 인자 오류로 도형이 안 그려짐,기준상 6점이나 후하게 8점',
    '10204,박학생,10,10,10,30,감점 없음,감점 없음,감점 없음,',
  ].join('\n'));
  await T.waitForSelector('#upOk');
  const prev2 = await T.innerText('.modal-body');
  ok(/파일 머리글대로/.test(prev2) && /만점 30/.test(prev2) && /비고/.test(prev2), '교사: 채점 시트를 올리면 항목(①②③)과 만점 30을 파일대로 정하겠다고 안내');
  await T.click('#upOk');
  await T.waitForFunction(() => !document.getElementById('modal').classList.contains('open'));
  await T.waitForSelector('#dTable td.crit-cell');
  const a2 = await read(async db => (await getDoc(doc(db, 'score_assessments', aid2))).data());
  ok(a2.criteria.length === 3 && a2.maxScore === 30 && a2.criteria[2].label === '프로그램 완성', '교사: 평가 항목·만점 저장');
  const r2 = await read(async db => (await getDoc(doc(db, 'score_results', `${aid2}_StuA`))).data());
  ok(r2.score === 28 && r2.items[2].score === 8 && /함수 호출/.test(r2.items[2].reason) && r2.items[0].reason === '' && !('note' in r2) && r2.maxScore === 30, '교사: 항목별 점수·사유 저장("감점 없음"은 빈칸), 결과 문서에 비고 없음');
  const n2 = await read(async db => (await getDoc(doc(db, 'score_notes', aid2))).data());
  ok(/후하게/.test(n2.notes.StuA), '교사: 비고는 선생님 전용 문서에 저장');
  ok((await T.$$('#dTable td.crit-cell')).length === 6 && /28/.test(await T.innerText('#dTable tr[data-sid="StuA"] [data-total]')), '교사: 표에 항목 칸·합계가 보임');
  // 항목 점수를 표에서 고치면 합계가 따라 바뀌고 이력이 남는다
  await T.fill('#dTable tr[data-sid="StuA"] input[data-f="item"][data-i="2"]', '9');
  ok((await T.innerText('#dTable tr[data-sid="StuA"] [data-total]')).trim() === '29', '교사: 항목 점수를 고치면 합계가 바로 바뀜');
  await T.click('#btnSave');
  await T.waitForFunction(() => document.getElementById('savebar').classList.contains('hidden'));
  const h2 = await read(async db => (await getDocs(collection(db, 'score_results', `${aid2}_StuA`, 'history'))).docs.map(d => d.data()));
  ok(h2.length === 1 && /③ 8 → 9/.test(h2[0].summary), '교사: 항목 점수 변경도 이력에 남음');

  // 제출물 연결
  await T.click('#btnFiles');
  await T.fill('#drvFolders', 'https://drive.google.com/drive/folders/FOLDER');
  await T.click('#drvLoad');
  await T.waitForSelector('#drvSave', { timeout: 10000 });
  const drv = await T.innerText('#drvResult');
  ok(/학생 2명 · 파일 3개/.test(drv) && /못 붙인 파일 1/.test(drv) && /이름에 학번이 없음/.test(drv), '교사: 드라이브 폴더 → 학번으로 2명·3개 연결, 학번 없는 파일 알림');
  await T.click('#drvSave');
  await T.waitForFunction(() => !document.getElementById('modal').classList.contains('open'));
  const fa = await read(async db => (await getDoc(doc(db, 'score_results', `${aid2}_StuA`))).data().files);
  ok(fa.map(f => f.id).join() === 'F_A1,F_A2', '교사: 학생별 제출물 저장(본 파일 먼저, _2 다음)');
  await T.click('#dTable tr[data-sid="StuA"] [data-act="files"]');
  await T.waitForSelector('.modal-body img.file-img', { timeout: 10000 });
  ok(true, '교사: 제출물 미리보기(그림)');
  await T.click('.modal-foot [data-close]');
  await T.click('#dClasses [data-pub="S중__g1__c2"]');
  await T.waitForSelector('#dClasses [data-pub="S중__g1__c2"].on');

  // 학생: 항목별 점수 + 내 제출물
  await S.goto('http://localhost:8099/score.html');
  await S.waitForSelector('#list .item', { timeout: 10000 });
  await S.click('#list .item:has-text("2차 수행평가")');
  await S.waitForSelector('#detail .crit');
  const det2 = await S.innerText('#detail');
  ok(/항목별 점수/.test(det2) && /프로그램 완성/.test(det2) && /함수 호출 인자 오류/.test(det2) && /29/.test(det2), '학생: 항목별 점수·사유가 보임');
  ok(!/후하게/.test(det2), '학생: 비고(선생님 메모)는 안 보임');
  await S.waitForFunction(() => document.querySelectorAll('#detail img.file-img').length === 2, null, { timeout: 10000 });
  ok(true, '학생: 내 제출물 그림 2장이 보임');
  ok((await S.$$('#detail a[download]')).length === 0, '학생: 내려받기 버튼 없음');
  await S.click('#detail img.file-img');
  await S.waitForSelector('.sv-back .sv-body img', { timeout: 5000 });
  ok(/김학생\.png/.test(await S.innerText('.sv-title')), '학생: 그림을 누르면 그 자리에서 팝업으로 크게 보임');
  await S.keyboard.press('Escape');
  await S.waitForSelector('.sv-back', { state: 'detached', timeout: 5000 });
  ok(/시험 점수 확인/.test(await S.innerText('#navTitle')), '학생: 화면 제목이 "시험 점수 확인"');
  await shot(S, '4-student-items-files');
  await shot(T, '5-teacher-items');
  // 다른 학생 파일은 못 받는다(진짜 규칙이 판단)
  const tokA = await idTokenOf('stua@ohinfo.local', 'pass99');
  const steal = await fakeGas({ action: 'file', idToken: tokA, rid: `${aid2}_StuB`, fileId: 'F_B' });
  const steal2 = await fakeGas({ action: 'file', idToken: tokA, rid: `${aid2}_StuA`, fileId: 'F_B' });
  const steal3 = await fakeGas({ action: 'list', idToken: tokA, aid: aid2, folders: ['FOLDER'] });
  ok(!!steal.error && !!steal2.error && !!steal3.error, '학생: 남의 결과·남의 파일·폴더 목록 요청은 거부');

  // ── 시험에서 가져오기 ── 1학년 전체 배정: 김학생(채점 끝), 박학생(채점 중), 이학생(안 봄)
  await env.withSecurityRulesDisabled(async c => {
    const db = c.firestore();
    await setDoc(doc(db, 'exams/EXM'), { title: '정보 기말고사' });
    await setDoc(doc(db, 'exam_questions/QM1'), { examId: 'EXM', order: 1, type: 'mc', title: '변수란 무엇인가', options: ['가', '나'], points: 10 });
    await setDoc(doc(db, 'exam_questions/QM2'), { examId: 'EXM', order: 2, type: 'code', title: '합 구하기', points: 10 });
    await setDoc(doc(db, 'exam_assignments/ASM'), { examId: 'EXM', schoolName: 'S중', grade: '1', class: '', status: 'OFF' });
    await setDoc(doc(db, 'exam_progress/ASM_StuA'), { asId: 'ASM', studentId: 'StuA', status: 'submitted', totalScore: 5, totalPoints: 20, needsManual: false });
    await setDoc(doc(db, 'exam_results/ASM_StuA_0'), { asId: 'ASM', studentId: 'StuA', questionId: 'QM1', qIdx: 0, type: 'mc', value: '1', score: 0, maxScore: 10, feedback: '', check: 'wrong' });
    await setDoc(doc(db, 'exam_results/ASM_StuA_1'), { asId: 'ASM', studentId: 'StuA', questionId: 'QM2', qIdx: 1, type: 'code', value: 'x', score: 5, maxScore: 10, feedback: 'cases:1/2' });
    await setDoc(doc(db, 'exam_progress/ASM_StuB'), { asId: 'ASM', studentId: 'StuB', status: 'submitted', totalScore: 0, totalPoints: 20, needsManual: true });
    await setDoc(doc(db, 'exam_results/ASM_StuB_0'), { asId: 'ASM', studentId: 'StuB', questionId: 'QM1', qIdx: 0, type: 'mc', value: '0', score: 0, maxScore: 10, feedback: 'manual', check: 'correct' });
    await setDoc(doc(db, 'exam_results/ASM_StuB_1'), { asId: 'ASM', studentId: 'StuB', questionId: 'QM2', qIdx: 1, type: 'code', value: 'y', score: 0, maxScore: 10, feedback: 'manual' });
  });
  await T.goto('http://localhost:8098/score.html');
  await T.waitForSelector('#assessList .a-card', { timeout: 15000 });
  await T.click('#btnFromExam');
  await T.waitForSelector('#feExam option[value="EXM"]', { state: 'attached', timeout: 10000 });
  await T.selectOption('#feExam', 'EXM');
  await T.click('#feLoad');
  await T.waitForSelector('#feSave', { timeout: 10000 });
  const fe = await T.innerText('#fePrev');
  ok(/채점 끝난 응시 1명/.test(fe) && /미제출 1명/.test(fe) && /채점 중 1명/.test(fe) && /만점 20/.test(fe), '교사: 시험에서 가져오기 미리보기(응시 1·미제출 1·채점 중 1 제외, 만점 20)');
  await T.click('#feSave');
  await T.waitForSelector('#dTable td.crit-cell', { timeout: 10000 });
  const aid3 = await read(async db => (await getDocs(query(collection(db, 'score_assessments'), where('title', '==', '정보 기말고사')))).docs[0].id);
  const [a3, e1, e3] = await read(async db => Promise.all([getDoc(doc(db, 'score_assessments', aid3)), getDoc(doc(db, 'score_results', `${aid3}_StuA`)), getDoc(doc(db, 'score_results', `${aid3}_StuC`))]).then(x => x.map(d => d.data())));
  ok(a3.source.examId === 'EXM' && a3.criteria.length === 2 && a3.maxScore === 20 && a3.classKeys.length === 2, '교사: 시험 → 평가(출처·문항 2개 항목·만점 20·대상 반 2개)');
  ok(e1.score === 5 && e1.items[0].reason === '오답' && e1.items[1].reason === '테스트 1/2 통과' && e1.fromExam === true && e3.status === 'missing', '교사: 문항 점수·안전한 사유(정답 번호 없음)·미제출 상태');
  ok(!(await read(async db => (await getDoc(doc(db, 'score_results', `${aid3}_StuB`))).exists())), '교사: 채점 중인 학생은 가져오지 않음');
  // 박학생 채점이 끝난 뒤 다시 가져오기
  await env.withSecurityRulesDisabled(async c => {
    const db = c.firestore();
    await setDoc(doc(db, 'exam_results/ASM_StuB_0'), { score: 10, feedback: '' }, { merge: true });
    await setDoc(doc(db, 'exam_results/ASM_StuB_1'), { score: 7, feedback: '반복문은 맞지만 출력 형식이 다름' }, { merge: true });
    await setDoc(doc(db, 'exam_progress/ASM_StuB'), { totalScore: 17, needsManual: false }, { merge: true });
  });
  await T.click('#btnResync');
  await T.waitForSelector('#rsOk', { timeout: 10000 });
  ok(/새로 1/.test(await T.innerText('.modal-body')), '교사: 다시 가져오기 — 늦게 채점한 학생 1명 새로');
  await T.click('#rsOk');
  await T.waitForFunction(() => !document.getElementById('modal').classList.contains('open'));
  const e2 = await read(async db => (await getDoc(doc(db, 'score_results', `${aid3}_StuB`))).data());
  ok(e2.score === 17 && e2.items[0].reason === '' && /출력 형식/.test(e2.items[1].reason), '교사: 다시 가져오기 반영(선생님 피드백은 사유로)');
  await T.click('#dClasses [data-pub="S중__g1__c2"]');
  await T.waitForSelector('#dClasses [data-pub="S중__g1__c2"].on');
  await S.goto('http://localhost:8099/score.html');
  await S.waitForSelector('#list .item', { timeout: 10000 });
  await S.click('#list .item:has-text("정보 기말고사")');
  await S.waitForSelector('#detail .crit');
  ok(/테스트 1\/2 통과/.test(await S.innerText('#detail')) && (await S.$$('#detail a[href="exam.html"]')).length === 1, '학생: 시험에서 온 평가 — 문항별 점수·사유, 시험 화면 링크');

  ok(errors.length === 0, '페이지 오류 없음' + (errors.length ? ' — ' + errors.join(' | ') : ''));
} catch (e) {
  fails++; console.log('❌ 중단: ' + e.message);
  if (errors.length) console.log('   페이지 오류: ' + errors.join(' | '));
} finally {
  await browser.close(); adminSrv.close(); stuSrv.close(); await env.cleanup();
}
console.log(fails ? `\n실패 ${fails}건` : '\n전부 통과'); process.exitCode = fails ? 1 : 0;
