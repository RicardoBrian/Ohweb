import { chromium } from 'playwright-core';
import { readFileSync } from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import { initializeTestEnvironment } from '@firebase/rules-unit-testing';
import { doc, setDoc, getDoc, getDocs, collection, query, where, updateDoc } from 'firebase/firestore';
import { onRequest as examApiHandler } from '../ohinfo/functions/api/exam.js';

// 실제 배포되는 ohinfo/public을 그대로 띄우고, Firebase CDN만 npm 패키지 묶음(.fbcdn)으로,
// firebase-config.js만 에뮬레이터 연결용으로 바꿔치기한다. 시험 서버(/api/exam)는 실제
// ohinfo/functions/api/exam.js를 에뮬레이터에 붙여서 돌린다(코드 실행 서버 Piston만 모의 응답).
// CodeMirror도 CDN 대신 npm 패키지를 내려준다 — 언어 전환 때 에디터가 다시 붙는지 봐야 한다.
const ROOT = new URL('../ohinfo/public', import.meta.url).pathname;
const FB = new URL('./.fbcdn', import.meta.url).pathname;
const CM = new URL('./node_modules/codemirror', import.meta.url).pathname;
const PHASE = process.env.PHASE === '2' ? 2 : 1;
let rules = readFileSync(new URL('../ohweb-firestore.rules', import.meta.url), 'utf8');
if (PHASE === 2) rules = rules.replace(/allow read: if true; \/\/ PHASE2: (allow read: if [^;]+;)/, '$1');
const env = await initializeTestEnvironment({ projectId: 'ohweb-93062', firestore: { rules, host: '127.0.0.1', port: 8181 } });
await env.clearFirestore();
await fetch('http://127.0.0.1:9099/emulator/v1/projects/ohweb-93062/accounts', { method: 'DELETE' });
const minsAgo = m => new Date(Date.now() - m * 60000);
await env.withSecurityRulesDisabled(async c => {
  const db = c.firestore();
  await setDoc(doc(db, 'students/StuA'), { name: '김학생', schoolName: 'S중', grade: '1', class: '2', number: 3, registered: true });
  await setDoc(doc(db, 'student_directory/StuA'), { schoolName: 'S중', grade: '1', class: '2', number: 3, registered: true, locked: false, failedAttempts: 0 });
  // EX1: 객관식 + 서술형 + 코딩. 보기에 HTML처럼 생긴 글자를 넣어 이스케이프를 본다.
  await setDoc(doc(db, 'exams/EX1'), { title: '중간고사' });
  await setDoc(doc(db, 'exam_questions/Q1'), { examId: 'EX1', order: 1, type: 'mc', title: '1+1?', options: ['2', '<b>3</b>'], points: 10 });
  await setDoc(doc(db, 'exam_answers/Q1'), { examId: 'EX1', answer: '0', testCases: [] });
  await setDoc(doc(db, 'exam_questions/Q2'), { examId: 'EX1', order: 2, type: 'essay', title: '서술', points: 20 });
  await setDoc(doc(db, 'exam_questions/Q3'), { examId: 'EX1', order: 3, type: 'code', title: 'hi 출력', points: 10, boilerplate: "print('hi')" });
  await setDoc(doc(db, 'exam_answers/Q3'), { examId: 'EX1', answer: '', testCases: [{ input: '', expected: 'hi' }] });
  // EX2: 객관식 둘(배점이 달라서, 답이 엉뚱한 문항에 채점되면 점수로 드러난다)
  await setDoc(doc(db, 'exams/EX2'), { title: '쪽지시험' });
  await setDoc(doc(db, 'exam_questions/Q4'), { examId: 'EX2', order: 1, type: 'mc', title: '첫 문제', options: ['가', '나'], points: 10 });
  await setDoc(doc(db, 'exam_answers/Q4'), { examId: 'EX2', answer: '0', testCases: [] });
  await setDoc(doc(db, 'exam_questions/Q5'), { examId: 'EX2', order: 2, type: 'mc', title: '둘째 문제', options: ['다', '라'], points: 20 });
  await setDoc(doc(db, 'exam_answers/Q5'), { examId: 'EX2', answer: '0', testCases: [] });
  await setDoc(doc(db, 'student_forms/F1'), { ownerId: 'StuA', title: '좋아하는 과목', status: 'open', responseCount: 0, questions: [{ id: 'q1', type: 'mc', text: '좋아하는 과목은?', options: ['정보', '수학'] }] });
  await setDoc(doc(db, 'exam_assignments/AS1'), { examId: 'EX1', code: 'ABC', status: 'ON', grade: '1', class: '2', schoolName: 'S중', duration: 10 });
  await setDoc(doc(db, 'exam_assignments/AS2'), { examId: 'EX1', code: '', status: 'OFF', grade: '1', class: '2', schoolName: 'S중', duration: 10 });
  await setDoc(doc(db, 'exam_assignments/AS3'), { examId: 'EX1', code: '', status: 'ON', grade: '2', class: '', schoolName: 'S중', duration: 10 });
  await setDoc(doc(db, 'exam_assignments/AS4'), { examId: 'EX2', code: '', status: 'ON', grade: '1', class: '', schoolName: '', duration: 0 });
  await setDoc(doc(db, 'exam_assignments/AS5'), { examId: 'EX2', code: '', status: 'ON', grade: '', class: '', schoolName: '', duration: 0, entryMinutes: 5, openedAt: minsAgo(10) });
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
  // 모의 Piston: print('hi')가 들어 있으면 hi를 출력한 걸로 친다.
  if (p === '/piston/execute') {
    let b = ''; req.on('data', d => b += d); req.on('end', () => {
      const code = JSON.parse(b).files?.[0]?.content || '';
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ run: { stdout: code.includes("print('hi')") ? 'hi\n' : '', stderr: '' } }));
    });
    return;
  }
  if (p === '/') p = '/index.html';
  if (p === '/firebase-config.js') { res.writeHead(200, { 'content-type': 'text/javascript' }); return res.end(fbconf); }
  try { const body = readFileSync(path.join(ROOT, p)); res.writeHead(200, { 'content-type': p.endsWith('.js') ? 'text/javascript' : p.endsWith('.css') ? 'text/css' : 'text/html; charset=utf-8' }); res.end(body); }
  catch { res.writeHead(404); res.end(); }
}).listen(8099);

