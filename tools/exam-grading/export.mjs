// 채점용 내보내기 — 시험 배정의 문항·정답·학생 답안을 채점 폴더에 파일로 만든다(DB 는 읽기만).
//   node tools/exam-grading/export.mjs <asId> [<asId> …] [--out 폴더]
//   node tools/exam-grading/export.mjs --exam <examId> [--out 폴더]     (그 시험의 배정 전부)
// 만드는 파일 (기본 폴더: ~/exam-grading/<날짜>_<시험 제목>/ — 학생 개인정보라 레포 밖에 둔다)
//   questions.md   문항·배점·보기·정답·테스트케이스 (채점자가 읽는 것)
//   grades.csv     학생 × 문항 한 줄씩. "점수"·"사유"·"확인필요" 칸을 채운다 → apply.mjs 로 반영
//   students.csv   학생별 상태(제출/채점대기/미제출)·현재 총점
//   exam.json      위 내용의 원본(도구가 다시 읽을 때)
import { mkdirSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { getDoc, queryEq, isEmulator } from './firestore.mjs';
import { toCSV } from '../../ohweb/public/score-core.js';

export const GRADE_HEADER = ['배정', '학생ID', '학번', '이름', '문항', '문항ID', '유형', '배점', '학생답', '정답', '자동판정', '현재점수', '점수', '사유', '확인필요'];
const TYPE = { mc: '객관식', sa: '단답형', essay: '서술형', code: '코드' };
const circ = i => { const n = Number(i); return Number.isInteger(n) && n >= 0 && n < 20 ? String.fromCharCode(9312 + n) : String(i ?? ''); };
const pad2 = v => String(parseInt(String(v ?? '').replace(/[^0-9]/g, ''), 10) || 0).padStart(2, '0');
export const hakbun = s => `${parseInt(String(s.grade ?? '').replace(/[^0-9]/g, ''), 10) || ''}${pad2(s.class)}${pad2(s.number)}`;
const normGC = v => String(v ?? '').replace(/학년|반/g, '').trim();
const isTarget = (a, s) => (!a.grade || normGC(a.grade) === normGC(s.grade)) && (!a.class || normGC(a.class) === normGC(s.class)) && (!a.schoolName || a.schoolName === (s.schoolName || ''));

function parseArgs(argv) {
  const o = { asIds: [], examId: '', out: '' };
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === '--exam') o.examId = argv[++i];
    else if (argv[i] === '--out') o.out = argv[++i];
    else o.asIds.push(argv[i]);
  }
  return o;
}

