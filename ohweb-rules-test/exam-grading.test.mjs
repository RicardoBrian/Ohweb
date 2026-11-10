// 채점 도구(tools/exam-grading) — 에뮬레이터에서 내보내기 → 점수 채우기 → 미리보기 → 반영까지.
// npm run test:grading
import { initializeTestEnvironment } from '@firebase/rules-unit-testing';
import { readFileSync, writeFileSync, mkdtempSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { doc, setDoc, getDoc } from 'firebase/firestore';

process.env.FIRESTORE_EMULATOR_HOST = '127.0.0.1:8181';
const { exportExam } = await import('../tools/exam-grading/export.mjs');
const { applyGrades } = await import('../tools/exam-grading/apply.mjs');
const { parseCSV, toCSV, decodeText } = await import('../ohweb/public/score-core.js');

const env = await initializeTestEnvironment({ projectId: 'ohweb-93062', firestore: { rules: 'rules_version = "2"; service cloud.firestore { match /{d=**} { allow read, write: if false; } }', host: '127.0.0.1', port: 8181 } });
await env.clearFirestore();
await env.withSecurityRulesDisabled(async c => {
  const db = c.firestore();
  const st = (id, n, name) => setDoc(doc(db, 'students/' + id), { name, schoolName: 'S중', grade: '1', class: '2', number: n });
  await st('S1', 3, '김학생'); await st('S2', 4, '박학생'); await st('S3', 5, '이학생');
  await setDoc(doc(db, 'students/M'), { name: '선생님', isMaster: true, schoolName: 'S중', grade: '1', class: '2', number: 99 });
  await setDoc(doc(db, 'exams/EX1'), { title: '기말고사' });
  await setDoc(doc(db, 'exam_questions/Q1'), { examId: 'EX1', order: 1, type: 'mc', title: '1+1?', options: ['1', '2', '3'], points: 10 });
  await setDoc(doc(db, 'exam_questions/Q2'), { examId: 'EX1', order: 2, type: 'essay', title: '변수란?', points: 20 });
  await setDoc(doc(db, 'exam_questions/Q3'), { examId: 'EX1', order: 3, type: 'code', title: 'hi 출력', points: 10 });
  await setDoc(doc(db, 'exam_answers/Q1'), { examId: 'EX1', answer: '1' });
  await setDoc(doc(db, 'exam_answers/Q3'), { examId: 'EX1', testCases: [{ input: '', expected: 'hi' }, { input: 'a', expected: 'hi' }] });
  await setDoc(doc(db, 'exam_assignments/AS1'), { examId: 'EX1', schoolName: 'S중', grade: '1', class: '2', status: 'OFF' });
  const res = (sid, i, qid, type, value, extra) => setDoc(doc(db, `exam_results/AS1_${sid}_${i}`), { asId: 'AS1', studentId: sid, questionId: qid, qIdx: i, type, value, maxScore: [10, 20, 10][i], score: 0, feedback: 'manual', ...extra });
  for (const [sid, mc] of [['S1', 'correct'], ['S2', 'wrong']]) {
    await setDoc(doc(db, `exam_progress/AS1_${sid}`), { asId: 'AS1', studentId: sid, status: 'submitted', totalScore: 5, totalPoints: 40, needsManual: true });
    await res(sid, 0, 'Q1', 'mc', mc === 'correct' ? '1' : '0', { check: mc });
    await res(sid, 1, 'Q2', 'essay', '값을 담는 상자');
    await res(sid, 2, 'Q3', 'code', "print('hi')", { score: 5, feedback: 'cases:1/2' });
  }
});

const read = async fn => { let v; await env.withSecurityRulesDisabled(async cx => { v = await fn(cx.firestore()); }); return v; };
let fails = 0; const ok = (c, l) => { if (!c) fails++; console.log((c ? '✅ ' : '❌ ') + l); };
const out = mkdtempSync(path.join(os.tmpdir(), 'grading-'));
const ex = await exportExam({ asIds: ['AS1'], out });
ok(ex.questions === 3 && ex.submitted === 2 && ex.notSubmitted === 1 && ex.rows === 6, '내보내기: 문항 3, 제출 2, 미제출 1(선생님 계정 제외), 채점 줄 6');
const file = path.join(out, 'grades.csv');
let rows = parseCSV(decodeText(readFileSync(file)));
const H = rows[0], c = n => H.indexOf(n);
const row = (sid, q) => rows.find(r => r[c('학생ID')] === sid && r[c('문항')] === String(q));
ok(row('S1', 1)[c('점수')] === '10' && row('S2', 1)[c('점수')] === '0' && row('S1', 3)[c('점수')] === '5' && row('S1', 2)[c('점수')] === '', '내보내기: 객관식·코드 점수는 미리 채우고 서술형은 빈칸');
ok(/② 2/.test(row('S1', 1)[c('정답')]) && /① 1/.test(row('S2', 1)[c('학생답')]) && row('S1', 3)[c('자동판정')] === '테스트 1/2 통과', '내보내기: 보기 번호·정답·자동판정 표시');
ok(/변수란\?/.test(readFileSync(path.join(out, 'questions.md'), 'utf8')) && /미제출/.test(readFileSync(path.join(out, 'students.csv'), 'utf8')), '내보내기: questions.md·students.csv');

let r = await applyGrades(file);
ok(r.report.every(x => x.result === '건너뜀' && /빈칸/.test(x.why)) && r.writes === 0, '반영: 서술형 빈칸이면 학생 단위로 건너뜀');

row('S1', 2)[c('점수')] = '15'; row('S1', 2)[c('사유')] = '예시는 있으나 근거 부족';
row('S2', 2)[c('점수')] = '20'; row('S2', 2)[c('확인필요')] = '답이 짧아 판단 애매';
writeFileSync(file, toCSV(rows));
r = await applyGrades(file);
const s1 = r.report.find(x => x.sid === 'S1'), s2 = r.report.find(x => x.sid === 'S2');
ok(s1.result === '반영+공개' && s1.after === '30/40' && s2.result === '건너뜀' && /확인필요/.test(s2.why), '미리보기: 김학생 30/40 공개 예정, 확인필요인 박학생은 건너뜀');
const before = await read(async db => (await getDoc(doc(db, 'exam_progress/AS1_S1'))).data());
ok(before.needsManual === true && before.totalScore === 5, '미리보기는 DB 를 바꾸지 않음');

r = await applyGrades(file, { write: true });
const [p1, q2, q3, p2] = await read(db => Promise.all(['exam_progress/AS1_S1', 'exam_results/AS1_S1_1', 'exam_results/AS1_S1_2', 'exam_progress/AS1_S2'].map(async p => (await getDoc(doc(db, p))).data())));
ok(p1.needsManual === false && p1.totalScore === 30 && p1.totalPoints === 40 && p1.gradedBy === 'claude-session' && !!p1.gradedAt, '반영: 총점·공개·채점자·시각 저장');
ok(q2.score === 15 && q2.feedback === '예시는 있으나 근거 부족' && q3.feedback === 'cases:1/2', '반영: 서술형 점수·사유, 코드는 사유 비우면 자동 채점 표시 유지');
ok(p2.needsManual === true, '반영: 건너뛴 학생은 그대로(비공개)');

r = await applyGrades(file);
ok(r.report.find(x => x.sid === 'S1').result === '변경 없음', '다시 미리보기: 이미 반영한 학생은 변경 없음');
row('S1', 1)[c('점수')] = '11'; writeFileSync(file, toCSV(rows));
r = await applyGrades(file);
ok(/0~10 밖/.test(r.report.find(x => x.sid === 'S1').why), '배점보다 큰 점수는 거부');

console.log(fails ? `\n실패 ${fails}건` : '\n전부 통과'); process.exitCode = fails ? 1 : 0;
await env.cleanup();
