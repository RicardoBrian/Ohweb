/**
 * Cloudflare Pages Function — /api/lesson  (새 플랫폼 학생 화면 kakainfo.com/k/)
 *
 * courses · course_lessons · docs 는 선생님만 읽게 잠겨 있다(규칙). 학생 화면은 여기를 거쳐
 * "내 반에 공개된 차시"만 받는다. 시험(/api/exam)과 같은 방식: 로그인 토큰으로 본인 확인 →
 * 서비스 계정으로 읽어서 필요한 것만 내려보낸다.
 *   today — 내 과목들과 공개된 차시 목록, 지금 볼 차시(가장 최근에 공개된 것)
 *   doc   — 차시 하나의 문서. 발표자 메모 블록은 빼고 보낸다.
 * 마스터 계정(isMaster)은 선생님 확인용이라 학교·반과 공개 여부를 따지지 않는다.
 * 설계: PLATFORM-DESIGN.md §8.3, §8.8
 */
import { withCors, json, isSafeId, normGC, openDb, verifyStudent } from '../../lib/student-api.js';

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

async function actionDoc(db, student, lessonId) {
  if (!isSafeId(lessonId)) return json({ error: '요청 정보가 올바르지 않습니다.' }, 400);
  const lesson = await db.get(`course_lessons/${lessonId}`);
  const course = lesson && isSafeId(lesson.courseId) ? await db.get(`courses/${lesson.courseId}`) : null;
  if (!lesson || !course || !inCourse({ id: lesson.courseId, ...course }, student) || !isOpen(lesson, student)) {
    return json({ error: '열 수 없는 차시입니다.', closed: true }, 200);
  }
  course.id = lesson.courseId;
  const all = ordered(course, await db.queryEq('course_lessons', { courseId: course.id }));
  const me = all.find(l => l.id === lessonId);
  const d = lesson.docId && isSafeId(lesson.docId) ? await db.get(`docs/${lesson.docId}`) : null;
  // 발표자 메모는 학생에게 보내지 않는다(번역본도)
  const blocks = (d?.blocks || []).filter(b => b.type !== 'note');
  const keep = new Set(blocks.map(b => b.id));
  const tr = Object.fromEntries(Object.entries(d?.tr || {}).map(([lang, m]) => [lang, Object.fromEntries(Object.entries(m || {}).filter(([id]) => keep.has(id)))]));
  return json({ course: pickCourse(course), lesson: pickLesson({ ...lesson, id: lessonId, no: me?.no }), doc: { blocks, tr } });
}

async function handle(request, env) {
  if (request.method === 'OPTIONS') return new Response(null, { status: 204 });
  if (request.method !== 'POST') return json({ error: 'Method Not Allowed' }, 405);
  let body;
  try { body = await request.json(); } catch { return json({ error: 'invalid JSON body' }, 400); }
  const { action, idToken, studentDocId, lessonId } = body || {};
  if (!idToken || !isSafeId(studentDocId)) return json({ error: '요청 정보가 부족합니다.' }, 400);
  if (!['today', 'doc'].includes(action)) return json({ error: '알 수 없는 요청입니다.' }, 400);
  try { await verifyStudent(idToken, studentDocId, env); } catch (e) { return json({ error: e.message, relogin: true }, 403); }
  try {
    const db = await openDb(env, 'lesson');
    if (!db) return json(SETUP_ERROR, 200);
    const student = await db.get(`students/${studentDocId}`);
    if (!student) return json({ error: '학생 정보를 찾을 수 없습니다.' }, 404);
    return action === 'today' ? await actionToday(db, student) : await actionDoc(db, student, lessonId);
  } catch (e) {
    console.error('lesson:', action, e);
    return json({ error: '수업 서버 오류가 발생했습니다.', detail: String(e.message || e).slice(0, 300) }, 200);
  }
}

export async function onRequest({ request, env }) {
  try { return withCors(await handle(request, env), request); }
  catch (e) { console.error('lesson uncaught:', e); return withCors(json({ error: '수업 서버 오류가 발생했습니다.' }, 200), request); }
}
