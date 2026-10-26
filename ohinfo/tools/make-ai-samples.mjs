// AI 실험실 표 데이터 연습용 예시(가상 데이터) 만들기 → ohweb/public/ai-data/*.csv
// 같은 씨앗이라 언제 돌려도 같은 파일이 나온다. 빈칸·이상한 값을 몇 개 일부러 넣어 둔다(② 데이터 살펴보기 연습).
//   node ohinfo/tools/make-ai-samples.mjs
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const OUT = path.join(path.dirname(fileURLToPath(import.meta.url)), '../../ohweb/public/ai-data');
let a = 20261018;
const rand = () => { a |= 0; a = a + 0x6D2B79F5 | 0; let t = Math.imul(a ^ a >>> 15, 1 | a); t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t; return ((t ^ t >>> 14) >>> 0) / 4294967296; };
const gauss = (m, s) => { const u = 1 - rand(), v = rand(); return m + s * Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v); };
const pick = (list, w) => { let r = rand() * w.reduce((x, y) => x + y, 0); for (let i = 0; i < list.length; i++) { r -= w[i]; if (r < 0) return list[i]; } return list[list.length - 1]; };
const r1 = v => Math.round(v * 10) / 10, r0 = v => Math.round(v);
const shuffle = arr => { for (let i = arr.length - 1; i > 0; i--) { const j = Math.floor(rand() * (i + 1)); [arr[i], arr[j]] = [arr[j], arr[i]]; } return arr; };
function write(name, cols, rows) {
  const csv = [cols, ...rows].map(r => r.map(c => (/[",\n]/.test(String(c)) ? `"${String(c).replace(/"/g, '""')}"` : c)).join(',')).join('\n') + '\n';
  fs.writeFileSync(path.join(OUT, name), csv);
  console.log(name, rows.length + '줄');
}

// 1) 펭귄 종류(분류) — 남극 펭귄 연구 자료(Palmer Penguins)의 평균·흩어짐을 본뜬 가상 데이터
{
  const sp = [
    ['아델리', 50, [38.8, 2.7], [18.3, 1.2], [190, 6.5], [3700, 460], [['토르게르센', '비스코', '드림'], [1, 1, 1]]],
    ['젠투', 45, [47.5, 3.1], [15.0, 1.0], [217, 6.5], [5076, 504], [['비스코'], [1]]],
    ['턱끈', 30, [48.8, 3.3], [18.4, 1.1], [196, 7.1], [3733, 384], [['드림'], [1]]],
  ];
  let rows = [];
  for (const [name, n, bl, bd, fl, ms, [isl, w]] of sp) for (let i = 0; i < n; i++) rows.push([r1(gauss(...bl)), r1(gauss(...bd)), r0(gauss(...fl)), r0(gauss(...ms) / 25) * 25, pick(isl, w), name]);
  rows = shuffle(rows);
  rows[7][3] = ''; rows[41][0] = ''; rows[63][3] = 37500; rows[88][2] = 19;   // 빈칸 2, 이상한 값 2(단위 실수)
  write('penguin.csv', ['부리 길이(mm)', '부리 두께(mm)', '날개 길이(mm)', '몸무게(g)', '사는 섬', '펭귄 종류'], rows);
}

// 2) 과일 이름(분류) — 쉬운 예시: 색깔만 봐도 거의 맞히지만 초록 과일은 다른 정보가 필요하다
{
  const fr = [
    ['사과', 26, [250, 35], [8, 0.8], [['빨강', '초록'], [8, 2]], [['매끈'], [1]]],
    ['바나나', 24, [150, 25], [18, 2.5], [['노랑', '초록'], [9, 1]], [['매끈'], [1]]],
    ['귤', 25, [110, 20], [6, 0.7], [['주황', '초록'], [9, 1]], [['울퉁불퉁', '매끈'], [8, 2]]],
  ];
  let rows = [];
  for (const [name, n, wt, ln, [cl, cw], [sk, sw]] of fr) for (let i = 0; i < n; i++) rows.push([r0(gauss(...wt)), r1(gauss(...ln)), pick(cl, cw), pick(sk, sw), name]);
  rows = shuffle(rows);
  rows[12][0] = ''; rows[30][0] = 1800; rows[51][1] = '모름';
  write('fruit.csv', ['무게(g)', '길이(cm)', '색깔', '껍질', '과일'], rows);
}

// 3) 키로 발 크기 예측(예측, 정보 1개) — 직선 하나로 보기 좋은 예시
{
  let rows = [];
  for (let i = 0; i < 50; i++) { const h = r0(gauss(160, 8)); rows.push([h, r0((h * 1.55 - 10 + gauss(0, 6)) / 5) * 5]); }
  rows[17][1] = ''; rows[33][0] = 16.2;
  write('foot.csv', ['키(cm)', '발 크기(mm)'], rows);
}

// 4) 아이스크림 판매량(예측, 정보 여러 개)
{
  let rows = [];
  for (let i = 0; i < 60; i++) {
    const temp = r1(gauss(24, 6)), hum = r0(Math.min(95, Math.max(25, gauss(60, 15)))), rain = rand() < 0.7 ? 0 : r0(rand() * 40);
    rows.push([temp, hum, rain, Math.max(0, r0(12 * temp - 0.8 * hum - 3 * rain + 60 + gauss(0, 22)))]);
  }
  rows[9][0] = -99; rows[25][3] = ''; rows[44][1] = '';
  write('icecream.csv', ['기온(℃)', '습도(%)', '비(mm)', '판매량(개)'], rows);
}

// 5) 공부 습관과 점수(예측, 정보 여러 개)
{
  let rows = [];
  for (let i = 0; i < 80; i++) {
    const st = r1(Math.max(0, gauss(6, 3))), sl = r1(Math.min(10, Math.max(5, gauss(7.5, 1)))), ph = r1(Math.max(0, gauss(3, 1.5)));
    rows.push([st, sl, ph, Math.min(100, Math.max(0, r0(48 + 4 * st + 2.5 * (sl - 7) - 3 * ph + gauss(0, 7))))]);
  }
  rows[5][0] = 70; rows[38][3] = ''; rows[61][2] = '';
  write('study.csv', ['공부 시간(시간/주)', '잠 시간(시간/일)', '스마트폰(시간/일)', '점수'], rows);
}
