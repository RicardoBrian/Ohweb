// 새 선생님 화면(ohweb/public/k/) e2e — 오늘·과목 화면을 띄우고 Firebase 만 에뮬레이터로 바꿔서 돌려 본다.
// 새 과목 → 단원 → 차시 2개 → 반별 공개 → 순서 바꾸기 → 학생 탭 → 오늘 화면에서 다음 차시 공개 → 지난 과목으로
import { chromium } from 'playwright-core';
import { readFileSync } from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import { initializeTestEnvironment } from '@firebase/rules-unit-testing';
import { doc, setDoc, getDocs, collection } from 'firebase/firestore';

const ADMIN_ROOT = new URL('../ohweb/public', import.meta.url).pathname;
const KAKA = new URL('../ohinfo/public/kaka', import.meta.url).pathname;
const FB = new URL('./.fbcdn', import.meta.url).pathname;
const ADMIN_EMAIL = 'qjatjr7575@gmail.com';
const SHOT = process.env.SHOT_DIR;
const rules = readFileSync(new URL('../ohweb-firestore.rules', import.meta.url), 'utf8');
const env = await initializeTestEnvironment({ projectId: 'ohweb-93062', firestore: { rules, host: '127.0.0.1', port: 8181 } });
await env.clearFirestore();
await fetch('http://127.0.0.1:9099/emulator/v1/projects/ohweb-93062/accounts', { method: 'DELETE' });
await env.withSecurityRulesDisabled(async c => {
  const db = c.firestore();
  await setDoc(doc(db, 'schools/s1'), { name: 'S중' });
  await setDoc(doc(db, 'students/A1'), { name: '김하늘', schoolName: 'S중', grade: '1', class: '1', number: 1, registered: true });
  await setDoc(doc(db, 'students/A2'), { name: '이도윤', schoolName: 'S중', grade: '1', class: '2', number: 1, registered: false });
  await setDoc(doc(db, 'students/A3'), { name: '다른반', schoolName: 'S중', grade: '1', class: '3', number: 1, registered: true });
  await setDoc(doc(db, 'students/A4'), { name: '다른학년', schoolName: 'S중', grade: '2', class: '1', number: 1, registered: true });
});
const signUp = async (email, password) => {
  const r = await fetch('http://127.0.0.1:9099/identitytoolkit.googleapis.com/v1/accounts:signUp?key=fake', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ email, password, returnSecureToken: true }) });
  if (!r.ok) throw new Error('signup ' + await r.text());
  return (await r.json()).localId;
};
const adminUid = await signUp(ADMIN_EMAIL, 'adminpw1');
await fetch('http://127.0.0.1:9099/identitytoolkit.googleapis.com/v1/projects/ohweb-93062/accounts:update', { method: 'POST', headers: { 'content-type': 'application/json', authorization: 'Bearer owner' }, body: JSON.stringify({ localId: adminUid, emailVerified: true }) });

const conf = `import { initializeApp } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-app.js";
import { getFirestore, connectFirestoreEmulator } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";
import { getAuth, connectAuthEmulator, signInWithEmailAndPassword } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-auth.js";
const app = initializeApp({ apiKey: 'fake', projectId: 'ohweb-93062', authDomain: 'localhost' });
export const db = getFirestore(app); connectFirestoreEmulator(db, '127.0.0.1', 8181);
export const auth = getAuth(app); connectAuthEmulator(auth, 'http://127.0.0.1:9099', { disableWarnings: true });
if (!auth.currentUser) await signInWithEmailAndPassword(auth, '${ADMIN_EMAIL}', 'adminpw1');`;
const type = p => p.endsWith('.js') ? 'text/javascript' : p.endsWith('.css') ? 'text/css' : p.endsWith('.svg') ? 'image/svg+xml' : 'text/html; charset=utf-8';
const srv = http.createServer((req, res) => {
  const p = decodeURIComponent(new URL(req.url, 'http://x').pathname);
  if (p === '/firebase-config.js') { res.writeHead(200, { 'content-type': 'text/javascript' }); return res.end(conf); }
  try { const body = readFileSync(path.join(ADMIN_ROOT, p)); res.writeHead(200, { 'content-type': type(p) }); res.end(body); }
  catch { res.writeHead(404); res.end(); }
}).listen(8098);

let fails = 0;
const ok = (label, cond, extra = '') => { if (cond) console.log('✅ ' + label); else { fails++; console.log('❌ ' + label + (extra ? ' — ' + extra : '')); } };
const readAll = async name => { let out = []; await env.withSecurityRulesDisabled(async c => { out = (await getDocs(collection(c.firestore(), name))).docs.map(d => d.data()); }); return out; };
const lessonsInDb = () => readAll('course_lessons');
const coursesInDb = () => readAll('courses');

const browser = await chromium.launch(process.env.CHROMIUM_PATH ? { executablePath: process.env.CHROMIUM_PATH } : {});
const ctx = await browser.newContext({ viewport: { width: 1280, height: 860 }, deviceScaleFactor: SHOT ? 2 : 1 });
await ctx.route('**/*', route => {
  const u = route.request().url();
  const m = u.match(/^https:\/\/www\.gstatic\.com\/firebasejs\/10\.12\.2\/([A-Za-z0-9_-]+\.js)$/);
  if (m) return route.fulfill({ status: 200, contentType: 'text/javascript', body: readFileSync(path.join(FB, m[1])) });
  const k = u.match(/^https:\/\/kakainfo\.com\/kaka\/([a-z-]+\.(css|svg))$/);
  if (k) return route.fulfill({ status: 200, contentType: type(k[1]), body: readFileSync(path.join(KAKA, k[1])) });
  if (u.endsWith('/api/translate')) {
    const { texts, targetLang } = JSON.parse(route.request().postData());
    return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ translations: texts.map(t => ({ text: `[${targetLang}] ${t}` })) }) });
  }
  if (u.startsWith('http://localhost:') || u.startsWith('http://127.0.0.1')) return route.continue();
  return route.abort();
});
const page = await ctx.newPage();
const errors = [];
page.on('pageerror', e => errors.push(e.message));
page.on('console', m => { if (m.type() === 'error' && !/ERR_FAILED|Failed to load resource/.test(m.text())) errors.push(m.text()); });
const dlg = async (values, submit = true) => {
  await page.waitForSelector('.k-dialog');
  for (const [k, v] of Object.entries(values)) await page.fill(`.k-dialog [name="${k}"]`, v);
  if (submit) await page.click('.k-dialog .k-dialog__actions button:last-child');
  await page.waitForSelector('.k-dialog', { state: 'detached' });
};

