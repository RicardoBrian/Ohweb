// AI 실험실 — 표 데이터(CSV) 분류·예측 공용 로직. DOM 없이 돌아가는 순수 함수만 둔다(Node에서 테스트).
// 학생 실험실(ai-table.js), 공개 웹앱(aiapp.html), 관리자(ohweb admin, 같은 파일을 복사해 씀)가 같이 쓴다.
//
//  분류(글자 값을 맞힘) → 결정 트리: "무게가 150g보다 가벼운가?" 같은 질문을 차례로 던져 답을 좁힌다.
//  예측(숫자 값을 맞힘) → 선형 회귀: 점들을 가장 잘 지나는 식(y = a×x + b)을 찾는다.

export const MAX_ROWS = 1000;
export const MAX_COLS = 12;
export const MIN_ROWS = 10;
export const MAX_CLASSES = 8;
export const MAX_DEPTH = 5;
export const TEST_RATIO = 0.2;
export const CSV_MAX_BYTES = 200000;

// ── CSV 읽기 ──
// 엑셀에서 저장한 CSV(쉼표·세미콜론·탭, 따옴표, BOM)를 읽는다. 빈 줄은 버린다.
export function parseCsv(text) {
  const s = String(text || '').replace(/^﻿/, '');
  const first = s.split(/\r?\n/, 1)[0] || '';
  const delim = [',', ';', '\t'].map(d => [d, first.split(d).length]).sort((a, b) => b[1] - a[1])[0][0];
  const out = [];
  let row = [], cell = '', q = false;
  for (let i = 0; i < s.length; i++) {
    const ch = s[i];
    if (q) {
      if (ch === '"') { if (s[i + 1] === '"') { cell += '"'; i++; } else q = false; }
      else cell += ch;
    } else if (ch === '"' && cell.trim() === '') { q = true; cell = ''; }
    else if (ch === delim) { row.push(cell); cell = ''; }
    else if (ch === '\n' || ch === '\r') {
      if (ch === '\r' && s[i + 1] === '\n') i++;
      row.push(cell); out.push(row); row = []; cell = '';
    } else cell += ch;
  }
  if (cell !== '' || row.length) { row.push(cell); out.push(row); }
  const lines = out.map(r => r.map(c => c.trim())).filter(r => r.some(c => c !== ''));
  if (!lines.length) return { cols: [], rows: [] };
  const width = Math.max(...lines.map(r => r.length));
  const seen = new Set();
  const cols = Array.from({ length: width }, (_, i) => {
    let n = (lines[0][i] || '').slice(0, 20) || `열${i + 1}`;
    while (seen.has(n)) n += "'";
    seen.add(n);
    return n;
  });
  const rows = lines.slice(1).map(r => Array.from({ length: width }, (_, i) => r[i] || ''));
  return { cols, rows };
}

// "1,200" "3.5" "-2" 같은 숫자 글자 → 숫자. 숫자가 아니면 NaN.
export function toNum(v) {
  const s = String(v == null ? '' : v).replace(/,/g, '').trim();
  return /^[-+]?(\d+\.?\d*|\.\d+)(e[-+]?\d+)?$/i.test(s) ? Number(s) : NaN;
}

// 열 종류: 채워진 칸의 90% 이상이 숫자면 숫자 열(나머지는 '이상한 값'으로 잡힌다).
export function colTypes(cols, rows) {
  return cols.map((_, c) => {
    const vals = rows.map(r => r[c]).filter(v => v !== '');
    if (!vals.length) return 'cat';
    const n = vals.filter(v => !Number.isNaN(toNum(v))).length;
    return n >= vals.length * 0.9 ? 'num' : 'cat';
  });
}

// 선생님이 준 CSV + 맞힐 열 → 수업에서 쓰는 데이터 묶음.
export function makeDataset(csv, target) {
  const { cols, rows } = parseCsv(csv);
  const types = colTypes(cols, rows);
  const ti = cols.indexOf(target);
  const prob = ti >= 0 && types[ti] === 'num' ? 'reg' : 'class';
  let classes = [];
  if (ti >= 0 && prob === 'class') {
    const cnt = new Map();
    rows.forEach(r => { if (r[ti] !== '') cnt.set(r[ti], (cnt.get(r[ti]) || 0) + 1); });
    classes = [...cnt.entries()].sort((a, b) => b[1] - a[1] || (a[0] < b[0] ? -1 : 1)).map(x => x[0]);
  }
  return { cols, rows, types, ti, target, prob, classes };
}

