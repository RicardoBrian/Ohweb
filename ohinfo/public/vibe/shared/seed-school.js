// 견본 학교 데이터 — 관리자 화면(vibe/teacher)과 학생 사이트(vibe/student)가 같이 쓴다.
// 사람·학교 이름은 전부 가상이다. 구조는 실제 앱이 저장하는 모양 그대로다.
import './fake-firebase/core.js';

const F = globalThis.FakeFB;
export const NS = 'vibe-school';
export const SCHOOL = '견본중학교';

const DAY = 86400000;
const ago = (days, hours = 0) => F.Timestamp.fromMillis(Date.now() - days * DAY - hours * 3600000);
const isoAgo = (days, hours = 0) => new Date(Date.now() - days * DAY - hours * 3600000).toISOString();

export const STUDENTS = [
  { id: 'st01', number: '1', name: '김하늘' },
  { id: 'st02', number: '2', name: '이바다' },
  { id: 'st03', number: '3', name: '박서준' },
  { id: 'st04', number: '4', name: '최은비' },
  { id: 'st05', number: '5', name: '정도윤' },
  { id: 'st06', number: '6', name: '한지우' },
];
export const DEMO_STUDENT = 'st01';

export function seedSchool() {
  F.seed(NS, (put) => {
    put('schools/sch1', { name: SCHOOL, code: 'DEMO', createdAt: ago(30) });

    for (const s of STUDENTS) {
      put(`students/${s.id}`, {
        schoolName: SCHOOL, grade: '1', class: '1', number: s.number, name: s.name,
        registered: true, mustChangePassword: false, locked: false, failedAttempts: 0, isMaster: false,
        createdAt: ago(30),
      });
      put(`student_directory/${s.id}`, {
        schoolName: SCHOOL, grade: '1', class: '1', number: s.number,
        registered: true, locked: false, failedAttempts: 0,
      });
    }

    // 학급별 공개 앱 (home.html·admin.html의 appKey 규칙)
    put(`appSettings/${SCHOOL}__g1__c1`, {
      schoolName: SCHOOL, grade: '1', class: '1',
      apps: { ohdlet: true, exam: true, form: true, ai: true },
    });

    // ── 정보 게시판 수업과 글 ──
    const cls = { name: '1학년 정보', schoolName: SCHOOL, grade: '1', group: '1' };
    put('classes/cls1', {
      ...cls, desc: '정보 수업 결과물을 올리는 게시판입니다.', ex: '예) 오늘 만든 웹앱 주소와 소감을 적어 주세요.', popup: '',
      boardLayout: 'grid', columns: [], status: 'ON', createdAt: ago(20),
    });
    const boardKey = `${cls.name}__${SCHOOL}__g1__c1`;
    const posts = [
      ['st02', '우리 반 급식 메뉴 알리미', '오늘 급식 메뉴를 보여주는 웹앱을 만들었어요. 알레르기 표시도 넣었습니다.', 3, 2],
      ['st03', '단어 퀴즈 게임', '영어 단어를 맞히면 점수가 올라가는 게임입니다. 틀린 단어는 다시 나와요.', 1, 1],
      ['st04', '모둠 발표 타이머', '발표 시간을 재고 1분 남으면 색이 바뀝니다.', 5, 0],
    ];
    posts.forEach(([sid, sub, msg, likes, d], i) => {
      const s = STUDENTS.find((x) => x.id === sid);
      put(`posts/post${i + 1}`, {
        classTitle: cls.name, boardKey, grade: '1', group: '1', num: s.number, name: s.name, studentId: sid,
        srcLang: 'ko', subKo: sub, msgKo: msg, subZh: '', msgZh: '', subRu: '', msgRu: '', subEn: '', msgEn: '',
        imgs: [], column: '', likes, pinned: false, deleted: false,
        createdAt: ago(d, i + 1), updatedAt: ago(d, i + 1),
      });
    });

    // ── 시험: 문항은 exam_questions, 정답은 exam_answers(관리자 전용)에 따로 ──
    put('exams/ex1', { title: '정보 단원평가 (견본)', desc: '컴퓨터 구조와 알고리즘', forms: [], shuffleForms: false, createdAt: ago(7) });
    const qs = [
      { id: 'q1', type: 'mc', title: '중앙 처리 장치', content: '컴퓨터에서 명령어를 해석하고 계산을 담당하는 장치는 무엇인가요?',
        options: ['CPU', '모니터', '키보드', '스피커'], points: 10, answer: '0' },
      { id: 'q2', type: 'sa', title: '입력 장치', content: '마우스처럼 컴퓨터에 정보를 넣는 장치를 무엇이라고 하나요?', points: 10, answer: '입력 장치' },
      { id: 'q3', type: 'essay', title: '알고리즘', content: '알고리즘이 무엇인지 생활 속 예를 들어 설명해 보세요.', points: 20, answer: '' },
      { id: 'q4', type: 'code', title: '두 수의 합', content: '두 정수를 입력받아 합을 출력하는 프로그램을 작성하세요.',
        inDesc: '한 줄에 정수 a, b가 공백으로 주어집니다.', outDesc: 'a+b를 출력합니다.', inEx: '3 5', outEx: '8',
        points: 20, answer: '', testCases: [{ input: '3 5', expected: '8' }, { input: '10 -4', expected: '6' }] },
    ];
    qs.forEach((q, i) => {
      const { id, answer, testCases, ...fields } = q;
      put(`exam_questions/${id}`, { examId: 'ex1', ...fields, imageUrl: '', order: i + 1, createdAt: ago(7) });
      put(`exam_answers/${id}`, { examId: 'ex1', answer, testCases: testCases || [] });
    });
    put('exam_assignments/as1', {
      examId: 'ex1', code: '', grade: '1', class: '1', schoolName: SCHOOL, duration: 20, entryMinutes: 0,
      status: 'ON', formMode: '', createdAt: ago(1), openedAt: ago(1),
    });
    // 이미 낸 학생 두 명 — 관리자 채점 화면에서 바로 보인다
    const answersOf = {
      st02: ['0', '입력 장치', '라면 끓이는 순서처럼 어떤 일을 하기 위한 단계를 차례로 적은 것입니다.', 'a, b = map(int, input().split())\nprint(a + b)'],
      st03: ['1', '입력장치', '문제를 푸는 방법입니다.', 'print(input())'],
    };
    for (const [sid, vals] of Object.entries(answersOf)) {
      const s = STUDENTS.find((x) => x.id === sid);
      qs.forEach((q, i) => {
        put(`exam_results/as1_${sid}_${i}`, {
          asId: 'as1', examId: 'ex1', questionId: q.id, studentId: sid,
          name: s.name, grade: '1', class: '1', num: s.number, lang: 'ko', qIdx: i, type: q.type, title: q.title,
          value: vals[i], score: 0, maxScore: q.points, feedback: 'manual',
          check: q.type === 'mc' ? (vals[i] === q.answer ? 'correct' : 'wrong') : null,
          gradedAt: isoAgo(0, 20),
        });
      });
      put(`exam_progress/as1_${sid}`, {
        examId: 'ex1', asId: 'as1', studentId: sid, name: s.name, grade: '1', class: '1', num: s.number,
        status: 'submitted', enterCount: 1, form: '', startTime: isoAgo(0, 21), lastEnterAt: isoAgo(0, 21),
        totalScore: 0, totalPoints: 60, submitTime: isoAgo(0, 20), needsManual: true, elapsedSec: 840, late: false, alertCount: 0,
      });
    }

    // ── 질문하기 (학생 ↔ 선생님 1:1) ──
    put('qna_threads/st02', {
      studentName: '이바다', schoolName: SCHOOL, grade: '1', class: '1', number: '2',
      emailNotify: true, unreadByAdmin: true, unreadByStudent: false, lastMessageAt: ago(0, 3), lastNotifiedAt: null,
    });
    put('qna_threads/st02/messages/m1', { sender: 'student', text: '선생님, 웹앱을 배포했는데 주소에 들어가면 빈 화면만 나와요.', attachments: [], createdAt: ago(0, 5) });
    put('qna_threads/st02/messages/m2', { sender: 'admin', text: 'Cloudflare 설정에서 빌드 출력 폴더를 확인해 볼까요? 화면을 캡처해서 보내 주세요.', attachments: [], createdAt: ago(0, 4), readAt: ago(0, 4) });
    put('qna_threads/st02/messages/m3', { sender: 'student', text: '찾았어요! 폴더 이름이 달랐어요. 감사합니다.', attachments: [], createdAt: ago(0, 3) });

    // ── AI 실험실: 열린 수업 하나와 2명씩 모둠 (프로젝트는 학생이 들어오면 앱이 만든다) ──
    put('ai_assignments/ai1', {
      title: '우리 모둠 분류 모델 (견본)', schoolName: SCHOOL, grade: '1', class: '1',
      minPerLabel: 15, minTestPerLabel: 3, maxLabels: 5, groupSize: 2, board: null, boardScope: 'class',
      sources: ['draw', 'search'], cameraUpload: false, textModel: 'mean', kind: 'image', status: 'ON', createdAt: ago(2),
    });
    [['st01', 'st02'], ['st03', 'st04'], ['st05', 'st06']].forEach((ids, i) => {
      put(`ai_pairs/pair${i + 1}`, {
        asId: 'ai1', no: i + 1, members: ids, memberEmails: ids.map((id) => `${id}@ohinfo.local`),
        memberNames: Object.fromEntries(ids.map((id) => [id, STUDENTS.find((s) => s.id === id).name])),
        leaderId: ids[0], round: 0, currentProjectId: '', createdAt: ago(2),
      });
    });

    // ── 학생이 만든 설문 ──
    put('student_forms/form1', {
      title: '우리 반 체육대회 종목 투표', description: '하고 싶은 종목을 골라 주세요.', descImage: '',
      allowAnon: true, showResultToRespondent: true, status: 'open',
      questions: [
        { id: 'fq1', type: 'mc', text: '가장 하고 싶은 종목은?', options: ['피구', '줄다리기', '계주', '발야구'], required: true },
        { id: 'fq2', type: 'short', text: '하고 싶은 말이 있다면 적어 주세요.', options: [], required: false },
      ],
      ownerId: DEMO_STUDENT, ownerName: '김하늘', responseCount: 3, createdAt: ago(3), updatedAt: ago(3),
    });
    [['st02', '피구', '다 같이 재밌게 해요!'], ['st04', '계주', ''], ['st05', '피구', '응원 열심히 할게요']].forEach(([sid, a1, a2], i) => {
      const s = STUDENTS.find((x) => x.id === sid);
      put(`student_form_responses/resp${i + 1}`, {
        formId: 'form1', ownerId: DEMO_STUDENT, respondentId: sid, respondentName: `${s.number} ${s.name}`,
        answers: [a1, a2], submittedAt: ago(2, i),
      });
    });
  });
}

/** 학생 화면을 처음 열면 견본 학생(김하늘)으로 로그인된 상태로 시작한다 (로그아웃했으면 그대로 둔다). */
export function ensureStudentLogin() {
  if (localStorage.getItem('vibe_student_loggedout') === '1') return;
  if (localStorage.getItem('ohinfo_student')) return;
  const raw = F.rawDoc(NS, `students/${DEMO_STUDENT}`);
  if (!raw) return;
  const { password, ...rest } = raw;
  localStorage.setItem('ohinfo_student', JSON.stringify({ id: DEMO_STUDENT, ...rest, _exp: Date.now() + 5 * DAY }));
  const email = `${DEMO_STUDENT}@ohinfo.local`;
  localStorage.setItem(`vibe-auth:${NS}#student`, JSON.stringify({ ...F.DEMO_USER, uid: 'demo-' + DEMO_STUDENT, email, displayName: DEMO_STUDENT, providerData: [] }));
}
