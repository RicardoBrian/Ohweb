// 시험(exam_*) → 시험 점수 확인(score_*) 연결.
// admin.html 문항별 채점의 [공개]와 score.html 의 [시험에서 가져오기]·[다시 가져오기]가 같이 쓴다.
//
// - 시험 하나 = 평가 하나(score_assessments.source = {type:'exam', examId, asIds}). 없으면 만든다.
// - 문항 = 평가 항목. 시험지 유형(A/B/C형)이 있어도 유형마다 문항 수·유형·배점 순서가 같으면
//   "몇 번째 문항"끼리 같은 항목으로 묶는다(다르면 총점만).
// - 학생 결과에 examSync.score 를 남겨, 점수 확인 화면에서 선생님이 점수를 직접 고친 학생은
//   다시 보낼 때 덮어쓰지 않는다(건너뛴 학생 수를 돌려준다).
// - 이탈 2회 이상·늦은 제출은 점수를 바꾸지 않고 선생님만 보는 비고(score_notes)에 ⚠ 로 남긴다.
// - 보낸 학생의 exam_progress.scoreLinked = true → 학생 시험 화면은 "점수는 시험 점수 확인에서".
import {
  collection, doc, getDoc, getDocs, query, where, addDoc, writeBatch, serverTimestamp, arrayUnion,
} from '/vibe/shared/fake-firebase/firebase-firestore.js';
import * as SC from './score-core.js';

const TYPE_KO = { mc: '객관식', sa: '단답형', essay: '서술형', code: '코딩' };
const normGC = v => String(v ?? '').replace(/학년|반/g, '').trim();
export const currentTerm = () => { const d = new Date(); return `${d.getFullYear()}-${d.getMonth() + 1 >= 8 ? 2 : 1}`; };
const shortTitle = t => String(t || '').replace(/^\s*\[[^\]]*\]\s*/, '').replace(/\s+/g, ' ').slice(0, 24).trim();

// 평가 항목과 "문항 → 항목 번호" 찾기
export function examCriteria(exam, questions) {
  const qs = questions.slice().sort((a, b) => (a.order ?? 1e9) - (b.order ?? 1e9));
  const forms = Array.isArray(exam?.forms) ? exam.forms : [];
  if (!forms.length) {
    const criteria = qs.map((q, i) => ({ label: `Q${i + 1}. ${shortTitle(q.title)}`.trim(), max: Number(q.points) || 0 }));
    const idx = Object.fromEntries(qs.map((q, i) => [q.id, i]));
    return { itemsMode: true, criteria, slotOf: r => idx[r.questionId] };
  }
  // 유형마다: 공통 문항(form '') + 그 유형 문항을 순서대로
  const listOf = f => qs.filter(q => !q.form || q.form === f);
  const lists = forms.map(listOf);
  const sig = l => l.map(q => `${q.type}:${Number(q.points) || 0}`).join(',');
  if (!lists.every(l => sig(l) === sig(lists[0])) || !lists[0].length) return { itemsMode: false, criteria: [], slotOf: () => undefined };
  // 항목 이름: "문항 1 유형 쓰기(단답형)" 처럼 — 유형마다 내용이 다르므로 제목 대신 번호·유형
  const criteria = lists[0].map((q, i) => {
    const m = String(q.title || '').match(/^\s*\[([^\]]+)\]/);
    return { label: `${i + 1}. ${m ? m[1] + ' ' : ''}${TYPE_KO[q.type] || q.type}`, max: Number(q.points) || 0 };
  });
  const idx = {};
  lists.forEach(l => l.forEach((q, i) => { idx[q.id] = i; }));
  return { itemsMode: true, criteria, slotOf: r => idx[r.questionId] };
}

// 학생에게 보일 사유(객관식 정답 번호는 넣지 않는다)
export function examReason(r) {
  const fb = String(r.feedback ?? '');
  if (fb.startsWith('cases:')) return `테스트 ${fb.slice(6)} 통과`;
  if (fb === 'manual' || fb === 'correct' || fb.startsWith('wrong')) return (r.score ?? 0) < (r.maxScore ?? 0) && r.type === 'mc' ? '오답' : '';
  if (!fb && r.type === 'mc' && (r.score ?? 0) < (r.maxScore ?? 0)) return '오답';
  return fb.slice(0, 500);
}

// 제출한 학생 한 명 → 결과 값 {score, status, items?}
export function rowFromExam(spec, results, progress) {
  if (!spec.itemsMode) return { score: Number(progress?.totalScore) || 0, status: 'normal' };
  const items = spec.criteria.map(c => ({ label: c.label, max: c.max, score: null, reason: '' }));
  for (const r of results) {
    const i = spec.slotOf(r);
    if (i != null) items[i] = { ...items[i], score: Number(r.score) || 0, reason: examReason(r) };
  }
  return { score: SC.sumItems(items), status: 'normal', items };
}

