// 수업일지(ohlog) e2e — 실제 ohlog/public 을 브라우저(Chromium)로 띄우고, Firebase는 에뮬레이터,
// /api/comci 는 실제 functions/api/comci.js 를 그대로 돌리되 컴시간 서버만 가짜 응답으로 바꾼다.
// 흐름: 관리자 가입(바로 승인) → 교사 신청(대기) → 관리자 승인 → 교사 일지·진도 계획·보강 추가·주간·진도·내보내기.
//   npm run test:classlog   (Java 필요)
import { chromium } from 'playwright-core';
import { initializeTestEnvironment } from '@firebase/rules-unit-testing';
import { readFileSync, existsSync, mkdirSync } from 'node:fs';
import http from 'node:http';
import path from 'node:path';

const ROOT = new URL('../ohlog/public/', import.meta.url).pathname;
const FB = new URL('./.fbcdn', import.meta.url).pathname;
const SHOTS = process.env.SHOTS; // 화면 캡처 저장 폴더(선택)
if (SHOTS) mkdirSync(SHOTS, { recursive: true });

// ── 가짜 컴시간 ──
const comci = await import(new URL('../ohlog/functions/api/comci.js', import.meta.url));
const pct2bytes = (s) => { const out = []; for (let i = 0; i < s.length;) { if (s[i] === '%') { out.push(parseInt(s.slice(i + 1, i + 3), 16)); i += 3; } else { out.push(s.charCodeAt(i)); i++; } } return Buffer.from(out); };
const ST_HTML = "<script>function school_ra(sc){$.ajax({ url:'./36179?17384l'+sc});} function sc_data(sc,sc2,r,nw){} sc_data('73629_',sc,1,'0'); 원자료=Q자료(자료.자료481[학년][반][요일][교시]);일일자료=Q자료(자료.자료147[학년][반][요일][교시]);var m3=자료.자료245[학년][반][요일][교시];성명=Q성명(자료.자료446[th]);과목명=Q과목명(자료.자료492[sb]);</script>";
const TEACHERS = ['', ...Array.from({ length: 28 }, (_, i) => `교사${i + 1}*`)];
const SUBJECTS = [27, ...Array.from({ length: 27 }, (_, i) => `과목${i + 1}`)];
SUBJECTS[10] = '수학'; SUBJECTS[12] = '과학A';
// 슬롯마다 반(전체 14개)에 서로 다른 교사를 배정 → 실제처럼 겹침 0. 코드 = 과목*1000 + 교사.
function timetable(week) {
  const classes = [0, 4, 5, 5]; const tbl = [3]; let gi = 0;
  for (let g = 1; g <= 3; g++) {
    const G = [classes[g]];
    for (let c = 1; c <= classes[g]; c++, gi++) {
      const C = [5];
      for (let d = 1; d <= 5; d++) {
        const D = [6];
        for (let p = 1; p <= 6; p++) {
          const t = ((gi + d * 3 + p * 5 + week) % 28) + 1;
          const subj = t === 10 ? 10 : ((t - 1) % 27) + 1;
          const code = subj * 1000 + t;
          D.push(g === 2 && c === 1 && d === 4 && p === 2 ? '>' + code : code);
        }
        C.push(D);
      }
      G.push(C);
    }
    tbl.push(G);
  }
  return tbl;
}
function weekJson(r) {
  const start = r === 1 ? '26-10-26' : '26-11-02';
  return JSON.stringify({
    학급수: [14, 4, 5, 5], 분리: 1000, 강의실: 0, 오늘r: 1, 학교명: '컴시간중',
    일자자료: [[1, '26-10-26 ~ 26-10-31'], [2, '26-11-02 ~ 26-11-07']], 시작일: '20' + start,
    일과시간: ['1(09:00)', '2(09:55)', '3(10:50)', '4(11:45)', '5(13:30)', '6(14:25)', '7(15:20)'],
    담임: [0, [0, 1, 2, 3, 4], [0, 5, 6, 7, 8, 9], [0, 10, 11, 12, 13, 14]], // 3학년 1반 담임 = 10번 교사
    자료446: TEACHERS, 자료492: SUBJECTS, 자료481: timetable(r), 자료147: timetable(r), 자료245: [3],
  }) + '\0\0';
}
globalThis.fetch = (orig => async (url, opt) => {
  const u = String(url);
  if (!u.startsWith('http://comci.net:4082')) return orig(url, opt);
  if (u.endsWith('/st')) return new Response(pct2bytes(comci.eucKrPercent(ST_HTML)));
  if (u.includes('?17384l')) return new Response(JSON.stringify({ 학교검색: [[24966, '경기', '관산중학교', 43917]] }));
  const tok = atob(u.split('?')[1]);
  return new Response(weekJson(Number(tok.split('_').pop())));
})(globalThis.fetch);

