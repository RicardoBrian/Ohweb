// 견본 출결 관리용 설정 — 가짜 Firebase(이 브라우저 저장) + 가상 학급.
import { initializeApp } from '/vibe/shared/fake-firebase/firebase-app.js';
import { getFirestore, connectFirestoreEmulator } from '/vibe/shared/fake-firebase/firebase-firestore.js';
import { getAuth, connectAuthEmulator } from '/vibe/shared/fake-firebase/firebase-auth.js';

const NS = 'vibe-attend';
const F = globalThis.FakeFB;
const U = F.DEMO_USER;
const ts = (days) => F.Timestamp.fromMillis(Date.now() - days * 86400000);
const iso = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
// n번째 전 수업일(주말 건너뜀)
// 화면이 이번 달을 먼저 보여주므로, 지난달로 넘어가면 오늘 날짜로 둔다
function schoolDayAgo(n) {
  const today = new Date(); today.setHours(0, 0, 0, 0);
  const d = new Date(today);
  while (n > 0) { d.setDate(d.getDate() - 1); if (d.getDay() !== 0 && d.getDay() !== 6) n--; }
  return iso(d.getMonth() === today.getMonth() ? d : today);
}
const now = new Date();
const YEAR = now.getMonth() < 2 ? now.getFullYear() - 1 : now.getFullYear(); // 3월에 새 학년도
const CID = `${YEAR}-1-1`;

// 출결 앱은 통합 프로젝트(gwansan-work) 구조: apps/attend/…, 명렬표 years/{연도}/students, 보호자 반 아래 guardians
F.seed(NS, (put) => {
  put(`admins/${U.email}`, { email: U.email });
  const roster = [
    [1, '김하늘', '', '김보호'], [2, '이바다', '', '이보호'], [3, '박서준', '', '박보호'], [4, '최은비', '', '최보호'],
    [5, '정도윤', '', '정보호'], [6, '한지우', '', '한보호'], [7, 'Emma Lee', '이엠마', 'Lee'], [8, '오하린', '', '오보호'],
  ];
  for (const P of ['apps/attend/']) {
    put(`${P}allowed/${U.email}`, { email: U.email, note: '1-1 견본 선생님', addedAt: ts(30) });
    put(`${P}classes/${CID}`, {
      year: YEAR, grade: 1, cls: 1, ownerUid: U.uid, ownerEmail: U.email, teacherName: '견본 선생님', offDays: [],
      createdAt: ts(60), updatedAt: ts(1),
    });
  }
  for (const [no, name, koName, guardian] of roster) {
    put(`years/${YEAR}/students/${CID}-${no}`, { grade: 1, klass: 1, number: no, name, koreanName: koName, updatedAt: ts(60) });
    put(`apps/attend/classes/${CID}/guardians/${CID}-${no}`, { number: no, guardian, updatedAt: ts(60) });
  }

  const base = { docs: [], docsIn: false, neis: false, memo: '', reportId: null, method: '', methodEtc: '', confirmDate: '', confirmHour: '', talker: '' };
  const recs = [
    { no: 1, name: '김하늘', kind: '결석', cause: '질병', start: schoolDayAgo(4), end: schoolDayAgo(4), period: '', days: 1,
      reason: '감기 몸살', docs: ['진료확인서'], docsIn: true, method: '전화연락', confirmDate: schoolDayAgo(4), confirmHour: '8', talker: '모' },
    { no: 3, name: '박서준', kind: '지각', cause: '미인정', start: schoolDayAgo(3), end: schoolDayAgo(3), period: '1', days: null, reason: '늦잠', neis: true },
    { no: 5, name: '정도윤', kind: '조퇴', cause: '질병', start: schoolDayAgo(2), end: schoolDayAgo(2), period: '5', days: null,
      reason: '복통', docs: ['담임확인서(상기명 학생은 보건실 방문 후 조퇴함)'], method: '전화연락', confirmDate: schoolDayAgo(2), confirmHour: '12', talker: '부' },
    { no: 2, name: '이바다', kind: '결과', cause: '출석인정', start: schoolDayAgo(1), end: schoolDayAgo(1), period: '3~4', days: null,
      reason: '학교 대표 정보 대회 참가', docs: ['참가확인서'], docsIn: true },
  ];
  for (const P of ['apps/attend/']) {
    recs.forEach((r, i) => put(`${P}classes/${CID}/records/rec${i + 1}`, { ...base, ...r, createdAt: ts(5 - i), updatedAt: ts(5 - i) }));
    // 관리 탭에 보이는 승인 신청 하나
    put(`${P}requests/demo-other`, { email: 'other@example.com', name: '다른 견본 선생님', year: YEAR, grade: 1, cls: 2, createdAt: ts(0) });
  }
});

// 로그인 3일 유지 기록 — 견본은 처음 열 때 지금 시각으로 둔다
if (!localStorage.getItem('gwsattend.loginAt')) localStorage.setItem('gwsattend.loginAt', String(Date.now()));

export const CONFIGURED = true;
const app = initializeApp({ projectId: NS });
export const db = getFirestore(app);
export const auth = getAuth(app);
void connectFirestoreEmulator; void connectAuthEmulator;
