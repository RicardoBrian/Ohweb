// 공개용 자리 바꾸기(ohinfo/public/자리바꾸기.html) e2e — DB·로그인 없음, 브라우저 저장만.
// 명렬표 붙여넣기 → 교실 만들기 → 뽑기(테마마다) → 빠르게 모두 → 새로 고침해도 유지 → PDF 내려받기
import { chromium } from 'playwright-core';
import { readFileSync } from 'node:fs';
import http from 'node:http';
import path from 'node:path';

const ROOT = new URL('../ohinfo/public', import.meta.url).pathname;
const NM = new URL('./node_modules', import.meta.url).pathname;
const SHOT = process.env.SHOT_DIR;
let fails = 0;
const ok = (label, cond, extra = '') => { if (cond) console.log('✅ ' + label); else { fails++; console.log('❌ ' + label + (extra ? ' — ' + extra : '')); } };

// 관리자 판과 같은 연출 파일이어야 한다
ok('seats-themes.js 가 관리자 판과 같음', readFileSync(path.join(ROOT, 'seats-themes.js'), 'utf8') === readFileSync(new URL('../ohweb/public/seats-themes.js', import.meta.url), 'utf8'));

const srv = http.createServer((req, res) => {
  let p = decodeURIComponent(new URL(req.url, 'http://x').pathname);
  if (!path.extname(p)) p += '.html'; // Cloudflare Pages 처럼 .html 없이도 연다
  try { const body = readFileSync(path.join(ROOT, p)); res.writeHead(200, { 'content-type': p.endsWith('.js') ? 'text/javascript' : p.endsWith('.css') ? 'text/css' : p.endsWith('.png') ? 'image/png' : 'text/html; charset=utf-8' }); res.end(body); }
  catch { res.writeHead(404); res.end(); }
}).listen(8096);

const browser = await chromium.launch(process.env.CHROMIUM_PATH ? { executablePath: process.env.CHROMIUM_PATH } : {});
const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: SHOT ? 2 : 1, acceptDownloads: true });
await ctx.route('**/*', route => {
  const u = route.request().url();
  if (u.includes('cdnjs.cloudflare.com/ajax/libs/html2canvas/1.4.1/html2canvas.min.js')) return route.fulfill({ contentType: 'text/javascript', body: readFileSync(path.join(NM, 'html2canvas/dist/html2canvas.min.js')) });
  if (u.includes('cdnjs.cloudflare.com/ajax/libs/jspdf/2.5.1/jspdf.umd.min.js')) return route.fulfill({ contentType: 'text/javascript', body: readFileSync(path.join(NM, 'jspdf/dist/jspdf.umd.min.js')) });
  if (u.startsWith('http://localhost:')) return route.continue();
  return route.abort();
});
const page = await ctx.newPage();
const errors = [];
page.on('pageerror', e => errors.push(e.message));
page.on('console', m => { if (m.type() === 'error' && !/ERR_FAILED|Failed to load resource/.test(m.text())) errors.push(m.text()); });
const settled = () => page.waitForFunction(() => !document.querySelector('.tok') && !document.querySelector('#btnFire').disabled || document.querySelector('#leftCount').textContent === '0', null, { timeout: 15000 });