// 선생님이 볼 경고(점수는 안 바꿈)
export function examWarn(p) {
  const w = [];
  if ((Number(p?.alertCount) || 0) >= 2) w.push(`화면 이탈 ${p.alertCount}회`);
  if (p?.late) w.push('제출 시간 초과');
  return w.length ? `⚠ ${w.join(' · ')} — 기본점수 처리 여부 확인` : '';
}

async function commitOps(db, ops) {
  for (let i = 0; i < ops.length; i += 400) {
    const b = writeBatch(db);
    ops.slice(i, i + 400).forEach(op => op(b));
    await b.commit();
  }
}

// 시험의 평가 찾기(없으면 null)
export async function findExamAssessment(db, examId) {
  const s = await getDocs(query(collection(db, 'score_assessments'), where('source.examId', '==', examId)));
  return s.empty ? null : { id: s.docs[0].id, ...s.docs[0].data() };
}

// 보내기. studentIds: 이번에 보낼 학생(채점 끝난 학생).
// publish: true 면 그 학생들의 반을 점수 확인에서 공개하고, 그 반의 안 본 학생도 '미제출'로 넣는다.
// 돌려줌: { assessmentId, created, sent, skipped:[학생ID], warned }
export async function syncExamToScore(db, { examId, studentIds, publish = false }) {
  const [exSnap, qSnap, aSnap] = await Promise.all([
    getDoc(doc(db, 'exams', examId)),
    getDocs(query(collection(db, 'exam_questions'), where('examId', '==', examId))),
    getDocs(query(collection(db, 'exam_assignments'), where('examId', '==', examId))),
  ]);
  const exam = exSnap.exists() ? exSnap.data() : { title: '시험' };
  const spec = examCriteria(exam, qSnap.docs.map(d => ({ id: d.id, ...d.data() })));
  const asg = aSnap.docs.map(d => ({ id: d.id, ...d.data() }));
  const [pSnap, rSnap] = await Promise.all([
    getDocs(query(collection(db, 'exam_progress'), where('examId', '==', examId))),
    getDocs(query(collection(db, 'exam_results'), where('examId', '==', examId))),
  ]);
  // 예전 진행 기록엔 examId 가 없을 수 있어 배정으로도 모은다
  const progs = new Map(), resBy = new Map();
  const addP = d => { const p = d.data(); const sid = p.studentId || d.id.split('_').slice(1).join('_'); progs.set(sid, { id: d.id, ...p, studentId: sid }); };
  pSnap.docs.forEach(addP);
  const addR = r => { const k = `${r.asId}|${r.studentId}`; if (!resBy.has(k)) resBy.set(k, new Map()); resBy.get(k).set(r.questionId + '|' + r.qIdx, r); };
  rSnap.docs.forEach(d => addR(d.data()));
  for (const a of asg) {
    const [ps, rs] = await Promise.all([
      getDocs(query(collection(db, 'exam_progress'), where('asId', '==', a.id))),
      getDocs(query(collection(db, 'exam_results'), where('asId', '==', a.id))),
    ]);
    ps.docs.forEach(d => { if (![...progs.values()].some(p => p.id === d.id)) addP(d); });
    rs.docs.forEach(d => addR(d.data()));
  }

  // 평가 찾기·만들기
  let a = await findExamAssessment(db, examId), created = false;
  const maxScore = spec.itemsMode ? SC.sumMax(spec.criteria) : Math.max(0, ...[...progs.values()].map(p => Number(p.totalPoints) || 0));
  if (!a) {
    const data = { title: exam.title || '시험', subject: '', term: currentTerm(), maxScore, baseScore: null, criteria: spec.criteria, classKeys: [], publishedClasses: [],
      source: { type: 'exam', examId, asIds: asg.map(x => x.id) }, createdAt: serverTimestamp(), updatedAt: serverTimestamp() };
    const ref = await addDoc(collection(db, 'score_assessments'), data);
    a = { id: ref.id, ...data }; created = true;
  } else if (spec.itemsMode && (a.criteria || []).length !== spec.criteria.length) {
    throw new Error(`시험 문항 수(${spec.criteria.length})가 점수 확인 평가 "${a.title}"의 항목 수(${(a.criteria || []).length})와 다릅니다. 점수 확인에서 그 평가를 지우거나 항목을 맞춘 뒤 다시 공개하세요.`);
  }

  // 보낼 학생: 채점 끝난 학생 + 공개하는 반의 미제출 학생
  const ids = new Set(studentIds || []);
  const stuSnaps = new Map();
  const loadStu = async sid => { if (!stuSnaps.has(sid)) { const s = await getDoc(doc(db, 'students', sid)); stuSnaps.set(sid, s.exists() ? { id: sid, ...s.data() } : null); } return stuSnaps.get(sid); };
  await Promise.all([...ids].map(loadStu));
  const publishClasses = publish ? [...new Set([...ids].map(sid => stuSnaps.get(sid)).filter(Boolean).map(s => SC.classKey(s.schoolName, s.grade, s.class)))] : [];
  const missingClasses = publishClasses;
  const missing = [];
  if (missingClasses.length) {
    const want = new Set(missingClasses);
    for (const x of asg) {
      if (!x.schoolName) continue;
      const ss = await getDocs(query(collection(db, 'students'), where('schoolName', '==', x.schoolName)));
      ss.docs.forEach(d => {
        const s = { id: d.id, ...d.data() };
        if (s.isMaster) return;
        if (x.grade && normGC(x.grade) !== normGC(s.grade)) return;
        if (x.class && normGC(x.class) !== normGC(s.class)) return;
        if (!want.has(SC.classKey(s.schoolName, s.grade, s.class))) return;
        stuSnaps.set(s.id, s);
        if (progs.get(s.id)?.status !== 'submitted' && !ids.has(s.id)) missing.push(s.id);
      });
    }
  }
  const all = [...ids, ...new Set(missing)];
  const existing = new Map();
  await Promise.all(all.map(async sid => {
    const s = await getDoc(doc(db, 'score_results', SC.resultId(a.id, sid)));
    if (s.exists()) existing.set(sid, s.data());
    await loadStu(sid);
  }));
  const notesSnap = await getDoc(doc(db, 'score_notes', a.id));
  const notes = notesSnap.exists() ? (notesSnap.data().notes || {}) : {};

  const pubSet = new Set([...(a.publishedClasses || []), ...publishClasses]);
  const ops = [], newClasses = new Set(), skipped = [], noteUpd = {};
  let sent = 0, warned = 0;
  for (const sid of all) {
    const st = stuSnaps.get(sid);
    if (!st) continue;
    const ck = SC.classKey(st.schoolName, st.grade, st.class);
    const p = progs.get(sid);
    let val;
    if (p?.status === 'submitted') {
      const rs = [...(resBy.get(`${p.asId}|${sid}`)?.values() || [])];
      val = rowFromExam(spec, rs, p);
    } else {
      val = { score: null, status: 'missing', ...(spec.itemsMode ? { items: spec.criteria.map(c => ({ label: c.label, max: c.max, score: null, reason: '' })) } : {}) };
    }
    const prev = existing.get(sid);
    const ref = doc(db, 'score_results', SC.resultId(a.id, sid));
    const published = pubSet.has(ck);
    if (prev) {
      // 점수 확인에서 선생님이 고친 점수는 지키고, 공개 여부만 맞춘다
      const overridden = prev.examSync && prev.score !== prev.examSync.score;
      if (overridden) { skipped.push(sid); if (published && !prev.published) ops.push(b => b.update(ref, { published: true, publishedAt: serverTimestamp() })); continue; }
      const next = { ...SC.pickResult(prev), score: val.score, status: prev.status === 'missing' || val.status === 'missing' ? val.status : prev.status, ...(val.items ? { items: val.items } : {}) };
      const pubChange = published && !prev.published;
      if (!SC.sameResult(prev, next)) {
        ops.push(b => b.set(doc(collection(ref, 'history')), { at: serverTimestamp(), before: SC.pickResult(prev), after: SC.pickResult(next), summary: SC.describeChange(prev, next) + ' (시험에서 보냄)', wasPublished: !!prev.published }));
        ops.push(b => b.update(ref, { ...SC.pickResult(next), examSync: { score: next.score }, updatedAt: serverTimestamp(), ...(pubChange ? { published: true, publishedAt: serverTimestamp() } : {}) }));
        sent++;
      } else if (pubChange) ops.push(b => b.update(ref, { published: true, publishedAt: serverTimestamp() }));
    } else {
      ops.push(b => b.set(ref, {
        assessmentId: a.id, studentId: sid, classKey: ck,
        title: a.title, subject: a.subject || '', term: a.term || '', maxScore: a.maxScore,
        score: val.score, status: val.status, deductions: [], memo: '', ...(val.items ? { items: val.items } : {}),
        examSync: { score: val.score }, fromExam: true,
        published, publishedAt: published ? serverTimestamp() : null, createdAt: serverTimestamp(), updatedAt: serverTimestamp(),
      }));
      sent++;
    }
    if (!(a.classKeys || []).includes(ck)) newClasses.add(ck);
    if (p?.status === 'submitted' && !p.scoreLinked) ops.push(b => b.update(doc(db, 'exam_progress', p.id), { scoreLinked: true }));
    const w = examWarn(p);
    if (w) { warned++; if (!String(notes[sid] || '').includes('⚠')) noteUpd[sid] = [w, notes[sid]].filter(Boolean).join(' / '); }
  }
  const aUpd = { updatedAt: serverTimestamp() };
  if (newClasses.size) aUpd.classKeys = arrayUnion(...newClasses);
  if (publishClasses.length) aUpd.publishedClasses = arrayUnion(...publishClasses);
  ops.push(b => b.update(doc(db, 'score_assessments', a.id), aUpd));
  if (Object.keys(noteUpd).length) ops.push(b => b.set(doc(db, 'score_notes', a.id), { notes: noteUpd, updatedAt: serverTimestamp() }, { merge: true }));
  await commitOps(db, ops);
  return { assessmentId: a.id, title: a.title, created, sent, skipped, warned };
}
