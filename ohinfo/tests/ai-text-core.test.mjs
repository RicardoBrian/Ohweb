// AI 실험실 문장(텍스트) 분류 로직 테스트 — `node ohinfo/tests/ai-text-core.test.mjs`
import assert from 'node:assert/strict';
import * as X from '../public/ai-text-core.js';
import { I18N } from '../public/ai-i18n.js';

let n = 0;
const queue = [];
const test = (name, fn) => queue.push([name, fn]);
const DATA = [
  ['오늘 정말 행복해요', 'j'], ['기분이 너무 좋아', 'j'], ['신난다 최고야', 'j'], ['선물 받아서 기뻐요', 'j'], ['웃음이 나와요', 'j'],
  ['너무 슬퍼요', 's'], ['눈물이 나요', 's'], ['친구가 이사가서 슬프다', 's'], ['우울한 하루', 's'], ['마음이 아파요', 's'],
  ['진짜 화가 나', 'a'], ['짜증나 죽겠어', 'a'], ['왜 내 말을 안 들어', 'a'], ['너무 화났어요', 'a'], ['열받아', 'a'],
].map(([text, labelId]) => ({ text, labelId }));

test('문장 다듬기·같은 문장 비교', () => {
  assert.equal(X.normText('  안녕   하세요 \n'), '안녕 하세요');
  assert.equal(X.normText('가'.repeat(150)).length, X.TEXT_MAX);
  assert.equal(X.sameKey('좋아요!!'), X.sameKey('좋아 요'));
  assert.notEqual(X.sameKey('좋아요'), X.sameKey('싫어요'));
});
test('조각: 단어 전체 + 두 글자씩', () => {
  assert.deepEqual(X.wordFeats('좋아요!'), ['w:좋아요', 'b:좋아', 'b:아요']);
  assert.deepEqual(X.wordFeats('나'), ['w:나', 'b:나']);
  assert.deepEqual(X.wordFeats('!!'), []);
  assert.deepEqual(X.wordFeats('Happy'), ['w:happy', 'b:ha', 'b:ap', 'b:pp', 'b:py']);
});
test('학습·예측: 새 문장의 감정을 맞힌다', () => {
  const m = X.trainText(DATA, ['j', 's', 'a']);
  assert.equal(X.predictText(m, '오늘 너무 좋아요').top, 'j');
  assert.equal(X.predictText(m, '슬퍼서 눈물').top, 's');
  assert.equal(X.predictText(m, '화나서 짜증나').top, 'a');
  const p = X.predictText(m, '아무말').probs;
  assert.ok(Math.abs(Object.values(p).reduce((a, b) => a + b, 0) - 1) < 1e-9);
});
test('영향 준 단어: 감정 단어가 그 레이블 색, 모르는 단어는 색 없음', () => {
  const m = X.trainText(DATA, ['j', 's', 'a']);
  const ws = X.predictText(m, '오늘 짜증나 뭐지').words;
  assert.equal(ws.find(x => x.w === '짜증나').id, 'a');
  assert.equal(ws.find(x => x.w === '짜증나').s, 1);
  assert.equal(ws.find(x => x.w === '뭐지').id, '');
});
test('레이블별 단서 단어', () => {
  const m = X.trainText(DATA, ['j', 's', 'a']);
  const tw = X.topWords(m, DATA);
  assert.ok(tw.s.includes('슬퍼요') && tw.a.includes('짜증나'));
  assert.ok(!tw.j.includes('슬퍼요'));
});
test('모델 크기 제한·문장이 없는 레이블', () => {
  const many = Array.from({ length: 2000 }, (_, i) => ({ text: `단어${i} 다른말${i * 7}`, labelId: i % 2 ? 'x' : 'y' }));
  const m = X.trainText(many, ['x', 'y', 'z']);
  assert.ok(m.feats.length <= X.MAX_FEATS);
  assert.equal(m.docs.z, 0);
  assert.ok(['x', 'y', 'z'].includes(X.predictText(m, '단어5').top));
  // Firestore에 그대로 저장되는 모양(배열 안 배열 없음)
  assert.ok(Object.values(m.counts).every(a => Array.isArray(a) && a.every(Number.isInteger)));
  assert.equal(JSON.stringify(m).includes('_idx'), false);
});
test('문장 문구가 4개 언어에 모두 있다', () => {
  const keys = Object.keys(I18N.ko).filter(k => /^x/.test(k));
  assert.ok(keys.length > 40);
  for (const l of ['en', 'zh', 'ru']) for (const k of keys) assert.ok(k in I18N[l], `${l}.${k}`);
});