// 관리자가 배정할 때 검사. 오류 코드 목록(빈 배열이면 통과).
export function validateDataset(ds, csvBytes = 0) {
  const e = [];
  if (csvBytes > CSV_MAX_BYTES) e.push('tooBig');
  if (ds.cols.length < 2) e.push('fewCols');
  if (ds.cols.length > MAX_COLS) e.push('manyCols');
  if (ds.rows.length < MIN_ROWS) e.push('fewRows');
  if (ds.rows.length > MAX_ROWS) e.push('manyRows');
  if (ds.ti < 0) e.push('noTarget');
  else if (ds.prob === 'class') {
    if (ds.classes.length < 2) e.push('fewClasses');
    if (ds.classes.length > MAX_CLASSES) e.push('manyClasses');
  } else if (!ds.types.some((t, i) => t === 'num' && i !== ds.ti)) e.push('noNumFeature');
  return e;
}

// 회귀에는 숫자 열만, 분류에는 모든 열을 쓸 수 있다.
export function usableFeature(ds, c) {
  return c !== ds.ti && (ds.prob === 'class' || ds.types[c] === 'num');
}

// ── 공부용·시험용 나누기 ──
// 같은 데이터면 언제나 같은 줄이 시험용이 된다(씨앗 = 배정 ID). 분류는 답마다 20%씩 고르게.
function hash(str) {
  let h = 2166136261;
  for (let i = 0; i < str.length; i++) { h ^= str.charCodeAt(i); h = Math.imul(h, 16777619); }
  return h >>> 0;
}
function rng(seed) {
  let a = hash(String(seed)) || 1;
  return () => { a |= 0; a = a + 0x6D2B79F5 | 0; let t = Math.imul(a ^ a >>> 15, 1 | a); t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t; return ((t ^ t >>> 14) >>> 0) / 4294967296; };
}
export function testRows(ds, seed = '', ratio = TEST_RATIO) {
  const rand = rng(seed + '|' + ds.rows.length);
  const groups = new Map();
  ds.rows.forEach((r, i) => {
    const k = ds.prob === 'class' ? r[ds.ti] : '';
    if (!groups.has(k)) groups.set(k, []);
    groups.get(k).push(i);
  });
  const test = new Set();
  for (const idx of groups.values()) {
    const a = idx.slice();
    for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(rand() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; }
    const k = a.length >= 3 ? Math.max(1, Math.round(a.length * ratio)) : 0;
    a.slice(0, k).forEach(i => test.add(i));
  }
  return test;
}

// ── 데이터 살펴보기: 빈칸·이상한 값 ──
const quant = (s, p) => { const i = (s.length - 1) * p, lo = Math.floor(i), hi = Math.ceil(i); return s[lo] + (s[hi] - s[lo]) * (i - lo); };
export function colStats(ds, c) {
  const v = ds.rows.map(r => toNum(r[c])).filter(x => !Number.isNaN(x)).sort((a, b) => a - b);
  if (!v.length) return null;
  const q1 = quant(v, 0.25), q3 = quant(v, 0.75), iqr = q3 - q1;
  return { min: v[0], max: v[v.length - 1], q1, q3, med: quant(v, 0.5), lo: q1 - 3 * iqr, hi: q3 + 3 * iqr, iqr };
}
// 줄마다 문제 목록. kind: empty(빈칸) · notNum(숫자 칸에 글자) · outlier(다른 값과 너무 다름)
// 빈칸·글자는 AI가 배울 수 없어 저절로 빠지고, 이상한 값은 모둠이 뺄지 정한다.
export function rowIssues(ds, colsUsed) {
  const stats = {};
  colsUsed.forEach(c => { if (ds.types[c] === 'num') stats[c] = colStats(ds, c); });
  return ds.rows.map(r => {
    const out = [];
    for (const c of colsUsed) {
      const v = r[c];
      if (v === '') { out.push({ c, kind: 'empty' }); continue; }
      if (ds.types[c] !== 'num') continue;
      const x = toNum(v);
      if (Number.isNaN(x)) { out.push({ c, kind: 'notNum' }); continue; }
      const st = stats[c];
      if (st && st.iqr > 0 && (x < st.lo || x > st.hi)) out.push({ c, kind: 'outlier' });
    }
    return out;
  });
}
export const autoDropped = issues => issues.some(x => x.kind !== 'outlier');
export const hasOutlier = issues => issues.some(x => x.kind === 'outlier');

