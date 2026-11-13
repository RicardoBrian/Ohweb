// kakainfo 체험 계정 — 만들기·되돌리기 (운영 DB 직접, 이 컴퓨터의 firebase CLI 로그인 사용)
//
//   node tools/trial-account/trial.mjs            # 미리보기: 지울 것·만들 것 개수만 (쓰지 않음)
//   node tools/trial-account/trial.mjs --write    # 체험학교 데이터를 지우고 처음 상태로 다시 만든다
//
// 같은 명령이 처음 만들기와 되돌리기를 겸한다. 체험 계정 사람들이 쓴 글·시험 제출·설문·AI 모둠 작업을
// 지우고, 견본 내용과 비밀번호를 처음대로 돌린다. 다른 학교 데이터는 건드리지 않는다
// (지우는 대상은 아래 TRIAL_* 값으로만 찾는다).
// 규칙(ohweb-firestore.rules 의 isTrial)은 이 계정으로 로그인했을 때만 체험학교 것으로 좁힌다.
import { queryEq, getDoc, commitRaw, listSub, accessToken, DOCS_ROOT, PROJECT, isEmulator } from '../exam-grading/firestore.mjs';

export const SCHOOL = '체험학교';
export const STUDENT_ID = 'trial-student';
export const PASSWORD = 'kakainfo';              // 공개용 — 소개 페이지에 그대로 적는다
const CLASS_TITLE = '체험학교 정보';             // 규칙 trialPostOk 와 같아야 한다
const EXAM_ID = 'trial-ex1', AS_ID = 'trial-as1';
const AI_AS = 'trial-ai1';                        // 규칙 ai_pairs 와 같아야 한다
const SCORE_AS = 'trial-score1', SCORE_AS2 = 'trial-score2';
const FORM_ID = 'trial-form1';

const WRITE = process.argv.includes('--write');
const DAY = 86400000;
const ago = (d, h = 0) => new Date(Date.now() - d * DAY - h * 3600000);

const STUDENTS = [
  { id: STUDENT_ID, number: '1', name: '체험학생' },
  { id: 'trial-friend1', number: '2', name: '김하늘' },
  { id: 'trial-friend2', number: '3', name: '이바다' },
  { id: 'trial-friend3', number: '4', name: '박서준' },
  { id: 'trial-friend4', number: '5', name: '최은비' },
];
const nameOf = id => STUDENTS.find(s => s.id === id).name;
const numOf = id => STUDENTS.find(s => s.id === id).number;

// ── Firestore 값 (Date → timestamp) ──
function val(x) {
  if (x === null || x === undefined) return { nullValue: null };
  if (x instanceof Date) return { timestampValue: x.toISOString() };
  if (typeof x === 'boolean') return { booleanValue: x };
  if (typeof x === 'number') return Number.isInteger(x) ? { integerValue: String(x) } : { doubleValue: x };
  if (typeof x === 'string') return { stringValue: x };
  if (Array.isArray(x)) return { arrayValue: { values: x.map(val) } };
  return { mapValue: { fields: Object.fromEntries(Object.entries(x).map(([k, v]) => [k, val(v)])) } };
}
const setW = (path, data) => ({ update: { name: `${DOCS_ROOT}/${path}`, fields: val(data).mapValue.fields } });
const delW = path => ({ delete: `${DOCS_ROOT}/${path}` });

