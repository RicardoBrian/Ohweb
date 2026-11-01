/**
 * SeatChange (견본판) — 저장 계층.
 *
 * 원본은 Firestore + 익명 인증으로 방을 공유하지만, 이 견본은 브라우저의
 * localStorage에만 저장한다 — 서버로 아무것도 전송하지 않고, 이 브라우저를
 * 벗어나면 공유되지 않는다(연수 시연 목적). app.js가 기대하는 함수 시그니처는
 * 원본 store.js와 동일하게 맞춰서, app.js는 한 줄도 고칠 필요가 없다.
 */

const STORE_KEY = 'seatchange.demo.rooms';
const ROOM_KEY = 'seatchange.demo.roomId';

function loadAll() {
  try {
    return JSON.parse(localStorage.getItem(STORE_KEY) || '{}');
  } catch {
    return {};
  }
}

function saveAll(rooms) {
  localStorage.setItem(STORE_KEY, JSON.stringify(rooms));
}

function roomIdFromUrl() {
  return new URLSearchParams(location.search).get('room');
}

function setRoomIdInUrl(id) {
  const url = new URL(location.href);
  url.searchParams.set('room', id);
  history.replaceState(null, '', url);
}

function newId() {
  return 'demo' + Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
}

/**
 * 시작 시 1회 호출. 이 브라우저에 저장된 방이 있으면 불러오고,
 * 없으면(첫 방문) data는 null — 저장할 때 새로 만든다.
 */
export async function openRoom() {
  const rooms = loadAll();
  const urlId = roomIdFromUrl();
  const roomId = urlId || localStorage.getItem(ROOM_KEY) || null;

  if (!roomId || !rooms[roomId]) return { roomId: null, data: null, isOwner: true, uid: 'demo' };

  if (!urlId) localStorage.setItem(ROOM_KEY, roomId);
  if (urlId) setRoomIdInUrl(roomId);
  return { roomId, data: rooms[roomId], isOwner: true, uid: 'demo' };
}

/**
 * 현재 상태를 저장한다. roomId가 없으면 새로 만들고 URL·localStorage에 기록한다.
 */
export async function saveRoom(roomId, state) {
  const rooms = loadAll();
  const FIELDS = [
    'desks', 'members', 'rowAssign', 'avoidPairs',
    'avoidPrevSeat', 'avoidPrevMate', 'prev', 'result',
  ];
  const payload = {};
  for (const k of FIELDS) payload[k] = state[k] ?? null;
  payload.name = state.name || '이름 없는 좌석표';
  payload.updatedAt = Date.now();

  if (roomId && rooms[roomId]) {
    payload.createdAt = rooms[roomId].createdAt;
    rooms[roomId] = payload;
    saveAll(rooms);
    return roomId;
  }

  const id = newId();
  payload.createdAt = Date.now();
  rooms[id] = payload;
  saveAll(rooms);
  localStorage.setItem(ROOM_KEY, id);
  setRoomIdInUrl(id);
  return id;
}

/** 내가 만든(=이 브라우저에 저장된) 좌석표 목록. */
export async function listMyRooms() {
  const rooms = loadAll();
  return Object.entries(rooms)
    .map(([id, r]) => ({ id, name: r.name || '이름 없는 좌석표', updatedAt: r.updatedAt || 0 }))
    .sort((a, b) => b.updatedAt - a.updatedAt);
}

export function shareUrl(roomId) {
  const url = new URL(location.href);
  url.search = '';
  url.searchParams.set('room', roomId);
  return url.toString();
}