// 모둠원마다 살펴볼 줄 범위(번호 순으로 고르게 나눔). [시작, 끝) 줄 번호.
export function ranges(n, members) {
  const m = Math.max(1, members.length);
  const out = {};
  members.forEach((id, i) => { out[id] = [Math.round(i * n / m), Math.round((i + 1) * n / m)]; });
  return out;
}

// 학습·시험에 쓸 줄: 뺀 줄, 쓰는 칸이 비었거나 글자인 줄은 뺀다.
// drop: { 줄번호: true(뺌) | false(둠) }
export function samples(ds, features, { drop = {}, test, which }) {
  const cols = [...features, ds.ti];
  const out = [];
  ds.rows.forEach((r, i) => {
    if (which === 'train' ? test.has(i) : !test.has(i)) return;
    if (drop[i] === true) return;
    const x = [];
    for (const c of cols) {
      const v = r[c];
      if (v === '') return;
      if (ds.types[c] === 'num' && Number.isNaN(toNum(v))) return;
    }
    for (const c of features) x.push(ds.types[c] === 'num' ? toNum(r[c]) : r[c]);
    const y = ds.prob === 'class' ? ds.classes.indexOf(r[ds.ti]) : toNum(r[ds.ti]);
    if (ds.prob === 'class' && y < 0) return;
    out.push({ i, x, y });
  });
  return out;
}

// ── 결정 트리(분류) ──
// 노드: { f: 특징 순번(features 안에서), t: 기준값(숫자: x ≤ t) | e: 같은 값(글자: x == e), y: 예 쪽, n: 아니오 쪽 }
// 잎: { c: [답별 개수] }
function gini(cnt, tot) { let g = 1; for (const k of cnt) g -= (k / tot) ** 2; return g; }
function counts(list, K) { const c = new Array(K).fill(0); list.forEach(s => { c[s.y]++; }); return c; }

export function trainTree(list, ftypes, K, maxDepth = 3, depth = 0) {
  const c = counts(list, K);
  const tot = list.length;
  if (depth >= maxDepth || tot < 2 || c.filter(Boolean).length <= 1) return { c };
  const base = gini(c, tot);
  let best = null;
  ftypes.forEach((type, f) => {
    if (type === 'num') {
      const s = list.slice().sort((a, b) => a.x[f] - b.x[f]);
      const left = new Array(K).fill(0);
      for (let i = 0; i < s.length - 1; i++) {
        left[s[i].y]++;
        if (s[i].x[f] === s[i + 1].x[f]) continue;
        const nl = i + 1, nr = tot - nl;
        const right = c.map((k, j) => k - left[j]);
        const g = base - (nl * gini(left, nl) + nr * gini(right, nr)) / tot;
        if (!best || g > best.g + 1e-12) best = { g, f, t: Math.round(((s[i].x[f] + s[i + 1].x[f]) / 2) * 1000) / 1000 };
      }
    } else {
      const vals = [...new Set(list.map(s => s.x[f]))].sort();
      if (vals.length < 2) return;
      for (const v of vals) {
        const yes = list.filter(s => s.x[f] === v);
        const cy = counts(yes, K), cn = c.map((k, j) => k - cy[j]);
        const ny = yes.length, nn = tot - ny;
        const g = base - (ny * gini(cy, ny) + nn * gini(cn, nn)) / tot;
        if (!best || g > best.g + 1e-12) best = { g, f, e: v };
      }
    }
  });
  if (!best || best.g <= 1e-9) return { c };
  const isYes = s => (best.e != null ? s.x[best.f] === best.e : s.x[best.f] <= best.t);
  const node = { f: best.f, ...(best.e != null ? { e: best.e } : { t: best.t }) };
  node.y = trainTree(list.filter(isYes), ftypes, K, maxDepth, depth + 1);
  node.n = trainTree(list.filter(s => !isYes(s)), ftypes, K, maxDepth, depth + 1);
  return node;
}
export function treeLeaf(node, x) {
  let n = node;
  while (n && !n.c) n = (n.e != null ? x[n.f] === n.e : x[n.f] <= n.t) ? n.y : n.n;
  return n;
}
export function treeProbs(node, x) {
  const leaf = treeLeaf(node, x);
  const tot = leaf.c.reduce((a, b) => a + b, 0) || 1;
  return leaf.c.map(k => k / tot);
}
export const argmax = a => a.reduce((bi, v, i) => (v > a[bi] ? i : bi), 0);
export function treeSize(node) { return node.c ? { leaves: 1, depth: 0 } : (() => { const a = treeSize(node.y), b = treeSize(node.n); return { leaves: a.leaves + b.leaves, depth: 1 + Math.max(a.depth, b.depth) }; })(); }