// ── 1. 지울 것 찾기 (체험학교 것만) ──
async function collectDeletes() {
  const paths = new Set();
  const add = d => paths.add(d.path);
  const withSubs = async (docs, subs) => {
    for (const d of docs) {
      add(d);
      for (const sub of subs) for (const s of await listSub(d.path, sub)) add(s);
    }
  };
  await withSubs(await queryEq('posts', { classTitle: CLASS_TITLE }), ['comments']);
  for (const id of STUDENTS.map(s => s.id)) {
    const t = await getDoc(`qna_threads/${id}`);
    if (t) add(t);
    for (const m of await listSub(`qna_threads/${id}`, 'messages')) add(m);   // 스레드 문서 없이 메시지만 있는 경우도
    for (const f of await queryEq('student_forms', { ownerId: id })) add(f);
    for (const r of await queryEq('student_form_responses', { ownerId: id })) add(r);
    for (const r of await queryEq('student_form_responses', { respondentId: id })) add(r);
  }
  for (const c of ['exam_progress', 'exam_results']) for (const d of await queryEq(c, { asId: AS_ID })) add(d);
  for (const d of await queryEq('ai_pairs', { asId: AI_AS })) add(d);
  const projects = await queryEq('ai_projects', { asId: AI_AS });
  await withSubs(projects, ['images']);
  for (const p of projects) {
    const app = await getDoc(`ai_apps/${p.id}`);
    if (app) add(app);
    for (const f of await listSub(`ai_apps/${p.id}`, 'feedback')) add(f);
  }
  for (const aid of [SCORE_AS, SCORE_AS2]) {
    await withSubs(await queryEq('score_results', { assessmentId: aid }), ['history']);
  }
  // 안전장치: 체험학교 밖으로 보이는 경로가 섞이면 멈춘다
  for (const p of paths) {
    if (!/(trial-|체험)/.test(p) && !/^(posts|qna_threads|student_forms|student_form_responses|exam_progress|exam_results|ai_pairs|ai_projects|ai_apps|score_results)\//.test(p)) {
      throw new Error('예상 밖 경로: ' + p);
    }
  }
  return [...paths];
}