// /api/exam — 실제 서버 코드를 에뮬레이터(규칙 우회 'owner' 토큰)에 붙인다.
const apiEnv = { FIRESTORE_EMULATOR_HOST: '127.0.0.1:8181', FIREBASE_AUTH_EMULATOR_HOST: '127.0.0.1:9099', FIREBASE_PROJECT_ID: 'ohweb-93062', PISTON_URL: 'http://127.0.0.1:8099/piston' };
const apiCalls = [];
async function serveExamApi(route) {
  const body = route.request().postData();
  const req = new Request('http://localhost:8099/api/exam', { method: 'POST', headers: { 'content-type': 'application/json', origin: 'http://localhost:8099' }, body });
  const res = await examApiHandler({ request: req, env: apiEnv });
  const text = await res.text();
  apiCalls.push({ req: JSON.parse(body), status: res.status, res: JSON.parse(text) });
  return route.fulfill({ status: res.status, contentType: 'application/json', body: text });
}
// 일시 오류 흉내: 남은 횟수만큼 시험 서버가 503, 로그인이 "너무 많은 요청"으로 실패한다.
let failExamApi = 0, failLogin = 0;
const lastCall = action => [...apiCalls].reverse().find(c => c.req.action === action);
const cmFile = { 'codemirror.min.js': 'lib/codemirror.js', 'codemirror.min.css': 'lib/codemirror.css', 'python.min.js': 'mode/python/python.js', 'closebrackets.min.js': 'addon/edit/closebrackets.js' };