// ── 정적 서버 + /api/comci ──
const fbconf = `import { initializeApp } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-app.js";
import { getFirestore, connectFirestoreEmulator } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";
import { getAuth, connectAuthEmulator, signInWithCredential, GoogleAuthProvider } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-auth.js";
const app = initializeApp({ apiKey: 'fake', projectId: 'ohweb-93062', authDomain: 'localhost' });
export const db = getFirestore(app); connectFirestoreEmulator(db, '127.0.0.1', 8181);
export const auth = getAuth(app); connectAuthEmulator(auth, 'http://127.0.0.1:9099', { disableWarnings: true });
window.__signIn = (email) => signInWithCredential(auth, GoogleAuthProvider.credential(JSON.stringify({ sub: email, email, email_verified: true })));`;
// 새 버전 감지: 실제 version.js 를 돌리고(ASSETS 는 정적 파일로 대신), '배포'는 소금 값을 올려 흉내 낸다
const version = await import(new URL('../ohlog/functions/api/version.js', import.meta.url));
let deploySalt = 0;
const assets = { fetch: async (u) => { const f = path.join(ROOT, new URL(u).pathname === '/' ? 'index.html' : new URL(u).pathname); return existsSync(f) ? new Response(readFileSync(f)) : new Response('', { status: 404 }); } };
const TYPES = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.png': 'image/png', '.svg': 'image/svg+xml' };
const server = http.createServer(async (req, res) => {
  const u = new URL(req.url, 'http://localhost');
  if (u.pathname === '/api/comci') {
    const r = await comci.onRequestGet({ request: new Request('http://localhost' + req.url), env: {} });
    res.writeHead(r.status, { 'content-type': 'application/json' }); res.end(await r.text()); return;
  }
  if (u.pathname === '/api/version') {
    const r = await version.onRequestGet({ request: new Request('http://localhost' + req.url), env: { ASSETS: assets } });
    const { v } = await r.json();
    res.writeHead(200, { 'content-type': 'application/json', 'cache-control': 'no-store' }); res.end(JSON.stringify({ v: v + '-' + deploySalt })); return;
  }
  if (u.pathname === '/__deploy') { deploySalt++; res.writeHead(204); res.end(); return; }
  if (u.pathname === '/firebase-config.js') { res.writeHead(200, { 'content-type': 'text/javascript' }); res.end(fbconf); return; }
  const f = path.join(ROOT, u.pathname === '/' ? 'index.html' : u.pathname);
  if (!f.startsWith(ROOT) || !existsSync(f)) { res.writeHead(404); res.end(); return; }
  res.writeHead(200, { 'content-type': TYPES[path.extname(f)] || 'application/octet-stream' }); res.end(readFileSync(f));
});
await new Promise((r) => server.listen(8098, r));

const env = await initializeTestEnvironment({ projectId: 'ohweb-93062', firestore: { rules: readFileSync(new URL('../ohweb-firestore.rules', import.meta.url), 'utf8'), host: '127.0.0.1', port: 8181 } });
await env.clearFirestore();
await fetch('http://127.0.0.1:9099/emulator/v1/projects/ohweb-93062/accounts', { method: 'DELETE' });

