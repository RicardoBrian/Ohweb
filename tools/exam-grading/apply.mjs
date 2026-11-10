// 채점 반영 — grades.csv 의 "점수"·"사유"를 DB 에 쓴다. 관리자 화면 채점 창의 "저장"과 같은 형식.
//   node tools/exam-grading/apply.mjs <grades.csv>            미리보기만(아무것도 안 씀) + apply-preview.csv
//   node tools/exam-grading/apply.mjs <grades.csv> --write    실제로 쓴다
// 학생 단위로 처리한다. 그 학생의 문항이 하나라도 점수 빈칸이거나 "확인필요"가 적혀 있으면 그 학생은 건너뛴다.
// 쓰는 것: exam_results/{배정}_{학생}_{번호} 의 score·feedback,
//          exam_progress/{배정}_{학생} 의 totalScore·totalPoints·needsManual=false·gradedAt·gradedBy
// ⚠️ needsManual 이 false 가 되는 순간 학생의 시험 화면에 점수·사유가 보인다.
import { readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { getDoc, queryEq, commitUpdates, isEmulator } from './firestore.mjs';
import { parseCSV, decodeText, toCSV } from '../../ohweb/public/score-core.js';


export async function applyGrades(file, { write = false, allowFlagged = false, gradedBy = 'claude-session' } = {}) {
  const rows = parseCSV(decodeText(readFileSync(file)));
  const [h, ...body] = rows;
  const col = n => h.indexOf(n);
  for (const n of ['배정', '학생ID', '문항ID', '배점', '점수', '사유']) if (col(n) < 0) throw new Error(`grades.csv 에 "${n}" 열이 없습니다.`);
  const get = (r, n) => String(r[col(n)] ?? '').trim();
  const groups = new Map();
  body.forEach((r, i) => {
    const k = `${get(r, '배정')}|${get(r, '학생ID')}`;
    (groups.get(k) || groups.set(k, []).get(k)).push({ r, line: i + 2 });
  });

  const report = [], updates = [];
  for (const [k, list] of groups) {
    const [asId, sid] = k.split('|');
    const who = `${get(list[0].r, '학번')} ${get(list[0].r, '이름')}`.trim() || sid;
    const skip = why => report.push({ asId, sid, who, result: '건너뜀', why });
    const blank = list.filter(x => get(x.r, '점수') === '');
    if (blank.length) { skip(`점수 빈칸 ${blank.length}문항`); continue; }
    const flagged = list.filter(x => get(x.r, '확인필요'));
    if (flagged.length && !allowFlagged) { skip(`확인필요 ${flagged.length}문항: ${flagged.map(x => get(x.r, '확인필요')).join(' / ').slice(0, 80)}`); continue; }
    const prog = await getDoc(`exam_progress/${asId}_${sid}`);
    if (prog?.status !== 'submitted') { skip('제출 기록이 없음'); continue; }
    const results = await queryEq('exam_results', { asId, studentId: sid });
    const byQ = new Map(results.map(r => [r.questionId, r]));
    let bad = '';
    const used = new Set(), changes = [];
    for (const { r, line } of list) {
      const res = byQ.get(get(r, '문항ID'));
      if (!res) { bad = `${line}줄: 이 학생의 결과에 문항ID ${get(r, '문항ID')} 가 없음`; break; }
      const score = Number(get(r, '점수'));
      if (!Number.isFinite(score) || score < 0 || score > (res.maxScore || 0)) { bad = `${line}줄: 점수 ${get(r, '점수')} 가 0~${res.maxScore} 밖`; break; }
      const reason = get(r, '사유');
      // 사유를 비우면, 코드 자동 채점 결과(cases:3/5)만 남기고 나머지 시스템 표시(manual 등)는 지운다 — 채점 창과 같음.
      const feedback = reason || (String(res.feedback ?? '').startsWith('cases:') ? res.feedback : '');
      used.add(res.id);
      if (res.score !== score || res.feedback !== feedback) changes.push({ res, score, feedback });
    }
    if (bad) { skip(bad); continue; }
    if (used.size !== results.length) { skip(`grades.csv 에 없는 문항 ${results.length - used.size}개`); continue; }
    const scoreOf = res => changes.find(c => c.res.id === res.id)?.score ?? res.score ?? 0;
    const total = Math.round(results.reduce((s, res) => s + scoreOf(res), 0) * 100) / 100;
    const totalPoints = results.reduce((s, res) => s + (res.maxScore || 0), 0);
    const before = prog.needsManual === false ? prog.totalScore : '(채점 전)';
    const reveal = prog.needsManual !== false;
    if (!changes.length && !reveal && prog.totalScore === total) { report.push({ asId, sid, who, result: '변경 없음', why: '', before, after: total }); continue; }
    changes.forEach(c => updates.push({ path: `exam_results/${c.res.id}`, data: { score: c.score, feedback: c.feedback } }));
    updates.push({ path: `exam_progress/${asId}_${sid}`, data: { totalScore: total, totalPoints, needsManual: false, gradedBy }, serverTime: ['gradedAt'] });
    report.push({ asId, sid, who, result: reveal ? '반영+공개' : '반영', why: `바뀐 문항 ${changes.length}개`, before, after: `${total}/${totalPoints}` });
  }

  if (write && updates.length) await commitUpdates(updates);
  const out = path.join(path.dirname(file), 'apply-preview.csv');
  writeFileSync(out, toCSV([['배정', '학생ID', '학생', '처리', '내용', '이전 총점', '새 총점'], ...report.map(r => [r.asId, r.sid, r.who, r.result, r.why, r.before ?? '', r.after ?? ''])]));
  return { report, writes: updates.length, written: write && updates.length > 0, preview: out };
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const args = process.argv.slice(2);
  const file = args.find(a => !a.startsWith('--'));
  if (!file) { console.error('사용법: node tools/exam-grading/apply.mjs <grades.csv> [--write] [--allow-flagged]'); process.exit(1); }
  const r = await applyGrades(file, { write: args.includes('--write'), allowFlagged: args.includes('--allow-flagged') });
  const n = s => r.report.filter(x => x.result.startsWith(s)).length;
  console.log(`${isEmulator ? '[에뮬레이터] ' : ''}${r.written ? '반영 완료' : '미리보기(아직 안 씀)'} — 반영 ${n('반영')}명(그중 새로 공개 ${n('반영+공개')}), 변경 없음 ${n('변경 없음')}명, 건너뜀 ${n('건너뜀')}명, 쓰기 ${r.writes}건`);
  r.report.filter(x => x.result === '건너뜀').forEach(x => console.log(`  건너뜀 ${x.who}: ${x.why}`));
  console.log(`자세한 표: ${r.preview}`);
  if (!r.written && r.writes) console.log('실제로 쓰려면 같은 명령에 --write 를 붙인다. (needsManual 이 풀리면 학생 시험 화면에 점수가 보인다)');
}