const browser = await chromium.launch(process.env.CHROMIUM_PATH ? { executablePath: process.env.CHROMIUM_PATH } : {});
const ctx = await browser.newContext();
await ctx.route('**/*', async route => {
  const u = route.request().url();
  const m = u.match(/^https:\/\/www\.gstatic\.com\/firebasejs\/10\.12\.2\/([A-Za-z0-9_-]+\.js)$/);
  if (m) return route.fulfill({ status: 200, contentType: 'text/javascript', body: readFileSync(path.join(FB, m[1])) });
  const c = u.match(/^https:\/\/cdnjs\.cloudflare\.com\/ajax\/libs\/codemirror\/5\.65\.16\/.*?([a-z]+\.min\.(js|css))$/);
  if (c && cmFile[c[1]]) return route.fulfill({ status: 200, contentType: c[2] === 'css' ? 'text/css' : 'text/javascript', body: readFileSync(path.join(CM, cmFile[c[1]])) });
  if (u.includes('/api/exam') && failExamApi > 0) { failExamApi--; return route.fulfill({ status: 503, contentType: 'text/html', body: '<html>503</html>' }); }
  if (u.includes('/api/exam')) return serveExamApi(route);
  if (u.includes('accounts:signInWithPassword') && failLogin > 0 && route.request().method() === 'POST') {
    failLogin--;
    return route.fulfill({ status: 400, contentType: 'application/json', headers: { 'access-control-allow-origin': '*' }, body: JSON.stringify({ error: { code: 400, message: 'TOO_MANY_ATTEMPTS_TRY_LATER' } }) });
  }
  if (u.startsWith('http://localhost:8099') || u.startsWith('http://127.0.0.1')) return route.continue();
  return route.abort();
});
const page = await ctx.newPage();
const errors = [];
page.on('pageerror', e => errors.push(e.message));
page.on('console', m => { if (m.type() === 'error') errors.push('console: ' + m.text()); });
page.on('dialog', d => d.accept());
let fails = 0; const ok = (c, l) => { if (!c) fails++; console.log((c ? '✅ ' : '❌ ') + l); };
const readProg = async id => { let d; await env.withSecurityRulesDisabled(async c => { d = (await getDoc(doc(c.firestore(), 'exam_progress/' + id))).data(); }); return d; };

// 1) 로그인 (index.html)
await page.goto('http://localhost:8099/index.html');
await page.waitForFunction(() => document.querySelectorAll('#loginSchool option').length > 1, null, { timeout: 15000 });
await page.selectOption('#loginSchool', 'S중');
await page.waitForTimeout(300);
await page.selectOption('#loginGrade', '1'); await page.waitForTimeout(200);
await page.selectOption('#loginClass', '2'); await page.waitForTimeout(300);
await page.selectOption('#loginNumber', '3');
// 같은 학교 IP로 한꺼번에 로그인해 Firebase가 잠시 막은 상황 — "비밀번호 틀림"으로 세면 안 된다
failLogin = 1;
await page.fill('#loginPw', 'pass99');
await page.evaluate(() => window.doLogin());
await page.waitForFunction(() => /많아/.test(document.getElementById('loginErr').innerText), null, { timeout: 15000 });
let dirA; await env.withSecurityRulesDisabled(async c => { dirA = (await getDoc(doc(c.firestore(), 'student_directory/StuA'))).data(); });
ok(!dirA.failedAttempts && !dirA.locked, '로그인 요청 과다(too-many-requests) → "잠시 후 다시" 안내, 비밀번호 실패 횟수 안 올라감');
await page.fill('#loginPw', 'pass99');
await page.evaluate(() => window.doLogin());
await page.waitForURL(/home\.html/, { timeout: 15000 });
const sess = await page.evaluate(() => JSON.parse(localStorage.getItem('ohinfo_student')));
ok(sess?.name === '김학생' && !('password' in sess), `[${PHASE}단계] 로그인 성공, 세션에 이름(본인 문서) 포함`);

