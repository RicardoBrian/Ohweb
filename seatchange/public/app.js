/**
 * SeatChange — UI.
 * 배정 로직은 arrange.js, 저장은 store.js(Firestore)에 있고
 * 이 파일은 상태 관리와 렌더링만 한다.
 *
 * 책상은 고정 공식(행×열)으로 생성하지 않고 편집 가능한 배열(S.desks)로
 * 다룬다 — 추가/삭제/드래그 이동이 전부 이 배열을 직접 바꾸는 것이다.
 * "설계 모드"(S.result 없음)와 "배치 완료 모드"(S.result 있음)는 서로
 * 다른 화면이 아니라 같은 보드가 다른 상태로 보이는 것뿐이다.
 */
import { arrange, makeGrid, makeSeed } from './arrange.js';
import { openRoom, saveRoom, shareUrl, listMyRooms } from './store.js';

const $ = id => document.getElementById(id);
const newId = prefix => `${prefix}${Date.now()}${Math.random().toString(36).slice(2, 7)}`;

const S = {
  name: '', roomId: null, isOwner: true,
  desks: [],          // {id, row, col}
  members: [],        // {id, name}
  rowAssign: {},       // {memberId: rowIndex(0-based)} — 명렬표의 "줄배정" 칸
  avoidPairs: [],      // [idA, idB][]
  avoidPrevSeat: false,
  avoidPrevMate: false,
  prev: null,          // 직전 배정 {deskId: memberId}
  result: null,        // {placements, seed, relaxed}
};

/* ---------- 저장 ---------- */
let saveTimer = null;
function scheduleSave() {
  if (!S.isOwner) return;
  clearTimeout(saveTimer);
  saveTimer = setTimeout(async () => {
    try {
      const id = await saveRoom(S.roomId, S);
      if (!S.roomId) { S.roomId = id; renderRoomBar(); }
    } catch (e) {
      toast('저장 실패: ' + e.message);
    }
  }, 600);
}

function applyLoadedData(data) {
  S.name = data.name || '';
  S.desks = Array.isArray(data.desks) ? data.desks : [];
  S.members = data.members ?? [];
  S.rowAssign = data.rowAssign ?? {};
  S.avoidPairs = data.avoidPairs ?? [];
  S.avoidPrevSeat = !!data.avoidPrevSeat;
  S.avoidPrevMate = !!data.avoidPrevMate;
  S.prev = data.prev ?? null;
  S.result = data.result ?? null;
}

/* ---------- 파생 ---------- */
const boardRows = () => S.desks.reduce((m, d) => Math.max(m, d.row + 1), 0);
const boardCols = () => S.desks.reduce((m, d) => Math.max(m, d.col + 1), 0);
const deskAt = (row, col) => S.desks.find(d => d.row === row && d.col === col);
const nameOf = id => S.members.find(m => m.id === id)?.name ?? '?';
const isEditable = () => S.isOwner && !S.result;

/* ---------- 알림 ---------- */
let toastTimer;
function toast(msg) {
  const t = $('toast');
  t.textContent = msg; t.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => t.classList.remove('show'), 2400);
}

