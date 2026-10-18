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
