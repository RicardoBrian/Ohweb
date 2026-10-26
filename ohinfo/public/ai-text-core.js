// AI 실험실 — 문장(텍스트) 분류 공용 로직. DOM 없이 돌아가는 순수 함수만 둔다(Node에서 테스트).
// 학생 실험실(ai-text.js)과 공개 웹앱(aiapp.html)이 같이 쓴다.
//
// 모델: 나이브 베이즈 — 레이블마다 "어떤 단어 조각이 얼마나 자주 나왔나"를 세어 두었다가,
// 새 문장의 조각들이 어느 레이블 문장에 더 자주 나왔는지로 고른다. 그래서 "어떤 단어가 영향을 줬는지"를
// 단어마다 바로 보여 줄 수 있다.
// 조각: 띄어쓰기 단어 전체(w:좋아요) + 단어 안의 두 글자씩(b:좋아, b:아요) — 한국어는 "좋아요/좋았어"처럼
// 끝이 바뀌어도 앞 조각(좋아/좋았)이 겹쳐서 비슷하게 잡힌다.

export const TEXT_MAX = 100;     // 문장 하나 최대 글자 수
export const MAX_FEATS = 3000;   // 모델에 남기는 조각 수(웹앱 문서 크기 제한)

export function normText(s) {
  return String(s || '').normalize('NFC').replace(/\s+/g, ' ').trim().slice(0, TEXT_MAX);
}
// 같은 문장인지 비교할 때(띄어쓰기·문장부호·대소문자 무시)
export function sameKey(s) {
  return normText(s).toLowerCase().replace(/[^\p{L}\p{N}]+/gu, '');
}
// 문장 → 단어(원래 모양 그대로, 화면에 색칠할 때 씀)
export function words(s) {
  return normText(s).split(' ').filter(Boolean);
}
// 단어 하나 → 조각
export function wordFeats(w) {
  const x = String(w).toLowerCase().replace(/[^\p{L}\p{N}]+/gu, '');
  if (!x) return [];
  const chars = [...x];
  const out = ['w:' + x];
  if (chars.length === 1) out.push('b:' + x);
  for (let i = 0; i < chars.length - 1; i++) out.push('b:' + chars[i] + chars[i + 1]);
  return out;
}
export function feats(s) {
  return words(s).flatMap(wordFeats);
}

// 학습: samples = [{ text, labelId }] → model
// model = { labels: [id], feats: [조각], counts: { id: [조각별 개수] }, totals: { id: 조각 수 합 }, docs: { id: 문장 수 } }
export function trainText(samples, labelIds) {
  const per = Object.fromEntries(labelIds.map(id => [id, new Map()]));
  const docs = Object.fromEntries(labelIds.map(id => [id, 0]));
  const all = new Map();
  for (const s of samples) {
    if (!per[s.labelId]) continue;
    docs[s.labelId]++;
    for (const f of feats(s.text)) {
      per[s.labelId].set(f, (per[s.labelId].get(f) || 0) + 1);
      all.set(f, (all.get(f) || 0) + 1);
    }
  }
  const keep = [...all.entries()].sort((a, b) => b[1] - a[1] || (a[0] < b[0] ? -1 : 1)).slice(0, MAX_FEATS).map(x => x[0]).sort();
  const counts = {}, totals = {};
  for (const id of labelIds) {
    counts[id] = keep.map(f => per[id].get(f) || 0);
    totals[id] = counts[id].reduce((a, b) => a + b, 0);
  }
  return { labels: labelIds.slice(), feats: keep, counts, totals, docs };
}

// 조각별 레이블 점수(로그 확률) 계산 준비
function prep(model) {
  if (model._idx) return model;
  const idx = new Map(model.feats.map((f, i) => [f, i]));
  Object.defineProperty(model, '_idx', { value: idx, enumerable: false });
  return model;
}
function featLog(model, id, f) {
  const i = model._idx.get(f);
  const V = model.feats.length || 1;
  const c = i == null ? 0 : model.counts[id][i];
  return Math.log((c + 1) / ((model.totals[id] || 0) + V));
}