const browser = await chromium.launch(process.env.CHROMIUM_PATH ? { executablePath: process.env.CHROMIUM_PATH } : {});
let fails = 0;
const ok = (label, cond, extra = '') => { if (cond) console.log('✅ ' + label); else { fails++; console.log('❌ ' + label + (extra ? ' — ' + extra : '')); } };
async function open(email, viewport = { width: 1440, height: 1000 }) {
  const ctx = await browser.newContext({ viewport, acceptDownloads: true, timezoneId: 'Asia/Seoul' });
  await ctx.route('**/*', (route) => {
    const u = route.request().url();
    const m = u.match(/^https:\/\/www\.gstatic\.com\/firebasejs\/10\.12\.2\/([A-Za-z0-9_-]+\.js)$/);
    if (m) return route.fulfill({ status: 200, contentType: 'text/javascript', body: readFileSync(path.join(FB, m[1])) });
    if (u.startsWith('http://localhost:8098') || u.startsWith('http://127.0.0.1')) return route.continue();
    return route.abort(); // 폰트 등 외부는 끊는다
  });
  const page = await ctx.newPage();
  page.on('pageerror', (e) => { fails++; console.log('❌ 페이지 오류(' + email + '): ' + e.message); });
  await page.clock.setFixedTime(new Date('2026-10-29T10:00:00+09:00')); // 목요일(1주차)
  await page.goto('http://localhost:8098/');
  await page.waitForSelector('#screenLogin.show');
  await page.evaluate((e) => window.__signIn(e), email);
  return { ctx, page };
}
const shot = (page, name) => SHOTS && page.screenshot({ path: path.join(SHOTS, name + '.png'), fullPage: true });
async function onboard(page, teacherId) {
  await page.waitForSelector('#screenOnboard.show');
  await page.fill('#obQuery', '관산');
  await page.click('#obSearch');
  await page.click('#obSchools .pick-item');
  await page.waitForSelector('#obTeacherSel option[value="10"]', { state: 'attached' });
  await page.selectOption('#obTeacherSel', String(teacherId));
  await page.waitForSelector('#obPreview .week-grid');
}

// 1) 관리자: 가입하면 바로 승인
const A = await open('qjatjr7575@gmail.com');
await onboard(A.page, 10);
await shot(A.page, '01-onboard');
await A.page.click('#obSubmit');
await A.page.waitForSelector('#app:not(.hidden) #sec-today.active');
ok('관리자는 신청 즉시 앱으로 들어감', true);

// 2) 교사: 신청 → 대기 화면
const T = await open('teacher@gmail.com', { width: 390, height: 844 });
await onboard(T.page, 10);
await T.page.click('#obSubmit');
await T.page.waitForSelector('#screenPending.show');
ok('교사는 신청 후 승인 대기 화면', (await T.page.textContent('#pendTitle')).includes('대기'));
await shot(T.page, '02-pending-m');