// ── 선형 회귀(예측) ──
// 최소제곱: (XᵀX)w = Xᵀy 를 가우스 소거로 푼다. 특징이 몇 개뿐이라 충분하다.
export function trainLinear(list, nf) {
  const d = nf + 1;
  const A = Array.from({ length: d }, () => new Array(d + 1).fill(0));
  for (const s of list) {
    const v = [...s.x, 1];
    for (let i = 0; i < d; i++) { for (let j = 0; j < d; j++) A[i][j] += v[i] * v[j]; A[i][d] += v[i] * s.y; }
  }
  for (let i = 0; i < nf; i++) A[i][i] += 1e-9 * (A[i][i] || 1);   // 같은 값만 있는 열에도 풀리게
  for (let col = 0; col < d; col++) {
    let p = col;
    for (let r = col + 1; r < d; r++) if (Math.abs(A[r][col]) > Math.abs(A[p][col])) p = r;
    [A[col], A[p]] = [A[p], A[col]];
    if (Math.abs(A[col][col]) < 1e-12) continue;
    for (let r = 0; r < d; r++) {
      if (r === col) continue;
      const k = A[r][col] / A[col][col];
      for (let j = col; j <= d; j++) A[r][j] -= k * A[col][j];
    }
  }
  const sol = A.map((row, i) => (Math.abs(row[i]) < 1e-12 ? 0 : row[d] / row[i]));
  const r4 = v => Math.round(v * 10000) / 10000;
  return { w: sol.slice(0, nf).map(r4), b: r4(sol[nf]) };
}
export const linPredict = (m, x) => m.w.reduce((s, w, i) => s + w * x[i], m.b);

