// 수행평가 점수 확인 — score-core.js(파일 읽기·학생 맞추기·이력 비교) 단위 테스트.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  decodeText, parseCSV, toCSV, parseTemplateRows, parseScoreRows, parseStatus,
  classKey, studentKey, sameResult, describeChange, parseHakbun, hakbunInName, matchFiles, scoreHeader,
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
  assert.deepEqual(r.rows[0], { line: 2, studentId: 'A', score: 17, status: 'normal', deductions: items, memo: '잘함', note: '' });
  assert.deepEqual(r.rows[1], { line: 3, studentId: 'B', score: null, status: 'missing', deductions: [], memo: '', note: '' });
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

// ── 채점 시트(상세 탭) 그대로 ──
const sheet = [
  '학번,이름,① 변수 사용(5),② 연산 블록(5),③ 반복과 조건(15),1차 합계(25),① 감점 사유,② 감점 사유,③ 감점 사유,비고',
  '10203,김학생,2,1,7,10,변수 1개만 저장,연산 블록 미사용,"반복, 조건 블록 미사용",일부만 제출',
  '10204,박학생,5,5,15,25,감점 없음,감점 없음,감점 없음,',
  '10205,없는애,5,5,15,25,,,,',
].join('\n');

test('학번 읽기·파일 이름 속 학번', () => {
  assert.deepEqual(parseHakbun('10203'), { grade: 1, cls: 2, number: 3 });
  assert.equal(parseHakbun('1023'), null);
  assert.equal(hakbunInName('20260930_10114_문가월_2.png'), '10114');
  assert.equal(hakbunInName('20261104_10101_엔젤.sb3'), '10101');
  assert.equal(hakbunInName('스크린샷.png'), null);
});

test('채점 시트: 학번·항목 점수·항목 사유·비고를 그대로 읽고 항목을 제안한다', () => {
  const r = parseScoreRows(parseCSV(sheet), { students, items, maxScore: 25 });
  assert.deepEqual(r.fileCriteria, [{ idx: 1, label: '변수 사용', max: 5 }, { idx: 2, label: '연산 블록', max: 5 }, { idx: 3, label: '반복과 조건', max: 15 }]);
  assert.equal(r.rows.length, 2);
  assert.equal(r.errors.length, 1); // 없는 학생
  const a = r.rows[0];
  assert.equal(a.studentId, 'A'); assert.equal(a.score, 10); assert.equal(a.note, '일부만 제출');
  assert.deepEqual(a.items[2], { label: '반복과 조건', max: 15, score: 7, reason: '반복, 조건 블록 미사용' });
  assert.equal(r.rows[1].items[0].reason, ''); // "감점 없음" 은 빈 사유
  assert.deepEqual(r.warnings, []);
});

test('채점 시트: 평가 항목 배점을 넘으면 오류, 항목 수가 다르면 거부', () => {
  const crit = [{ label: '변수 사용', max: 5 }, { label: '연산 블록', max: 5 }, { label: '반복과 조건', max: 5 }];
  const r = parseScoreRows(parseCSV(sheet), { students, items, criteria: crit });
  assert.match(r.errors.join('\n'), /3번 항목 점수 7 가 배점 5/);
  const r2 = parseScoreRows(parseCSV(sheet), { students, items, criteria: crit.slice(0, 2) });
  assert.match(r2.errors[0], /항목 수/);
});

test('학번이 두 학교에 있으면 평가 대상 반 학생을 고르고, 그래도 겹치면 오류', () => {
  const two = [...students, { id: 'X', schoolName: '다른중', grade: '1', class: '2', number: 3, name: '김학생' }];
  const csv = '학번,점수\n10203,5';
  assert.match(parseScoreRows(parseCSV(csv), { students: two, items, maxScore: 20 }).errors[0], /여러 학교/);
  assert.equal(parseScoreRows(parseCSV(csv), { students: two, poolIds: ['A', 'B'], items, maxScore: 20 }).rows[0].studentId, 'A');
});

test('제출물 파일을 학번으로 학생에게 붙인다', () => {
  const files = [{ id: '1', name: '20260930_10203_김학생_2.png' }, { id: '2', name: '20260930_10203_김학생.png' }, { id: '3', name: '20260930_10299_누구.png' }, { id: '4', name: '메모.txt' }];
  const m = matchFiles(files, students, ['A', 'B']);
  assert.deepEqual(m.byStudent.A.map(f => f.id), ['2', '1']);
  assert.deepEqual(m.unmatched.map(f => f.why), ['명단에 없는 학번', '이름에 학번이 없음']);
});

test('항목이 있는 평가의 점수 양식 머리글은 다시 읽힌다', () => {
  const crit = [{ label: '변수 사용', max: 5 }, { label: '연산', max: 5 }];
  const h = scoreHeader(crit);
  const r = parseScoreRows([h, ['관산중', '1', '2', '3', '김학생', '4', '5', '조금 부족', '', '', '', '', '']], { students, items, criteria: crit });
  assert.deepEqual(r.errors, []);
  assert.equal(r.rows[0].score, 9);
  assert.equal(r.rows[0].items[0].reason, '조금 부족');
});

test('이력: 항목 점수 변경도 요약', () => {
  const a = { score: 10, items: [{ label: 'x', max: 5, score: 2, reason: '' }] };
  assert.equal(describeChange(a, { score: 13, items: [{ label: 'x', max: 5, score: 5, reason: '' }] }), '점수 10 → 13, ① 2 → 5');
});