// ── 2. 만들 것 ──
function seedWrites() {
  const w = [];
  const put = (p, d) => w.push(setW(p, d));

  put('schools/trial-school', { name: SCHOOL, code: 'trial', createdAt: ago(30) });
  for (const s of STUDENTS) {
    const base = { schoolName: SCHOOL, grade: '1', class: '1', number: s.number };
    put(`students/${s.id}`, { ...base, name: s.name, registered: true, mustChangePassword: false, locked: false, failedAttempts: 0, isMaster: false, createdAt: ago(30) });
    put(`student_directory/${s.id}`, { ...base, registered: true, locked: false, failedAttempts: 0 });
  }
  put(`appSettings/${SCHOOL}__g1__c1`, { schoolName: SCHOOL, grade: '1', class: '1', apps: { ohdlet: true, exam: true, form: true, ai: true, score: true } });

  // 게시판
  put('classes/trial-class1', {
    name: CLASS_TITLE, schoolName: SCHOOL, grade: '1', group: '1',
    desc: '수업 결과물을 올리는 게시판입니다. 자유롭게 글을 써 보세요.', ex: '예) 오늘 만든 웹앱 주소와 소감을 적어 주세요.', popup: '',
    boardLayout: 'grid', columns: [], status: 'ON', createdAt: ago(20),
  });
  const boardKey = `${CLASS_TITLE}__${SCHOOL}__g1__c1`;
  [
    ['trial-friend1', '우리 반 급식 메뉴 알리미', '오늘 급식 메뉴를 보여주는 웹앱을 만들었어요. 알레르기 표시도 넣었습니다.', 3, 2],
    ['trial-friend2', '단어 퀴즈 게임', '영어 단어를 맞히면 점수가 올라가는 게임입니다. 틀린 단어는 다시 나와요.', 1, 1],
    ['trial-friend3', '모둠 발표 타이머', '발표 시간을 재고 1분 남으면 색이 바뀝니다.', 5, 0],
  ].forEach(([sid, sub, msg, likes, d], i) => {
    put(`posts/trial-post${i + 1}`, {
      classTitle: CLASS_TITLE, boardKey, grade: '1', group: '1', num: numOf(sid), name: nameOf(sid), studentId: sid,
      srcLang: 'ko', subKo: sub, msgKo: msg, subZh: '', msgZh: '', subRu: '', msgRu: '', subEn: '', msgEn: '',
      imgs: [], column: '', likes, commentCount: 0, pinned: false, deleted: false, createdAt: ago(d, i + 1), updatedAt: ago(d, i + 1),
    });
  });

  // 시험 (문항·정답 분리. 제출하면 객관식·단답은 바로 채점, 서술형은 선생님 채점 대기)
  put(`exams/${EXAM_ID}`, { title: '체험 시험 — 컴퓨터 기초', desc: '체험용 연습 시험입니다. 부담 없이 풀어 보세요.', forms: [], shuffleForms: false, createdAt: ago(7) });
  const qs = [
    { id: 'trial-q1', type: 'mc', title: '중앙 처리 장치', content: '컴퓨터에서 명령어를 해석하고 계산을 담당하는 장치는 무엇인가요?', options: ['CPU', '모니터', '키보드', '스피커'], points: 10, answer: '0' },
    { id: 'trial-q2', type: 'sa', title: '입력 장치', content: '마우스처럼 컴퓨터에 정보를 넣는 장치를 무엇이라고 하나요?', points: 10, answer: '입력 장치' },
    { id: 'trial-q3', type: 'essay', title: '알고리즘', content: '알고리즘이 무엇인지 생활 속 예를 들어 설명해 보세요.', points: 20, answer: '' },
    { id: 'trial-q4', type: 'code', title: '두 수의 합', content: '두 정수를 입력받아 합을 출력하는 파이썬 프로그램을 작성하세요.',
      inDesc: '한 줄에 정수 a, b가 공백으로 주어집니다.', outDesc: 'a+b를 출력합니다.', inEx: '3 5', outEx: '8',
      points: 20, answer: '', testCases: [{ input: '3 5', expected: '8' }, { input: '10 -4', expected: '6' }] },
  ];
  qs.forEach((q, i) => {
    const { id, answer, testCases, ...fields } = q;
    put(`exam_questions/${id}`, { examId: EXAM_ID, ...fields, imageUrl: '', order: i + 1, createdAt: ago(7) });
    put(`exam_answers/${id}`, { examId: EXAM_ID, answer, testCases: testCases || [] });
  });
  put(`exam_assignments/${AS_ID}`, { examId: EXAM_ID, code: '', grade: '1', class: '1', schoolName: SCHOOL, duration: 20, entryMinutes: 0, status: 'ON', formMode: '', createdAt: ago(1), openedAt: ago(1) });

  // 설문 (체험학생이 만든 설문 + 친구들 응답)
  put(`student_forms/${FORM_ID}`, {
    title: '우리 반 체육대회 종목 투표', description: '하고 싶은 종목을 골라 주세요.', descImage: '',
    allowAnon: true, showResultToRespondent: true, status: 'open',
    questions: [
      { id: 'fq1', type: 'mc', text: '가장 하고 싶은 종목은?', options: ['피구', '줄다리기', '계주', '발야구'], required: true },
      { id: 'fq2', type: 'short', text: '하고 싶은 말이 있다면 적어 주세요.', options: [], required: false },
    ],
    ownerId: STUDENT_ID, ownerName: nameOf(STUDENT_ID), responseCount: 3, createdAt: ago(3), updatedAt: ago(3),
  });
  [['trial-friend1', '피구', '다 같이 재밌게 해요!'], ['trial-friend3', '계주', ''], ['trial-friend4', '피구', '응원 열심히 할게요']].forEach(([sid, a1, a2], i) => {
    put(`student_form_responses/trial-resp${i + 1}`, { formId: FORM_ID, ownerId: STUDENT_ID, respondentId: sid, respondentName: `${numOf(sid)} ${nameOf(sid)}`, answers: [a1, a2], submittedAt: ago(2, i) });
  });

  // 질문하기 — 선생님 답장이 달린 대화 하나 (알림 메일은 보내지 않게 emailNotify 끔)
  put(`qna_threads/${STUDENT_ID}`, { studentName: nameOf(STUDENT_ID), schoolName: SCHOOL, grade: '1', class: '1', number: '1', emailNotify: false, unreadByAdmin: false, unreadByStudent: true, lastMessageAt: ago(0, 3), lastNotifiedAt: null });
  put(`qna_threads/${STUDENT_ID}/messages/trial-m1`, { sender: 'student', text: '선생님, 웹앱을 배포했는데 주소에 들어가면 빈 화면만 나와요.', attachments: [], createdAt: ago(0, 5) });
  put(`qna_threads/${STUDENT_ID}/messages/trial-m2`, { sender: 'admin', text: '빌드 출력 폴더 설정을 확인해 볼까요? 화면을 캡처해서 보내 주세요. (체험용 예시 답변입니다)', attachments: [], createdAt: ago(0, 4) });

  // AI 실험실 — 체험학생 + 친구 한 명이 한 모둠
  put(`ai_assignments/${AI_AS}`, {
    title: '우리 모둠 이미지 분류 AI (체험)', schoolName: SCHOOL, grade: '1', class: '1',
    minPerLabel: 15, minTestPerLabel: 3, maxLabels: 5, groupSize: 2, board: null, boardScope: 'class',
    sources: ['draw', 'search'], cameraUpload: false, textModel: 'mean', kind: 'image', status: 'ON', createdAt: ago(2),
  });
  [[STUDENT_ID, 'trial-friend1'], ['trial-friend2', 'trial-friend3']].forEach((ids, i) => {
    put(`ai_pairs/trial-pair${i + 1}`, {
      asId: AI_AS, no: i + 1, members: ids, memberEmails: ids.map(id => `${id}@ohinfo.local`),
      memberNames: Object.fromEntries(ids.map(id => [id, nameOf(id)])), leaderId: ids[0], round: 0, currentProjectId: '', createdAt: ago(2),
    });
  });

  // 수행평가 점수 (공개된 결과 2개: 감점 방식·항목별 방식)
  const now = ago(1);
  put(`score_results/${SCORE_AS}_${STUDENT_ID}`, {
    assessmentId: SCORE_AS, studentId: STUDENT_ID, name: nameOf(STUDENT_ID), schoolName: SCHOOL, grade: '1', class: '1', number: '1',
    title: '1차 수행평가 — 나만의 웹페이지', subject: '정보', term: '2학기', score: 17, maxScore: 20, status: 'done',
    deductions: [{ code: 'A1', label: '분량 미달(소개 문단 부족)' }], memo: '디자인이 깔끔해요. 소개 글을 조금 더 채워 보세요.',
    published: true, publishedAt: now, updatedAt: now,
  });
  put(`score_results/${SCORE_AS2}_${STUDENT_ID}`, {
    assessmentId: SCORE_AS2, studentId: STUDENT_ID, name: nameOf(STUDENT_ID), schoolName: SCHOOL, grade: '1', class: '1', number: '1',
    title: '2차 수행평가 — 파이썬 프로그램', subject: '정보', term: '2학기', score: 26, maxScore: 30, status: 'done',
    items: [
      { label: '문제 분석', max: 10, score: 10, reason: '' },
      { label: '코드 작성', max: 10, score: 8, reason: '입력값 검사가 빠졌어요.' },
      { label: '실행 결과', max: 10, score: 8, reason: '테스트 3개 중 2개 통과' },
    ],
    published: true, publishedAt: now, updatedAt: now,
  });
  return w;
}

