// 맥 AI 채점 워커 — 관리자 화면의 [AI 채점 요청]을 받아 단답형·서술형 답에 점수 "제안"을 단다.
//
//  흐름: 관리자 화면이 exams/{시험}.aiJob = { status:'queued', sel, questionIds } 를 쓴다
//   → 이 워커가 주기적으로 찾아 'running' 으로 바꾸고, 문항마다 학생 답을 묶어 claude -p 로 채점
//   → exam_results 에 aiScore·aiReason·aiFlag(·aiFlagReason)·aiModel·aiAt 만 쓴다(점수 score 는 안 건드림)
//   → aiJob.status = 'done'. 선생님이 문항별 채점 화면에서 제안을 보고 [적용]해야 점수가 된다.
//
//  - 채점 기준: exams/{시험}.aiRubric(시험 공통) + exam_answers/{문항}.rubric(문항별) + 정답(answer)
//    + 선생님이 이미 채점한 답(teacherGradedAt)을 예시로 같이 보낸다.
//  - 학생 이름·학번은 보내지 않는다(A1, A2 … 로만). 외국어 답은 한국어 번역(valueKo)도 함께.
//  - 상태 표시: appSettings/aiGradingWorker.lastSeen 을 주기적으로 갱신(관리자 화면 "맥 채점기 연결됨").
//  - DB 접속은 tools/exam-grading 과 같다(firebase CLI 로그인, 운영 DB 직접. 에뮬레이터는 FIRESTORE_EMULATOR_HOST).
//
//  실행: node tools/ai-grading/worker.mjs          (계속 돈다, launchd 로 띄움 — README)
//        node tools/ai-grading/worker.mjs --once   (대기 중인 작업만 처리하고 끝)
//  환경변수: AI_GRADER_CMD(기본 claude), AI_GRADER_MODEL(비우면 claude 기본 모델), AI_GRADER_BATCH(기본 12),
//            AI_GRADER_PARALLEL(동시에 보낼 묶음 수, 기본 3), AI_GRADER_POLL_MS(기본 15000)
import { spawn } from 'node:child_process';
import { mkdirSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { getDoc, queryEq, commitUpdates, commitRaw, toValue, DOCS_ROOT } from '../exam-grading/firestore.mjs';

const cmd = () => process.env.AI_GRADER_CMD || 'claude';
const MODEL = process.env.AI_GRADER_MODEL || '';
const BATCH = Math.max(1, parseInt(process.env.AI_GRADER_BATCH || '12', 10));
const PARALLEL = Math.max(1, parseInt(process.env.AI_GRADER_PARALLEL || '3', 10));
const POLL_MS = Math.max(3000, parseInt(process.env.AI_GRADER_POLL_MS || '15000', 10));
const VERSION = '1';
// claude 를 레포 밖 빈 폴더에서 돌린다 — 프로젝트 CLAUDE.md·설정이 채점에 섞이지 않게.
const WORKDIR = path.join(os.homedir(), '.kakainfo-ai-grading');
const log = (...a) => console.log(new Date().toISOString(), ...a);

const SYSTEM = [
  '너는 중학교 정보 교사의 수행평가 채점 보조다. 학생 답마다 점수와 사유를 제안한다. 최종 점수는 선생님이 정한다.',
  '규칙:',
  '- 선생님이 준 채점 기준(시험 공통 기준, 문항 기준, 정답)과 선생님이 직접 채점한 예시만 따른다. 기준에 없는 감점·가산을 지어내지 않는다.',
  '- 점수는 0 이상 배점 이하의 정수.',
  '- 기준으로 판단이 애매하거나(경계 사례, 기준에 없는 경우, 답을 읽기 어려움, 번역이 의심스러움) 선생님이 꼭 봐야 하면 flag=true 로 하고 flagReason 에 이유를 짧게.',
  '- reason 은 학생에게 보일 수 있다. "~다" 체로 짧게(1~2문장), 기준의 어떤 요소가 맞고 빠졌는지. 정답을 통째로 적지 않는다.',
  '- 외국어 답은 원문을 기준으로 판단하고, 한국어 번역은 참고만 한다.',
].join('\n');
const SCHEMA = JSON.stringify({
  type: 'object', required: ['items'],
  properties: { items: { type: 'array', items: { type: 'object', required: ['id', 'score', 'reason', 'flag'],
    properties: { id: { type: 'string' }, score: { type: 'integer' }, reason: { type: 'string' }, flag: { type: 'boolean' }, flagReason: { type: 'string' } } } } },
});

// claude -p 한 번 — 결과는 { items:[…] , model }
export function runGrader(prompt) {
  return new Promise((resolve, reject) => {
    mkdirSync(WORKDIR, { recursive: true });
    const args = ['-p', '--output-format', 'json', '--tools', '', '--no-session-persistence', '--setting-sources', '',
      '--system-prompt', SYSTEM, '--json-schema', SCHEMA, ...(MODEL ? ['--model', MODEL] : [])];
    const ch = spawn(cmd(), args, { cwd: WORKDIR, env: process.env });
    let out = '', err = '';
    const timer = setTimeout(() => { ch.kill('SIGKILL'); reject(new Error('채점 응답 시간 초과(5분)')); }, 300000);
    ch.stdout.on('data', d => { out += d; });
    ch.stderr.on('data', d => { err += d; });
    ch.on('error', e => { clearTimeout(timer); reject(e); });
    ch.on('close', code => {
      clearTimeout(timer);
      try {
        const j = JSON.parse(out);
        if (j.is_error) throw new Error(String(j.result || 'claude 오류').slice(0, 300));
        const s = j.structured_output || JSON.parse(j.result);
        if (!Array.isArray(s?.items)) throw new Error('채점 결과 형식이 다릅니다');
        resolve({ items: s.items, model: Object.keys(j.modelUsage || {})[0] || MODEL || 'claude' });
      } catch (e) { reject(new Error(`claude 실행 실패(code ${code}): ${e.message} ${err.slice(0, 200)}`)); }
    });
    ch.stdin.end(prompt);
  });
}

const txt = v => String(v ?? '').trim();
export function buildPrompt({ exam, q, key, examples, batch, context }) {
  const lines = [];
  if (txt(context)) lines.push('## 앞 문항의 사례 (이 문항이 말하는 "위 사례")', txt(context), '');
  if (txt(exam.aiRubric)) lines.push('## 시험 공통 채점 기준', txt(exam.aiRubric), '');
  lines.push(`## 문항 (${q.type === 'sa' ? '단답형' : '서술형'}, 배점 ${Number(q.points) || 0}점)`, `제목: ${txt(q.title)}`);
  if (txt(q.content)) lines.push(`내용:\n${txt(q.content)}`);
  if (txt(key?.answer)) lines.push(`정답·핵심어: ${txt(key.answer)}`);
  lines.push('');
  lines.push('## 이 문항 채점 기준', txt(key?.rubric) || '(따로 없음 — 정답과 시험 공통 기준으로 판단하고, 애매하면 flag)', '');
  if (examples.length) {
    lines.push('## 선생님이 직접 채점한 예시 (점수 감각을 여기에 맞춘다)');
    examples.forEach(r => lines.push(`- 답: ${JSON.stringify(txt(r.value))} → ${r.score}점${txt(r.feedback) && r.feedback !== 'manual' ? ` (${txt(r.feedback)})` : ''}`));
    lines.push('');
  }
  lines.push('## 채점할 답 (id 마다 하나씩, 모두 채점. 글자 수·화면 이탈 횟수·제출 시간 초과는 시험 기록에서 가져온 사실이다. 기준에 이 조건에 따른 점수 규칙이 있으면 그대로 따른다)');
  batch.forEach(({ id, r, p }) => {
    const meta = [(Number(p?.alertCount) || 0) > 0 ? `화면 이탈 ${p.alertCount}회` : '', p?.late ? '제출 시간 초과' : ''].filter(Boolean).join(', ');
    lines.push(`[${id}] (${txt(r.value).length}자, 공백 포함${meta ? ', ' + meta : ''}) ${txt(r.value) ? JSON.stringify(txt(r.value)) : '(빈 답 — 무응답)'}${txt(r.valueKo) ? `\n    (한국어 번역: ${JSON.stringify(txt(r.valueKo))})` : ''}`);
  });
  return lines.join('\n');
}

async function setJob(examId, job) {
  await commitUpdates([{ path: `exams/${examId}`, data: { aiJob: job } }]);
}

// 작업 하나 처리
export async function processJob(exam) {
  const examId = exam.id;
  const job = { ...exam.aiJob, status: 'running', startedAt: new Date().toISOString(), message: '', worker: os.hostname() };
  await setJob(examId, job);
  try {
    const sel = String(job.sel || `exam:${examId}`);
    const scope = sel.startsWith('exam:') ? { examId } : { asId: sel };
    const [questions, results, progs] = await Promise.all([
      queryEq('exam_questions', { examId }), queryEq('exam_results', scope), queryEq('exam_progress', scope),
    ]);
    const progOf = r => progs.find(p => p.asId === r.asId && (p.studentId || p.id.split('_').slice(1).join('_')) === r.studentId);
    const wanted = Array.isArray(job.questionIds) && job.questionIds.length ? new Set(job.questionIds) : null;
    const qs = questions.filter(q => (q.type === 'sa' || q.type === 'essay') && (!wanted || wanted.has(q.id)))
      .sort((a, b) => (a.order || 0) - (b.order || 0));
    // 할 일: 제출했고 아직 공개 전, 선생님이 안 매긴 답. 다시 채점(redo)이 아니면 제안이 이미 있는 건 건너뜀.
    // 다시 채점(redo)이면 선생님이 이미 매긴 답도 제안을 새로 단다(점수 score 는 그대로 — 화면에서 [적용]해야 바뀜).
    const todo = q => results.filter(r => r.questionId === q.id && progOf(r)?.status === 'submitted' && progOf(r)?.needsManual !== false
      && (job.redo || (!r.teacherGradedAt && r.aiScore == null)));
    const total = qs.reduce((n, q) => n + todo(q).length, 0);
    let done = 0, flagged = 0, model = '';
    job.progress = { done, total };
    await setJob(examId, job);
    // 문항별로 묶음(BATCH 개씩)을 만들어 두고 PARALLEL 개씩 동시에 claude 로 보낸다
    // "위 사례"처럼 앞 문항을 가리키는 문항이면, 같은 시험지 유형의 바로 앞 문항 내용을 같이 보낸다
    const byOrder = questions.slice().sort((a, b) => (a.order || 0) - (b.order || 0));
    const caseOf = q => {
      if (!/위\s|위의/.test(txt(q.title) + ' ' + txt(q.content))) return '';
      const i = byOrder.findIndex(x => x.id === q.id);
      const prev = byOrder.slice(0, i).reverse().find(x => (x.form || '') === (q.form || '') && txt(x.content));
      return prev ? `${txt(prev.title)}\n${txt(prev.content)}` : '';
    };
    const tasks = [];
    for (const q of qs) {
      const list = todo(q);
      if (!list.length) continue;
      const key = (await getDoc(`exam_answers/${q.id}`)) || {};
      // 예시: 선생님이 직접 판단한 답만 — AI 제안을 그대로 [적용]한 점수는 예시가 아니다(옛 기준 제안이 굳어진다)
      const examples = results.filter(r => r.questionId === q.id && r.teacherGradedAt && txt(r.value) && (r.aiScore == null || Number(r.score) !== Number(r.aiScore))).slice(0, 8);
      const context = caseOf(q);
      for (let i = 0; i < list.length; i += BATCH) tasks.push({ q, key, examples, context, batch: list.slice(i, i + BATCH).map((r, k) => ({ id: `A${i + k + 1}`, r, p: progOf(r) })) });
    }
    let jobWrite = Promise.resolve();
    const runTask = async ({ q, key, examples, batch, context }) => {
      const max = Number(q.points) || 0;
      // 빈 답도 보낸다 — 최저점이 0이 아닌 기준(예: 무응답 1점·3점)이 있어서
      const real = batch;
      const got = await runGrader(buildPrompt({ exam, q, key, examples, batch: real, context }));
      model = got.model || model;
      const ups = [];
      for (const b of real) {
        const it = got.items.find(x => x.id === b.id);
        if (!it) { ups.push({ path: b.r.path, data: { aiScore: null, aiReason: '', aiFlag: true, aiFlagReason: 'AI 가 이 답을 채점하지 않았다', aiModel: got.model }, serverTime: ['aiAt'] }); flagged++; continue; }
        const score = Math.max(0, Math.min(max, Math.round(Number(it.score) || 0)));
        if (it.flag) flagged++;
        ups.push({ path: b.r.path, data: { aiScore: score, aiReason: txt(it.reason), aiFlag: !!it.flag, aiFlagReason: txt(it.flagReason), aiModel: got.model }, serverTime: ['aiAt'] });
      }
      await commitUpdates(ups);
      done += batch.length;
      const snap = { ...job, progress: { done, total } };
      jobWrite = jobWrite.then(() => setJob(examId, snap)); // 진행 표시는 순서대로
      log(`${exam.title}: ${done}/${total}`);
    };
    let next = 0;
    await Promise.all(Array.from({ length: Math.min(PARALLEL, tasks.length) }, async () => {
      while (next < tasks.length) await runTask(tasks[next++]);
    }));
    await jobWrite;
    job.progress = { done, total };
    Object.assign(job, { status: 'done', finishedAt: new Date().toISOString(), model, message: `${done}개 제안${flagged ? `, 확인 필요 ${flagged}개` : ''}` });
    await setJob(examId, job);
    return job;
  } catch (e) {
    log('작업 실패', examId, e.message);
    Object.assign(job, { status: 'error', finishedAt: new Date().toISOString(), message: e.message.slice(0, 300) });
    await setJob(examId, job);
    return job;
  }
}

export async function heartbeat() {
  await commitRaw([{ update: { name: `${DOCS_ROOT}/appSettings/aiGradingWorker`, fields: { host: toValue(os.hostname()), version: toValue(VERSION), model: toValue(MODEL || 'default') } },
    updateMask: { fieldPaths: ['host', 'version', 'model'] }, updateTransforms: [{ fieldPath: 'lastSeen', setToServerValue: 'REQUEST_TIME' }] }]);
}

export async function processQueued() {
  const queued = await queryEq('exams', { 'aiJob.status': 'queued' });
  const out = [];
  for (const exam of queued) { log('작업 시작', exam.title); out.push(await processJob(exam)); }
  return out;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const once = process.argv.includes('--once');
  log(`AI 채점 워커 시작 (${cmd()}${MODEL ? ' ' + MODEL : ''}, ${once ? '한 번' : POLL_MS + 'ms 마다'})`);
  for (;;) {
    try { await heartbeat(); await processQueued(); }
    catch (e) { log('오류', e.message); }
    if (once) break;
    await new Promise(r => setTimeout(r, POLL_MS));
  }
}
