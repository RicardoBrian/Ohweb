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
const TYPES = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.png': 'image/png', '.svg': 'image/svg+xml' };
const server = http.createServer(async (req, res) => {
  const u = new URL(req.url, 'http://localhost');
  if (u.pathname === '/api/comci') {
    const r = await comci.onRequestGet({ request: new Request('http://localhost' + req.url), env: {} });
    res.writeHead(r.status, { 'content-type': 'application/json' }); res.end(await r.text()); return;
  }
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
await T.page.waitForSelector('#app:not(.hidden) #sec-today.active', { timeout: 10000 });
ok('승인되면 교사 화면이 자동으로 앱으로 바뀜', true);

// 4) 오늘 수업: 컴시간 수업 목록 + 일지 쓰기
const p = T.page;
await p.waitForSelector('#todayList .lesson');
const n = await p.locator('#todayList .lesson').count();
ok('오늘(목) 수업 카드가 나옴', n > 0, `count=${n}`);
const debug = await p.evaluate(async () => (await (await fetch('/api/comci?code=43917&teacher=10')).json()).debug);
ok('시간표 해석: 과목*1000+교사, 겹침 0', debug.mode === 'subjectHigh' && debug.clashes === 0, JSON.stringify(debug));
await shot(p, '04-today-m');
const [grade, cls] = (await p.locator('#todayList .lesson .who').first().textContent()).trim().match(/^(\d+)-(\d+)/).slice(1);
await p.locator('#todayList .lesson').first().click();
await p.waitForSelector('#logModal.show');
await p.fill('#lmContent', '일차방정식 풀이 연습');
await p.fill('#lmUnit', '2단원 1차시');
await p.fill('#lmHomework', '익힘책 10쪽');
await p.click('#lmSave');
await p.waitForSelector('#todayList .lesson .badge.ok');
ok('일지 저장 후 "작성" 표시', true);

// 5) 진도 계획: 여러 줄 붙여넣기 → 저장
await p.click('.tab[data-go="plan"]');
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

// 6) 다시 일지를 열면 다음 차시가 골라져 있음 → 계획 차시로 저장
await p.click('.tab[data-go="today"]');
await p.locator('#todayList .lesson').first().click();
await p.waitForSelector('#logModal.show');
const planVisible = await p.isVisible('#lmPlanField');
ok('계획이 있으면 진도 선택 칸이 보임', planVisible);
const opt = await p.$eval('#lmPlan', (s) => s.selectedOptions[0]?.textContent);
ok('다음 차시(첫 차시)가 미리 골라짐', opt === '등식의 성질', opt);
await shot(p, '06-log-modal-m');
await p.click('#lmSave');
await p.waitForSelector('#logModal.show', { state: 'detached' });

// 7) 보강 수업 추가 → 오늘 목록에 나옴
await p.click('[data-act="add-extra"]');
await p.fill('#exPeriod', '7');
await p.click('#exSave');
await p.waitForSelector('#todayList .lesson .badge.on');
ok('보강 수업이 오늘 목록에 추가됨', (await p.locator('#todayList .lesson').count()) === n + 1);

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

// 9) 다른 사람 데이터는 안 보임(관리자 일지 0건)
await P.click('.side-item[data-go="export"]');
await P.waitForSelector('#exTable .empty-state');
ok('관리자 계정에는 교사의 일지가 섞이지 않음', true);
await P.click('.dark-toggle');
await P.click('.side-item[data-go="week"]');
await P.waitForSelector('#weekGrid .slot');
await shot(P, '10-week-dark');

// 10) 해상도별 화면(SHOTS 를 줄 때만): 휴대폰·태블릿·노트북·큰 모니터
if (SHOTS) {
  await P.click('.dark-toggle');
  for (const [w, h] of [[390, 844], [1024, 768], [1440, 900], [1920, 1080]]) {
    await p.setViewportSize({ width: w, height: h });
    for (const v of ['today', 'week', 'progress', 'plan', 'export']) {
      await p.evaluate((v) => { location.hash = v; }, v);
      await p.waitForTimeout(250);
      await p.screenshot({ path: path.join(SHOTS, `res-${w}-${v}.png`) });
    }
  }
}

await browser.close(); server.close(); await env.cleanup();
console.log(fails ? `\n실패 ${fails}건` : '\n전부 통과');
process.exit(fails ? 1 : 0);
