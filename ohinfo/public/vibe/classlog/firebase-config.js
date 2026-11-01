// 견본 수업일지용 설정 — 가짜 Firebase(이 브라우저 저장) + 견본 데이터.
import { initializeApp } from '/vibe/shared/fake-firebase/firebase-app.js';
import { getFirestore } from '/vibe/shared/fake-firebase/firebase-firestore.js';
import { getAuth } from '/vibe/shared/fake-firebase/firebase-auth.js';
import { SCHOOL, MY_SLOTS, weeks } from '/vibe/shared/api/comci.js';

const NS = 'vibe-classlog';
const F = globalThis.FakeFB;
const UID = F.DEMO_USER.uid;
const ts = (days) => F.Timestamp.fromMillis(Date.now() - days * 86400000);

F.seed(NS, (put) => {
  put(`classlog_users/${UID}`, {
    email: F.DEMO_USER.email, name: F.DEMO_USER.displayName,
    schoolCode: SCHOOL.sccode, schoolName: SCHOOL.name, region: SCHOOL.region,
    teacherId: 1, teacherName: '견본*', status: 'approved', createdAt: ts(40), updatedAt: ts(40),
  });
  // 승인을 기다리는 다른 선생님 (관리자 화면의 승인 목록에 보인다)
  put('classlog_users/demo-other', {
    email: 'other@example.com', name: '다른 견본 선생님',
    schoolCode: SCHOOL.sccode, schoolName: SCHOOL.name, region: SCHOOL.region,
    teacherId: 3, teacherName: '이*수', status: 'pending', createdAt: ts(1), updatedAt: ts(1),
  });

  // 진도 계획: 1학년 정보
  const items = [
    ['1단원', '컴퓨팅 시스템의 구성'], ['1단원', '운영체제의 역할'], ['2단원', '자료와 정보'], ['2단원', '자료의 표현'],
    ['3단원', '문제 분해와 추상화'], ['3단원', '알고리즘 설계'], ['4단원', '순차·선택 구조'], ['4단원', '반복 구조'],
  ].map(([unit, title], i) => ({ id: 'p' + (i + 1), unit, title }));
  put(`classlog_users/${UID}/plans/1_정보`, { grade: 1, subject: '정보', items, updatedAt: ts(20) });

  // 지난주와 이번 주 지나간 수업의 일지
  const ws = weeks();
  const today = new Date(); today.setHours(0, 0, 0, 0);
  const progress = { 1: 0, 2: 0, 3: 0, 4: 0 };
  const notes = ['', '질문이 많아 다음 시간에 복습', '', '모둠 활동 시간이 부족했음', ''];
  for (const w of ws.slice(0, 2)) {
    for (const [g, c, d, p] of [...MY_SLOTS].sort((a, b) => a[2] - b[2] || a[3] - b[3])) {
      const [y, m, dd] = w.start.split('-').map(Number);
      const date = new Date(y, m - 1, dd + d - 1);
      if (date >= today) continue;
      const iso = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
      const it = items[Math.min(progress[c]++, items.length - 1)];
      put(`classlog_users/${UID}/logs/${iso}_${p}_${g}-${c}`, {
        date: iso, period: p, grade: g, cls: c, subject: '정보', status: 'normal',
        planItem: it.id, unit: it.title, content: `${it.title} 개념 설명과 활동지 풀이`,
        homework: progress[c] % 2 ? '활동지 마무리' : '', note: notes[(c + d) % notes.length], updatedAt: ts(0),
      });
    }
  }
});

const app = initializeApp({ projectId: NS });
export const db = getFirestore(app);
export const auth = getAuth(app);