// 예측: { probs: { id: p }, top, words: [{ w, id(가장 영향 준 레이블)|'', s(0~1 세기) }] }
export function predictText(model, text) {
  prep(model);
  const ids = model.labels;
  const N = ids.reduce((a, id) => a + (model.docs[id] || 0), 0);
  const score = Object.fromEntries(ids.map(id => [id, Math.log(((model.docs[id] || 0) + 1) / (N + ids.length))]));
  const ws = words(text).map(w => {
    const fs = wordFeats(w).filter(f => model._idx.has(f));
    const per = Object.fromEntries(ids.map(id => [id, fs.reduce((a, f) => a + featLog(model, id, f), 0)]));
    fs.length && ids.forEach(id => { score[id] += per[id]; });
    if (!fs.length) return { w, id: '', s: 0 };
    const mean = ids.reduce((a, id) => a + per[id], 0) / ids.length;
    let best = ids[0];
    ids.forEach(id => { if (per[id] > per[best]) best = id; });
    return { w, id: best, v: per[best] - mean };
  });
  const mx = Math.max(...ids.map(id => score[id]));
  const ex = Object.fromEntries(ids.map(id => [id, Math.exp(score[id] - mx)]));
  const sum = Object.values(ex).reduce((a, b) => a + b, 0);
  const probs = Object.fromEntries(ids.map(id => [id, ex[id] / sum]));
  let top = ids[0];
  ids.forEach(id => { if (probs[id] > probs[top]) top = id; });
  // 영향 세기: 이 문장 안에서 가장 센 단어를 1로
  const vmax = Math.max(0, ...ws.map(x => x.v || 0));
  return { probs, top, words: ws.map(x => ({ w: x.w, id: x.id, s: vmax > 0 && x.v > 0 ? Math.round((x.v / vmax) * 100) / 100 : 0 })) };
}

// 레이블마다 AI가 단서로 삼은 단어(문장에 나온 단어 중 그 레이블 쪽으로 가장 기운 것)
export function topWords(model, samples, n = 6) {
  prep(model);
  const ids = model.labels;
  const seen = new Map();
  for (const s of samples) for (const w of words(s.text)) {
    const k = w.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, '');
    if (k && !seen.has(k)) seen.set(k, w.replace(/[^\p{L}\p{N}]+/gu, ''));
  }
  const out = Object.fromEntries(ids.map(id => [id, []]));
  for (const [k, w] of seen) {
    const fs = wordFeats(k).filter(f => model._idx.has(f));
    if (!fs.length) continue;
    const per = ids.map(id => fs.reduce((a, f) => a + featLog(model, id, f), 0));
    const mean = per.reduce((a, b) => a + b, 0) / ids.length;
    let bi = 0;
    per.forEach((v, i) => { if (v > per[bi]) bi = i; });
    if (per[bi] - mean > 0) out[ids[bi]].push({ w, v: per[bi] - mean });
  }
  for (const id of ids) out[id] = out[id].sort((a, b) => b.v - a.v).slice(0, n).map(x => x.w);
  return out;
}

// 단어 조각 보여 주기(③에서 "AI는 문장을 이렇게 잘라 봐요")
export function pieces(s) {
  return words(s).map(w => ({ w, f: wordFeats(w).map(f => f.slice(2)) }));
}