export async function exportExam({ asIds = [], examId = '', out = '' }) {
  let assignments;
  if (examId) assignments = await queryEq('exam_assignments', { examId });
  else assignments = (await Promise.all(asIds.map(id => getDoc(`exam_assignments/${id}`)))).filter(Boolean);
  if (!assignments.length) throw new Error('배정을 찾지 못했습니다. list.mjs 로 asId 를 확인하세요.');
  const exIds = [...new Set(assignments.map(a => a.examId))];
  if (exIds.length > 1) throw new Error('서로 다른 시험의 배정을 한 번에 내보낼 수 없습니다.');
  const exam = (await getDoc(`exams/${exIds[0]}`)) || { id: exIds[0], title: exIds[0] };
  const qs = (await queryEq('exam_questions', { examId: exam.id })).sort((a, b) => (a.order ?? 1e9) - (b.order ?? 1e9));
  const keys = Object.fromEntries((await Promise.all(qs.map(q => getDoc(`exam_answers/${q.id}`)))).map((k, i) => [qs[i].id, k || { answer: qs[i].answer, testCases: qs[i].testCases }]));
  const questions = qs.map((q, i) => ({
    id: q.id, no: i + 1, type: q.type, typeLabel: TYPE[q.type] || q.type, title: q.title || '', points: q.points || 0,
    form: q.form || '', options: q.options || [], answer: keys[q.id]?.answer ?? null, testCases: keys[q.id]?.testCases || [],
    rubric: q.rubric || q.criteria || '',
  }));
  const qById = Object.fromEntries(questions.map(q => [q.id, q]));

  const students = await queryEq('students', {});
  const rows = [], studentRows = [];
  for (const a of assignments) {
    const [progs, results] = await Promise.all([queryEq('exam_progress', { asId: a.id }), queryEq('exam_results', { asId: a.id })]);
    const progBy = Object.fromEntries(progs.map(p => [p.studentId || p.id.slice(a.id.length + 1), p]));
    const resBy = {};
    results.forEach(r => (resBy[r.studentId] ||= []).push(r));
    const targets = students.filter(s => !s.isMaster && s.schoolName && isTarget(a, s));
    const ids = new Set([...targets.map(s => s.id), ...Object.keys(progBy)]);
    for (const sid of ids) {
      const s = students.find(x => x.id === sid) || { id: sid, name: resBy[sid]?.[0]?.name || '', grade: '', class: '', number: '' };
      const p = progBy[sid];
      const st = p?.status === 'submitted' ? (p.needsManual ? '채점대기' : '채점완료') : (p ? '응시 중(미제출)' : '미제출');
      studentRows.push([a.id, sid, hakbun(s), s.name || '', st, p?.status === 'submitted' && !p.needsManual ? p.totalScore ?? '' : '', p?.totalPoints ?? '', p?.form || '']);
      if (p?.status !== 'submitted') continue;
      for (const r of (resBy[sid] || []).sort((x, y) => (x.qIdx || 0) - (y.qIdx || 0))) {
        const q = qById[r.questionId] || { no: (r.qIdx || 0) + 1, type: r.type, typeLabel: TYPE[r.type] || r.type, points: r.maxScore, options: [], answer: null, testCases: [] };
        const fb = String(r.feedback ?? '');
        const auto = r.type === 'mc' ? (r.check === 'correct' ? '맞음' : r.check === 'wrong' ? '틀림' : '')
          : fb.startsWith('cases:') ? `테스트 ${fb.slice(6)} 통과` : '';
        const ansText = r.type === 'mc'
          ? (r.value === '' || r.value == null ? '(무응답)' : `${circ(r.value)} ${q.options?.[Number(r.value)] ?? ''}`.trim())
          : String(r.value ?? '');
        const key = r.type === 'mc' ? (q.answer == null ? '' : `${circ(q.answer)} ${q.options?.[Number(q.answer)] ?? ''}`.trim())
          : r.type === 'code' ? (q.testCases?.length ? `테스트케이스 ${q.testCases.length}개(questions.md)` : '')
          : String(q.answer ?? '');
        // 미리 채우는 점수: 객관식 맞음/틀림, 코드 자동 채점. 나머지는 빈칸(채점자가 채운다).
        const graded = fb !== 'manual' && p.needsManual === false;
        const pre = graded ? r.score : r.type === 'mc' && r.check ? (r.check === 'correct' ? r.maxScore : 0) : fb.startsWith('cases:') ? r.score : '';
        const curFb = fb === 'manual' || fb.startsWith('wrong') || fb === 'correct' || fb.startsWith('cases:') ? '' : fb;
        rows.push([a.id, sid, hakbun(s), s.name || r.name || '', q.no, r.questionId || '', q.typeLabel, r.maxScore ?? q.points, ansText, key, auto, graded ? r.score : '', pre, curFb, '']);
      }
    }
  }
  rows.sort((x, y) => String(x[2]).localeCompare(String(y[2]), 'ko', { numeric: true }) || x[4] - y[4]);
  studentRows.sort((x, y) => String(x[2]).localeCompare(String(y[2]), 'ko', { numeric: true }));

  const date = new Date().toISOString().slice(0, 10);
  const dir = out || path.join(os.homedir(), 'exam-grading', `${date}_${String(exam.title).replace(/[\\/:*?"<>|]/g, '_')}`);
  mkdirSync(dir, { recursive: true });
  writeFileSync(path.join(dir, 'grades.csv'), toCSV([GRADE_HEADER, ...rows]));
  writeFileSync(path.join(dir, 'students.csv'), toCSV([['배정', '학생ID', '학번', '이름', '상태', '현재총점', '만점', '시험지'], ...studentRows]));
  writeFileSync(path.join(dir, 'exam.json'), JSON.stringify({ exam: { id: exam.id, title: exam.title, forms: exam.forms || [] }, assignments: assignments.map(a => ({ id: a.id, schoolName: a.schoolName || '', grade: a.grade || '', class: a.class || '' })), questions, exportedAt: new Date().toISOString() }, null, 2));
  const md = [`# ${exam.title}`, '', `배정: ${assignments.map(a => `${a.id}(${[a.schoolName, a.grade && a.grade + '학년', a.class && a.class + '반'].filter(Boolean).join(' ') || '전체'})`).join(', ')}`, ''];
  for (const q of questions) {
    md.push(`## ${q.no}. [${q.typeLabel}${q.form ? ` · ${q.form}형` : ''}] ${q.points}점 (문항ID ${q.id})`, '', q.title, '');
    if (q.options.length) md.push(...q.options.map((o, i) => `- ${circ(i)} ${o}`), '');
    if (q.type === 'mc') md.push(`정답: ${q.answer == null ? '(미등록)' : circ(q.answer)}`, '');
    else if (q.type === 'code') md.push(...q.testCases.map((t, i) => `- 테스트${i + 1}: 입력 \`${String(t.input ?? '').replace(/\n/g, '⏎')}\` → 기대 출력 \`${String(t.expected ?? '').replace(/\n/g, '⏎')}\``), '');
    else if (q.answer != null && q.answer !== '') md.push(`예시 정답: ${q.answer}`, '');
    if (q.rubric) md.push(`채점 기준(문항에 저장된 것): ${typeof q.rubric === 'string' ? q.rubric : JSON.stringify(q.rubric)}`, '');
  }
  writeFileSync(path.join(dir, 'questions.md'), md.join('\n'));
  const count = st => studentRows.filter(r => r[4] === st).length;
  return { dir, exam, questions: questions.length, rows: rows.length, submitted: count('채점대기') + count('채점완료'), waiting: count('채점대기'), notSubmitted: count('미제출') + count('응시 중(미제출)') };
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const r = await exportExam(parseArgs(process.argv.slice(2)));
  console.log(`${isEmulator ? '[에뮬레이터] ' : ''}${r.exam.title}: 문항 ${r.questions}개, 제출 ${r.submitted}명(채점대기 ${r.waiting}), 미제출 ${r.notSubmitted}명, 채점 줄 ${r.rows}개`);
  console.log(`폴더: ${r.dir}`);
}