// ── 실험 하나 만들기·채점 ──
// trial: { features: [열 번호], depth } → { model, score, n }
// score: 분류는 맞힌 비율(%), 예측은 평균 오차(맞힐 값의 단위).
export function fitTrial(ds, trial, ctx) {
  const list = samples(ds, trial.features, { ...ctx, which: 'train' });
  if (!list.length) return { error: 'noRows' };
  const ftypes = trial.features.map(c => ds.types[c]);
  const model = ds.prob === 'class'
    ? { tree: trainTree(list, ftypes, ds.classes.length, Math.min(MAX_DEPTH, Math.max(1, trial.depth || 2))) }
    : trainLinear(list, trial.features.length);
  return { model, ...scoreOn(ds, model, list), n: list.length };
}
export function predictRow(ds, model, x) {
  if (ds.prob === 'class') { const p = treeProbs(model.tree, x); return { p, y: argmax(p) }; }
  return { y: linPredict(model, x) };
}
export function scoreOn(ds, model, list) {
  if (!list.length) return { score: null, wrong: [] };
  if (ds.prob === 'class') {
    const wrong = [];
    let ok = 0;
    for (const s of list) { const { y, p } = predictRow(ds, model, s.x); if (y === s.y) ok++; else wrong.push({ i: s.i, y: s.y, got: y, p: Math.round(p[y] * 100) }); }
    return { score: Math.round(ok * 100 / list.length), correct: ok, wrong };
  }
  let sum = 0;
  const errs = list.map(s => { const got = linPredict(model, s.x); sum += Math.abs(got - s.y); return { i: s.i, y: s.y, got: round(got), e: Math.abs(got - s.y) }; });
  errs.sort((a, b) => b.e - a.e);
  return { score: round(sum / list.length), wrong: errs.slice(0, 5).map(({ i, y, got }) => ({ i, y, got })) };
}
export function testTrial(ds, trial, ctx) {
  const list = samples(ds, trial.features, { ...ctx, which: 'test' });
  return { ...scoreOn(ds, trial.model, list), n: list.length };
}
// 점수 비교: 분류는 높을수록, 예측(평균 오차)은 낮을수록 좋다.
export const better = (prob, a, b) => (b == null ? true : a == null ? false : prob === 'class' ? a > b : a < b);

// 소수점 자리: 원래 데이터의 자리수만큼(최대 2자리)
export function round(v, digits = 2) {
  const k = 10 ** digits;
  return Math.round(v * k) / k;
}
export function fmt(v) {
  if (v == null || Number.isNaN(v)) return '-';
  return String(round(v)).replace(/\.0+$/, '');
}

// ── 단계 열림 ──
export function nextUnlock(project, members = []) {
  const step = project.step || 1;
  if (step === 1) return project.defined ? 2 : 1;
  if (step === 2) { const ck = project.tChecked || {}; return members.length && members.every(m => ck[m]) ? 3 : 2; }
  if (step === 3) return Object.values(project.tTrials || {}).some(x => x && x.model) ? 4 : 3;
  if (step === 4) {
    const ev = project.evals || {};
    const keys = Object.keys(ev).filter(k => /^r\d+$/.test(k)).sort((a, b) => Number(a.slice(1)) - Number(b.slice(1)));
    const cur = keys.length ? ev[keys[keys.length - 1]] : null;
    return cur && cur.stars && Object.keys(cur.stars).length && project.tModel ? 5 : 4;
  }
  return step;
}

// ── 공개 웹앱 ──
// 입력 칸 정보: 숫자는 데이터의 최솟값~최댓값(이상한 값 빼고), 글자는 고를 수 있는 값들.
export function featureSpec(ds, c) {
  if (ds.types[c] === 'num') {
    const st = colStats(ds, c);
    const ok = x => !Number.isNaN(x) && (!st || st.iqr === 0 || (x >= st.lo && x <= st.hi));
    const cells = ds.rows.map(r => r[c]).filter(v => ok(toNum(v)));
    if (!cells.length) return { type: 'num', min: 0, max: 100, step: 1, def: 0 };
    const vals = cells.map(toNum);
    const lo = Math.min(...vals), hi = Math.max(...vals);
    const dec = Math.min(2, Math.max(0, ...cells.map(v => (String(v).split('.')[1] || '').length)));
    return { type: 'num', min: lo, max: hi, step: dec ? 10 ** -dec : 1, def: round(st.med, dec) };
  }
  const cnt = new Map();
  ds.rows.forEach(r => { if (r[c] !== '') cnt.set(r[c], (cnt.get(r[c]) || 0) + 1); });
  const opts = [...cnt.entries()].sort((a, b) => b[1] - a[1]).map(x => x[0]).slice(0, 12);
  return { type: 'cat', opts, def: opts[0] || '' };
}
// 공개 웹앱에서 맞히기: app.table = { prob, features:[{type,...}], model }, inputs: 칸별 값
export function appPredict(table, inputs) {
  const x = table.features.map((f, i) => (f.type === 'num' ? Number(inputs[i]) : String(inputs[i])));
  if (table.prob === 'class') return { p: treeProbs(table.model.tree, x) };
  return { v: linPredict(table.model, x) };
}