// ── 3. 로그인 계정(Firebase Auth) — 없으면 만들고, 있으면 비밀번호를 처음대로 ──
async function ensureAuth() {
  if (isEmulator) return '에뮬레이터: Auth 건너뜀';
  const base = `https://identitytoolkit.googleapis.com/v1/projects/${PROJECT}`;
  const H = { authorization: 'Bearer ' + await accessToken(), 'content-type': 'application/json', 'x-goog-user-project': PROJECT };
  const email = `${STUDENT_ID}@ohinfo.local`;
  const look = await (await fetch(`${base}/accounts:lookup`, { method: 'POST', headers: H, body: JSON.stringify({ email: [email] }) })).json();
  if (look.error) throw new Error('Auth 조회 실패: ' + JSON.stringify(look.error).slice(0, 300));
  const user = (look.users || [])[0];
  if (!WRITE) return user ? `Auth 계정 있음 → 비밀번호 되돌림 예정` : 'Auth 계정 없음 → 만들 예정';
  const r = user
    ? await fetch(`${base}/accounts:update`, { method: 'POST', headers: H, body: JSON.stringify({ localId: user.localId, password: PASSWORD, disableUser: false }) })
    : await fetch(`${base}/accounts`, { method: 'POST', headers: H, body: JSON.stringify({ email, password: PASSWORD }) });
  const j = await r.json();
  if (j.error) throw new Error('Auth 쓰기 실패: ' + JSON.stringify(j.error).slice(0, 300));
  return user ? 'Auth 비밀번호 되돌림' : 'Auth 계정 만듦';
}

const dels = await collectDeletes();
const sets = seedWrites();
console.log(`대상 DB: ${PROJECT}${isEmulator ? ' (에뮬레이터)' : ''}`);
console.log(`지울 문서 ${dels.length}개 (체험 사용자가 남긴 것), 만들 문서 ${sets.length}개`);
if (dels.length) console.log('  예: ' + dels.slice(0, 8).join(', ') + (dels.length > 8 ? ' …' : ''));
console.log(await ensureAuth());
if (!WRITE) { console.log('\n미리보기만 했습니다. 실제로 하려면 --write'); process.exit(0); }
await commitRaw(dels.map(delW));
await commitRaw(sets);
console.log(`\n완료 — kakainfo.com 에서 ${SCHOOL} / 1학년 / 1반 / 1번, 비밀번호 ${PASSWORD}`);