try {
  await page.goto('http://localhost:8096/' + encodeURIComponent('자리바꾸기'));
  await page.waitForSelector('#rsText', { timeout: 10000 });
  ok('처음 열면 명렬표 창', true);
  // 엑셀에서 복사한 것처럼: 머리줄 + 탭, 학번 칸이 섞인 줄, 번호 없는 줄
  await page.fill('#rsName', '2학년 3반');
  await page.fill('#rsText', '번호\t이름\n1\t김하늘\n2\t이도윤\n3 박서연\n4,최지호\n5\t20305\t정하린\n6 강민준\n7 조수아\n8 윤지우\n9 장서준\n10 임예린');
  ok('10명 인식', (await page.textContent('#rsCount')) === '10명 인식됨', await page.textContent('#rsCount'));
  await page.click('#rsSave');
  // 교실이 없으니 교실 창이 이어서 뜬다
  await page.waitForSelector('#edGrid .ed-cell', { timeout: 5000 });
  await page.click('[data-preset="0"]');
  await page.fill('#edRows', '2'); // 12자리
  await page.click('#edSave');
  await page.waitForSelector('.seatgrid .seat');
  ok('자리 12개', await page.locator('.seat').count() === 12);
  ok('반 선택에 2학년 3반 (10명)', (await page.textContent('#selClass')).includes('2학년 3반 (10명)'));
  ok('정하린 번호 5 (학번 칸 무시)', (await page.textContent('#roster')).includes('5정하린'));

  for (const th of ['cannon', 'gacha', 'crane', 'card', 'swipe', 'balloon']) {
    const before = await page.locator('.seat.filled').count();
    await page.selectOption('#selTheme', th);
    await page.click('#btnFire');
    await page.waitForFunction(n => document.querySelectorAll('.seat.filled').length === n + 1 && !document.querySelector('.tok'), before, { timeout: 15000 });
    await settled();
    ok(`테마 ${th}`, (await page.locator('.seat.filled').count()) === before + 1);
  }
  await page.click('#btnAll');
  await page.waitForFunction(() => document.querySelector('#leftCount').textContent === '0' && !document.querySelector('.tok') && document.querySelector('#btnAll span').textContent === '빠르게 모두' && !document.querySelector('#btnReset').disabled, null, { timeout: 20000 });
  const filled = await page.evaluate(() => [...document.querySelectorAll('.seat.filled')].map(s => +s.dataset.no).sort((a, b) => a - b));
  ok('1~10번 자리 순서대로', JSON.stringify(filled) === JSON.stringify([1, 2, 3, 4, 5, 6, 7, 8, 9, 10]), JSON.stringify(filled));
  const seat1 = await page.textContent('.seat[data-no="1"] .sname');

  // 새로 고침해도 그대로
  await page.reload();
  await page.waitForSelector('.seat.filled');
  ok('새로 고침 뒤 배치 유지', (await page.locator('.seat.filled').count()) === 10 && (await page.textContent('.seat[data-no="1"] .sname')) === seat1);
  if (SHOT) await page.screenshot({ path: SHOT + '/public-done.png' });

  // PDF
  const [dl] = await Promise.all([page.waitForEvent('download', { timeout: 20000 }), page.click('#btnPdf')]);
  if (SHOT) await dl.saveAs(SHOT + '/public.pdf');
  const file = await dl.path(), head = readFileSync(file).subarray(0, 5).toString();
  ok('PDF 내려받기', head === '%PDF-' && dl.suggestedFilename().includes('2학년 3반_자리배치_'), dl.suggestedFilename() + ' ' + head);
  ok('PDF 뒤 화면 원래대로', await page.evaluate(() => !document.body.classList.contains('pdf-mode')));

  // 명렬표 고치기: 한 명 추가해도 기존 배치는 유지
  await page.click('#btnEditRoster');
  await page.fill('#rsText', (await page.inputValue('#rsText')) + '\n11 한유나');
  await page.click('#rsSave');
  await page.waitForFunction(() => !document.querySelector('#modal').classList.contains('open'));
  ok('명렬표 고친 뒤 배치 유지', (await page.locator('.seat.filled').count()) === 10 && (await page.textContent('#leftCount')) === '1');

  await page.setViewportSize({ width: 390, height: 844 });
  ok('모바일 가로 넘침 없음', !(await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth + 1)));
  if (SHOT) await page.screenshot({ path: SHOT + '/public-mobile.png', fullPage: true });
  ok('콘솔 오류 없음', !errors.length, errors.join(' | '));
} catch (e) {
  fails++; console.log('❌ 예외: ' + e.message);
  if (SHOT) await page.screenshot({ path: SHOT + '/public-error.png' }).catch(() => {});
  if (errors.length) console.log(errors.join('\n'));
}
await browser.close(); srv.close();
console.log(fails ? `\n실패 ${fails}건` : '\n전부 통과'); process.exit(fails ? 1 : 0);