// 3) 관리자 승인 → 교사 화면 자동 전환
await A.page.click('.side-item[data-go="admin"]');
await A.page.waitForSelector('#adminList [data-s="approved"]');
await shot(A.page, '03-admin');
await A.page.click('#adminList [data-s="approved"]');
// 폰(홈 화면 앱)에서는 처음 열면 시간표가 나와야 한다
await T.page.waitForSelector('#app:not(.hidden) #sec-week.active', { timeout: 10000 });
ok('승인되면 교사 화면이 자동으로 앱으로 바뀜 — 폰에서는 처음에 시간표', true);
await T.page.waitForSelector('#weekGrid .slot');
const fit = await T.page.evaluate(() => {
  const th = [...document.querySelectorAll('#weekGrid .week-grid th')].map((e) => e.getBoundingClientRect());
  return { right: Math.max(...th.map((r) => r.right)), vw: innerWidth, scrollW: document.documentElement.scrollWidth, ths: th.length };
});
ok('폰 시간표가 월~금 한 화면에 꽉 참(가로 스크롤 없음)', fit.ths === 6 && fit.right <= fit.vw + 0.5 && fit.scrollW <= fit.vw + 0.5, JSON.stringify(fit));
const fill = await T.page.evaluate(() => { const sl = document.querySelector('#weekGrid .slot'); return sl.getBoundingClientRect().width / sl.parentElement.getBoundingClientRect().width; });
ok('폰 시간표 칸이 열 폭을 꽉 채움(안쪽 여백으로 좁아 보이지 않음)', fill > 0.92, String(fill));
ok('칸에 학년 색(--gh)·과목 색(--sh)이 붙음', await T.page.$eval('#weekGrid .slot', (e) => /--gh:\d+;--sh:\d+/.test(e.getAttribute('style'))));
const vfit = await T.page.evaluate(() => {
  const rows = [...document.querySelectorAll('#weekGrid .week-grid tr')];
  return { lastBottom: rows.at(-1).getBoundingClientRect().bottom, tabTop: document.querySelector('.tabbar').getBoundingClientRect().top, periods: rows.length - 1, top: document.querySelector('#weekGrid').getBoundingClientRect().top };
});
ok('폰 시간표가 세로로도 한 화면에 다 들어옴(마지막 교시가 하단 탭 위)', vfit.lastBottom <= vfit.tabTop, JSON.stringify(vfit));
if (SHOTS) await T.page.screenshot({ path: path.join(SHOTS, '02c-week-m-viewport.png') });
await shot(T.page, '02b-week-m');

// 4) 오늘 수업: 컴시간 수업 목록 + 일지 쓰기
const p = T.page;
await p.click('.tab[data-go="today"]');
await p.waitForSelector('#todayList .lesson');
const hd = await p.evaluate(() => {
  const t = document.getElementById('navTitle').getBoundingClientRect();
  return { h1: getComputedStyle(document.getElementById('todayTitle')).display, text: document.getElementById('navTitle').textContent, center: (t.left + t.right) / 2, vw: innerWidth };
});
ok('폰: 큰 제목은 숨기고 상단 바 가운데에만 "오늘 수업"이 한 번 나옴', hd.h1 === 'none' && hd.text === '오늘 수업' && Math.abs(hd.center - hd.vw / 2) < 3, JSON.stringify(hd));
const n = await p.locator('#todayList .lesson').count();
ok('오늘(목) 수업 카드가 나옴', n > 0, `count=${n}`);
const debug = await p.evaluate(async () => (await (await fetch('/api/comci?code=43917&teacher=10')).json()).debug);
ok('시간표 해석: 과목*1000+교사, 겹침 0', debug.mode === 'subjectHigh' && debug.clashes === 0, JSON.stringify(debug));
await shot(p, '04-today-m');
const [grade, cls] = (await p.locator('#todayList .lesson .who').first().textContent()).trim().match(/^(\d+)-(\d+)/).slice(1);
await p.locator('#todayList .lesson').first().click();
await p.waitForSelector('#logModal.show');
ok('진도 칸은 비어 있고(직접 적기가 기본) 계획표 선택 칸은 따로 없음', (await p.inputValue('#lmUnit')) === '' && (await p.locator('#lmPlan').count()) === 0);
await p.fill('#lmContent', '일차방정식 풀이 연습');
await p.fill('#lmUnit', '2단원 1차시');
await p.fill('#lmHomework', '익힘책 10쪽');
await p.click('#lmSave');
await p.waitForSelector('#todayList .lesson .badge.ok');
ok('일지 저장 후 "작성" 표시', true);

