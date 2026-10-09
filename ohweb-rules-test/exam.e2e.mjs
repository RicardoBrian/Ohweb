import { chromium } from 'playwright-core';
import { readFileSync } from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import { initializeTestEnvironment } from '@firebase/rules-unit-testing';
import { doc, setDoc, getDoc } from 'firebase/firestore';

// 실제 배포되는 ohinfo/public을 그대로 띄우고, Firebase CDN만 npm 패키지 묶음(.fbcdn)으로,
// firebase-config.js만 에뮬레이터 연결용으로 바꿔치기한다. 채점 서버(/api/grade-exam)는 모의 응답.
const ROOT = new URL('../ohinfo/public', import.meta.url).pathname;
const FB = new URL('./.fbcdn', import.meta.url).pathname;
const PHASE = process.env.PHASE === '2' ? 2 : 1;
let rules = readFileSync(new URL('../ohweb-firestore.rules', import.meta.url), 'utf8');
if (PHASE === 2) rules = rules.replace(/allow read: if true; \/\/ PHASE2: (allow read: if [^;]+;)/, '$1');
const env = await initializeTestEnvironment({ projectId: 'ohweb-93062', firestore: { rules, host: '127.0.0.1', port: 8181 } });
await env.clearFirestore();
await fetch('http://127.0.0.1:9099/emulator/v1/projects/ohweb-93062/accounts', { method: 'DELETE' });
await env.withSecurityRulesDisabled(async c => {
  const db = c.firestore();
  await setDoc(doc(db, 'students/StuA'), { name: '김학생', schoolName: 'S중', grade: '1', class: '2', number: 3, registered: true });
  await setDoc(doc(db, 'student_directory/StuA'), { schoolName: 'S중', grade: '1', class: '2', number: 3, registered: true, locked: false, failedAttempts: 0 });
  await setDoc(doc(db, 'exams/EX1'), { title: '중간고사' });
  await setDoc(doc(db, 'exam_questions/Q1'), { examId: 'EX1', order: 1, type: 'mc', title: '1+1?', options: ['2', '3'], points: 10 });
  await setDoc(doc(db, 'exam_questions/Q2'), { examId: 'EX1', order: 2, type: 'essay', title: '서술', points: 20 });
  await setDoc(doc(db, 'student_forms/F1'), { ownerId: 'StuA', title: '좋아하는 과목', status: 'open', responseCount: 0, questions: [{ id: 'q1', type: 'mc', text: '좋아하는 과목은?', options: ['정보', '수학'] }] });
  await setDoc(doc(db, 'exam_assignments/AS1'), { examId: 'EX1', code: 'ABC', status: 'ON', grade: '1', class: '2', schoolName: 'S중', duration: 10 });
});
const sr = await fetch('http://127.0.0.1:9099/identitytoolkit.googleapis.com/v1/accounts:signUp?key=fake', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ email: 'stua@ohinfo.local', password: 'pass99', returnSecureToken: true }) });
if (!sr.ok) throw new Error('signup ' + await sr.text());

const fbconf = `import { initializeApp } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-app.js";
import { getFirestore, connectFirestoreEmulator } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";
import { getAuth, connectAuthEmulator } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-auth.js";
const app = initializeApp({ apiKey: 'fake', projectId: 'ohweb-93062', authDomain: 'localhost' });
export const db = getFirestore(app); connectFirestoreEmulator(db, '127.0.0.1', 8181);
export const auth = getAuth(app); connectAuthEmulator(auth, 'http://127.0.0.1:9099', { disableWarnings: true });`;
const server = http.createServer((req, res) => {
  let p = decodeURIComponent(new URL(req.url, 'http://x').pathname);
  if (p === '/') p = '/index.html';
  if (p === '/firebase-config.js') { res.writeHead(200, { 'content-type': 'text/javascript' }); return res.end(fbconf); }
  try { const body = readFileSync(path.join(ROOT, p)); res.writeHead(200, { 'content-type': p.endsWith('.js') ? 'text/javascript' : p.endsWith('.css') ? 'text/css' : 'text/html; charset=utf-8' }); res.end(body); }
  catch { res.writeHead(404); res.end(); }
}).listen(8099);