const esc = s => String(s).replace(/[&<>"]/g, ch => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[ch]));

/* ---------- 렌더 ---------- */
function renderRoomBar() {
  $('roomName').value = S.name;
  $('roomTitleText').textContent = S.name || '이름 없는 좌석표';
  $('btnShare').disabled = !S.roomId;
}

/** 상태를 화면에 반영만 한다. 저장을 트리거하지 않는다 — 초기 로드 직후에도 안전하게 부를 수 있다. */
function paint() {
  document.body.classList.toggle('readonly', !S.isOwner);
  document.body.classList.toggle('arranged', !!S.result);

  const desks = S.desks.length, people = S.members.length;
  $('banner').innerHTML = people > desks
    ? `<div class="banner">학생이 책상보다 ${people - desks}명 많습니다. 책상을 늘리거나 명단을 줄이세요.</div>`
    : (S.result?.relaxed?.length
        ? `<div class="banner warn">규칙을 다 지킬 수 없어 일부를 완화했습니다: ${S.result.relaxed.map(labelOf).join(', ')}</div>` : '');
  $('readonlyBanner').hidden = S.isOwner;

  renderRoomBar();
  renderBoard();
  renderRosterList();
  renderAvoid();
  syncSwitch('swSeat', S.avoidPrevSeat);
  syncSwitch('swMate', S.avoidPrevMate);
}

/** 상태 변경 뒤에는 항상 이걸 부른다: 화면 반영 + 저장 예약. */
function render() { paint(); scheduleSave(); }

const labelOf = r => ({ avoidPrevNeighbor: '직전과 다른 짝', avoidPrevSeat: '직전과 다른 자리', avoidPairs: '짝 금지' }[r] ?? r);

function syncSwitch(id, on) { $(id).classList.toggle('on', !!on); }

/* ---------- 보드(책상 격자) ---------- */
function renderBoard() {
  const rows = boardRows(), cols = boardCols();
  const grid = $('grid');
  grid.style.gridTemplateColumns = `repeat(${Math.max(cols, 1)}, auto)`;
  grid.innerHTML = '';

  const editable = isEditable();

  // 1줄은 칠판에 제일 가까운 줄이어야 한다. 칠판이 격자 "아래"에 있으므로
  // (renderBoard가 그리는 순서 = 화면 위에서 아래) row 0을 맨 마지막에
  // 그려야 실제로 칠판과 가장 가까운 줄이 된다. row가 클수록 칠판에서 멀다.
  for (let r = rows - 1; r >= 0; r--) {
    for (let c = 0; c < cols; c++) {
      const desk = deskAt(r, c);
      grid.appendChild(desk ? renderDesk(desk, r, editable) : renderEmptyCell(r, c, editable));
    }
  }
}

function renderEmptyCell(row, col, editable) {
  const d = document.createElement('div');
  d.dataset.row = row; d.dataset.col = col;
  if (editable) {
    d.className = 'seat empty-slot';
    d.textContent = '+';
    d.title = '책상 추가';
    d.onclick = () => addDesk(row, col);
  } else {
    d.className = 'seat gap';
  }
  return d;
}

function renderDesk(desk, row, editable) {
  const d = document.createElement('div');
  d.dataset.deskId = desk.id; d.dataset.row = desk.row; d.dataset.col = desk.col;

  if (editable) {
    d.className = 'seat';
    d.innerHTML = `<span class="no">${row + 1}줄</span>`;
    const del = document.createElement('button');
    del.className = 'seat-del'; del.title = '책상 삭제';
    del.innerHTML = '<svg width="11" height="11"><use href="#ic-close"/></svg>';
    // pointerdown이 부모(책상)로 버블링되면 startDrag가 먼저 반응해 클릭이
    // 드래그로 오해된다 — 여기서 전파를 끊어야 삭제 클릭이 제대로 들어온다.
    del.onpointerdown = e => e.stopPropagation();
    del.onclick = e => { e.stopPropagation(); removeDesk(desk.id); };
    d.appendChild(del);
    d.onpointerdown = e => startDrag(e, d, desk.id);
    return d;
  }

  if (!S.result) {
    // 아직 배치 전이고 소유자도 아님(뷰어) — 그냥 빈 책상으로 보여줄 뿐, 누를 게 없다.
    d.className = 'seat preview';
    return d;
  }

  const who = S.result.placements[desk.id];
  if (!who) {
    d.className = 'seat spare';
    return d;
  }

  d.className = 'seat blank';
  d.title = '눌러서 확인';
  d.onclick = () => {
    d.classList.remove('landing'); void d.offsetWidth; d.classList.add('landing');
    showReveal(nameOf(who));
  };
  return d;
}

/* ---------- 책상 편집: 추가 · 삭제 · 이동 ---------- */
function addDesk(row, col) {
  if (deskAt(row, col)) return;
  S.desks.push({ id: newId('d'), row, col });
  render();
}

function removeDesk(id) {
  S.desks = S.desks.filter(d => d.id !== id);
  render();
}

function moveDeskTo(id, row, col) {
  const d = S.desks.find(x => x.id === id);
  if (!d || (d.row === row && d.col === col)) return;
  const occupant = S.desks.find(x => x.id !== id && x.row === row && x.col === col);
  if (occupant) { occupant.row = d.row; occupant.col = d.col; }
  d.row = row; d.col = col;
  render();
}

let drag = null;
function startDrag(e, el, deskId) {
  if (!isEditable()) return;
  e.preventDefault();
  drag = { deskId, moved: false };
  el.setPointerCapture(e.pointerId);
  const onMove = ev => {
    drag.moved = true;
    el.classList.add('dragging');
    document.querySelectorAll('.seat.drop-target').forEach(x => x.classList.remove('drop-target'));
    const under = document.elementFromPoint(ev.clientX, ev.clientY)?.closest('.seat');
    if (under && under.dataset.row != null) under.classList.add('drop-target');
  };
  const onUp = ev => {
    el.releasePointerCapture(e.pointerId);
    el.removeEventListener('pointermove', onMove);
    el.removeEventListener('pointerup', onUp);
    el.classList.remove('dragging');
    document.querySelectorAll('.seat.drop-target').forEach(x => x.classList.remove('drop-target'));
    const under = document.elementFromPoint(ev.clientX, ev.clientY)?.closest('.seat');
    if (drag.moved && under && under.dataset.row != null) {
      moveDeskTo(deskId, +under.dataset.row, +under.dataset.col);
    }
    drag = null;
  };
  el.addEventListener('pointermove', onMove);
  el.addEventListener('pointerup', onUp);
}

function addRow() {
  const cols = boardCols() || 4;
  const r = boardRows();
  for (let c = 0; c < cols; c++) S.desks.push({ id: newId('d'), row: r, col: c });
  render();
}
function removeRow() {
  const last = boardRows() - 1;
  if (last < 0) return toast('더 지울 줄이 없습니다');
  S.desks = S.desks.filter(d => d.row !== last);
  render();
}
function addCol() {
  const rows = boardRows() || 5;
  const c = boardCols();
  for (let r = 0; r < rows; r++) S.desks.push({ id: newId('d'), row: r, col: c });
  render();
}
function removeCol() {
  const last = boardCols() - 1;
  if (last < 0) return toast('더 지울 분단이 없습니다');
  S.desks = S.desks.filter(d => d.col !== last);
  render();
}

/* ---------- 명단 ---------- */
function renderRosterList() {
  const el = $('rosterList');
  if (!S.members.length) { el.innerHTML = '<div class="empty">아직 명단이 없습니다.</div>'; return; }
  const rows = boardRows();
  el.innerHTML = '';
  S.members.forEach(m => {
    const row = document.createElement('div');
    row.className = 'roster-row';
    const opts = ['<option value="">자동</option>'].concat(
      Array.from({ length: rows }, (_, i) => `<option value="${i}"${S.rowAssign[m.id] === i ? ' selected' : ''}>${i + 1}줄</option>`)
    );
    row.innerHTML = `<span class="rr-name">${esc(m.name)}</span>
      <select>${opts.join('')}</select>
      <button class="icon-action danger" title="삭제"><svg width="15" height="15"><use href="#ic-close"/></svg></button>`;
    row.querySelector('select').onchange = e => {
      const v = e.target.value;
      if (v === '') delete S.rowAssign[m.id]; else S.rowAssign[m.id] = +v;
      render();
    };
    row.querySelector('button').onclick = () => removeMember(m.id);
    el.appendChild(row);
  });
}

function addMember(name) {
  name = name.trim();
  if (!name) return;
  S.members.push({ id: newId('m'), name });
  render();
}

function removeMember(id) {
  S.members = S.members.filter(m => m.id !== id);
  delete S.rowAssign[id];
  S.avoidPairs = S.avoidPairs.filter(p => !p.includes(id));
  render();
}

function renderAvoid() {
  const opts = S.members.map(m => `<option value="${m.id}">${esc(m.name)}</option>`).join('');
  $('avoidA').innerHTML = opts; $('avoidB').innerHTML = opts;

  const el = $('avoidList');
  if (!S.avoidPairs.length) { el.innerHTML = '<div class="empty">지정된 짝 금지가 없습니다.</div>'; return; }
  el.innerHTML = '';
  S.avoidPairs.forEach(([a, b], i) => {
    const c = document.createElement('span');
    c.className = 'chip';
    c.innerHTML = `<span>${esc(nameOf(a))} · ${esc(nameOf(b))}</span>
      <button class="x"><svg width="13" height="13"><use href="#ic-close"/></svg></button>`;
    c.querySelector('.x').onclick = () => { S.avoidPairs.splice(i, 1); render(); };
    el.appendChild(c);
  });
}

/* ---------- 명렬표 CSV ---------- */
function downloadTemplate() {
  const csv = '\uFEFF' + ['이름,줄배정', '김민준,', '이서연,1', '박도윤,'].join('\r\n') + '\r\n';
  const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url; a.download = 'seatchange_명렬표_양식.csv';
  document.body.appendChild(a); a.click(); a.remove();
  URL.revokeObjectURL(url);
}

function parseRosterCsv(text) {
  const lines = text.split(/\r?\n/).map(l => l.trim()).filter(Boolean);
  const start = lines[0] && /이름/.test(lines[0]) ? 1 : 0;
  return lines.slice(start).map(line => {
    const [name, row] = line.split(',').map(s => (s ?? '').trim());
    return { name, row: row ? parseInt(row, 10) : null };
  }).filter(r => r.name);
}

/**
 * 엑셀에서 "CSV UTF-8"이 아니라 그냥 "CSV(쉼표로 분리)"로 저장하면, 한글
 * Windows 기준 EUC-KR(CP949)로 저장된다. file.text()는 항상 UTF-8로만
 * 읽어서 그 경우 한글이 마름모(◆) 같은 글자로 깨진다.
 *
 * UTF-8로 엄격하게(fatal) 디코딩해보고 실패하면 EUC-KR로 다시 읽는다 —
 * CP949로 인코딩된 한글 바이트열은 거의 항상 UTF-8 규칙을 어기므로
 * (연속 바이트 구조가 매우 엄격해서) 이 판별이 실제로 신뢰할 만하다.
 */
async function readRosterText(file) {
  const buf = await file.arrayBuffer();
  try {
    return new TextDecoder('utf-8', { fatal: true }).decode(buf);
  } catch {
    return new TextDecoder('euc-kr').decode(buf);
  }
}

async function uploadRosterFile(file) {
  const text = await readRosterText(file);
  const rows = parseRosterCsv(text);
  if (!rows.length) return toast('읽을 수 있는 이름이 없습니다');
  if (S.members.length && !confirm(`기존 명단 ${S.members.length}명을 지우고 ${rows.length}명으로 바꿀까요?`)) return;

  S.members = []; S.rowAssign = {};
  const rowCount = boardRows();
  let skipped = 0;
  rows.forEach(r => {
    const id = newId('m');
    S.members.push({ id, name: r.name });
    if (r.row != null) {
      const idx = r.row - 1;
      if (idx >= 0 && idx < rowCount) S.rowAssign[id] = idx; else skipped++;
    }
  });
  render();
  toast(`${rows.length}명 업로드 완료` + (skipped ? ` (줄 지정 ${skipped}건은 범위를 벗어나 무시됨)` : ''));
}

/* ---------- 배치 ---------- */
function doArrange() {
  if (!S.members.length) return toast('명단을 먼저 추가하세요');

  const res = arrange({
    seats: S.desks,
    members: S.members.map(m => ({ id: m.id, name: m.name })),
    seed: makeSeed(),
    rules: {
      rowRequired: S.rowAssign,
      avoidPairs: S.avoidPairs,
      avoidPrevSeat: S.avoidPrevSeat,
      avoidPrevNeighbor: S.avoidPrevMate,
      prev: S.prev,
    },
  });

  if (!res.ok) {
    return toast(res.reason === 'seat_shortage'
      ? `자리가 부족합니다 (${res.detail.members}명 / ${res.detail.seats}석)`
      : (res.detail?.hint || '규칙이 서로 충돌해 배정할 수 없습니다'));
  }

  S.prev = S.result?.placements ?? S.prev;
  S.result = res;
  closeSettings();
  render();
  toast(res.relaxed.length ? '배치 완료 (일부 규칙 완화)' : '배치 완료');
}

function redesign() {
  if (!confirm('배치를 초기화하고 다시 설계할까요?')) return;
  if (S.result) S.prev = S.result.placements;
  S.result = null;
  render();
}

/* ---------- 이름 공개 오버레이 ---------- */
let revealTimer = null;
function showReveal(name) {
  $('revealName').textContent = name;
  $('revealOverlay').classList.remove('hidden');
  requestAnimationFrame(() => $('revealOverlay').classList.add('show'));
  clearTimeout(revealTimer);
  revealTimer = setTimeout(hideReveal, 4000);
}
function hideReveal() {
  clearTimeout(revealTimer);
  $('revealOverlay').classList.remove('show');
  setTimeout(() => $('revealOverlay').classList.add('hidden'), 250);
}

/* ---------- 설정 패널 · 불러오기 대화상자 (scrim을 공유한다) ---------- */
function openSettings() {
  $('settingsPanel').classList.remove('hidden');
  $('scrim').classList.remove('hidden');
  requestAnimationFrame(() => { $('settingsPanel').classList.add('show'); $('scrim').classList.add('show'); });
}
function closeSettings() {
  $('settingsPanel').classList.remove('show');
  $('scrim').classList.remove('show');
  setTimeout(() => { $('settingsPanel').classList.add('hidden'); $('scrim').classList.add('hidden'); }, 260);
}

async function openLoad() {
  $('loadDialog').classList.remove('hidden');
  $('scrim').classList.remove('hidden');
  requestAnimationFrame(() => { $('loadDialog').classList.add('show'); $('scrim').classList.add('show'); });

  $('loadList').innerHTML = '<div class="empty">불러오는 중...</div>';
  try {
    const rooms = await listMyRooms();
    renderLoadList(rooms);
  } catch (e) {
    $('loadList').innerHTML = `<div class="empty">목록을 불러오지 못했습니다: ${esc(e.message)}</div>`;
  }
}
function closeLoad() {
  $('loadDialog').classList.remove('show');
  $('scrim').classList.remove('show');
  setTimeout(() => { $('loadDialog').classList.add('hidden'); $('scrim').classList.add('hidden'); }, 260);
}
function renderLoadList(rooms) {
  const el = $('loadList');
  const others = rooms.filter(r => r.id !== S.roomId);
  if (!others.length) { el.innerHTML = '<div class="empty">다른 저장된 좌석표가 없습니다.</div>'; return; }
  el.innerHTML = '';
  others.forEach(r => {
    const row = document.createElement('button');
    row.className = 'load-row';
    row.innerHTML = `<span class="lr-name">${esc(r.name)}</span><span class="lr-time">${relTime(r.updatedAt)}</span>`;
    row.onclick = () => { location.href = shareUrl(r.id); };
    el.appendChild(row);
  });
}
function relTime(ms) {
  if (!ms) return '';
  const min = Math.floor((Date.now() - ms) / 60000);
  if (min < 1) return '방금 전';
  if (min < 60) return `${min}분 전`;
  const hr = Math.floor(min / 60);
  if (hr < 24) return `${hr}시간 전`;
  return `${Math.floor(hr / 24)}일 전`;
}

/* ---------- 명시적 저장 ---------- */
async function saveNow() {
  clearTimeout(saveTimer);
  try {
    const id = await saveRoom(S.roomId, S);
    if (!S.roomId) { S.roomId = id; renderRoomBar(); }
    toast(`"${S.name || '이름 없는 좌석표'}" 저장했습니다`);
  } catch (e) {
    toast('저장 실패: ' + e.message);
  }
}

/* ---------- 전체화면(프로젝터) · 화면 반전 ---------- */
let inProjector = false;
async function toggleProjector() {
  inProjector = !inProjector;
  document.body.classList.toggle('projector', inProjector);
  try {
    if (inProjector) await document.documentElement.requestFullscreen?.();
    else if (document.fullscreenElement) await document.exitFullscreen?.();
  } catch { /* 전체화면 API가 막혀 있어도 projector 클래스만으로 충분히 커진다 */ }
}

/** 마주 앉은 사람에게 보드를 보여줄 때 쓴다 — 180도 돌려서 그 사람 기준으로 똑바로 보이게. */
function toggleFlip() {
  const on = !document.body.classList.contains('flipped');
  document.body.classList.toggle('flipped', on);
  localStorage.setItem('seatchange.flipped', on ? '1' : '0');
}

/* ---------- 배선 ---------- */
function bindSwitch(id, key) {
  const el = $(id);
  const flip = () => { S[key] = !S[key]; render(); };
  el.onclick = flip;
  el.onkeydown = e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); flip(); } };
}