// 5) 진도 계획: 여러 줄 붙여넣기 → 저장
await p.click('.tab[data-go="settings"]');
await p.click('.pick-item[data-go="plan"]'); // 진도 계획은 설정의 바로가기에서 연다(폰 하단 탭에는 없음)
await p.waitForSelector('#planBulk');
await p.selectOption('#planSel', `${grade}_수학`);
await p.waitForSelector('#planBulk');
await p.fill('#planBulk', '# 2. 일차방정식\n등식의 성질\n일차방정식 풀이\n활용 문제\n# 3. 좌표평면\n순서쌍');
await p.click('#planBulkAdd');
await p.waitForSelector('.plan-row');
ok('계획 4차시 추가', (await p.locator('.plan-row').count()) === 4);
await p.click('#planSave');
await p.waitForSelector('#planSave[disabled]');
await shot(p, '05-plan-m');

// 6) 계획이 생긴 뒤: 기본은 비어 있고, 추천 칩·▾ 목록에서 골라 채움
await p.click('.tab[data-go="today"]');
await p.locator('#todayList .lesson').first().click();
await p.waitForSelector('#logModal.show');
ok('저장해 둔 진도(직접 적은 글)가 그대로 보임', (await p.inputValue('#lmUnit')) === '2단원 1차시');
await p.click('#lmUnitBtn');
await p.waitForSelector('#lmUnitMenu .combo-opt');
const nextOpt = await p.$eval('#lmUnitMenu .combo-opt.next', (e) => e.dataset.text);
ok('▾ 목록에 계획표가 단원별로 나오고 다음 차시가 강조됨', nextOpt === '등식의 성질' && (await p.locator('#lmUnitMenu .combo-grp').count()) === 2, nextOpt);
await shot(p, '06-log-modal-m');
await p.click('#lmUnitMenu .combo-opt.next');
ok('목록에서 고르면 진도 칸이 채워짐', (await p.inputValue('#lmUnit')) === '등식의 성질');
ok('"저장 후 다음 수업" 버튼이 보임', await p.isVisible('#lmSaveNext'));
await p.click('#lmSaveNext');
await p.waitForSelector('#lmTitle:has-text("2-1")');
ok('저장 후 같은 날 다음 수업(2-1)이 바로 열림, 진도는 비어 있음', (await p.inputValue('#lmUnit')) === '');
ok('계획표가 없는 학년(2학년)에서는 추천 칩이 없음', (await p.locator('#lmSuggest .suggest').count()) === 0);
await p.fill('#lmContent', '쓰다 만 내용');
await p.click('#lmCancel');
await p.waitForSelector('#askModal.show');
ok('쓰던 내용이 있으면 닫기 전에 한 번 확인함', true);
await p.click('#askNo');
await p.fill('#lmContent', '');
await p.click('#lmCancel');
await p.waitForSelector('#logModal.show', { state: 'detached' });
ok('바뀐 게 없으면 확인 없이 닫힘', true);

// 7) 보강 수업 추가 → 오늘 목록에 나옴
await p.click('[data-act="add-extra"]');
await p.fill('#exPeriod', '7');
await p.click('#exSave');
await p.waitForSelector('#todayList .lesson .badge.on');
ok('보강 수업이 오늘 목록에 추가됨', (await p.locator('#todayList .lesson').count()) === n + 1);

// 7b) 빠른 시작: 두 번째 실행부터는 저장해 둔 시간표를 먼저 그린다.
//     컴시간은 끊고, Firebase 도구(SDK)는 2.5초 늦춰도 시간표는 그 전에 보여야 한다.
await p.route('**/api/comci*', (r) => r.abort());
await p.route('https://www.gstatic.com/**', async (r) => { await new Promise((res) => setTimeout(res, 2500)); await r.fallback(); });
const t0 = Date.now();
await p.goto('http://localhost:8098/');
await p.waitForSelector('#app:not(.hidden) #sec-week.active #weekGrid .slot', { timeout: 5000 });
const firstPaint = Date.now() - t0;
ok('빠른 시작: Firebase 도구가 2.5초 늦어도 시간표가 먼저 뜸(폰에서는 처음에 시간표)', firstPaint < 2200, `${firstPaint}ms`);
await p.click('.slot', { trial: true }).catch(() => {});
await p.locator('#weekGrid .slot').first().click();
ok('일지를 불러오기 전에는 칸을 눌러도 안 열림(덮어쓰기 방지)', (await p.locator('#logModal.show').count()) === 0);
await p.waitForSelector('#weekGrid .slot.done', { timeout: 15000 });
ok('도구가 도착하면 ✓ 표시(일지 데이터)가 채워짐', true);
await p.unroute('https://www.gstatic.com/**');
await p.unroute('**/api/comci*');