const browser = await chromium.launch(process.env.CHROMIUM_PATH ? { executablePath: process.env.CHROMIUM_PATH } : {});
const ctx = await browser.newContext();
let gradeBody = null;
await ctx.route('**/*', async route => {
  const u = route.request().url();
  const m = u.match(/^https:\/\/www\.gstatic\.com\/firebasejs\/10\.12\.2\/([A-Za-z0-9_-]+\.js)$/);
  if (m) return route.fulfill({ status: 200, contentType: 'text/javascript', body: readFileSync(path.join(FB, m[1])) });
  if (u.includes('/api/grade-exam')) { gradeBody = JSON.parse(route.request().postData()); return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ ok: true, totalScore: 10, totalPoints: 30, needsManual: true, items: [] }) }); }
  if (u.startsWith('http://localhost:8099') || u.startsWith('http://127.0.0.1')) return route.continue();
  return route.abort();
});
const page = await ctx.newPage();
const errors = [];
page.on('pageerror', e => errors.push(e.message));
page.on('console', m => { if (m.type() === 'error') errors.push('console: ' + m.text()); });
page.on('dialog', d => d.accept());
let fails = 0; const ok = (c, l) => { if (!c) fails++; console.log((c ? '✅ ' : '❌ ') + l); };

// 1) 로그인 (index.html)
await page.goto('http://localhost:8099/index.html');
await page.waitForFunction(() => document.querySelectorAll('#loginSchool option').length > 1, null, { timeout: 15000 });
await page.selectOption('#loginSchool', 'S중');
await page.waitForTimeout(300);
await page.selectOption('#loginGrade', '1'); await page.waitForTimeout(200);
await page.selectOption('#loginClass', '2'); await page.waitForTimeout(300);
await page.selectOption('#loginNumber', '3');
await page.fill('#loginPw', 'pass99');
await page.evaluate(() => window.doLogin());
await page.waitForURL(/home\.html/, { timeout: 15000 });
const sess = await page.evaluate(() => JSON.parse(localStorage.getItem('ohinfo_student')));
ok(sess?.name === '김학생' && !('password' in sess), `[${PHASE}단계] 로그인 성공, 세션에 이름(본인 문서) 포함`);

// 2) 시험 목록 → 코드 입장
await page.goto('http://localhost:8099/exam.html');
await page.waitForSelector('#code_AS1', { timeout: 15000 });
ok(true, '시험 목록에 배정된 시험 표시');
await page.fill('#code_AS1', 'ABC');
await page.evaluate(() => enterExamWithCode('AS1', 'ABC'));
await page.waitForSelector('#step2:not(.hidden)', { timeout: 15000 });
await page.waitForFunction(() => /\d\d:\d\d/.test(document.getElementById('timerBadge').innerText));
const t1 = await page.textContent('#timerBadge');
ok(t1 === '10:00' || t1 === '09:59', '첫 입장 타이머 10분 (' + t1 + ')');
let progStart1; await env.withSecurityRulesDisabled(async c => { progStart1 = (await getDoc(doc(c.firestore(), 'exam_progress/AS1_StuA'))).data(); });
ok(progStart1?.startTime && progStart1.status === 'started', '진행 기록 생성 + 시작 시각 기록');
// 답 입력
await page.evaluate(() => selectMC(0, 0));
await page.fill('#essay_1', '자동저장 확인용 서술 답안');
await page.dispatchEvent('#essay_1', 'input');
await page.waitForTimeout(3500);

// 3) 새로고침 → 재입장 → 타이머 이어짐 + 답안 복원
await page.reload();
await page.waitForSelector('#code_AS1', { timeout: 15000 });
await page.evaluate(() => enterExamWithCode('AS1', 'ABC'));
await page.waitForSelector('#step2:not(.hidden)', { timeout: 15000 });
await page.waitForFunction(() => /\d\d:\d\d/.test(document.getElementById('timerBadge').innerText));
const t2 = await page.textContent('#timerBadge');
const secs = s => { const [m, x] = s.split(':').map(Number); return m * 60 + x; };
ok(secs(t2) <= secs(t1) - 3, `새로고침 후 타이머 이어짐 (${t1} → ${t2}, 처음부터 다시 시작 안 함)`);
let progStart2; await env.withSecurityRulesDisabled(async c => { progStart2 = (await getDoc(doc(c.firestore(), 'exam_progress/AS1_StuA'))).data(); });
ok(progStart2.startTime.toMillis() === progStart1.startTime.toMillis(), '재입장해도 시작 시각 그대로');
ok((await page.inputValue('#essay_1')) === '자동저장 확인용 서술 답안', '새로고침 후 서술형 답안 복원');
ok(await page.evaluate(() => document.querySelector('.mc-opt.selected') !== null), '새로고침 후 객관식 선택 복원');