// 2) 시험 목록 — 서버가 열림·대상으로 거르고, 입장 코드는 내려보내지 않는다
await page.goto('http://localhost:8099/exam.html');
await page.waitForSelector('#code_AS1', { timeout: 15000 });
const listRes = lastCall('list')?.res;
const listed = (listRes?.exams || []).map(e => e.asId).sort().join(',');
ok(listed === 'AS1,AS4,AS5', `시험 목록: 열린 + 대상 학년·반·학교만 (${listed}) — OFF(AS2)·다른 학년(AS3) 제외`);
ok(!JSON.stringify(listRes).includes('ABC'), '시험 목록 응답에 입장 코드 없음');
ok(await page.isVisible('#code_AS1') && !(await page.isVisible('#code_AS4')), '코드 있는 배정만 코드 입력칸 (AS4는 바로 입장 버튼)');

// 3) 틀린 코드 → 서버가 막고 시작 기록도 안 남김
await page.evaluate(() => enterExamWithCode('AS1', 'XYZ'));
await page.waitForFunction(() => /코드/.test(document.getElementById('err_AS1').innerText), null, { timeout: 15000 });
ok(!(await readProg('AS1_StuA'))?.startTime, '틀린 입장 코드 → 입장 거부, 시작 시각 기록 안 됨');

// 4) 입장 마감이 지난 배정 → 새 입장 거부
await page.evaluate(() => enterExamWithCode('AS5', ''));
await page.waitForFunction(() => /입장 시간/.test(document.getElementById('err_AS5').innerText), null, { timeout: 15000 });
ok(true, '입장 마감(ON 후 5분)이 지난 배정 → 새 입장 거부');

// 5) 코드 입장
await page.fill('#code_AS1', 'ABC');
await page.evaluate(() => enterExamWithCode('AS1', 'ABC'));
await page.waitForSelector('#step2:not(.hidden)', { timeout: 15000 });
await page.waitForFunction(() => /\d\d:\d\d/.test(document.getElementById('timerBadge').innerText));
const t1 = await page.textContent('#timerBadge');
ok(t1 === '10:00' || t1 === '09:59', '첫 입장 타이머 10분 (' + t1 + ')');
const progStart1 = await readProg('AS1_StuA');
ok(progStart1?.startTime?.toMillis && progStart1.status === 'started', '서버가 진행 기록 생성 + 시작 시각(타임스탬프) 기록');
const startRes = lastCall('start')?.res;
ok(startRes?.questions?.length === 3 && !JSON.stringify(startRes).includes('testCases') && !/"answer"/.test(JSON.stringify(startRes)), '입장 응답: 문항 3개, 정답·테스트케이스 없음');
ok((await page.innerHTML('#qcard_0')).includes('&lt;b&gt;3&lt;/b&gt;'), '객관식 보기의 HTML 글자는 글자 그대로 표시');
ok(progStart1.enterCount === 1, '입장 횟수 1 기록');

