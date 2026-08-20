/**
 * SeatChange — 저장 계층.
 *
 * Firestore rules (firestore.rules)가 요구하는 것과 정확히 맞물려야 한다:
 * create/update는 ownerUid가 로그인한 사용자의 uid와 같아야 통과한다.
 * 그래서 저장 전에 whenSignedIn()으로 익명 인증이 끝나기를 반드시 기다린다.
 *
 * 방(room)은 URL의 ?room=<id> 로 식별한다. 링크를 공유하면 그 사람은
 * 같은 문서를 "읽기"는 되지만(rules: read는 열려있음), 자기 uid가
 * ownerUid와 다르면 "쓰기"는 막힌다 — 즉 자동으로 읽기 전용 뷰가 된다.
 */
import { db, whenSignedIn } from './firebase-config.js';
import {
  doc, getDoc, setDoc, addDoc, collection, serverTimestamp,
  query, where, limit, getDocs,
} from 'https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js';

const ROOMS = 'seat_rooms';
const ROOM_KEY = 'seatchange.roomId';

// firestore.rules의 필드 허용 목록과 일치해야 한다. 여기 없는 키를 보내면 거부된다.
const FIELDS = [
  'desks', 'members', 'rowAssign', 'avoidPairs',
  'avoidPrevSeat', 'avoidPrevMate', 'prev', 'result',
];

function roomIdFromUrl() {
  return new URLSearchParams(location.search).get('room');
}

function setRoomIdInUrl(id) {
  const url = new URL(location.href);
  url.searchParams.set('room', id);
  history.replaceState(null, '', url);
}

/**
 * 시작 시 1회 호출. 방을 열 수 있으면 데이터와 소유 여부를 돌려준다.
 * roomId가 없으면(첫 방문) data는 null이고 isOwner는 true — 저장할 때 새로 만든다.
 */
export async function openRoom() {
  const user = await whenSignedIn();
  const urlId = roomIdFromUrl();
  const roomId = urlId || localStorage.getItem(ROOM_KEY) || null;

  if (!roomId) return { roomId: null, data: null, isOwner: true, uid: user.uid };

  const snap = await getDoc(doc(db, ROOMS, roomId));
  if (!snap.exists()) return { roomId: null, data: null, isOwner: true, uid: user.uid };

  const data = snap.data();
  const isOwner = data.ownerUid === user.uid;
  if (isOwner && !urlId) localStorage.setItem(ROOM_KEY, roomId); // 소유자 방은 로컬에 기억
  if (urlId) setRoomIdInUrl(roomId); // 주소창에 항상 방 링크가 보이게
  return { roomId, data, isOwner, uid: user.uid };
}

/**
 * 현재 상태를 저장한다. roomId가 없으면 새로 만들고 URL·localStorage에 기록한다.
 * 소유자가 아닌데 호출하면(읽기 전용 뷰) rules가 거부하므로, 그 판단은
 * 호출하는 쪽(app.js)이 isOwner로 미리 걸러야 한다.
 */
export async function saveRoom(roomId, state) {
  const user = await whenSignedIn();
  const payload = {};
  for (const k of FIELDS) payload[k] = state[k] ?? null;
  payload.ownerUid = user.uid;
  payload.name = state.name || '이름 없는 좌석표';
  payload.updatedAt = serverTimestamp();

  if (roomId) {
    // merge:true — createdAt을 매번 다시 보내지 않아도 지워지지 않는다.
    // rules의 validRoom()은 병합 후 최종 문서 전체를 검사하므로 안전하다.
    await setDoc(doc(db, ROOMS, roomId), payload, { merge: true });
    return roomId;
  }

  payload.createdAt = serverTimestamp();
  const ref = await addDoc(collection(db, ROOMS), payload);
  localStorage.setItem(ROOM_KEY, ref.id);
  setRoomIdInUrl(ref.id);
  return ref.id;
}

/**
 * 내가 만든 좌석표 목록 ("불러오기"). firestore.rules는 list 쿼리를
 * `ownerUid == request.auth.uid`로 제한하므로, 정렬 없이 이 필터로만
 * 가져온 뒤 클라이언트에서 최신순으로 정렬한다 — orderBy를 같이 쓰면
 * 복합 색인이 필요해지는데, 방 개수가 많지 않은 앱이라 그럴 값어치가 없다.
 */
export async function listMyRooms() {
  const user = await whenSignedIn();
  const q = query(collection(db, ROOMS), where('ownerUid', '==', user.uid), limit(50));
  const snap = await getDocs(q);
  const rooms = snap.docs.map(d => ({
    id: d.id,
    name: d.data().name || '이름 없는 좌석표',
    updatedAt: d.data().updatedAt?.toMillis?.() ?? 0,
  }));
  rooms.sort((a, b) => b.updatedAt - a.updatedAt);
  return rooms;
}

export function shareUrl(roomId) {
  const url = new URL(location.href);
  url.search = '';
  url.searchParams.set('room', roomId);
  return url.toString();
}