async function init() {
  document.body.classList.add('loading');

  const dark = $('darkToggle');
  const setDark = on => { document.body.classList.toggle('dark', on); localStorage.setItem('seatchange.dark', on ? '1' : '0'); };
  setDark(localStorage.getItem('seatchange.dark') === '1');
  dark.onclick = () => setDark(!document.body.classList.contains('dark'));

  if (localStorage.getItem('seatchange.flipped') === '1') document.body.classList.add('flipped');

  addEventListener('keydown', e => { if (e.key === 'Escape') { hideReveal(); closeSettings(); closeLoad(); } });

  try {
    const opened = await openRoom();
    S.roomId = opened.roomId;
    S.isOwner = opened.isOwner;
    if (opened.data) applyLoadedData(opened.data);
    // 진짜 첫 방문(불러온 방 자체가 없음)일 때만 기본 책상을 깔아준다.
    // 이미 있는 방인데 desks가 비어 있다면, 소유자가 일부러 다 지운 것일
    // 수 있으므로 되살리지 않는다.
    if (!opened.data && S.isOwner) S.desks = makeGrid(5, 4); // 5줄 4분단
  } catch (e) {
    toast('저장소에 연결하지 못했습니다: ' + e.message);
  }
  document.body.classList.remove('loading');

  $('roomName').oninput = e => { S.name = e.target.value; renderRoomBar(); scheduleSave(); };
  $('btnSave').onclick = saveNow;
  $('btnShare').onclick = async () => {
    if (!S.roomId) return toast('먼저 저장을 한 번 눌러 주세요');
    try { await navigator.clipboard.writeText(shareUrl(S.roomId)); toast('공유 링크를 복사했습니다'); }
    catch { toast(shareUrl(S.roomId)); }
  };
  $('btnNewRoom').onclick = () => { location.href = location.pathname; };
  $('btnSettings').onclick = openSettings;
  $('btnClosePanel').onclick = closeSettings;
  $('btnLoad').onclick = openLoad;
  $('btnCloseLoad').onclick = closeLoad;
  $('btnNewRoomFromLoad').onclick = () => { location.href = location.pathname; };
  $('scrim').onclick = () => { closeSettings(); closeLoad(); };
  $('btnFlip').onclick = toggleFlip;

  $('rowPlus').onclick = addRow; $('rowMinus').onclick = removeRow;
  $('colPlus').onclick = addCol; $('colMinus').onclick = removeCol;

  $('quickName').onkeydown = e => {
    if (e.key !== 'Enter') return;
    addMember(e.target.value); e.target.value = '';
  };
  $('clearNames').onclick = () => {
    if (!S.members.length || !confirm('명단을 전부 지울까요?')) return;
    S.members = []; S.rowAssign = {}; S.avoidPairs = []; render();
  };
  $('btnTemplate').onclick = downloadTemplate;
  $('fileRoster').onchange = async e => {
    const file = e.target.files[0];
    e.target.value = '';
    if (file) await uploadRosterFile(file);
  };

  $('addAvoid').onclick = () => {
    const a = $('avoidA').value, b = $('avoidB').value;
    if (!a || !b) return toast('두 명을 고르세요');
    if (a === b) return toast('서로 다른 두 명을 고르세요');
    if (S.avoidPairs.some(p => p.includes(a) && p.includes(b))) return toast('이미 등록된 조합입니다');
    S.avoidPairs.push([a, b]); render();
  };

  bindSwitch('swSeat', 'avoidPrevSeat');
  bindSwitch('swMate', 'avoidPrevMate');

  $('btnArrange').onclick = doArrange;
  $('btnRedesign').onclick = redesign;
  $('btnPrint').onclick = () => { if (!S.result) return toast('먼저 배치를 시작하세요'); print(); };
  $('btnFullscreen').onclick = toggleProjector;
  document.addEventListener('fullscreenchange', () => {
    if (!document.fullscreenElement && inProjector) { inProjector = false; document.body.classList.remove('projector'); }
  });
  $('revealOverlay').onclick = hideReveal;

  paint();   // 로드된 상태를 반영만 하고, 곧바로 다시 저장을 트리거하지 않는다.
}

init();