// ── 부정행위 방지 ──
// 이탈: blur와 visibilitychange가 같은 이탈에 같이 오므로 한 번만 센다. 돌아온(focus) 뒤 다시 나가면 또 센다.
await page.evaluate(() => { window.dispatchEvent(new Event('blur')); window.dispatchEvent(new Event('blur')); });
await page.evaluate(() => { window.dispatchEvent(new Event('focus')); window.dispatchEvent(new Event('blur')); window.dispatchEvent(new Event('focus')); });
await page.waitForTimeout(800);
ok((await page.textContent('#alertCount')) === '2' && (await readProg('AS1_StuA'))?.alertCount === 2, '화면 이탈 감지: 두 번 나감 → 2회, 진행 기록에도 저장');
// 붙여넣기: 100자 이상은 막고 횟수 기록, 짧은 건 허용
const pasteInto = (sel, n) => page.evaluate(([sel, n]) => {
  const dt = new DataTransfer(); dt.setData('text/plain', 'x'.repeat(n));
  const ev = new ClipboardEvent('paste', { clipboardData: dt, bubbles: true, cancelable: true });
  document.querySelector(sel).dispatchEvent(ev); return ev.defaultPrevented;
}, [sel, n]);
ok(await pasteInto('#essay_1', 150) === true && await pasteInto('#essay_1', 50) === false, '서술형: 150자 붙여넣기 차단, 50자는 허용');
await page.waitForSelector('#qcard_2 .CodeMirror', { timeout: 15000 });
const cmBefore = await page.evaluate(() => document.querySelector('#qcard_2 .CodeMirror').CodeMirror.getValue());
await page.evaluate(() => { const cm = document.querySelector('#qcard_2 .CodeMirror').CodeMirror; cm.replaceRange('y'.repeat(150), { line: 0, ch: 0 }, null, 'paste'); });
ok(await page.evaluate(b => document.querySelector('#qcard_2 .CodeMirror').CodeMirror.getValue() === b, cmBefore), '코딩 에디터: 150자 붙여넣기 차단');
await page.waitForTimeout(800);
ok((await page.textContent('#pasteBlockCountEl')) === '2' && (await readProg('AS1_StuA'))?.pasteBlockCount === 2, '붙여넣기 차단 2회 → 화면 표시 + 진행 기록 저장');
// 답 입력
await page.evaluate(() => selectMC(0, 0));
await page.fill('#essay_1', '자동저장 확인용 서술 답안');
await page.dispatchEvent('#essay_1', 'input');
await page.waitForSelector('#qcard_2 .CodeMirror', { timeout: 15000 });
await page.click('#qcard_2 .CodeMirror');
await page.keyboard.press('Control+End'); await page.keyboard.press('Enter');
await page.keyboard.type('x = 1');
// 시험 중 언어 전환 → 에디터가 다시 붙고, 이어서 친 코드가 저장·제출돼야 한다
await page.evaluate(() => setLang('en'));
await page.waitForSelector('#qcard_2 .CodeMirror', { timeout: 15000 });
ok(await page.evaluate(() => document.querySelectorAll('#qcard_2 .CodeMirror').length === 1), '언어 전환 후에도 코딩 에디터 그대로(일반 입력칸으로 안 바뀜)');
await page.click('#qcard_2 .CodeMirror');
await page.keyboard.press('Control+End'); await page.keyboard.press('Enter');
await page.keyboard.type('y = 2');
await page.evaluate(() => setLang('ko'));
await page.waitForTimeout(3500);

// 6) 새로고침 → 재입장 → 타이머 이어짐 + 답안 복원
await page.reload();
await page.waitForSelector('#code_AS1', { timeout: 15000 });
await page.evaluate(() => enterExamWithCode('AS1', 'ABC'));
await page.waitForSelector('#step2:not(.hidden)', { timeout: 15000 });
await page.waitForFunction(() => /\d\d:\d\d/.test(document.getElementById('timerBadge').innerText));
const t2 = await page.textContent('#timerBadge');
const secs = s => { const [m, x] = s.split(':').map(Number); return m * 60 + x; };
ok(secs(t2) <= secs(t1) - 3, `새로고침 후 타이머 이어짐 (${t1} → ${t2}, 처음부터 다시 시작 안 함)`);
const progStart2 = await readProg('AS1_StuA');
ok(progStart2.startTime.toMillis() === progStart1.startTime.toMillis(), '재입장해도 시작 시각 그대로');
ok((await page.inputValue('#essay_1')) === '자동저장 확인용 서술 답안', '새로고침 후 서술형 답안 복원');
ok(await page.evaluate(() => document.querySelector('.mc-opt.selected') !== null), '새로고침 후 객관식 선택 복원');
ok((await page.textContent('#alertCount')) === '2' && (await page.textContent('#pasteBlockCountEl')) === '2', '새로고침해도 이탈·붙여넣기 횟수 유지(0으로 안 돌아감)');
ok(progStart2.enterCount === 2, '재입장 → 입장 횟수 2');

