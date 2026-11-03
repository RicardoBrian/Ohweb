// 컴시간 접속 정보 자동 수집 (GitHub Actions 에서 매일 실행)
// 컴시간 /st 스크립트가 난독화돼(2026-11) 글로는 읽을 수 없다 → 진짜 브라우저로 페이지를 열어
// 학교를 검색·선택하게 하고, 그때 페이지가 보내는 요청에서 데이터 주소(route)·검색 꼬리(search)·PREFIX 를 알아낸다.
//   사용: node comci-capture.mjs <저장할 comci-boot.js 경로>
// 결과가 기존 값과 다를 때만 파일을 고친다(같으면 그대로 → 커밋·재배포 없음). 진단 자료는 ./out/ 에 남긴다.
import { chromium } from 'playwright';
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';

const OUT = process.argv[2];
const HOST = process.env.COMCI_HOST || 'http://comci.net:4082';
const SCHOOL = process.env.COMCI_SCHOOL || '관산중';
const CODE = process.env.COMCI_CODE || '43917';
mkdirSync('out', { recursive: true });

const reqs = [];
const log = (...a) => console.log('[capture]', ...a);
const b64 = (s) => { try { const t = Buffer.from(decodeURIComponent(s), 'base64').toString('latin1'); return /^[\w]+$/.test(t) ? t : null; } catch { return null; } };

const browser = await chromium.launch(process.env.CHROMIUM_PATH ? { executablePath: process.env.CHROMIUM_PATH } : {});
const page = await browser.newPage({ locale: 'ko-KR' });
page.on('request', (r) => { if (r.url().startsWith(HOST)) reqs.push({ method: r.method(), url: r.url() }); });
page.on('pageerror', (e) => log('page error:', e.message));

function analyze() {
  let route, search, prefix;
  for (const { url } of reqs) {
    const m = url.match(/^https?:\/\/[^/]+\/(\d+)\?(.+)$/);
    if (!m) continue;
    const q = m[2];
    const s = q.match(/^(\d+l)/); // 학교 검색: ./36179?17384l + EUC-KR 학교명
    if (s) { route = m[1]; search = s[1]; continue; }
    const d = b64(q); // 시간표: ./36179?btoa('73629_43917_0_1')
    const p = d && d.match(new RegExp('^(.*?)' + CODE + '_0_\\d+$'));
    if (p) { route = m[1]; prefix = p[1]; }
  }
  return { route, search, prefix };
}

let result = {};
try {
  await page.goto(HOST + '/st', { waitUntil: 'networkidle', timeout: 30000 });
  await page.screenshot({ path: 'out/1-open.png', fullPage: true });
  // 학교 검색창: 보이는 글자 입력칸 중 첫 번째
  const input = page.locator('input[type=text]:visible, input:not([type]):visible').first();
  await input.fill(SCHOOL);
  await input.press('Enter').catch(() => {});
  await page.waitForTimeout(2500);
  if (!analyze().search) {
    // Enter 로 안 되면 입력칸 옆 버튼(검색)을 누른다
    const btn = page.locator('input[type=button]:visible, button:visible').first();
    await btn.click().catch(() => {});
    await page.waitForTimeout(2500);
  }
  await page.screenshot({ path: 'out/2-search.png', fullPage: true });
  // 검색 결과에서 학교 이름을 누른다
  const hit = page.getByText(SCHOOL, { exact: false }).filter({ hasNotText: '검색' });
  const n = await hit.count();
  for (let i = 0; i < n && !analyze().prefix; i++) {
    await hit.nth(i).click({ timeout: 3000 }).catch(() => {});
    await page.waitForTimeout(3000);
  }
  await page.screenshot({ path: 'out/3-timetable.png', fullPage: true });
  result = analyze();
} catch (e) {
  log('오류:', e.message);
} finally {
  writeFileSync('out/requests.json', JSON.stringify(reqs, null, 2));
  writeFileSync('out/page.html', await page.content().catch(() => ''));
  await browser.close();
}

log('요청', reqs.length, '건:', reqs.map((r) => r.url).join('\n  '));
log('결과:', JSON.stringify(result));
if (!result.route || !result.search || result.prefix == null) {
  console.error('[capture] 접속 정보를 다 찾지 못함 — out/ 의 화면·요청 기록을 확인할 것');
  process.exit(1);
}
const src = readFileSync(OUT, 'utf8');
const prev = JSON.parse(src.slice(src.indexOf('{'), src.lastIndexOf('}') + 1));
const same = prev.route === result.route && prev.search === result.search && prev.prefix === result.prefix;
log(same ? '기존 값과 같음(파일 그대로)' : '바뀜 → 파일 갱신');
if (!same || !prev.capturedAt) writeFileSync(OUT, src.slice(0, src.indexOf('{')) + JSON.stringify({ ...prev, ...result, capturedAt: new Date().toISOString() }, null, 2) + ';\n');
