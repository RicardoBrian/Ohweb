// 견본 모임 정산용 설정 — 가짜 Firebase(이 브라우저 저장) + 견본 정산 하나.
import { initializeApp } from '/vibe/shared/fake-firebase/firebase-app.js';
import { getFirestore } from '/vibe/shared/fake-firebase/firebase-firestore.js';

const NS = 'vibe-settle';
const F = globalThis.FakeFB;
const ts = (days) => F.Timestamp.fromMillis(Date.now() - days * 86400000);
const day = (n) => { const d = new Date(Date.now() - n * 86400000); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`; };
const seeded = F.seed(NS, (put) => {
  const members = ['김하늘', '이바다', '박서준', '최은비'];
  put('settle_trips/trip1', { name: '모둠 체험학습 회비 (견본)', code: '1234', status: 'approved', members, memo: '', createdAt: ts(5) });
  put('settle_trips/trip2', { name: '동아리 간식비 (견본)', code: '1234', status: 'approved', members: ['김하늘', '정도윤', '한지우'], memo: '', createdAt: ts(12) });
  const ex = [
    [3, '버스 왕복', 48000, '김하늘', members.join(',')],
    [3, '점심 김밥', 22000, '이바다', members.join(',')],
    [3, '입장료', 36000, '박서준', '김하늘,이바다,박서준'],
    [2, '간식', 9000, '최은비', '김하늘:3000,최은비:6000'],
  ];
  ex.forEach(([d, desc, amount, payer, memberData], i) => put(`settle_trips/trip1/expenses/e${i + 1}`, { date: day(d), desc, amount, payer, memberData, createdAt: ts(d) }));
  put('settle_trips/trip1/transfers/t1', { date: day(1), sender: '최은비', receiver: '김하늘', amount: 10000, memo: '버스비', createdAt: ts(1) });
});
// 처음 열면 견본 정산으로 바로 들어간다 (비밀코드 1234)
if (seeded) localStorage.setItem('ohsettle_last', JSON.stringify({ tripId: 'trip1', code: '1234' }));

const app = initializeApp({ projectId: NS });
export const db = getFirestore(app);
