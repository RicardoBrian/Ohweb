/**
 * Cloudflare Pages Function — /api/lesson  (새 플랫폼 학생 화면 kakainfo.com/k/)
 *
 * courses · course_lessons · docs 는 선생님만 읽게 잠겨 있다(규칙). 학생 화면은 여기를 거쳐
 * "내 반에 공개된 차시"만 받는다. 시험(/api/exam)과 같은 방식: 로그인 토큰으로 본인 확인 →
 * 서비스 계정으로 읽어서 필요한 것만 내려보낸다.
 *   today — 내 과목들과 공개된 차시 목록, 지금 볼 차시(가장 최근에 공개된 것)
 *   doc   — 차시 하나의 문서. 발표자 메모 블록은 빼고 보낸다.
 *   work-open / work-save / work-version — 차시 안 도구 블록(지금은 파이썬)의 학생 작업.
 *     work/{학생ID_차시ID_블록ID} 에 마지막 코드, work_history 에 저장 이력(선생님이 본다).
 *   scratch-open / scratch-load / scratch-save — 스크래치 도구 블록. 파일(.sb3)은 선생님 구글 드라이브
 *     (lib/scratch-store.js), work·work_history 에는 파일 ID·크기·블록 수만.
 * 마스터 계정(isMaster)은 선생님 확인용이라 학교·반과 공개 여부를 따지지 않는다.
 * 설계: PLATFORM-DESIGN.md §8.3, §8.8
 */
import { withCors, json, isSafeId, normGC, openDb, verifyStudent } from '../../lib/student-api.js';
import { scratchStore } from '../../lib/scratch-store.js';

const SETUP_ERROR = { error: '수업 화면이 아직 준비되지 않았습니다. 선생님께 알려 주세요.' };

function inCourse(course, student) {
  if (student.isMaster) return course.status !== 'archived';
  return course.status !== 'archived' && course.schoolName === (student.schoolName || '')
    && normGC(course.grade) === normGC(student.grade) && (course.classes || []).includes(normGC(student.class));
}
const isOpen = (lesson, student) => student.isMaster || (lesson.openTo || []).includes(normGC(student.class));
const pickCourse = c => ({ id: c.id, name: c.name, i18n: c.i18n || {}, grade: c.grade, units: (c.units || []).map(u => ({ id: u.id, name: u.name, i18n: u.i18n || {} })) });
const pickLesson = l => ({ id: l.id, no: l.no, unitId: l.unitId, name: l.name, i18n: l.i18n || {}, hasDoc: !!l.docId });

// 단원 순서 → 단원 안 순서. 번호(no)는 과목 전체 차시 기준(닫힌 차시 포함)이라 선생님 화면 번호와 같다.
function ordered(course, lessons) {
  const u = Object.fromEntries((course.units || []).map((x, i) => [x.id, i]));
  const list = [...lessons].sort((a, b) => ((u[a.unitId] ?? 1e9) - (u[b.unitId] ?? 1e9)) || ((a.order || 0) - (b.order || 0)));
  list.forEach((l, i) => { l.no = i + 1; });
  return list;
}
async function myCourses(db, student) {
  const courses = student.isMaster
    ? [...await db.queryEq('courses', { status: 'active' })]
    : await db.queryEq('courses', { schoolName: student.schoolName || '' });
  return courses.filter(c => inCourse(c, student));
}

async function actionToday(db, student) {
  const courses = await myCourses(db, student);
  let current = null, currentAt = '';
  const out = [];
  for (const c of courses) {
    const lessons = ordered(c, await db.queryEq('course_lessons', { courseId: c.id })).filter(l => isOpen(l, student));
    for (const l of lessons) if (String(l.updatedAt || '') >= currentAt) { currentAt = String(l.updatedAt || ''); current = l.id; }
    out.push({ ...pickCourse(c), lessons: lessons.map(pickLesson) });
  }
  return json({ courses: out, current });
}