// 7) 제출 — 실제 서버 채점
await page.evaluate(() => submitExam());
await page.waitForSelector('#step3:not(.hidden)', { timeout: 20000 });
const sub = lastCall('submit');
ok(sub?.req?.answers?.[0]?.value === 0 && sub.req.answers[0].qId === 'Q1' && /자동저장/.test(sub.req.answers[1]?.value), '답안을 문항 ID와 함께 전송');
ok(sub?.req?.answers?.[2]?.value === "print('hi')\nx = 1\ny = 2", `언어 전환 전후로 친 코드가 합쳐져 제출 (${JSON.stringify(sub?.req?.answers?.[2]?.value)})`);
ok(sub?.res?.ok && sub.res.totalScore === 10 && sub.res.needsManual === true, `자동 채점은 코딩만(10점) — 객관식·서술형은 선생님 채점 대기 (${sub?.res?.totalScore}점)`);
ok(/선생님/.test(await page.textContent('#resultDetails')), '서술형 포함 → "채점 대기" 화면');
let results; await env.withSecurityRulesDisabled(async c => { results = (await getDocs(query(collection(c.firestore(), 'exam_results'), where('asId', '==', 'AS1')))).docs.map(d => d.data()); });
ok(results.length === 3 && results.every(r => r.questionId), '채점 결과 3건 기록 + 문항 ID 포함');
const q1r = results.find(r => r.questionId === 'Q1');
ok(q1r?.score === 0 && q1r.feedback === 'manual' && q1r.check === 'correct', '객관식: 점수는 0(선생님 확정 전), 맞았는지(check)만 기록');
ok(!JSON.stringify(sub.res).includes('check'), '학생에게 가는 응답엔 맞았는지(check) 없음');

// 8) 시간 초과된 시험에 재입장 → 즉시 자동 제출
await env.withSecurityRulesDisabled(async c => { await setDoc(doc(c.firestore(), 'exam_progress/AS1_StuA'), { status: 'started', startTime: minsAgo(13) }, { merge: true }); });
const before = apiCalls.length;
await page.goto('http://localhost:8099/exam.html');
await page.waitForSelector('#code_AS1', { timeout: 15000 });
await page.evaluate(() => enterExamWithCode('AS1', 'ABC'));
await page.waitForSelector('#step3:not(.hidden)', { timeout: 20000 });
ok(apiCalls.slice(before).some(c => c.req.action === 'submit'), '제한시간 지난 뒤 재입장 → 저장된 답으로 즉시 자동 제출');
ok((await readProg('AS1_StuA'))?.late === true, '제한시간 초과 표시(late) 기록');

// 9) 입장 중 일시 오류 — 한 번은 조용히 다시 시도, 그래도 안 되면 안내 + 선생님이 볼 수 있게 기록
await page.goto('http://localhost:8099/exam.html');
await page.waitForSelector('#examListArea button', { timeout: 15000 });
failExamApi = 2;
await page.evaluate(() => enterExamWithCode('AS4', ''));
await page.waitForFunction(() => /인터넷|HTTP/.test(document.getElementById('err_AS4').innerText), null, { timeout: 15000 });
let errProg; for (let i = 0; i < 20 && !errProg?.enterError; i++) { await page.waitForTimeout(250); errProg = await readProg('AS4_StuA'); }
ok(errProg?.enterError && !errProg.startTime, `입장 일시 오류 → 진행 기록에 "입장 오류" 남김 (${errProg?.enterError?.slice(0, 40)})`);
failExamApi = 1;
await page.evaluate(() => enterExamWithCode('AS4', ''));
await page.waitForSelector('#step2:not(.hidden)', { timeout: 15000 });
ok(failExamApi === 0, '일시 오류 한 번은 자동으로 다시 시도해서 입장 성공');