// 7c) 새 버전 감지: 홈 화면 앱은 새로고침이 없으니 앱이 스스로 확인해서 적용한다
const deploy = () => fetch('http://localhost:8098/__deploy');
await p.waitForFunction(() => document.querySelector('#app:not(.hidden)'));
await p.evaluate(() => { window.__marker = 1; });
await p.click('.tab[data-go="settings"]');
await p.click('[data-act="check-update"]');
await p.waitForSelector('#toast.show');
ok('최신이면 새로고침 없이 "최신 버전이에요"만 알려줌', (await p.textContent('#toast')).includes('최신') && (await p.evaluate(() => window.__marker)) === 1);
await deploy(); // 새 버전 배포
await p.click('.tab[data-go="week"]');
await p.locator('#weekGrid .slot').first().click();
await p.waitForSelector('#logModal.show');
await p.fill('#lmContent', '쓰는 중');
await p.evaluate(() => document.dispatchEvent(new Event('visibilitychange')));
await p.waitForSelector('#updateBar:not(.hidden)');
ok('일지 작성 중에는 자동으로 새로고침하지 않고 알림줄만 띄움', (await p.evaluate(() => window.__marker)) === 1 && (await p.locator('#logModal.show').count()) === 1);
await p.click('#updateBar');
await p.waitForFunction(() => !window.__marker);
await p.waitForSelector('#app:not(.hidden)');
ok('알림줄을 누르면 새 버전으로 다시 열리고 주소의 ?v= 는 정리됨', !p.url().includes('v='));
await p.evaluate(() => { window.__marker = 1; });
await p.waitForTimeout(2000); // 앱이 기준 버전을 기록할 때까지(시작 1.5초 뒤)
await deploy(); // 또 배포 — 이번엔 아무것도 안 하고 있을 때
await p.evaluate(() => { document.activeElement?.blur?.(); document.dispatchEvent(new Event('visibilitychange')); });
await p.waitForFunction(() => !window.__marker, null, { timeout: 8000 });
await p.waitForSelector('#app:not(.hidden)');
ok('아무것도 안 하는 중이면 앱으로 돌아올 때 자동으로 새 버전이 적용됨', true);