const CLOSED = { error: '열 수 없는 차시입니다.', closed: true };
// 이 학생이 열 수 있는 차시면 { lesson, course, no }, 아니면 null
async function openLesson(db, student, lessonId) {
  if (!isSafeId(lessonId)) return null;
  const lesson = await db.get(`course_lessons/${lessonId}`);
  const course = lesson && isSafeId(lesson.courseId) ? await db.get(`courses/${lesson.courseId}`) : null;
  if (!lesson || !course || !inCourse(course, student) || !isOpen(lesson, student)) return null;
  course.id = lesson.courseId; lesson.id = lessonId;
  const all = ordered(course, await db.queryEq('course_lessons', { courseId: course.id }));
  return { lesson, course, no: all.find(l => l.id === lessonId)?.no };
}

async function actionDoc(db, student, lessonId) {
  const o = await openLesson(db, student, lessonId);
  if (!o) return json(CLOSED);
  const { lesson, course } = o, me = { no: o.no };
  const d = lesson.docId && isSafeId(lesson.docId) ? await db.get(`docs/${lesson.docId}`) : null;
  // 발표자 메모는 학생에게 보내지 않는다(번역본도)
  const blocks = (d?.blocks || []).filter(b => b.type !== 'note');
  const keep = new Set(blocks.map(b => b.id));
  const tr = Object.fromEntries(Object.entries(d?.tr || {}).map(([lang, m]) => [lang, Object.fromEntries(Object.entries(m || {}).filter(([id]) => keep.has(id)))]));
  return json({ course: pickCourse(course), lesson: pickLesson({ ...lesson, id: lessonId, no: me?.no }), doc: { blocks, tr } });
}

// ── 학생 작업(파이썬) ──
const MAX_CODE = 20000;
const SNAP_GAP_MS = 3 * 60 * 1000; // 자동 저장은 3분에 한 번만 이력에 남긴다
const lines = c => (c ? String(c).split('\n').length : 0);
async function openTool(db, student, lessonId, blockId, tool = 'python') {
  if (!isSafeId(blockId)) return null;
  const o = await openLesson(db, student, lessonId);
  if (!o || !o.lesson.docId || !isSafeId(o.lesson.docId)) return null;
  const d = await db.get(`docs/${o.lesson.docId}`);
  const block = (d?.blocks || []).find(b => b.id === blockId && b.type === 'tool' && b.data?.tool === tool);
  if (!block) return null;
  const tr = Object.fromEntries(Object.entries(d.tr || {}).filter(([, m]) => m?.[blockId]).map(([l, m]) => [l, m[blockId].data]));
  return { ...o, block: { id: block.id, data: block.data, tr } };
}
async function historyOf(db, workId) {
  const h = await db.queryEq('work_history', { workId });
  return h.sort((a, b) => String(b.at).localeCompare(String(a.at))).map(x => ({ id: x.id, at: x.at, reason: x.reason, lines: lines(x.code) }));
}
async function actionWork(db, student, studentId, body) {
  const { action, lessonId, blockId } = body;
  const t = await openTool(db, student, lessonId, blockId);
  if (!t) return json(CLOSED);
  const workId = `${studentId}_${lessonId}_${blockId}`;
  if (action === 'work-open') {
    const w = await db.get(`work/${workId}`);
    return json({ course: pickCourse(t.course), lesson: pickLesson({ ...t.lesson, no: t.no }), block: t.block,
      work: w ? { code: w.code, updatedAt: w.updatedAt } : null, history: w ? await historyOf(db, workId) : [] });
  }
  if (action === 'work-version') {
    const v = isSafeId(body.versionId) ? await db.get(`work_history/${body.versionId}`) : null;
    if (!v || v.workId !== workId) return json({ error: '저장 기록을 찾을 수 없습니다.' }, 404);
    return json({ code: v.code, at: v.at });
  }
  // work-save
  const code = String(body.code ?? '');
  if (code.length > MAX_CODE) return json({ error: `코드가 너무 깁니다(${MAX_CODE}자까지).` }, 400);
  const reason = ['auto', 'save', 'run'].includes(body.reason) ? body.reason : 'auto';
  const now = new Date().toISOString();
  const prev = await db.get(`work/${workId}`);
  await db.set(`work/${workId}`, { studentId, schoolName: student.schoolName || '', grade: normGC(student.grade), class: normGC(student.class),
    number: Number(student.number) || 0, courseId: t.course.id, lessonId, blockId, tool: 'python', code, updatedAt: now,
    createdAt: prev?.createdAt || now, saves: (Number(prev?.saves) || 0) + 1, runs: (Number(prev?.runs) || 0) + (reason === 'run' ? 1 : 0) });
  let history = prev ? await historyOf(db, workId) : [];
  const last = history[0];
  const lastCode = last ? (await db.get(`work_history/${last.id}`))?.code : null;
  const due = !last || reason === 'save' || Date.now() - Date.parse(last.at) >= SNAP_GAP_MS;
  if (due && code !== lastCode && code.trim()) {
    const id = await db.add('work_history', { workId, studentId, lessonId, blockId, code, at: now, reason });
    history = [{ id, at: now, reason, lines: lines(code) }, ...history];
  }
  return json({ updatedAt: now, history });
}