// 4) 제출
await page.evaluate(() => submitExam());
await page.waitForSelector('#step3:not(.hidden)', { timeout: 15000 });
ok(gradeBody?.answers?.[0]?.value === 0 && /자동저장/.test(gradeBody?.answers?.[1]?.value), '채점 서버로 답안 전송');
ok(/선생님/.test(await page.textContent('#resultDetails')), '서술형 포함 → "채점 대기" 화면');

// 5) 시간 초과된 시험에 재입장 → 즉시 자동 제출
await env.withSecurityRulesDisabled(async c => { await setDoc(doc(c.firestore(), 'exam_progress/AS1_StuA'), { status: 'started', startTime: new Date(Date.now() - 11 * 60000) }, { merge: true }); });
gradeBody = null;
await page.goto('http://localhost:8099/exam.html');
await page.waitForSelector('#code_AS1', { timeout: 15000 });
await page.evaluate(() => enterExamWithCode('AS1', 'ABC'));
await page.waitForSelector('#step3:not(.hidden)', { timeout: 15000 });
ok(gradeBody !== null, '제한시간 지난 뒤 재입장 → 저장된 답으로 즉시 자동 제출');

// 6) 로그인 화면 통합: 로그아웃 상태로 설문 링크 → 로그인 화면(index) → 로그인 → 다시 그 설문
{
  const ctx2 = await browser.newContext();
  await ctx2.route('**/*', async route => {
    const u = route.request().url();
    const m = u.match(/^https:\/\/www\.gstatic\.com\/firebasejs\/10\.12\.2\/([A-Za-z0-9_-]+\.js)$/);
    if (m) return route.fulfill({ status: 200, contentType: 'text/javascript', body: readFileSync(path.join(FB, m[1])) });
    if (u.startsWith('http://localhost:8099') || u.startsWith('http://127.0.0.1')) return route.continue();
    return route.abort();
  });
  const p2 = await ctx2.newPage();
  p2.on('pageerror', e => errors.push(e.message));
  await p2.goto('http://localhost:8099/formfill.html?id=F1');
  await p2.waitForURL(/index\.html/, { timeout: 15000 });
  ok(await p2.isVisible('#redirectNotice'), '로그아웃 상태 설문 링크 → 통합 로그인 화면 + "보던 페이지로 돌아갑니다" 안내');
  await p2.goto('http://localhost:8099/login.html');
  await p2.waitForURL(/index\.html/, { timeout: 15000 });
  ok(true, '옛 login.html 주소 → 통합 로그인 화면으로 이동');
  await p2.waitForFunction(() => document.querySelectorAll('#loginSchool option').length > 1, null, { timeout: 15000 });
  await p2.selectOption('#loginSchool', 'S중'); await p2.waitForTimeout(300);
  await p2.selectOption('#loginGrade', '1'); await p2.waitForTimeout(200);
  await p2.selectOption('#loginClass', '2'); await p2.waitForTimeout(300);
  await p2.selectOption('#loginNumber', '3');
  await p2.fill('#loginPw', 'pass99');
  await p2.evaluate(() => window.doLogin());
  await p2.waitForURL(/formfill\.html\?id=F1/, { timeout: 15000 });
  await p2.waitForSelector('#pageFill:not(.hidden)', { timeout: 15000 });
  ok((await p2.title()) === '좋아하는 과목 — kakainfo', '로그인 후 원래 설문으로 복귀 + 탭 제목 "설문 제목 — kakainfo"');
  await ctx2.close();
}

const realErr = errors.filter(e => !/net::ERR_FAILED|Failed to load resource|ERR_BLOCKED|CodeMirror script not ready|Could not reach Cloud Firestore backend/.test(e));
ok(realErr.length === 0, '페이지 스크립트 오류 없음' + (realErr.length ? ' — ' + realErr.slice(0, 5).join(' | ') : ''));
console.log(fails ? `실패 ${fails}건` : '전부 통과');
await browser.close(); server.close(); await env.cleanup(); process.exit(fails ? 1 : 0);
