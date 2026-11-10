// 시험 배정 목록 — 어느 시험을 채점할지 고를 때.
//   node tools/exam-grading/list.mjs            (전체)
//   node tools/exam-grading/list.mjs 기말       (시험 제목에 "기말"이 든 것만)
import { listAll, queryEq, isEmulator } from './firestore.mjs';

const filter = process.argv[2] || '';
const [exams, assignments] = await Promise.all([listAll('exams'), listAll('exam_assignments')]);
const examById = Object.fromEntries(exams.map(e => [e.id, e]));
const rows = [];
for (const a of assignments) {
  const ex = examById[a.examId];
  const title = ex?.title || '(시험 없음)';
  if (filter && !title.includes(filter)) continue;
  const progs = await queryEq('exam_progress', { asId: a.id });
  const submitted = progs.filter(p => p.status === 'submitted');
  rows.push({
    asId: a.id, examId: a.examId, 시험: title,
    대상: [a.schoolName, a.grade && `${a.grade}학년`, a.class && `${a.class}반`].filter(Boolean).join(' ') || '전체',
    상태: a.status === 'ON' ? '열림' : '닫힘',
    제출: submitted.length,
    채점대기: submitted.filter(p => p.needsManual === true).length,
  });
}
rows.sort((x, y) => x.시험.localeCompare(y.시험, 'ko') || x.대상.localeCompare(y.대상, 'ko', { numeric: true }));
if (isEmulator) console.log('[에뮬레이터]');
console.table(rows);
console.log('\n채점할 배정을 고르면: node tools/exam-grading/export.mjs <asId> [<asId> …]  또는  --exam <examId> (그 시험의 배정 전부)');