// ── 학생 작업(스크래치) ──
const MAX_SB3_B64 = Math.ceil(15 * 1024 * 1024 * 4 / 3); // 파일 15MB 까지
const SCRATCH_SNAP_MS = 10 * 60 * 1000;                  // 자동 저장은 10분에 한 번만 저장 기록에 남긴다
const REASON_KO = { auto: '자동', save: '저장', leave: '나갈 때' };
const n0 = (v, max) => Math.max(0, Math.min(max, Math.floor(Number(v) || 0)));
async function scratchHistory(db, workId) {
  const h = await db.queryEq('work_history', { workId });
  return h.sort((a, b) => String(b.at).localeCompare(String(a.at))).map(x => ({ id: x.id, at: x.at, reason: x.reason, bytes: x.bytes || 0, blocks: x.blocks || 0, sprites: x.sprites || 0 }));
}
async function actionScratch(db, student, studentId, body) {
  const { action, lessonId, blockId } = body;
  const t = await openTool(db, student, lessonId, blockId, 'scratch');
  if (!t) return json(CLOSED);
  const workId = `${studentId}_${lessonId}_${blockId}`;
  const w = await db.get(`work/${workId}`);
  const store = await scratchStore(db);
  if (action === 'scratch-open') {
    return json({ course: pickCourse(t.course), lesson: pickLesson({ ...t.lesson, no: t.no }), block: t.block, ready: !!store,
      work: w ? { updatedAt: w.updatedAt, bytes: w.bytes || 0, blocks: w.blocks || 0, sprites: w.sprites || 0 } : null,
      history: w ? await scratchHistory(db, workId) : [] });
  }
  if (!store) return json({ error: '스크래치 저장소(구글 드라이브)가 아직 연결되지 않았습니다. 선생님께 알려 주세요.', setup: true });
  if (action === 'scratch-load') {
    let fileId = null;
    if (body.versionId) {
      const v = isSafeId(body.versionId) ? await db.get(`work_history/${body.versionId}`) : null;
      if (!v || v.workId !== workId) return json({ error: '저장 기록을 찾을 수 없습니다.' }, 404);
      fileId = v.fileId;
    } else fileId = (!body.starter && w?.fileId) || t.block.data?.starterFileId || null;
    if (!fileId) return json({ empty: true });
    const d = await store.load(fileId);
    return json({ b64: d.b64 });
  }
  // scratch-save
  const b64 = String(body.b64 || '');
  if (!b64 || b64.length > MAX_SB3_B64 || !/^[A-Za-z0-9+/]+=*$/.test(b64)) return json({ error: b64.length > MAX_SB3_B64 ? '프로젝트가 너무 큽니다(15MB까지). 큰 소리·그림을 줄여 주세요.' : '저장할 파일이 올바르지 않습니다.' }, 400);
  const reason = REASON_KO[body.reason] ? body.reason : 'auto';
  const now = new Date(), at = now.toISOString();
  const hist = w ? await scratchHistory(db, workId) : [];
  const due = reason === 'save' || !hist.length || now - Date.parse(hist[0].at) >= SCRATCH_SNAP_MS;
  const kst = now.toLocaleString('sv-SE', { timeZone: 'Asia/Seoul' }).slice(5, 16).replace(/[-:]/g, '').replace(' ', ' ');
  const cls = normGC(student.class), num = String(Number(student.number) || 0).padStart(2, '0');
  const folders = [`${normGC(t.course.grade)}학년 ${t.course.name || ''}`, `${t.no || ''}차시 ${t.lesson.name || ''}`, `${cls}반 ${num} ${student.name || studentId}`];
  const saved = await store.save(folders, `${kst} ${REASON_KO[reason]}`, b64);
  const blocks = n0(body.blocks, 100000), sprites = n0(body.sprites, 1000), bytes = n0(saved.bytes, 1e9);
  let history = hist;
  if (due) {
    const id = await db.add('work_history', { workId, studentId, lessonId, blockId, tool: 'scratch', fileId: saved.fileId, at, reason, bytes, blocks, sprites });
    history = [{ id, at, reason, bytes, blocks, sprites }, ...hist];
  }
  // 저장 기록에 안 남은 지난 자동 저장 파일은 휴지통으로(드라이브가 자동 저장 파일로 쌓이지 않게)
  if (w?.fileId && !w.fileInHistory && w.fileId !== saved.fileId) await store.trash(w.fileId);
  await db.set(`work/${workId}`, { studentId, schoolName: student.schoolName || '', grade: normGC(student.grade), class: cls,
    number: Number(student.number) || 0, courseId: t.course.id, lessonId, blockId, tool: 'scratch', fileId: saved.fileId, fileInHistory: due,
    bytes, blocks, sprites, updatedAt: at, createdAt: w?.createdAt || at, saves: (Number(w?.saves) || 0) + 1 });
  return json({ updatedAt: at, history });
}