// 8) 주간·진도·내보내기 (PC 화면)
const P = A.page; // 관리자도 같은 교사 번호로 가입 → 데이터는 사람마다 따로
await T.page.setViewportSize({ width: 1440, height: 1000 });
await p.click('.side-item[data-go="week"]');
await p.waitForSelector('#weekGrid .slot.done');
ok('주간 표에 작성한 칸 표시', (await p.locator('#weekGrid .slot.done').count()) >= 1);
await shot(p, '07-week-pc');
await p.selectOption('#weekSel', '2');
await p.waitForSelector('#weekGrid .slot');
ok('다음 주 시간표 불러오기', (await p.locator('#weekGrid .slot').count()) > 0);
// 8b) 진도 드롭다운: 같은 학년 다른 반(아직 안 쓴 칸)에서도 계획표·이전 진도가 나옴
await p.locator('#weekGrid .slot:not(.done)', { hasText: /^3-\d/ }).first().click();
await p.waitForSelector('#logModal.show');
ok('다른 3학년 반(진도는 반마다 따로): 비어 있으면 첫 차시 추천 칩이 작게 보임', (await p.textContent('#lmSuggest .suggest')).includes('등식의 성질'));
await p.click('#lmUnitBtn');
await p.waitForSelector('#lmUnitMenu .combo-opt');
ok('같은 학년 다른 반에서도 계획표 4차시 + 이전에 쓴 진도가 목록에 나옴', (await p.locator('#lmUnitMenu .combo-opt').count()) >= 5 && (await p.locator('#lmUnitMenu .combo-sec').allTextContents()).some((t) => t.includes('이전에 쓴 진도')));
await p.click('#lmTitle'); // 바깥을 누르면 목록이 닫힘
ok('목록 바깥을 누르면 닫힘', await p.$eval('#lmUnitMenu', (e) => e.classList.contains('hidden')));
await p.click('#lmContentBtn');
await p.waitForSelector('#lmContentMenu .combo-opt');
await p.click('#lmContentMenu .combo-opt');
ok('이전 수업 내용을 눌러 가져옴', (await p.inputValue('#lmContent')).includes('일차방정식 풀이 연습'));
await p.fill('#lmContent', '');
await p.click('#lmCancel');
await p.waitForSelector('#logModal.show', { state: 'detached' });

// 8c) 학급 시간표(담임용)
await p.click('.side-item[data-go="class"]');
await p.waitForSelector('#clsGrid .slot.ro');
ok('학급 시간표: 내 담임 반(3-1)이 기본으로 열리고 배지가 보임', (await p.textContent('#clsTitle')).includes('3학년 1반') && (await p.textContent('#clsBadge')).includes('내 담임'));
ok('학급 시간표: 과목과 선생님 이름이 보임', /교사\d+\*/.test(await p.textContent('#clsGrid')) && (await p.locator('#clsGrid .slot.mine').count()) >= 1);
await p.selectOption('#clsNum', '2');
await p.waitForSelector('#clsTitle:has-text("3학년 2반")');
await p.waitForSelector('#clsGrid .slot.ro');
await p.selectOption('#clsGrade', '1');
await p.waitForSelector('#clsTitle:has-text("1학년 1반")');
await p.waitForSelector('#clsGrid .slot.ro');
ok('학급 시간표: 학년·반을 바꾸면 그 반 시간표가 나옴', (await p.locator('#clsGrid .slot.ro').count()) > 0);
await shot(p, '07b-class-pc');
// 8c2) 교사별: 다른 선생님 수업은 볼 수만 있고 일지는 못 연다
await p.click('#clsMode button[data-v="teacher"]');
await p.waitForSelector('#clsTeacher:not(.hidden)');
await p.waitForSelector('#clsGrid .slot.ro');
ok('교사별: 선생님 목록에 이름 옆 담당 과목이 같이 나옴', (await p.locator('#clsTeacher option', { hasText: '교사10* · 수학' }).count()) === 1);
ok('교사별: 다른 선생님 시간표가 "보기 전용"으로 나옴(눌러지는 버튼 없음)', (await p.textContent('#clsBadge')).includes('보기 전용') && (await p.locator('#clsGrid .slot.ro').count()) > 0 && (await p.locator('#clsGrid button').count()) === 0);
await shot(p, '07c-teacher-pc');
await p.locator('#clsGrid .slot.ro').first().click();
ok('교사별: 다른 선생님 칸을 눌러도 일지가 열리지 않음', (await p.locator('#logModal.show').count()) === 0);
await p.selectOption('#clsTeacher', '10');
await p.waitForSelector('#clsBadge .badge.on');
ok('교사별: 나를 고르면 "일지는 시간표에서" 안내', (await p.textContent('#clsBadge')).includes('시간표'));
await p.click('#clsMode button[data-v="class"]');
await p.click('.side-item[data-go="progress"]');
await p.waitForSelector('.class-card');
await p.locator(`.class-card[data-k="${grade}-${cls}|수학"]`).click();
await p.waitForSelector('.matrix .ck');
ok('반별 진도 비교표에 ✓ 표시', (await p.locator('.matrix .ck').count()) === 1);
await shot(p, '08-progress-pc');
await p.click('.side-item[data-go="export"]');
await p.waitForSelector('.export-table');
ok('내보내기 표에 기록 1건', (await p.locator('.export-table tr').count()) === 2);
const [dl] = await Promise.all([p.waitForEvent('download'), p.click('[data-act="csv"]')]);
const csv = readFileSync(await dl.path(), 'utf8');
ok('CSV에 진도·내용이 들어감', csv.includes('등식의 성질') && csv.includes('일차방정식 풀이 연습'), csv.slice(0, 200));
await shot(p, '09-export-pc');