try {
  await page.goto('http://localhost:8098/k/index.html');
  await page.waitForSelector('text=아직 과목이 없습니다', { timeout: 15000 });
  ok('과목이 없으면 안내가 보인다', true);
  if (SHOT) await page.screenshot({ path: SHOT + '/k-today-empty.png' });

  await page.click('#new-course');
  await dlg({ name: '정보', grade: '1', classes: '2, 1', schoolName: 'S중', year: '2027', semester: '1' });
  await page.waitForURL(/course\.html\?id=/);
  await page.waitForSelector('text=단원부터 넣으세요');
  let cs = await coursesInDb();
  ok('과목 저장: 반 정렬·번역', cs.length === 1 && cs[0].classes.join() === '1,2' && cs[0].i18n.en === '[en] 정보' && cs[0].status === 'active', JSON.stringify(cs[0]));

  await page.click('#unit-add');
  await dlg({ name: '알고리즘' });
  await page.waitForSelector('text=1. 알고리즘');
  ok('단원이 생긴다', true);

  for (const name of ['순차', '반복']) {
    await page.click('[data-ladd]');
    await dlg({ name, standards: name === '반복' ? '9정04-02' : '' });
    await page.waitForSelector(`text=${name}`);
  }
  ok('차시 두 개, 번호 1·2', (await page.locator('.k-lesson__no').allTextContents()).join() === '1차시,2차시');

  await page.click('[data-cls="1"] >> nth=0');
  await page.waitForSelector('[data-cls="1"][aria-pressed="true"]');
  let ls = await lessonsInDb();
  ok('1차시 1반 공개 저장', ls.find(l => l.name === '순차').openTo.join() === '1');

  await page.click('[data-lmove][data-d="-1"] >> nth=1');
  await page.waitForFunction(() => document.querySelector('.k-lesson__title')?.textContent === '반복');
  ls = await lessonsInDb();
  ok('순서 바꾸기 저장', ls.find(l => l.name === '반복').order === 1 && ls.find(l => l.name === '순차').order === 2);
  if (SHOT) await page.screenshot({ path: SHOT + '/k-course-lessons.png' });

  await page.click('[data-edit] >> nth=0');
  await dlg({ name: '반복문', standards: '9정04-02, 9정04-03' });
  await page.waitForFunction(() => document.querySelector('.k-lesson__title')?.textContent === '반복문' && document.querySelector('.k-lesson__meta')?.textContent.includes('03'));
  ls = await lessonsInDb();
  ok('차시 고치기: 이름·성취기준·번역', (l => l.standards.length === 2 && l.i18n.ru === '[ru] 반복문')(ls.find(l => l.order === 1)), JSON.stringify(ls.map(l => [l.name, l.order, l.standards, l.i18n])));

  await page.click('[data-tab="students"]');
  await page.waitForSelector('.k-table');
  const rows = await page.locator('.k-table tbody tr').allTextContents();
  ok('학생 탭: 이 과목 반 학생만(2명)', rows.length === 2 && rows.some(r => r.includes('가입 전')), rows.join(' | '));
  if (SHOT) await page.screenshot({ path: SHOT + '/k-course-students.png' });

  await page.click('.k-nav a:first-child');
  await page.waitForSelector('text=다음: 1차시 반복문');
  ok('오늘: 1반 다음 = 1차시(순서 바꾼 뒤 안 연 첫 차시)', true);
  if (SHOT) await page.screenshot({ path: SHOT + '/k-today.png' });
  await page.click('[data-cls="1"]');
  await page.waitForSelector('text=모든 차시를 공개했습니다');
  ls = await lessonsInDb();
  ok('오늘에서 공개 → 저장', ls.every(l => l.openTo.includes('1')));

  await page.click('a[href^="course.html"] >> nth=0');
  await page.click('[data-tab="setup"]');
  await page.click('#archive');
  await page.waitForSelector('text=다시 쓰기');
  cs = await coursesInDb();
  ok('지난 과목으로 옮기기', cs[0].status === 'archived');
  await page.goto('http://localhost:8098/k/index.html');
  await page.waitForSelector('text=지난 과목 1개');
  ok('오늘 화면에서 빠지고 지난 과목에 보인다', !(await page.textContent('main')).includes('다음:'));

  await page.setViewportSize({ width: 390, height: 800 });
  const wide = await page.evaluate(() => document.documentElement.scrollWidth > innerWidth);
  ok('폰 너비에서 가로 스크롤 없음', !wide);
  ok('화면 오류 없음', errors.length === 0, errors.join(' / '));
} catch (e) { fails++; console.log('❌ 진행 중 오류 — ' + e.message); if (SHOT) await page.screenshot({ path: SHOT + '/k-error.png' }); }

await browser.close(); srv.close(); await env.cleanup();
console.log(fails ? `\n실패 ${fails}건` : '\n전부 통과'); process.exit(fails ? 1 : 0);