async function handle(request, env) {
  if (request.method === 'OPTIONS') return new Response(null, { status: 204 });
  if (request.method !== 'POST') return json({ error: 'Method Not Allowed' }, 405);
  let body;
  try { body = await request.json(); } catch { return json({ error: 'invalid JSON body' }, 400); }
  const { action, idToken, studentDocId, lessonId } = body || {};
  if (!idToken || !isSafeId(studentDocId)) return json({ error: '요청 정보가 부족합니다.' }, 400);
  if (!['today', 'doc', 'work-open', 'work-save', 'work-version', 'scratch-open', 'scratch-load', 'scratch-save'].includes(action)) return json({ error: '알 수 없는 요청입니다.' }, 400);
  try { await verifyStudent(idToken, studentDocId, env); } catch (e) { return json({ error: e.message, relogin: true }, 403); }
  try {
    const db = await openDb(env, 'lesson');
    if (!db) return json(SETUP_ERROR, 200);
    const student = await db.get(`students/${studentDocId}`);
    if (!student) return json({ error: '학생 정보를 찾을 수 없습니다.' }, 404);
    if (action === 'today') return await actionToday(db, student);
    if (action === 'doc') return await actionDoc(db, student, lessonId);
    if (action.startsWith('scratch-')) return await actionScratch(db, student, studentDocId, body);
    return await actionWork(db, student, studentDocId, body);
  } catch (e) {
    console.error('lesson:', action, e);
    return json({ error: '수업 서버 오류가 발생했습니다.', detail: String(e.message || e).slice(0, 300) }, 200);
  }
}

export async function onRequest({ request, env }) {
  try { return withCors(await handle(request, env), request); }
  catch (e) { console.error('lesson uncaught:', e); return withCors(json({ error: '수업 서버 오류가 발생했습니다.' }, 200), request); }
}
