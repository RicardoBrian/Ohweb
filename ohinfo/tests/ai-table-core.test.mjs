// AI 실험실 표 데이터(CSV) 로직 테스트 — `node ohinfo/tests/ai-table-core.test.mjs`
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import * as T from '../public/ai-table-core.js';
import { I18N } from '../public/ai-i18n.js';

const here = p => fileURLToPath(new URL(p, import.meta.url));
let n = 0;
const test = (name, fn) => { fn(); n++; console.log('✅', name); };

test('관리자 복사본이 학생 쪽 파일과 똑같다', () => {
  assert.equal(fs.readFileSync(here('../../ohweb/public/ai-table-core.js'), 'utf8'), fs.readFileSync(here('../public/ai-table-core.js'), 'utf8'));
});
test('CSV: 따옴표·세미콜론·BOM·빈 줄·이름 없는 열', () => {
  const r = T.parseCsv('﻿a;b;\n"x;1";2;\r\n\n3;"he said ""hi""";\n');
  assert.deepEqual(r.cols, ['a', 'b', '열3']);
  assert.deepEqual(r.rows, [['x;1', '2', ''], ['3', 'he said "hi"', '']]);
  assert.deepEqual(T.parseCsv('a,a\n1,2').cols, ['a', "a'"]);
  assert.deepEqual(T.parseCsv('').rows, []);
});
test('숫자 읽기·열 종류(90% 규칙)', () => {
  assert.equal(T.toNum('1,200'), 1200);
  assert.equal(T.toNum(' -3.5 '), -3.5);
  assert.ok(Number.isNaN(T.toNum('3kg')));
  const rows = Array.from({ length: 10 }, (_, i) => [String(i), i % 2 ? 'a' : 'b']);
  rows[3][0] = '모름';
  assert.deepEqual(T.colTypes(['x', 'y'], rows), ['num', 'cat']);
});
test('데이터 검사: 분류·예측·오류', () => {
  const csv = 'x,y\n' + Array.from({ length: 12 }, (_, i) => `${i},${i % 2 ? '홀' : '짝'}`).join('\n');
  const ds = T.makeDataset(csv, 'y');
  assert.equal(ds.prob, 'class');
  assert.deepEqual([...ds.classes].sort(), ['짝', '홀']);
  assert.deepEqual(T.validateDataset(ds), []);
  assert.equal(T.makeDataset(csv, 'x').prob, 'reg');
  assert.deepEqual(T.validateDataset(T.makeDataset(csv, 'x')), ['noNumFeature']);
  assert.ok(T.validateDataset(T.makeDataset(csv, 'zz')).includes('noTarget'));
  assert.ok(T.validateDataset(T.makeDataset('x,y\n1,a', 'y')).includes('fewRows'));
});
test('시험용 줄: 언제나 같고, 답마다 약 20%', () => {
  const ds = T.makeDataset(fs.readFileSync(here('../../ohweb/public/ai-data/penguin.csv'), 'utf8'), '펭귄 종류');
  const a = T.testRows(ds, 'as1'), b = T.testRows(ds, 'as1'), c = T.testRows(ds, 'as2');
  assert.deepEqual([...a], [...b]);
  assert.notDeepEqual([...a].sort(), [...c].sort());
  for (const k of ds.classes) {
    const all = ds.rows.filter(r => r[ds.ti] === k).length;
    const te = [...a].filter(i => ds.rows[i][ds.ti] === k).length;
    assert.equal(te, Math.max(1, Math.round(all * 0.2)));
  }
});
test('빈칸·글자·이상한 값 찾기', () => {
  const csv = 'x,y\n' + ['1,a', '2,b', '3,a', '2,b', '1,a', '3,b', ',a', '?,b', '900,a', '2,b', '1,a', '3,b'].join('\n');
  const ds = T.makeDataset(csv, 'y');
  const iss = T.rowIssues(ds, [0, 1]);
  assert.deepEqual(iss[6], [{ c: 0, kind: 'empty' }]);
  assert.deepEqual(iss[7], [{ c: 0, kind: 'notNum' }]);
  assert.deepEqual(iss[8], [{ c: 0, kind: 'outlier' }]);
  assert.ok(T.autoDropped(iss[6]) && !T.autoDropped(iss[8]) && T.hasOutlier(iss[8]));
  assert.deepEqual(iss[0], []);
});
test('모둠원 줄 나누기', () => {
  assert.deepEqual(T.ranges(10, ['a', 'b', 'c']), { a: [0, 3], b: [3, 7], c: [7, 10] });
  assert.deepEqual(T.ranges(5, ['a']), { a: [0, 5] });
});
test('결정 트리: 깊이 1은 질문 하나, 깊이를 늘리면 다 맞힌다', () => {
  const list = [];
  for (let i = 0; i < 40; i++) list.push({ x: [i, i % 2 ? '빨강' : '파랑'], y: (i < 20 ? 0 : 2) + (i % 2) });   // 4가지 답
  const t1 = T.trainTree(list, ['num', 'cat'], 4, 1);
  assert.equal(T.treeSize(t1).depth, 1);
  const t2 = T.trainTree(list, ['num', 'cat'], 4, 2);
  const ok = list.filter(s => T.argmax(T.treeProbs(t2, s.x)) === s.y).length;
  assert.equal(ok, 40);
  assert.ok(Math.abs(T.treeProbs(t2, [5, '빨강']).reduce((a, b) => a + b, 0) - 1) < 1e-9);
});
test('선형 회귀: y = 2x + 3 을 찾는다(정보 2개도)', () => {
  const list = Array.from({ length: 20 }, (_, i) => ({ x: [i], y: 2 * i + 3 }));
  const m = T.trainLinear(list, 1);
  assert.ok(Math.abs(m.w[0] - 2) < 1e-6 && Math.abs(m.b - 3) < 1e-6);
  const l2 = Array.from({ length: 30 }, (_, i) => ({ x: [i, (i * 7) % 11], y: 1.5 * i - 2 * ((i * 7) % 11) + 10 }));
  const m2 = T.trainLinear(l2, 2);
  assert.ok(Math.abs(m2.w[0] - 1.5) < 1e-6 && Math.abs(m2.w[1] + 2) < 1e-6 && Math.abs(m2.b - 10) < 1e-6);
  assert.ok(Number.isFinite(T.trainLinear(Array.from({ length: 5 }, () => ({ x: [3], y: 4 })), 1).b));   // 같은 값만 있어도 풀린다
});
test('예시 데이터: 이상한 값을 빼면 예측이 나아진다(수업의 핵심 장면)', () => {
  const ds = T.makeDataset(fs.readFileSync(here('../../ohweb/public/ai-data/foot.csv'), 'utf8'), '발 크기(mm)');
  const test = T.testRows(ds, 'as1');
  const iss = T.rowIssues(ds, [0, ds.ti]);
  const out = iss.map((x, i) => (T.hasOutlier(x) ? i : -1)).filter(i => i >= 0);
  assert.ok(out.length >= 1);
  const keep = T.fitTrial(ds, { features: [0] }, { drop: {}, test });
  const drop = {}; out.forEach(i => { drop[i] = true; });
  const fixed = T.fitTrial(ds, { features: [0] }, { drop, test });
  assert.ok(fixed.score < keep.score, `${fixed.score} < ${keep.score}`);
  assert.ok(fixed.model.w[0] > 1, '키가 클수록 발도 크다');
});
test('예시 데이터 5종이 모두 검사를 통과하고 학습된다', () => {
  for (const [f, tg] of [['penguin', '펭귄 종류'], ['fruit', '과일'], ['foot', '발 크기(mm)'], ['icecream', '판매량(개)'], ['study', '점수']]) {
    const csv = fs.readFileSync(here(`../../ohweb/public/ai-data/${f}.csv`), 'utf8');
    const ds = T.makeDataset(csv, tg);
    assert.deepEqual(T.validateDataset(ds, csv.length), [], f);
    const feats = ds.cols.map((_, c) => c).filter(c => T.usableFeature(ds, c));
    const ctx = { drop: {}, test: T.testRows(ds, 'x') };
    const tr = T.fitTrial(ds, { features: feats, depth: 3 }, ctx);
    const te = T.testTrial(ds, { features: feats, model: tr.model }, ctx);
    assert.ok(tr.n > 30 && te.n > 5 && te.score != null, f);
  }
});
test('공개 웹앱 입력 칸·맞히기', () => {
  const ds = T.makeDataset(fs.readFileSync(here('../../ohweb/public/ai-data/fruit.csv'), 'utf8'), '과일');
  const w = T.featureSpec(ds, 0);
  assert.equal(w.type, 'num');
  assert.ok(w.max < 1000, '이상한 값(1800g)은 범위에서 뺀다');
  assert.equal(w.step, 1);
  const color = T.featureSpec(ds, 2);
  assert.equal(color.type, 'cat');
  assert.ok(color.opts.includes('노랑'));
  const feats = [0, 1, 2];
  const tr = T.fitTrial(ds, { features: feats, depth: 3 }, { drop: {}, test: T.testRows(ds, 's') });
  const table = { prob: 'class', features: feats.map(c => T.featureSpec(ds, c)), model: tr.model };
  const r = T.appPredict(table, [150, 18, '노랑']);
  assert.equal(ds.classes[T.argmax(r.p)], '바나나');
  const reg = { prob: 'reg', features: [{ type: 'num' }], model: { w: [2], b: 1 } };
  assert.equal(T.appPredict(reg, ['4']).v, 9);
});
test('단계 열림: 모둠원 모두 살펴보기 → 실험 → 고른 모델 + 별점', () => {
  const p = { step: 1, defined: true };
  assert.equal(T.nextUnlock(p, ['a', 'b']), 2);
  assert.equal(T.nextUnlock({ step: 2, tChecked: { a: true } }, ['a', 'b']), 2);
  assert.equal(T.nextUnlock({ step: 2, tChecked: { a: true, b: true } }, ['a', 'b']), 3);
  assert.equal(T.nextUnlock({ step: 3, tTrials: { a: { model: {} } } }, ['a']), 4);
  const ev = { r1: { stars: { a: { s: 4 } } } };
  assert.equal(T.nextUnlock({ step: 4, evals: ev }, ['a']), 4);
  assert.equal(T.nextUnlock({ step: 4, evals: ev, tModel: { uid: 'a' } }, ['a']), 5);
});
test('표 데이터 문구가 4개 언어에 모두 있다', () => {
  const keys = Object.keys(I18N.ko).filter(k => /^t[A-Z]|^ts\d/.test(k));
  assert.ok(keys.length > 80);
  for (const l of ['en', 'zh', 'ru']) for (const k of keys) assert.ok(k in I18N[l], `${l}.${k}`);
});

console.log(`\n${n}개 통과`);
