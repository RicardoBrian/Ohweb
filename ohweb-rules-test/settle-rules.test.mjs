// ohsettle-10d43 규칙 테스트 (ohsettle/firestore.rules)
import { initializeTestEnvironment } from '@firebase/rules-unit-testing';
import { readFileSync } from 'node:fs';
import { doc, getDoc, getDocs, setDoc, updateDoc, addDoc, deleteDoc, collection, collectionGroup, query, where, serverTimestamp } from 'firebase/firestore';

const rules = readFileSync(new URL('../ohsettle/firestore.rules', import.meta.url), 'utf8');
const env = await initializeTestEnvironment({ projectId: 'ohsettle-10d43', firestore: { rules, host: '127.0.0.1', port: 8181 } });
await env.clearFirestore();
await env.withSecurityRulesDisabled(async c => {
  const db = c.firestore();
  await setDoc(doc(db, 'settle_trips/T1'), { name: '여행', members: ['철수', '영희'], createdAt: new Date(), v: 2 });
  await setDoc(doc(db, 'settle_trips/T1/expenses/E1'), { date: '2026-01-01', desc: '밥', amount: 10000, payer: '철수', memberData: '철수,영희' });
  // 예전 판 문서 (비밀코드·상태·소수 금액·긴 날짜)
  await setDoc(doc(db, 'settle_trips/OLD'), { name: '옛 여행', code: '1234', status: 'approved', members: ['a', 'b'], memo: '' });
  await setDoc(doc(db, 'settle_trips/OLD/expenses/E1'), { date: '2025-12-03', desc: '숙소', amount: 2000.0, payer: 'a', memberData: 'a,b', createdAt: new Date() });
  await setDoc(doc(db, 'settle_trips/DONE'), { name: '끝', status: 'done', members: ['a', 'b'] });
});
const anon = env.unauthenticatedContext().firestore();

let fails = 0;
const T = async (label, p, expectOk) => {
  try { await p; if (!expectOk) { fails++; console.log('❌ 뚫림  ' + label); } else console.log('✅ 허용  ' + label); }
  catch (e) { if (expectOk) { fails++; console.log('❌ 막힘  ' + label + ' — ' + e.code); } else console.log('✅ 차단  ' + label); }
};
const exp = (o = {}) => ({ date: '2026-01-02', desc: '커피', amount: 4500, payer: '철수', memberData: '철수,영희', createdAt: serverTimestamp(), ...o });
const tr = (o = {}) => ({ date: '2026-01-02', sender: '영희', receiver: '철수', amount: 5000, memo: '', createdAt: serverTimestamp(), ...o });

console.log('── 막혀야 함 ──');
await T('프로젝트 목록 조회', getDocs(collection(anon, 'settle_trips')), false);
await T('이름으로 프로젝트 찾기', getDocs(query(collection(anon, 'settle_trips'), where('name', '==', '여행'))), false);
await T('모든 프로젝트 지출 한꺼번에(컬렉션 그룹)', getDocs(collectionGroup(anon, 'expenses')), false);
await T('참여자 1명으로 만들기', addDoc(collection(anon, 'settle_trips'), { name: 'x', members: ['a'], createdAt: serverTimestamp(), v: 2 }), false);
await T('엉뚱한 필드로 만들기', addDoc(collection(anon, 'settle_trips'), { name: 'x', members: ['a', 'b'], status: 'approved' }), false);
await T('예전 문서의 비밀코드 바꾸기', updateDoc(doc(anon, 'settle_trips/OLD'), { code: '0000' }), false);
await T('없는 프로젝트에 지출 쓰기', addDoc(collection(anon, 'settle_trips/NOPE/expenses'), exp()), false);
await T('종료된 프로젝트에 지출 쓰기', addDoc(collection(anon, 'settle_trips/DONE/expenses'), exp()), false);
await T('금액 0', addDoc(collection(anon, 'settle_trips/T1/expenses'), exp({ amount: 0 })), false);
await T('금액 소수', addDoc(collection(anon, 'settle_trips/T1/expenses'), exp({ amount: 10.5 })), false);
await T('금액 문자열', addDoc(collection(anon, 'settle_trips/T1/expenses'), exp({ amount: '100' })), false);
await T('지출에 엉뚱한 필드', addDoc(collection(anon, 'settle_trips/T1/expenses'), exp({ x: 1 })), false);
await T('송금 링크를 지도 아닌 값으로', updateDoc(doc(anon, 'settle_trips/T1'), { payLinks: 'x' }), false);
await T('자기 자신에게 송금', addDoc(collection(anon, 'settle_trips/T1/transfers'), tr({ receiver: '영희' })), false);

console.log('── 되어야 함 ──');
await T('링크(ID)로 프로젝트 읽기', getDoc(doc(anon, 'settle_trips/T1')), true);
await T('ID로 지출 목록 읽기', getDocs(collection(anon, 'settle_trips/T1/expenses')), true);
await T('새 프로젝트 만들기', addDoc(collection(anon, 'settle_trips'), { name: '새 여행', members: ['a', 'b'], createdAt: serverTimestamp(), v: 2 }), true);
await T('지출 추가', addDoc(collection(anon, 'settle_trips/T1/expenses'), exp()), true);
await T('직접 입력 지출 추가', addDoc(collection(anon, 'settle_trips/T1/expenses'), exp({ memberData: '철수:1500,영희:3000' })), true);
await T('지출 고치기', updateDoc(doc(anon, 'settle_trips/T1/expenses/E1'), { amount: 12000, updatedAt: serverTimestamp() }), true);
await T('예전 지출 고치기(소수 금액 → 정수)', updateDoc(doc(anon, 'settle_trips/OLD/expenses/E1'), { amount: 2000, desc: '숙소비', updatedAt: serverTimestamp() }), true);
await T('송금 기록', addDoc(collection(anon, 'settle_trips/T1/transfers'), tr()), true);
await T('참여자 추가', updateDoc(doc(anon, 'settle_trips/T1'), { members: ['철수', '영희', '민수'], updatedAt: serverTimestamp() }), true);
await T('카카오페이 송금 링크 저장', updateDoc(doc(anon, 'settle_trips/T1'), { payLinks: { '철수': 'https://qr.kakaopay.com/Abc123' }, updatedAt: serverTimestamp() }), true);
await T('예전 프로젝트 이름 바꾸기', updateDoc(doc(anon, 'settle_trips/OLD'), { name: '옛 여행 2', updatedAt: serverTimestamp() }), true);
await T('지출 지우기', deleteDoc(doc(anon, 'settle_trips/T1/expenses/E1')), true);
await T('프로젝트 지우기', deleteDoc(doc(anon, 'settle_trips/T1')), true);

await env.cleanup();
console.log(fails ? `\n실패 ${fails}개` : '\n모두 통과');
process.exit(fails ? 1 : 0);
