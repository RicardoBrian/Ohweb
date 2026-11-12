// 컴시간 시간표 자동 수집 (GitHub Actions comci-boot 에서 실행)
// 2026-11-07: 컴시간이 시간표 응답을 'enc5:…' 로 암호화해 서버(Cloudflare)에서는 읽을 수 없다.
// → 진짜 브라우저로 컴시간 /st 를 열어 학교를 검색·선택하고, 페이지가 스스로 푼 직후(JSON.parse)의 시간표를 가로챈다.
//   사용: node comci-capture.mjs <데이터 폴더>                 등록된 학교 전부(폴더의 <코드>_<이름>.json)
//         node comci-capture.mjs <데이터 폴더> <코드> <학교이름>  이 학교만(새로 등록)
// 학교마다 <코드>_<학교이름>.json = { code, name, region, changedAt, weeks: [{ r, label, raw }] } 를 쓴다.
// 시간표가 그대로면 파일을 건드리지 않는다(커밋 없음). 못 찾으면 { code, name, error } 를 쓴다(등록 실패 표시).
// 진단 자료(화면·요청 기록)는 ./out/ 에 남긴다.
import { chromium } from 'playwright';
import { readFileSync, writeFileSync, readdirSync, unlinkSync, mkdirSync, existsSync } from 'node:fs';
import path from 'node:path';

const [DIR, ONE_CODE, ONE_NAME] = process.argv.slice(2);
const HOST = process.env.COMCI_HOST || 'http://comci.net:4082';
if (!DIR) { console.error('사용: node comci-capture.mjs <데이터 폴더> [코드 학교이름]'); process.exit(2); }
mkdirSync('out', { recursive: true });
mkdirSync(DIR, { recursive: true });
const log = (...a) => console.log('[capture]', ...a);