// ── 뜻 이해 AI ──
// 시험용 가짜 뜻 숫자: 단어마다 정해진 방향(감정 단어는 감정 축)의 합
const DIM = 16;
const fakeVec = text => {
  const v = new Float32Array(DIM);
  for (const w of X.words(text)) {
    let h = 7; for (const ch of w) h = (h * 31 + ch.charCodeAt(0)) >>> 0;
    v[h % DIM] += 0.3;
    if (/슬|눈물|아파|грус|sad/.test(w)) v[0] += 1;
    if (/행복|기뻐|좋아|рад|happy/.test(w)) v[1] += 1;
  }
  return v;
};
test('뜻 숫자 줄이기(Int8)·되살리기', () => {
  const v = fakeVec('너무 슬퍼요');
  const back = X.decodeVec(X.encodeVec(v));
  const n = Math.sqrt(v.reduce((a, b) => a + b * b, 0));
  for (let i = 0; i < DIM; i++) assert.ok(Math.abs(back[i] - v[i] / n) < 0.01);
});
test('레이블 중심으로 맞히기 + 확률', () => {
  const tr = [['너무 슬퍼요', 's'], ['눈물이 나요', 's'], ['정말 행복해요', 'h'], ['기뻐요', 'h']].map(([text, labelId]) => ({ text, labelId }));
  const mn = X.meanModel(tr.map(x => fakeVec(x.text)), tr, ['s', 'h']);
  assert.equal(mn.dim, DIM);
  assert.equal(X.predictVec(mn, fakeVec('오늘 슬퍼')).top, 's');
  const p = X.predictVec(mn, fakeVec('행복한 하루'));
  assert.equal(p.top, 'h');
  assert.ok(Math.abs(p.probs.s + p.probs.h - 1) < 1e-9 && p.probs.h > 0.6);
  assert.ok(typeof JSON.parse(JSON.stringify(mn)).cents.s === 'string', 'Firestore에 문자열로 저장');
});
test('영향 준 단어(하나씩 빼 보기)', () => {
  const tr = [['너무 슬퍼요', 's'], ['정말 행복해요', 'h']].map(([text, labelId]) => ({ text, labelId }));
  const mn = X.meanModel(tr.map(x => fakeVec(x.text)), tr, ['s', 'h']);
  const ws = ['오늘', '슬퍼'];
  const ex = X.explainVec(mn, ws, fakeVec('오늘 슬퍼'), [fakeVec('슬퍼'), fakeVec('오늘')]);
  assert.equal(ex[1].id, 's');
  assert.equal(ex[1].s, 1);
});
test('뜻 지도: 같은 레이블끼리 가까이', () => {
  const vs = ['슬퍼', '눈물 슬퍼', '행복', '기뻐 행복'].map(fakeVec);
  const xy = X.project2d(vs);
  const d = (a, b) => Math.hypot(xy[a][0] - xy[b][0], xy[a][1] - xy[b][1]);
  assert.ok(d(0, 1) < d(0, 2) && d(2, 3) < d(1, 3));
});
test('서버로 맞히기, 실패하면 단어 조각 AI로', async () => {
  const tr = [['너무 슬퍼요', 's'], ['눈물이 나요', 's'], ['정말 행복해요', 'h'], ['기뻐요', 'h']].map(([text, labelId]) => ({ text, labelId }));
  const m = { model: X.trainText(tr, ['s', 'h']), mean: X.meanModel(tr.map(x => fakeVec(x.text)), tr, ['s', 'h']) };
  globalThis.fetch = async (url, o) => ({ ok: true, json: async () => ({ vecs: JSON.parse(o.body).texts.map(t => X.encodeVec(fakeVec(t))) }) });
  const r = await X.predictAny(m, '오늘 너무 슬퍼');
  assert.equal(r.via, 'mean'); assert.equal(r.top, 's');
  assert.equal(r.words.find(w => w.w === '슬퍼').id, 's');
  globalThis.fetch = async () => ({ ok: true, json: async () => ({ error: 'x', code: 'aiFail' }) });
  const r2 = await X.predictAny(m, '너무 슬퍼요');
  assert.equal(r2.via, 'words'); assert.equal(r2.top, 's');
});

for (const [name, fn] of queue) { await fn(); n++; console.log('✅', name); }
console.log(`\n${n}개 통과`);
