// 수행평가 점수 확인 — score-core.js(파일 읽기·학생 맞추기·이력 비교) 단위 테스트.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  decodeText, parseCSV, toCSV, parseTemplateRows, parseScoreRows, parseStatus,
  classKey, studentKey, sameResult, describeChange,
} from '../ohweb/public/score-core.js';

const students = [
  { id: 'A', schoolName: '관산중', grade: '1', class: '2', number: 3, name: '김학생' },
  { id: 'B', schoolName: '관산중', grade: '1학년', class: '2반', number: '4', name: '박학생' },
];
const items = [{ code: 'A1', label: '분량 미달' }, { code: 'A2', label: '기한 초과' }];

test('CSV: 따옴표·쉼표·줄바꿈·빈 줄', () => {
  assert.deepEqual(parseCSV('a,"b,c","d""e"\r\n\r\n1,"x\ny",3\n'), [['a', 'b,c', 'd"e'], ['1', 'x\ny', '3']]);
});

test('CSV 내려받기는 BOM 을 붙이고 다시 읽을 수 있다', () => {
  const s = toCSV([['과목', '사유'], ['정보', '쉼표, 있음']]);
  assert.equal(s.charCodeAt(0), 0xFEFF);
  assert.deepEqual(parseCSV(s.slice(1)), [['과목', '사유'], ['정보', '쉼표, 있음']]);
});

test('파일 글자: UTF-8(BOM) 과 CP949 둘 다 읽는다', () => {
  assert.equal(decodeText(new TextEncoder().encode('﻿학교')), '학교');
  // "학교" 의 EUC-KR 바이트
  assert.equal(decodeText(new Uint8Array([0xC7, 0xD0, 0xB1, 0xB3])), '학교');
});

test('감점사유 템플릿: 과목별로 묶고 잘못된 줄을 알려준다', () => {
  const { subjects, errors } = parseTemplateRows(parseCSV('과목,코드,사유\n정보,A1,분량 미달\n정보,A2,기한 초과\n과학,B1,안전 수칙\n정보,A1,중복\n정보,,빈칸'));
  assert.deepEqual(Object.keys(subjects), ['정보', '과학']);
  assert.equal(subjects['정보'].length, 2);
  assert.equal(errors.length, 2);
  assert.match(errors[0], /5줄/);
});

test('감점사유 템플릿: 머리글이 없으면 거부', () => {
  assert.match(parseTemplateRows([['a', 'b', 'c']]).errors[0], /머리글/);
});

test('반·학생 키는 "1학년"/"1" 같은 표기 차이를 맞춘다', () => {
  assert.equal(classKey('관산중', '1학년', '2반'), classKey('관산중', '1', '2'));
  assert.equal(studentKey('관산중', '1', '2', '03'), studentKey('관산중', '1학년', '2반', 3));
});

test('점수 파일: 학생 찾기, 상태·감점코드 변환', () => {
  const csv = '학교,학년,반,번호,이름,점수,상태,감점코드,메모\n관산중,1,2,3,김학생,17,,A1;A2,잘함\n관산중,1,2,4,박학생,,미제출,,';
  const r = parseScoreRows(parseCSV(csv), { students, items, maxScore: 20 });
  assert.deepEqual(r.errors, []);
  assert.deepEqual(r.warnings, []);
  assert.deepEqual(r.rows[0], { line: 2, studentId: 'A', score: 17, status: 'normal', deductions: items, memo: '잘함' });
  assert.deepEqual(r.rows[1], { line: 3, studentId: 'B', score: null, status: 'missing', deductions: [], memo: '' });
});

test('점수 파일: 없는 학생·중복·만점 초과·모르는 코드·모르는 상태', () => {
  const csv = '학교,학년,반,번호,점수,상태,감점코드\n관산중,1,2,9,10,,\n관산중,1,2,3,10,,\n관산중,1,2,3,10,,\n관산중,1,2,4,25,,\n관산중,1,2,4,10,,Z9\n관산중,1,2,4,10,조퇴,';
  const r = parseScoreRows(parseCSV(csv), { students, items, maxScore: 20 });
  assert.equal(r.rows.length, 1);
  assert.equal(r.errors.length, 5);
  assert.match(r.errors.join('\n'), /찾을 수 없습니다[\s\S]*두 번[\s\S]*만점[\s\S]*Z9[\s\S]*상태/);
});

test('점수 파일: 이름이 다르면 경고(번호가 바뀐 학생)', () => {
  const r = parseScoreRows(parseCSV('학교,학년,반,번호,이름,점수\n관산중,1,2,3,다른애,10'), { students, items, maxScore: 20 });
  assert.equal(r.rows.length, 1);
  assert.match(r.warnings[0], /이름이 명단과 다릅니다/);
});

test('상태 표기', () => {
  assert.equal(parseStatus(''), 'normal');
  assert.equal(parseStatus('결시'), 'absent');
  assert.equal(parseStatus('인정점'), 'credited');
  assert.equal(parseStatus('조퇴'), null);
});

test('이력: 바뀐 것만 요약', () => {
  const a = { score: 15, status: 'normal', deductions: [{ code: 'A1', label: '분량 미달' }], memo: '' };
  assert.ok(sameResult(a, { ...a, updatedAt: 1, published: true }));
  assert.equal(describeChange(a, { ...a, score: 17, deductions: [{ code: 'A2', label: '기한 초과' }] }), '점수 15 → 17, 감점 +A2 −A1');
});
