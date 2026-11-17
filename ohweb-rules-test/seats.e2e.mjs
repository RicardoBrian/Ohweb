// 자리 배치 e2e — 실제 교사 화면(ohweb/public/seats.html)을 띄우고 Firebase 만 에뮬레이터로 바꿔서 돌려 본다.
// 교실 만들기(본보기) → 대포 한 번 발사(1번 자리) → 고정석 → 결석 → 빠르게 모두 → 자리 바꾸기 → 저장 → 다시 불러오기
import { chromium } from 'playwright-core';
import { readFileSync } from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import { initializeTestEnvironment } from '@firebase/rules-unit-testing';
import { doc, setDoc, getDocs, collection } from 'firebase/firestore';

const ADMIN_ROOT = new URL('../ohweb/public', import.meta.url).pathname;
const FB = new URL('./.fbcdn', import.meta.url).pathname;
const ADMIN_EMAIL = 'qjatjr7575@gmail.com';
const SHOT = process.env.SHOT_DIR;
const rules = readFileSync(new URL('../ohweb-firestore.rules', import.meta.url), 'utf8');
const env = await initializeTestEnvironment({ projectId: 'ohweb-93062', firestore: { rules, host: '127.0.0.1', port: 8181 } });
await env.clearFirestore();
await fetch('http://127.0.0.1:9099/emulator/v1/projects/ohweb-93062/accounts', { method: 'DELETE' });
const NAMES = ['김하늘', '이도윤', '박서연', '최지호', '정하린', '강민준', '조수아', '윤지우', '장서준', '임예린', '한유나', '오시우'];
await env.withSecurityRulesDisabled(async c => {
  const db = c.firestore();
  await Promise.all(NAMES.map((n, i) => setDoc(doc(db, 'students/S2_' + (i + 1)), { name: n, schoolName: 'S중', grade: '1', class: '2', number: i + 1, registered: true })));
  await setDoc(doc(db, 'students/S3_1'), { name: '다른반', schoolName: 'S중', grade: '1', class: '3', number: 1, registered: true });
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
const srv = http.createServer((req, res) => {
  let p = decodeURIComponent(new URL(req.url, 'http://x').pathname);
  if (p === '/firebase-config.js') { res.writeHead(200, { 'content-type': 'text/javascript' }); return res.end(conf); }
  try { const body = readFileSync(path.join(ADMIN_ROOT, p)); res.writeHead(200, { 'content-type': p.endsWith('.js') ? 'text/javascript' : p.endsWith('.css') ? 'text/css' : 'text/html; charset=utf-8' }); res.end(body); }
  catch { res.writeHead(404); res.end(); }
}).listen(8097);

let fails = 0;
const ok = (label, cond, extra = '') => { if (cond) console.log('✅ ' + label); else { fails++; console.log('❌ ' + label + (extra ? ' — ' + extra : '')); } };

const browser = await chromium.launch(process.env.CHROMIUM_PATH ? { executablePath: process.env.CHROMIUM_PATH } : {});
const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: SHOT ? 2 : 1 });
await ctx.route('**/*', route => {
  const u = route.request().url();
  const m = u.match(/^https:\/\/www\.gstatic\.com\/firebasejs\/10\.12\.2\/([A-Za-z0-9_-]+\.js)$/);
  if (m) return route.fulfill({ status: 200, contentType: 'text/javascript', body: readFileSync(path.join(FB, m[1])) });
  if (u.startsWith('http://localhost:') || u.startsWith('http://127.0.0.1')) return route.continue();
  return route.abort();
});
const page = await ctx.newPage();
const errors = [];
page.on('pageerror', e => errors.push(e.message));
page.on('console', m => { if (m.type() === 'error' && !/ERR_FAILED|Failed to load resource/.test(m.text())) errors.push(m.text()); });
page.on('dialog', d => d.accept());

