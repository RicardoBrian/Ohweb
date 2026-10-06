// AI 실험실 순수 로직 테스트 — `node ohinfo/tests/ai-core.test.mjs`
import assert from 'node:assert/strict';
import * as C from '../public/ai-core.js';
import { I18N, makeT } from '../public/ai-i18n.js';

let n = 0;
const test = (name, fn) => { fn(); n++; console.log('✅', name); };

test('모델 링크: 주소 그대로', () => {
  assert.deepEqual(C.parseModelUrl('https://teachablemachine.withgoogle.com/models/AbC12_-x/'),
    { id: 'AbC12_-x', url: 'https://teachablemachine.withgoogle.com/models/AbC12_-x/' });
});
test('모델 링크: 끝 슬래시 없음·앞뒤 공백', () => {
  assert.equal(C.parseModelUrl('  teachablemachine.withgoogle.com/models/XyZ123 ').id, 'XyZ123');
});
test('모델 링크: 예제 코드 전체를 붙여넣음', () => {
  const code = '<script>\n  const URL = "https://teachablemachine.withgoogle.com/models/Qw3rTy9/";\n let model;</script>';
  assert.equal(C.parseModelUrl(code).id, 'Qw3rTy9');
});
test('모델 링크: 다운로드 파일·엉뚱한 글', () => {
  assert.equal(C.parseModelUrl('converted_keras.zip').error, 'downloaded');
  assert.equal(C.parseModelUrl('tm-my-image-model').error, 'downloaded');
  assert.equal(C.parseModelUrl('https://google.com').error, 'notfound');
  assert.equal(C.parseModelUrl('').error, 'empty');
});
test('메타데이터: 이미지/오디오/클래스 수', () => {
  assert.deepEqual(C.checkMetadata({ packageName: '@teachablemachine/image', labels: ['a', 'b'] }), { labels: ['a', 'b'] });
  assert.equal(C.checkMetadata({ packageName: '@teachablemachine/audio', labels: ['a', 'b'] }).error, 'notimage');
  assert.equal(C.checkMetadata({ labels: ['a'] }).error, 'fewclasses');
  assert.equal(C.checkMetadata(null).error, 'badmeta');
});
const labels = [
  { id: 'l1', name: '사과', tr: { en: 'Apple' } },
  { id: 'l2', name: '바나나', tr: { en: 'Banana' } },
  { id: 'l3', name: '포도' },
];
test('클래스 자동 연결: 이름·번역·공백/대소문자', () => {
  const m = C.autoMapClasses(['사과', 'banana ', 'Class 3'], labels);
  assert.deepEqual(m, { '사과': 'l1', 'banana ': 'l2', 'Class 3': '' });
});
test('클래스 연결 점검: 빠짐·중복·안 쓴 레이블', () => {
  const r = C.checkMapping(['a', 'b'], labels, { a: 'l1', b: 'l1' });
  assert.equal(r.ok, false); assert.deepEqual(r.dup, ['l1']); assert.deepEqual(r.unusedLabels, ['l2', 'l3']);
  const r2 = C.checkMapping(['a', 'b', 'c'], labels, { a: 'l1', b: 'l2', c: '' });
  assert.equal(r2.ok, false); assert.deepEqual(r2.missing, ['c']);
  assert.equal(C.checkMapping(['a', 'b', 'c'], labels, { a: 'l1', b: 'l2', c: 'l3' }).ok, true);
});
test('기본 클래스 이름 감지', () => {
  assert.ok(C.isDefaultClassName('Class 1')); assert.ok(C.isDefaultClassName('클래스 2'));
  assert.ok(!C.isDefaultClassName('Classic'));
});
test('레이블 검사', () => {
  const ok = [{ id: 'a', name: '사과', owner: 'A' }, { id: 'b', name: '배', owner: 'B' }];
  assert.deepEqual(C.validateLabels(ok, ['A', 'B']), []);
  assert.ok(C.validateLabels([ok[0]], ['A']).includes('min2'));
  assert.ok(C.validateLabels([ok[0], { id: 'c', name: ' 사 과 ', owner: 'A' }], ['A']).includes('duplicate'));
  assert.ok(C.validateLabels([{ ...ok[0], owner: 'A' }, { ...ok[1], owner: 'A' }], ['A', 'B']).includes('memberWithout'));
  assert.ok(C.validateLabels(ok, ['A', 'B', 'C']).includes('fewerThanMembers'));
  assert.ok(C.validateLabels([...ok, { id: 'c', name: '', owner: 'A' }], ['A', 'B']).includes('empty'));
  assert.ok(C.validateLabels([...ok, { id: 'c', name: 'x', owner: 'Z' }], ['A', 'B']).includes('noOwner'));
  const six = 'abcdef'.split('').map((x, i) => ({ id: x, name: x, owner: i % 2 ? 'A' : 'B' }));
  assert.ok(C.validateLabels(six, ['A', 'B'], 5).includes('tooMany'));
});
test('번역 문맥 붙이고 떼기', () => {
  assert.equal(C.withContext('배', '과일'), '배 (과일)');
  assert.equal(C.stripContext('Pear (fruit)'), 'Pear');
  assert.equal(C.stripContext('梨（水果）'), '梨');
  assert.equal(C.stripContext('Груша'), 'Груша');
  assert.equal(C.stripContext('(fruit)'), '(fruit)');
});
test('결과 문구: 틀 4개 × 4개 언어, 번역된 레이블 사용', () => {
  const l = { name: '고양이', tr: { en: 'Cat', zh: '猫', ru: 'Кошка' }, phrase: 1 };
  assert.equal(C.phraseFor(l, 'ko'), '이건 바로 고양이!');
  assert.equal(C.phraseFor(l, 'en'), 'This is: Cat!');
  assert.equal(C.phraseFor(l, 'ru'), 'Это Кошка!');
  assert.equal(C.phraseFor({ ...l, phrase: 3 }, 'ko'), '아마도 고양이일 거예요');
  for (const p of C.PHRASES) for (const lang of C.LANGS) assert.ok(p[lang].includes('{L}'), `${lang} 틀에 {L}`);
});
test('결과 문구: 직접 쓰기·번역·숨김', () => {
  const l = { name: '고양이', tr: { en: 'Cat' }, phrase: C.CUSTOM_PHRASE, custom: '가 나타났다!', customTr: { en: 'A cat appeared!' } };
  assert.equal(C.phraseFor(l, 'ko'), '고양이가 나타났다!');
  assert.equal(C.phraseFor(l, 'en'), 'A cat appeared!');
  assert.equal(C.phraseFor(l, 'zh'), '고양이가 나타났다!'.replace('고양이', '고양이'));
  assert.equal(C.phraseFor(l, 'en', { hidden: true }), 'The answer is: Cat!');
  assert.equal(C.phraseFor({ name: 'Cat', phrase: 4, custom: ' is here', customTr: { ko: '고양이 등장' } }, 'en', { srcLang: 'en' }), 'Cat is here');
});
test('직접 쓰는 문구 검사', () => {
  assert.equal(C.validateCustomPhrase('가 나타났다! 야옹~'), '');
  assert.equal(C.validateCustomPhrase('   '), 'empty');
  assert.equal(C.validateCustomPhrase('가'.repeat(21)), 'tooLong');
  assert.equal(C.validateCustomPhrase('www.naver.com 보기'), 'link');
  assert.equal(C.validateCustomPhrase('씨 발'), 'bad');
  assert.equal(C.validateCustomPhrase('Fuck'), 'bad');
});
test('사진 수 균형', () => {
  assert.equal(C.isUnbalanced([20, 21, 19]), false);
  assert.equal(C.isUnbalanced([30, 10]), true);
  assert.equal(C.isUnbalanced([4, 1]), false); // 차이가 작으면 경고 안 함
});
test('단계 열림 조건', () => {
  const p = { step: 2, labels: [{ id: 'a' }, { id: 'b' }], counts: { train: { a: 15, b: 14 } } };
  assert.equal(C.nextUnlock(p, { minPerLabel: 15 }), 2);
  p.counts.train.b = 15;
  assert.equal(C.nextUnlock(p, { minPerLabel: 15 }), 3);
  assert.equal(C.nextUnlock({ step: 1, defined: true }), 2);
  assert.equal(C.nextUnlock({ step: 3, modelUrl: 'x', mappingOk: false }), 3);
  assert.equal(C.nextUnlock({ step: 3, modelUrl: 'x', mappingOk: true }), 4);
  assert.equal(C.nextUnlock({ step: 4, evals: { r1: { stars: {} } } }), 4);
  assert.equal(C.nextUnlock({ step: 4, evals: { r1: { stars: { A: { s: 3 } } } } }), 5);
});
test('평가 회차 정렬·채점', () => {
  const p = { evals: { r10: { pct: 90 }, r2: { pct: 50 }, editing: {} } };
  assert.deepEqual(C.evalRounds(p).map(r => r.n), [2, 10]);
  assert.equal(C.currentEval(p).pct, 90);
  const s = C.scoreResults([{ labelId: 'a', ok: true }, { labelId: 'a', ok: false }, { labelId: 'b', ok: true }]);
  assert.deepEqual([s.total, s.correct, s.pct, s.per.a.correct], [3, 2, 67, 1]);
});
test('사진 지문 거리·중복', () => {
  assert.equal(C.fpDistance('ff00', 'ff00'), 0);
  assert.equal(C.fpDistance('ff00', 'fe00'), 1);
  assert.equal(C.fpDistance('ff', 'ff00'), Infinity);
  assert.ok(C.isDuplicate('ff00', ['0000', 'ff01']));
  assert.ok(!C.isDuplicate('ffff', ['0000']));
});
test('사진 장수 세기', () => {
  assert.deepEqual(C.countImages([{ kind: 'train', labelId: 'a' }, { kind: 'train', labelId: 'a' }, { kind: 'test', labelId: 'b' }]),
    { train: { a: 2 }, test: { b: 1 } });
});
test('현황판 요약', () => {
  const s = C.buildSummary({ step: 2, topic: '과일', labels: [{ id: 'a', name: '사과' }], counts: { train: { a: 3 } } }, { minPerLabel: 10 });
  assert.deepEqual(s.labels[0], { id: 'a', name: '사과', emoji: '', c: 3, t: 0 });
  assert.equal(s.minPerLabel, 10); assert.equal(s.acc, null); assert.equal(s.title, '');
});
test('ohdlet 게시 키(ohdlet.html과 같은 규칙)', () => {
  assert.equal(C.classBoardKey({ name: '정보', schoolName: '관산중', grade: '1', group: '4' }), '정보__관산중__g1__c4');
  assert.equal(C.classBoardKey({ name: '정보', schoolName: '관산중' }), '정보__관산중');
});
test('구글 이미지 끌어놓기 주소 풀기', () => {
  assert.equal(C.extractImageUrl('https://www.google.com/imgres?imgurl=https%3A%2F%2Fa.com%2Fx.jpg&imgrefurl=y'), 'https://a.com/x.jpg');
  assert.equal(C.extractImageUrl('#comment\nhttps://b.com/y.png'), 'https://b.com/y.png');
  assert.equal(C.extractImageUrl('javascript:alert(1)'), '');
  assert.ok(C.extractImageUrl('data:image/png;base64,AAAA').startsWith('data:image/png'));
});
test('4개 언어 문장 키가 모두 같다', () => {
  const keys = o => Object.entries(o).flatMap(([k, v]) => (v && typeof v === 'object' && !Array.isArray(v)) ? keys(v).map(x => k + '.' + x) : [k + (Array.isArray(v) ? `[${v.length}]` : '')]).sort();
  const base = keys(I18N.ko);
  for (const l of ['en', 'zh', 'ru']) assert.deepEqual(keys(I18N[l]), base, l);
  const t = makeT('en');
  assert.equal(t('score', { n: 10, c: 7 }), '7 of 10 correct');
  assert.equal(t('causes.few'), 'Too few photos');
  assert.equal(t('nope'), 'nope');
});
console.log(`\n${n}개 통과`);
