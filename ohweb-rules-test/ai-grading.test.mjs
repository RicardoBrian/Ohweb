// 맥 AI 채점 워커(tools/ai-grading) — 에뮬레이터 + 가짜 claude 로 작업 처리까지.
// npm run test:ai-grading
import { initializeTestEnvironment } from '@firebase/rules-unit-testing';
import { readFileSync, mkdtempSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { doc, setDoc, getDoc } from 'firebase/firestore';

const here = path.dirname(fileURLToPath(import.meta.url));
process.env.FIRESTORE_EMULATOR_HOST = '127.0.0.1:8181';
process.env.AI_GRADER_CMD = path.join(here, 'ai-grading-stub.mjs');
process.env.AI_GRADER_BATCH = '2';
const logFile = path.join(mkdtempSync(path.join(os.tmpdir(), 'aig-')), 'prompts.txt');
process.env.AI_STUB_LOG = logFile;
const W = await import('../tools/ai-grading/worker.mjs');

const env = await initializeTestEnvironment({ projectId: 'ohweb-93062', firestore: { rules: 'rules_version = "2"; service cloud.firestore { match /{d=**} { allow read, write: if false; } }', host: '127.0.0.1', port: 8181 } });
await env.clearFirestore();
const S = ['S1', 'S2', 'S3', 'S4', 'S5'];
await env.withSecurityRulesDisabled(async c => {
  const db = c.firestore();
  await setDoc(doc(db, 'exams/EX1'), { title: '수행평가', aiRubric: '맞춤법은 감점하지 않는다.', aiJob: { status: 'queued', sel: 'exam:EX1', questionIds: [] } });
  await setDoc(doc(db, 'exams/EX2'), { title: '다른 시험' });
  await setDoc(doc(db, 'exam_questions/Q1'), { examId: 'EX1', order: 1, type: 'mc', title: '고르기', content: '사례: 이루다 챗봇', points: 2 });
  await setDoc(doc(db, 'exam_questions/Q2'), { examId: 'EX1', order: 2, type: 'essay', title: '위 사례의 해결 방안은?', points: 10 });
  await setDoc(doc(db, 'exam_answers/Q2'), { examId: 'EX1', answer: '값을 담는 상자', rubric: '상자 비유 10점, 없으면 3점', minScore: 2 });
  const names = { S1: '김학생', S2: '박학생', S3: '이학생', S4: '최학생', S5: '정학생' };
  const vals = { S1: '값을 담는 상자', S2: '변수는 잘 모름 같은 느낌의 칸', S3: '', S4: 'Коробка для значения', S5: '상자다' };
  for (const sid of S) {
    const as = sid === 'S5' ? 'AS2' : 'AS1';
    await setDoc(doc(db, `exam_progress/${as}_${sid}`), { asId: as, examId: 'EX1', studentId: sid, status: 'submitted', needsManual: sid !== 'S5' ? true : false, ...(sid === 'S1' ? { alertCount: 3, late: true } : {}) });
    await setDoc(doc(db, `exam_results/${as}_${sid}_0`), { asId: as, examId: 'EX1', studentId: sid, name: names[sid], questionId: 'Q1', qIdx: 0, type: 'mc', value: '1', score: 2, maxScore: 2, feedback: 'correct' });
    await setDoc(doc(db, `exam_results/${as}_${sid}_1`), { asId: as, examId: 'EX1', studentId: sid, name: names[sid], questionId: 'Q2', qIdx: 1, type: 'essay', value: vals[sid], score: 0, maxScore: 10, feedback: 'manual',
      ...(sid === 'S4' ? { valueKo: '값을 위한 상자' } : {}) });
  }
  // 선생님이 이미 매긴 답(예시로 쓰여야 하고, 다시 채점되면 안 됨)
  await setDoc(doc(db, 'exam_progress/AS1_S6'), { asId: 'AS1', examId: 'EX1', studentId: 'S6', status: 'submitted', needsManual: true });
  // AI 제안을 그대로 적용한 답(예시로 쓰면 안 됨)
  await setDoc(doc(db, 'exam_progress/AS1_S7'), { asId: 'AS1', examId: 'EX1', studentId: 'S7', status: 'submitted', needsManual: true });
  await setDoc(doc(db, 'exam_results/AS1_S7_1'), { asId: 'AS1', examId: 'EX1', studentId: 'S7', name: '오학생', questionId: 'Q2', qIdx: 1, type: 'essay', value: '옛 기준 답', score: 0, aiScore: 1, aiApplied: true, maxScore: 10, feedback: '', teacherGradedAt: new Date() });
  await setDoc(doc(db, 'exam_results/AS1_S6_1'), { asId: 'AS1', examId: 'EX1', studentId: 'S6', name: '한학생', questionId: 'Q2', qIdx: 1, type: 'essay', value: '변수는 이름표', score: 6, maxScore: 10, feedback: '비유가 다르다', teacherGradedAt: new Date() });
});
const read = async p => { let v; await env.withSecurityRulesDisabled(async cx => { v = (await getDoc(doc(cx.firestore(), p))).data(); }); return v; };
let fails = 0; const ok = (c, l) => { if (!c) fails++; console.log((c ? '✅ ' : '❌ ') + l); };

const jobs = await W.processQueued();
ok(jobs.length === 1 && jobs[0].status === 'done', '대기 중인 작업 하나만 처리하고 done');
const ex = await read('exams/EX1');
ok(ex.aiJob.status === 'done' && ex.aiJob.progress.done === 4 && ex.aiJob.progress.total === 4 && /확인 필요 1/.test(ex.aiJob.message), `진행 4/4, 메시지 "${ex.aiJob.message}"`);
const r = sid => read(`exam_results/AS1_${sid}_1`);
const [r1, r2, r3, r4, r6] = await Promise.all(['S1', 'S2', 'S3', 'S4', 'S6'].map(r));
ok(r1.aiScore === 10 && r1.score === 0 && r1.aiReason && r1.aiModel === 'stub-model' && r1.aiAt, '제안 점수는 배점으로 잘리고(15→10) score 는 그대로');
ok(r2.aiFlag === true && r2.aiFlagReason === '판단 어려움', '애매한 답은 확인 필요 표시');
ok(r3.aiScore === 2 && r3.aiModel === 'rule' && r3.aiFlag === false, '빈 답은 AI 없이 문항의 빈 답 점수(2점), 확인 필요 없이');
ok(r4.aiScore === 3, '러시아어 답도 채점');
ok(r6.aiScore === undefined, '선생님이 매긴 답은 건드리지 않음');
ok((await read('exam_results/AS2_S5_1')).aiScore === undefined, '이미 공개한 학생(needsManual=false)은 건너뜀');
ok((await read('exam_results/AS1_S1_0')).aiScore === undefined, '객관식은 건너뜀');
const prompts = readFileSync(logFile, 'utf8');
ok(!/김학생|박학생|최학생|한학생|S1|S4/.test(prompts), '프롬프트에 이름·학번 없음');
ok(/맞춤법은 감점하지 않는다/.test(prompts) && /상자 비유 10점/.test(prompts) && /변수는 이름표.*6점/.test(prompts) && !/값을 위한 상자|번역/.test(prompts.split("채점할 답")[1]) && /Коробка для значения/.test(prompts) && /앞 문항의 사례[\s\S]*사례: 이루다 챗봇/.test(prompts), '프롬프트에 공통 기준·문항 기준·선생님 예시·앞 문항 사례, 외국어 답은 원문만(번역 없음)');
ok(!/화면 이탈|시간 초과/.test(prompts) && !/옛 기준 답/.test(prompts.split('채점할 답')[0]), '이탈·지각 정보는 AI 에 안 보냄(경고용), AI 제안을 그대로 적용한 답은 예시에서 뺌');
ok(prompts.split('=====').length - 1 === 2 && !/빈 답 — 무응답/.test(prompts), '2개씩 묶어 claude 2번 호출(빈 답은 안 보냄)');

// 다시 채점하지 않으면 제안 있는 건 건너뜀, redo 면 다시
await env.withSecurityRulesDisabled(async c => setDoc(doc(c.firestore(), 'exams/EX1'), { title: '수행평가', aiJob: { status: 'queued', sel: 'AS1', questionIds: ['Q2'] } }, { merge: false }));
await W.processQueued();
ok((await read('exams/EX1')).aiJob.progress.total === 0, '다시 요청: 이미 제안 있는 답은 건너뜀');
await env.withSecurityRulesDisabled(async c => setDoc(doc(c.firestore(), 'exams/EX1'), { title: '수행평가', aiJob: { status: 'queued', sel: 'AS1', questionIds: ['Q2'], redo: true } }));
await W.processQueued();
ok((await read('exams/EX1')).aiJob.progress.total === 6, '다시 채점(redo): 선생님이 매긴 답까지 6개 다시');
const r6b = await r('S6');
ok(r6b.aiScore != null && r6b.score === 6, '다시 채점해도 선생님이 매긴 점수(score)는 그대로, 제안만 새로');

// claude 가 실패하면 error
process.env.AI_GRADER_CMD = '/nonexistent/claude';
await env.withSecurityRulesDisabled(async c => setDoc(doc(c.firestore(), 'exams/EX1'), { title: '수행평가', aiJob: { status: 'queued', sel: 'AS1', redo: true } }));
await W.processQueued();
const e = (await read('exams/EX1')).aiJob;
ok(e.status === 'error' && e.message, `claude 실패 → error ("${e.message.slice(0, 40)}")`);

await W.heartbeat();
const hb = await read('appSettings/aiGradingWorker');
ok(hb.lastSeen && hb.host, '연결 표시(appSettings/aiGradingWorker.lastSeen)');

await env.cleanup();
console.log(fails ? `\n${fails}개 실패` : '\n모두 통과');
process.exit(fails ? 1 : 0);