try {
  await page.goto('http://localhost:8097/seats.html');
  // 교실이 없으면 편집 창이 바로 뜬다
  await page.waitForSelector('#edGrid .ed-cell', { timeout: 15000 });
  ok('교실이 없으면 새 교실 창이 뜬다', true);
  await page.click('[data-preset="2"]'); // 컴퓨터실 4+4 다섯 줄 (40자리)
  await page.fill('#edRows', '2');      // 2줄 → 16자리 (학생 12명)
  await page.fill('#edName', '컴퓨터실 1');
  ok('편집 창 자리 수', /자리 16개/.test(await page.textContent('#edCount')), await page.textContent('#edCount'));
  if (SHOT) await page.screenshot({ path: SHOT + '/seats-editor.png' });
  await page.click('#edSave');
  await page.waitForSelector('.seatgrid .seat');
  ok('교실 자리 16개', await page.locator('.seat').count() === 16);
  ok('반 목록에 1학년 2반', (await page.textContent('#selClass')).includes('2반 (12명)'));
  ok('남은 학생 12', (await page.textContent('#leftCount')) === '12');
  if (SHOT) { await page.waitForTimeout(400); await page.screenshot({ path: SHOT + '/seats-ready.png' }); }

  // 한 번 발사 → 1번 자리
  await page.click('#btnFire');
  await page.waitForFunction(() => document.querySelector('.seat[data-no="1"]')?.classList.contains('filled') && !document.querySelector('.tok'), null, { timeout: 8000 });
  ok('첫 발사는 1번 자리에', true);
  ok('남은 학생 11', (await page.textContent('#leftCount')) === '11');
  if (SHOT) { await page.click('#btnFire'); await page.waitForTimeout(1450); await page.screenshot({ path: SHOT + '/seats-flying.png' }); await page.waitForFunction(() => !document.querySelector('.tok') && !document.querySelector('#btnFire').disabled); }

  // 테마 6개: 하나씩 골라 한 번씩 뽑아 본다 (보통 속도)
  const themes = await page.$$eval('#selTheme option', os => os.map(o => o.value));
  ok('테마 6개', themes.length === 6, themes.join(','));
  for (const th of themes) {
    if (th === 'cannon') continue;
    const before = await page.locator('.seat.filled').count();
    await page.selectOption('#selTheme', th);
    await page.waitForTimeout(150);
    await page.click('#btnFire');
    if (SHOT) { await page.waitForTimeout(th === 'swipe' ? 1500 : th === 'crane' ? 2400 : 1100); await page.screenshot({ path: SHOT + `/theme-${th}.png` }); }
    await page.waitForFunction(n => document.querySelectorAll('.seat.filled').length === n + 1 && !document.querySelector('.tok') && !document.querySelector('#btnFire').disabled, before, { timeout: 15000 });
    ok(`테마 ${th}: 다음 자리에 기입`, (await page.textContent('#leftCount')) === String(12 - before - 1));
  }
  await page.selectOption('#selTheme', 'cannon');
  // 지금까지 뽑은 걸 비우고 원래 흐름으로
  await page.click('#btnReset'); await page.click('#mResetAll');
  await page.click('#btnFire');
  await page.waitForFunction(() => document.querySelector('.seat[data-no="1"]')?.classList.contains('filled') && !document.querySelector('.tok') && !document.querySelector('#btnFire').disabled, null, { timeout: 8000 });

  // 고정석: 16번 빈자리에 12번 학생
  await page.click('.seat[data-no="16"]');
  await page.click('.pick-grid button[data-sid="S2_12"]').catch(async () => {
    // 이미 뽑혔으면 아무나
    await page.click('.pick-grid button');
  });
  ok('고정석 표시', await page.locator('.seat[data-no="16"].manual').count() === 1);

  // 결석 한 명 (아직 안 앉은 학생)
  const absentId = await page.evaluate(() => [...document.querySelectorAll('#roster .chip:not(.done)')][0]?.dataset.sid);
  await page.click(`#roster .chip[data-sid="${absentId}"]`);
  ok('결석 표시', await page.locator(`#roster .chip.off[data-sid="${absentId}"]`).count() === 1);

  // 빠르게 모두
  await page.click('#btnAll');
  await page.waitForFunction(() => document.querySelector('#leftCount').textContent === '0' && !document.querySelector('.tok') && document.querySelector('#btnAll span').textContent === '빠르게 모두' && !document.querySelector('#btnReset').disabled, null, { timeout: 20000 });
  const filled = await page.evaluate(() => [...document.querySelectorAll('.seat.filled')].map(s => +s.dataset.no).sort((a, b) => a - b));
  ok('11명 앉음(결석 1명 제외)', filled.length === 11, JSON.stringify(filled));
  ok('번호 순서대로 채움(1~10 + 고정 16)', JSON.stringify(filled) === JSON.stringify([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 16]), JSON.stringify(filled));
  const names = await page.evaluate(() => [...document.querySelectorAll('.seat.filled .sname')].map(e => e.textContent));
  ok('같은 학생이 두 번 앉지 않음', new Set(names).size === names.length);
  ok('다른 반 학생 없음', !names.includes('다른반'));

  // 자리 바꾸기: 1번 ↔ 2번
  const [n1, n2] = await page.evaluate(() => [1, 2].map(n => document.querySelector(`.seat[data-no="${n}"] .sname`).textContent));
  await page.click('.seat[data-no="1"]'); await page.click('.seat[data-no="2"]');
  const [m1, m2] = await page.evaluate(() => [1, 2].map(n => document.querySelector(`.seat[data-no="${n}"] .sname`).textContent));
  ok('두 자리 서로 바꾸기', m1 === n2 && m2 === n1);
  // 되돌리기
  await page.click('#btnUndo');
  ok('되돌리기', (await page.textContent('.seat[data-no="1"] .sname')) === n1);

  if (SHOT) await page.screenshot({ path: SHOT + '/seats-done.png' });

  // 저장
  await page.click('#btnSave'); await page.click('#svGo');
  await page.waitForFunction(() => !document.querySelector('#modal').classList.contains('open'));
  let plans = [];
  await env.withSecurityRulesDisabled(async c => { plans = (await getDocs(collection(c.firestore(), 'seat_plans'))).docs.map(d => d.data()); });
  ok('seat_plans 저장', plans.length === 1 && plans[0].seats.length === 11 && plans[0].classKey && plans[0].room.cells.length === 18, JSON.stringify(plans[0]?.seats?.length));
  ok('결석 저장', plans[0]?.absent?.includes(absentId));

  // 다시 하기 → 기록에서 불러오기
  await page.click('#btnReset'); await page.click('#mResetAll');
  ok('모두 비우기', await page.locator('.seat.filled').count() === 0);
  await page.click('#btnHistory');
  await page.click('[data-load]');
  await page.waitForFunction(() => document.querySelectorAll('.seat.filled').length === 11);
  ok('기록 불러오기', (await page.textContent('.seat[data-no="1"] .sname')) === n1);

  // 발표 모드 · 교사 시점
  await page.click('#btnFlip');
  ok('교사 시점: 칠판이 아래', await page.locator('.front.bottom').count() === 1);
  await page.click('#btnPresent');
  ok('발표 모드', await page.evaluate(() => document.body.classList.contains('present')));
  if (SHOT) await page.screenshot({ path: SHOT + '/seats-present.png' });
  // 발표 모드에서 뽑기 장면 (인형뽑기)
  await page.click('#btnReset'); await page.click('#mResetAll');
  await page.selectOption('#selTheme', 'crane');
  await page.click('#btnFire');
  if (SHOT) { await page.waitForTimeout(2300); await page.screenshot({ path: SHOT + '/present-crane.png' }); }
  ok('뽑는 동안 무대 크게(스포트라이트)', await page.evaluate(() => !!document.querySelector('.stage.spot') && !!document.querySelector('.spot-dim')));
  await page.waitForFunction(() => document.querySelectorAll('.seat.filled').length === 1 && !document.querySelector('.tok') && !document.querySelector('#btnFire').disabled, null, { timeout: 15000 });
  if (SHOT) { await page.waitForTimeout(200); await page.screenshot({ path: SHOT + '/present-reveal.png' }); }
  ok('발표 모드에서 뽑기', true);
  ok('뽑기 끝나면 무대 제자리', await page.evaluate(() => !document.querySelector('.stage.spot') && !document.querySelector('.spot-dim') && !document.querySelector('.stage-ph')));

  // 모바일 폭
  await page.click('#btnExitPresent');
  ok('발표 모드 끝내기', await page.evaluate(() => !document.body.classList.contains('present')));
  await page.waitForTimeout(300);
  await page.setViewportSize({ width: 390, height: 844 });
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth + 1);
  ok('모바일 가로 넘침 없음', !overflow);
  if (SHOT) await page.screenshot({ path: SHOT + '/seats-mobile.png', fullPage: true });

  ok('콘솔 오류 없음', !errors.length, errors.join(' | '));
} catch (e) {
  fails++; console.log('❌ 예외: ' + e.message);
  if (SHOT) await page.screenshot({ path: SHOT + '/seats-error.png' }).catch(() => {});
  if (errors.length) console.log(errors.join('\n'));
}
await browser.close(); srv.close(); await env.cleanup();
console.log(fails ? `\n실패 ${fails}건` : '\n전부 통과'); process.exit(fails ? 1 : 0);
