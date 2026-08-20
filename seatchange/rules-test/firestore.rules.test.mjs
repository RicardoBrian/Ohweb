import { initializeTestEnvironment, assertSucceeds, assertFails } from '@firebase/rules-unit-testing';
import { readFileSync } from 'fs';
import { doc, setDoc, getDoc, updateDoc, deleteDoc, collection, addDoc, serverTimestamp, query, where, getDocs } from 'firebase/firestore';

const testEnv = await initializeTestEnvironment({
  projectId: 'demo-seatchange',
  firestore: { rules: readFileSync('firestore.rules', 'utf8'), host: 'localhost', port: 8080 },
});

let pass = 0, fail = 0;
const ok = async (label, p) => {
  try { await p; pass++; console.log('  PASS  ' + label); }
  catch (e) { fail++; console.log('->FAIL  ' + label + '  :: ' + e.message.split('\n')[0]); }
};

const alice = testEnv.authenticatedContext('alice-uid').firestore();
const bob    = testEnv.authenticatedContext('bob-uid').firestore();
const anon   = testEnv.unauthenticatedContext().firestore();

const validRoom = (ownerUid, over = {}) => ({
  ownerUid, name: '3반', desks: [{ id: 'd1', row: 0, col: 0 }], members: [],
  updatedAt: serverTimestamp(), ...over,
});

// 1) 익명(비로그인)은 아무것도 못 만든다 — 반드시 signIn(익명 인증)을 거쳐야 함
await ok('비로그인 create 거부', assertFails(
  setDoc(doc(anon, 'seat_rooms/r1'), validRoom('anon'))
));

// 2) 로그인한 사람은 자기 uid로 방을 만들 수 있다
await ok('본인 uid로 create 허용', assertSucceeds(
  setDoc(doc(alice, 'seat_rooms/r1'), validRoom('alice-uid'))
));

// 3) 남의 uid를 사칭해서 만들 수는 없다
await ok('타인 uid 사칭 create 거부', assertFails(
  setDoc(doc(bob, 'seat_rooms/r2'), validRoom('alice-uid'))
));

// 4) 필드가 부족하거나(updatedAt 누락) 스키마를 벗어나면 거부
await ok('필수 필드 누락 create 거부', assertFails(
  setDoc(doc(alice, 'seat_rooms/r3'), { ownerUid: 'alice-uid', name: 'x' })
));
await ok('허용 안 된 필드 create 거부', assertFails(
  setDoc(doc(alice, 'seat_rooms/r4'), validRoom('alice-uid', { secret: 'nope' }))
));
await ok('desks 개수 상한 초과 create 거부', assertFails(
  setDoc(doc(alice, 'seat_rooms/r5'),
    validRoom('alice-uid', { desks: Array.from({ length: 81 }, (_, i) => ({ id: `d${i}`, row: 0, col: i })) }))
));

// 5) 아무나(로그인 안 해도) 링크만 있으면 읽을 수 있다 (get)
await ok('비로그인 read 허용 (공유 링크)', assertSucceeds(
  getDoc(doc(anon, 'seat_rooms/r1'))
));

// 5b) 목록 조회(list, "내 좌석표 불러오기")는 소유자 본인만 — 그리고 쿼리
// 자체가 ownerUid로 좁혀져 있어야 한다. firebaseConfig는 공개 정보이므로
// 이 규칙이 없으면 아무나 전체 좌석표 목록을 긁어갈 수 있다.
await ok('소유자가 자기 uid로 필터한 list 허용', assertSucceeds(
  getDocs(query(collection(alice, 'seat_rooms'), where('ownerUid', '==', 'alice-uid')))
));
await ok('필터 없는 list(컬렉션 전체 훑기) 거부', assertFails(
  getDocs(collection(alice, 'seat_rooms'))
));
await ok('남의 uid로 필터해도 list 거부', assertFails(
  getDocs(query(collection(bob, 'seat_rooms'), where('ownerUid', '==', 'alice-uid')))
));
await ok('비로그인 list 거부', assertFails(
  getDocs(query(collection(anon, 'seat_rooms'), where('ownerUid', '==', 'alice-uid')))
));

// 6) 소유자만 수정 가능
await ok('소유자 update 허용', assertSucceeds(
  updateDoc(doc(alice, 'seat_rooms/r1'), { name: '4반', updatedAt: serverTimestamp() })
));
await ok('타인 update 거부', assertFails(
  updateDoc(doc(bob, 'seat_rooms/r1'), { name: '해킹', updatedAt: serverTimestamp() })
));

// 7) update로 ownerUid를 바꿔치기 할 수 없다
await ok('update로 ownerUid 탈취 거부', assertFails(
  updateDoc(doc(alice, 'seat_rooms/r1'), { ownerUid: 'bob-uid', updatedAt: serverTimestamp() })
));

// 8) 삭제는 소유자만
await ok('타인 delete 거부', assertFails(deleteDoc(doc(bob, 'seat_rooms/r1'))));
await ok('소유자 delete 허용', assertSucceeds(deleteDoc(doc(alice, 'seat_rooms/r1'))));

// 9) 정의하지 않은 컬렉션은 완전히 막힌다 (디폴트 거부 확인)
await ok('미정의 컬렉션 거부', assertFails(
  setDoc(doc(alice, 'other_stuff/x'), { a: 1 })
));

console.log(`\n통과 ${pass} / 실패 ${fail}`);
await testEnv.cleanup();
process.exit(fail ? 1 : 0);