// 10) 문항 순서가 바뀌어도 답은 문항 ID로 기록 + 정답은 선생님이 공개할 때만
await page.evaluate(() => { selectMC(0, 0); selectMC(1, 1); }); // Q4(10점) 정답, Q5(20점) 오답
await env.withSecurityRulesDisabled(async c => { const db = c.firestore(); await updateDoc(doc(db, 'exam_questions/Q4'), { order: 2 }); await updateDoc(doc(db, 'exam_questions/Q5'), { order: 1 }); });
await page.evaluate(() => submitExam());
await page.waitForSelector('#step3:not(.hidden)', { timeout: 20000 });
let r4; await env.withSecurityRulesDisabled(async c => { r4 = (await getDocs(query(collection(c.firestore(), 'exam_results'), where('asId', '==', 'AS4')))).docs.map(d => ({ id: d.id, ...d.data() })); });
const chk = id => r4.find(r => r.questionId === id)?.check;
ok(chk('Q4') === 'correct' && chk('Q5') === 'wrong', `푸는 사이 선생님이 순서를 바꿔도 답이 맞는 문항에 기록 (Q4 ${chk('Q4')}, Q5 ${chk('Q5')})`);
ok(/선생님/.test(await page.textContent('#resultDetails')), '객관식만 있는 시험도 선생님 채점 전엔 점수 비공개');
// 선생님이 채점 저장(admin saveGrades와 같은 쓰기)
await env.withSecurityRulesDisabled(async c => {
  const db = c.firestore();
  for (const r of r4) await updateDoc(doc(db, 'exam_results/' + r.id), { score: r.check === 'correct' ? r.maxScore : 0, feedback: '' });
  await updateDoc(doc(db, 'exam_progress/AS4_StuA'), { totalScore: 10, totalPoints: 30, needsManual: false });
  await updateDoc(doc(db, 'exam_assignments/AS4'), { status: 'OFF' });
});
await page.goto('http://localhost:8099/exam.html');
await page.waitForSelector('#examListArea button', { timeout: 15000 });
ok((lastCall('list')?.res?.exams || []).some(e => e.asId === 'AS4'), 'OFF가 돼도 이미 낸 시험은 목록에 남음(결과 보기)');
await page.evaluate(() => showMyResult('AS4'));
await page.waitForSelector('#step3:not(.hidden)', { timeout: 15000 });
const hidden = await page.textContent('#resultDetails');
ok(/10/.test(await page.textContent('#resultScore')) && !/정답:/.test(hidden) && /공개/.test(hidden) && lastCall('result')?.res?.items?.every(i => i.correct === undefined), '채점 후 점수는 보이지만, 정답 공개 전엔 OFF여도 정답 안 보임');
await env.withSecurityRulesDisabled(async c => { await updateDoc(doc(c.firestore(), 'exam_assignments/AS4'), { revealAnswers: true }); });
await page.evaluate(() => showMyResult('AS4'));
await page.waitForFunction(() => /정답:/.test(document.getElementById('resultDetails').innerText), null, { timeout: 15000 });
ok(/내 답: ② · 정답: ①/.test(await page.textContent('#resultDetails')), '선생님이 "정답 공개"를 켜면 내 답과 정답 표시');

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

const realErr = errors.filter(e => !/net::ERR_FAILED|Failed to load resource|ERR_BLOCKED|CodeMirror script not ready|Could not reach Cloud Firestore backend|exam api|login:/.test(e));
ok(realErr.length === 0, '페이지 스크립트 오류 없음' + (realErr.length ? ' — ' + realErr.slice(0, 5).join(' | ') : ''));
console.log(fails ? `실패 ${fails}건` : '전부 통과');
await browser.close(); server.close(); await env.cleanup(); process.exit(fails ? 1 : 0);