// 파일 이름: 43917_관산중학교.json (서버는 목록만 보고 이름으로 검색한다)
const safe = (s) => String(s).replace(/[\\/:*?"<>|\s]+/g, '').slice(0, 40);
const fileOf = (code, name) => path.join(DIR, `${code}_${safe(name)}.json`);
function existing() {
  const out = [];
  for (const f of readdirSync(DIR)) {
    const m = f.match(/^(\d{1,8})_(.+)\.json$/);
    if (!m) continue;
    try { out.push({ file: path.join(DIR, f), ...JSON.parse(readFileSync(path.join(DIR, f), 'utf8')) }); } catch {}
  }
  return out;
}

// 컴시간이 '일자자료'·'일과시간' 같은 이름도 '자료136' 처럼 매번 바꾸므로, 모양을 보고 원래 이름을 붙여 둔다(서버가 이 이름을 쓴다).
function renameKeys(raw) {
  if (!raw?.['학급수']) return raw;
  for (const [k, v] of Object.entries(raw)) {
    if (!/^자료\d+$/.test(k) || !Array.isArray(v) || !v.length) continue;
    if (!raw['일자자료'] && v.every((x) => Array.isArray(x) && x.length === 2 && /\d{2}-\d{2}-\d{2}\s*~/.test(String(x[1])))) raw['일자자료'] = v;
    else if (!raw['일과시간'] && v.every((x) => typeof x === 'string' && /^\d+\(\d{1,2}:\d{2}\)/.test(x))) raw['일과시간'] = v;
  }
  return raw;
}

const browser = await chromium.launch(process.env.CHROMIUM_PATH ? { executablePath: process.env.CHROMIUM_PATH } : {});

// 학교 하나: 이름으로 검색 → onclick="sc_disp(코드)" 를 누름 → 일자 목록의 주마다 해독된 시간표를 모은다
async function capture(code, query, tag) {
  const page = await browser.newPage({ locale: 'ko-KR' });
  const reqs = [];
  page.on('request', (r) => { if (r.url().startsWith(HOST)) reqs.push(r.url()); });
  page.on('pageerror', (e) => log(code, 'page error:', e.message));
  await page.addInitScript(() => {
    window.__comci = [];
    const orig = JSON.parse;
    JSON.parse = function (t, ...r) {
      const v = orig.call(this, t, ...r);
      try { if (v && (v['학급수'] || v['학교검색'])) window.__comci.push(v); } catch {}
      return v;
    };
  });
  // 2026-11-11: 컴시간이 해독된 시간표 안의 글자(이름·과목·날짜·주 목록)를 다시 XOR+base64 로 숨기고,
  // 그 키를 페이지를 열 때마다 바꾼다(페이지 안 QnmsbChange). 나중에는 풀 수 없으니 여기서 페이지 함수로 풀어 저장한다.
  const take = () => page.evaluate(() => {
    const list = window.__comci.splice(0);
    const dec = typeof QnmsbChange === 'function' ? QnmsbChange : null; // eslint-disable-line no-undef
    if (!dec) return list;
    const B64 = /^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=|[A-Za-z0-9+/]{4})$/;
    const walk = (v) => {
      if (typeof v === 'string') { if (B64.test(v)) { try { return dec(v); } catch {} } return v; }
      if (Array.isArray(v)) return v.map(walk);
      if (v && typeof v === 'object') { const o = {}; for (const k of Object.keys(v)) o[k] = walk(v[k]); return o; }
      return v;
    };
    return list.map(walk);
  }).then((list) => list.map(renameKeys)).catch(() => []);
  try {
    await page.goto(HOST + '/st', { waitUntil: 'networkidle', timeout: 30000 });
    const input = page.locator('input[type=text]:visible, input:not([type]):visible').first();
    await input.fill(query);
    await input.press('Enter').catch(() => {});
    await page.waitForTimeout(2500);
    const found = (await take()).find((v) => v['학교검색'])?.['학교검색'] || [];
    const hit = page.locator(`[onclick="sc_disp(${code})"]`).first();
    if (!(await hit.count())) {
      await page.screenshot({ path: `out/${tag}-search.png`, fullPage: true });
      return { error: `컴시간에서 '${query}'로 검색한 결과에 학교 코드 ${code}가 없어요`, results: found.length };
    }
    const name = (await hit.textContent()).trim() || query;
    const region = found.find((x) => x[2] === name)?.[1] || '';
    await hit.click({ timeout: 5000 });
    await page.waitForTimeout(3000);
    const weeks = [];
    const add = async () => {
      const raw = (await take()).filter((v) => v['학급수']).at(-1);
      if (!raw) return;
      const label = await page.locator('select').filter({ hasText: '~' }).first().evaluate((s) => s.options[s.selectedIndex]?.text || '').catch(() => '');
      const r = (raw['일자자료'] || []).find(([, l]) => String(l).trim() === label.trim())?.[0] ?? weeks.length + 1;
      if (!weeks.some((w) => w.r === r)) weeks.push({ r: Number(r), label: label.trim(), raw });
    };
    await add();
    const sel = page.locator('select').filter({ hasText: '~' }).first();
    const n = await sel.locator('option').count().catch(() => 0);
    for (let i = 0; i < n; i++) {
      const before = weeks.length;
      await sel.selectOption({ index: i }).catch(() => {});
      await page.waitForTimeout(2500);
      await add();
      if (weeks.length === before) await page.waitForTimeout(1500).then(add);
    }
    await page.screenshot({ path: `out/${tag}-timetable.png`, fullPage: true });
    if (!weeks.length) return { error: '학교를 골랐지만 시간표를 못 가로챘어요(컴시간 화면이 바뀌었을 수 있음)' };
    weeks.sort((a, b) => a.r - b.r);
    return { name, region, weeks };
  } catch (e) {
    await page.screenshot({ path: `out/${tag}-error.png`, fullPage: true }).catch(() => {});
    return { error: e.message };
  } finally {
    writeFileSync(`out/${tag}-requests.json`, JSON.stringify(reqs, null, 2));
    await page.close();
  }
}

const list = ONE_CODE
  ? [{ code: ONE_CODE, name: ONE_NAME || '', query: ONE_NAME || '' }]
  : existing().filter((s) => !s.error).map((s) => ({ code: String(s.code), name: s.name, query: s.query || s.name, prev: s }));
if (!ONE_CODE && !list.length) list.push({ code: '43917', name: '관산중학교', query: '관산중' }); // 처음: 관산중부터
if (ONE_CODE && !/^\d{1,8}$/.test(ONE_CODE)) { console.error('학교 코드 형식이 아님'); process.exit(2); }

let failed = 0, changed = 0;
for (const s of list) {
  const prev = s.prev || existing().find((x) => String(x.code) === s.code);
  const res = await capture(s.code, s.query, s.code);
  if (res.error) {
    failed++;
    log(s.code, s.name, '실패:', res.error);
    // 새로 등록하는 학교만 실패를 파일로 남긴다(앱이 '못 찾음'을 보여주게). 이미 있던 학교는 마지막 시간표를 그대로 둔다.
    if (ONE_CODE && !(prev && !prev.error)) {
      if (prev?.file && existsSync(prev.file)) unlinkSync(prev.file);
      writeFileSync(fileOf(s.code, s.name || s.code), JSON.stringify({ code: Number(s.code), name: s.name, query: s.query, error: res.error, at: new Date().toISOString() }));
      changed++;
    }
    continue;
  }
  const same = prev && !prev.error && JSON.stringify(prev.weeks) === JSON.stringify(res.weeks) && prev.name === res.name;
  log(s.code, res.name, res.weeks.map((w) => `${w.r}주(${w.label})`).join(', '), same ? '그대로' : '바뀜');
  if (same) continue;
  if (prev?.file && existsSync(prev.file)) unlinkSync(prev.file); // 이름이 바뀌었으면 파일 이름도 바뀐다
  writeFileSync(fileOf(s.code, res.name), JSON.stringify({ code: Number(s.code), name: res.name, region: res.region, query: s.query, changedAt: new Date().toISOString(), weeks: res.weeks }));
  changed++;
}
await browser.close();
log(`학교 ${list.length}곳, 바뀜 ${changed}, 실패 ${failed}`);
// 전부 실패면 실행을 실패로 표시(관리자 화면 경고). 등록 하나가 실패한 것은 정상(잘못된 코드일 수 있음).
if (failed && failed === list.length && !ONE_CODE) process.exit(1);