// 8d) 푸터(저작권·인스타·메일) + 피드백
ok('푸터: 관산중학교 오범석 저작권', (await p.textContent('#app .credit')).includes('관산중학교 오범석'));
ok('푸터: 인스타그램·메일 링크', (await p.locator('#app .credit a[href="https://instagram.com/nosuk.beom"]').count()) === 1 && (await p.locator('#app .credit a[href="mailto:qjatjr7575@gmail.com"]').count()) === 1);
await p.click('#app .credit [data-act="feedback"]');
await p.waitForSelector('#fbModal.show');
await p.click('#fbKind button[data-v="bug"]');
await p.fill('#fbText', '학급 시간표에서 선택과목이 겹쳐 보여요');
await p.click('#fbSend');
await p.waitForSelector('#fbModal.show', { state: 'detached' });
let fbDocs = [];
await env.withSecurityRulesDisabled(async (c) => { fbDocs = (await c.firestore().collection('classlog_feedback').get()).docs.map((d) => d.data()); });
ok('피드백이 Firestore에 저장됨(종류·내용·보낸 사람)', fbDocs.length === 1 && fbDocs[0].kind === 'bug' && fbDocs[0].text.includes('선택과목') && fbDocs[0].teacherName === '교사10*', JSON.stringify(fbDocs));

// 9) 다른 사람 데이터는 안 보임(관리자 일지 0건)
await P.click('.side-item[data-go="export"]');
await P.waitForSelector('#exTable .empty-state');
ok('관리자 계정에는 교사의 일지가 섞이지 않음', true);
await P.click('.side-item[data-go="admin"]');
await P.waitForSelector('#adminFeedback .user-row');
ok('관리자 화면에 받은 피드백이 보임', (await P.textContent('#adminFeedback')).includes('오류 신고'));
await P.click('.side-item[data-go="settings"]');
await shot(P, '10b-settings-pc');
ok('사이드바·상단 바에 "다크 모드" 스위치가 없음', (await P.locator('.dark-toggle, .nav-dark-label').count()) === 0);
await P.click('#themeSeg button[data-v="dark"]');
ok('설정에서 다크를 고르면 어두운 화면이 됨', await P.$eval('body', (b) => b.classList.contains('dark')));
await P.click('.side-item[data-go="week"]');
await P.waitForSelector('#weekGrid .slot');
await shot(P, '10-week-dark');

// 10) 해상도별 화면(SHOTS 를 줄 때만): 휴대폰·태블릿·노트북·큰 모니터
if (SHOTS) {
  for (const [w, h] of [[390, 844], [1024, 768], [1440, 900], [1920, 1080]]) {
    await p.setViewportSize({ width: w, height: h });
    for (const v of ['today', 'week', 'class', 'progress', 'plan', 'export', 'settings']) {
      await p.evaluate((v) => { location.hash = v; }, v);
      await p.waitForTimeout(250);
      await p.screenshot({ path: path.join(SHOTS, `res-${w}-${v}.png`) });
    }
  }
}

await browser.close(); server.close(); await env.cleanup();
console.log(fails ? `\n실패 ${fails}건` : '\n전부 통과');
process.exit(fails ? 1 : 0);