// ── 뜻 이해 AI(다국어 문장 모델) ──
// 서버(/api/embed, Workers AI bge-m3)가 문장을 "뜻 숫자"(1024개, 길이 1)로 바꿔 준다.
// 레이블마다 학습 문장들의 평균 위치(중심)를 기억했다가, 새 문장은 가장 가까운(코사인) 레이블로 고른다.
// 한국어로 학습해도 중국어·러시아어 문장을 맞힐 수 있다(같은 뜻이면 가까운 숫자).
export const MEAN_SCALE = 20;   // 가까움 차이를 확률로 바꿀 때의 세기(0.1 차이 ≈ 88%)
export function decodeVec(b64) {
  const s = atob(b64), a = new Float32Array(s.length);
  for (let i = 0; i < s.length; i++) { const c = s.charCodeAt(i); a[i] = (c > 127 ? c - 256 : c) / 127; }
  return a;
}
export function encodeVec(v) {
  let n = 0;
  for (const x of v) n += x * x;
  n = Math.sqrt(n) || 1;
  let s = '';
  for (const x of v) { const q = Math.max(-127, Math.min(127, Math.round(x / n * 127))); s += String.fromCharCode(q < 0 ? q + 256 : q); }
  return btoa(s);
}
const dotv = (a, b) => { let s = 0; for (let i = 0; i < a.length; i++) s += a[i] * b[i]; return s; };
const unit = v => { const n = Math.sqrt(dotv(v, v)) || 1; return v.map(x => x / n); };
// vecs: Float32Array[] (samples와 같은 순서), samples: [{ labelId }] → { labels, dim, cents: { id: b64 } }
export function meanModel(vecs, samples, labelIds) {
  const dim = vecs[0] ? vecs[0].length : 0;
  const sum = Object.fromEntries(labelIds.map(id => [id, new Float32Array(dim)]));
  samples.forEach((s, i) => { const t = sum[s.labelId]; if (t && vecs[i]) for (let k = 0; k < dim; k++) t[k] += vecs[i][k]; });
  return { labels: labelIds.slice(), dim, cents: Object.fromEntries(labelIds.map(id => [id, encodeVec(sum[id])])) };
}
function cents(mean) {
  if (!mean._c) Object.defineProperty(mean, '_c', { value: Object.fromEntries(mean.labels.map(id => [id, unit(decodeVec(mean.cents[id]))])), enumerable: false });
  return mean._c;
}
export function simsOf(mean, v) {
  const c = cents(mean);
  return Object.fromEntries(mean.labels.map(id => [id, dotv(unit(v), c[id])]));
}
export function predictVec(mean, v) {
  const sims = simsOf(mean, v);
  const ids = mean.labels;
  const mx = Math.max(...ids.map(id => sims[id]));
  const ex = Object.fromEntries(ids.map(id => [id, Math.exp((sims[id] - mx) * MEAN_SCALE)]));
  const sum = Object.values(ex).reduce((a, b) => a + b, 0);
  const probs = Object.fromEntries(ids.map(id => [id, ex[id] / sum]));
  let top = ids[0];
  ids.forEach(id => { if (probs[id] > probs[top]) top = id; });
  return { probs, top, sims };
}
// 영향 준 단어: 단어를 하나씩 빼 본 문장의 뜻(without[i])과 비교해, 빼면 가까움이 가장 많이 줄어드는 레이블이 그 단어의 색.
export function explainVec(mean, ws, full, without) {
  const f = simsOf(mean, full);
  const per = ws.map((w, i) => {
    if (!without[i]) return { w, id: '', v: 0 };
    const s = simsOf(mean, without[i]);
    const d = Object.fromEntries(mean.labels.map(id => [id, f[id] - s[id]]));
    const avg = mean.labels.reduce((a, id) => a + d[id], 0) / mean.labels.length;
    let best = mean.labels[0];
    mean.labels.forEach(id => { if (d[id] > d[best]) best = id; });
    return { w, id: best, v: d[best] - avg };
  });
  const vmax = Math.max(0, ...per.map(x => x.v));
  return per.map(x => ({ w: x.w, id: x.v > 0 ? x.id : '', s: vmax > 0 && x.v > 0 ? Math.round(x.v / vmax * 100) / 100 : 0 }));
}
// 뜻 지도: 뜻 숫자들을 2차원으로(주성분 2개) — 비슷한 뜻의 문장이 가까이 모이는지 본다.
export function project2d(vecs) {
  const n = vecs.length;
  if (!n) return [];
  const d = vecs[0].length, mean = new Float32Array(d);
  vecs.forEach(v => { for (let k = 0; k < d; k++) mean[k] += v[k] / n; });
  const X = vecs.map(v => v.map((x, k) => x - mean[k]));
  const comps = [];
  for (let c = 0; c < 2; c++) {
    let p = new Float32Array(d).map((_, k) => Math.sin(k * (c + 1) + 1));
    for (let it = 0; it < 40; it++) {
      const s = X.map(x => dotv(x, p));
      const q = new Float32Array(d);
      X.forEach((x, i) => { for (let k = 0; k < d; k++) q[k] += s[i] * x[k]; });
      comps.forEach(cp => { const pr = dotv(q, cp); for (let k = 0; k < d; k++) q[k] -= pr * cp[k]; });
      p = unit(q);
    }
    comps.push(p);
  }
  return X.map(x => [dotv(x, comps[0]), dotv(x, comps[1])]);
}
// 서버에 문장 보내기(64개씩). 실패하면 오류를 던진다 — 부르는 쪽이 단어 조각 방식으로 대신한다.
export async function embedTexts(texts, url = '/api/embed') {
  const out = [];
  for (let i = 0; i < texts.length; i += 64) {
    const part = texts.slice(i, i + 64);
    const r = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ texts: part }) });
    const d = await r.json();
    if (!r.ok || d.error || !Array.isArray(d.vecs) || d.vecs.length !== part.length) throw new Error(d.code || d.error || 'embed');
    d.vecs.forEach(b => out.push(b ? decodeVec(b) : null));
  }
  return out;
}
// 문장 하나 맞히기(실험실·웹앱·코딩 공용): 뜻 AI가 있으면 서버로, 안 되면 단어 조각 AI로.
// m = { model: 단어 조각 모델, mean?: 뜻 모델 } → { probs, top, words, via: 'mean'|'words' }
export async function predictAny(m, text, { explain = true, url } = {}) {
  if (m.mean) {
    try {
      const ws = words(text);
      const variants = explain && ws.length > 1 && ws.length <= 12 ? ws.map((_, i) => ws.filter((__, k) => k !== i).join(' ')) : [];
      const vs = await embedTexts([normText(text), ...variants], url);
      const r = predictVec(m.mean, vs[0]);
      const wl = variants.length ? explainVec(m.mean, ws, vs[0], vs.slice(1)) : ws.map(w => ({ w, id: '', s: 0 }));
      return { probs: r.probs, top: r.top, words: wl, via: 'mean' };
    } catch (e) { if (!m.model) throw e; }
  }
  const r = predictText(m.model, text);
  return { ...r, via: 'words' };
}
