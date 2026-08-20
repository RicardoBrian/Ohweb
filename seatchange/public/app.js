/**
 * SeatChange — UI.
 * 배정 로직은 arrange.js에 있고, 이 파일은 상태 관리와 렌더링만 한다.
 *
 * 저장은 현재 localStorage. 기기 간 공유가 필요해지면 store 계층만
 * Firestore로 갈아끼우면 되도록 read/write를 한곳에 모아뒀다.
 */
import { arrange, makeGrid, makeSeed } from './arrange.js';

const $ = id => document.getElementById(id);
const KEY = 'seatchange.v1';

const S = {
  rows: 5, cols: 6, aisleEvery: 3,
  disabled: [],          // seatId[]
  members: [],           // {id, name, front}
  avoidPairs: [],        // [idA, idB][]
  avoidPrevSeat: false,
  avoidPrevMate: false,
  frontRows: 2,
  prev: null,            // 직전 배정 {seatId: memberId}
  result: null,          // {placements, seed, relaxed}
};

/* ---------- 저장 ---------- */
const save = () => { try { localStorage.setItem(KEY, JSON.stringify(S)); } catch {} };
function load() {
  try { Object.assign(S, JSON.parse(localStorage.getItem(KEY) || '{}')); } catch {}
}

/* ---------- 파생 ---------- */
function aisleAfter() {
  const out = [];
  if (S.aisleEvery > 1) for (let c = S.aisleEvery - 1; c < S.cols - 1; c += S.aisleEvery) out.push(c);
  return out;
}
const allSeats = () => makeGrid(S.rows, S.cols, { aisleAfter: aisleAfter() })
  .map(s => ({ ...s, disabled: S.disabled.includes(s.id) }));
const usableCount = () => allSeats().filter(s => !s.disabled).length;
const nameOf = id => S.members.find(m => m.id === id)?.name ?? '?';

/* ---------- 알림 ---------- */
let toastTimer;
function toast(msg) {
  const t = $('toast');
  t.textContent = msg; t.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => t.classList.remove('show'), 2400);
}

/* ---------- 렌더 ---------- */
function render() {
  const seats = usableCount(), people = S.members.length;
  $('statSeats').textContent = seats;
  $('statSub').textContent = people
    ? `${people}명 · ${seats - people >= 0 ? `${seats - people}자리 남음` : `${people - seats}자리 부족`}`
    : '명단을 입력하세요';

  $('banner').innerHTML = people > seats
    ? `<div class="banner">자리가 ${people - seats}개 부족합니다. 행·열을 늘리거나 명단을 줄이세요.</div>`
    : (S.result?.relaxed?.length
        ? `<div class="banner warn">규칙을 다 지킬 수 없어 일부를 완화했습니다: ${S.result.relaxed.map(labelOf).join(', ')}</div>` : '');

  renderRoster();
  renderFrontPicker();
  renderAvoid();
  renderResult();
  save();
}

const labelOf = r => ({ avoidPrevNeighbor: '직전과 다른 짝', avoidPrevSeat: '직전과 다른 자리', avoidPairs: '짝 금지' }[r] ?? r);

function renderRoster() {
  const el = $('roster');
  if (!S.members.length) { el.innerHTML = '<div class="empty">아직 명단이 없습니다.</div>'; return; }
  el.innerHTML = '';
  S.members.forEach(m => {
    const c = document.createElement('span');
    c.className = 'chip';
    c.innerHTML = `<span>${esc(m.name)}</span>
      <button class="x" title="삭제"><svg width="13" height="13"><use href="#ic-close"/></svg></button>`;
    c.querySelector('.x').onclick = () => { removeMember(m.id); };
    el.appendChild(c);
  });
}

function renderFrontPicker() {
  const el = $('frontPicker');
  if (!S.members.length) { el.innerHTML = '<div class="empty">명단을 먼저 입력하세요.</div>'; return; }
  el.innerHTML = '';
  S.members.forEach(m => {
    const b = document.createElement('button');
    b.className = 'chip' + (m.front ? ' tag-front' : '');
    b.style.cssText = 'padding:5px 12px;cursor:pointer;font-family:inherit;';
    if (m.front) b.style.color = 'var(--accent)';
    b.textContent = m.name;
    b.onclick = () => { m.front = !m.front; render(); };
    el.appendChild(b);
  });
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

/** 좌석 격자를 그린다. cellFn이 각 좌석에 들어갈 이름을 정한다. */
function paintGrid(container, placements, { clickable = false } = {}) {
  const seats = allSeats();
  const maxCol = Math.max(...seats.map(s => s.col), 0);
  container.style.gridTemplateColumns = `repeat(${maxCol + 1}, auto)`;
  container.innerHTML = '';

  const at = new Map(seats.map(s => [`${s.row}:${s.col}`, s]));
  for (let r = 0; r < S.rows; r++) {
    // 통로가 낀 col 번호는 건너뛰므로, 자리 번호는 줄마다 따로 1부터 센다.
    let n = 0;
    for (let c = 0; c <= maxCol; c++) {
      const seat = at.get(`${r}:${c}`);
      const d = document.createElement('div');
      if (!seat) { d.className = 'seat gap'; container.appendChild(d); continue; }
      n++;

      const who = placements?.[seat.id];
      d.className = 'seat' + (seat.disabled ? ' off' : '');
      d.dataset.seat = seat.id;
      d.innerHTML = `<span class="nm">${seat.disabled ? '사용 안 함' : (who ? esc(nameOf(who)) : '&nbsp;')}</span>
                     <span class="no">${r + 1}줄 ${n}번</span>`;
      if (clickable) d.onclick = () => toggleSeat(seat.id);
      container.appendChild(d);
    }
  }
}

function renderResult() {
  const has = !!S.result?.placements;
  $('resultCard').hidden = !has;
  $('emptyCard').hidden = has;
  if (!has) return;
  $('seedLabel').textContent = `seed ${S.result.seed}`;
  paintGrid($('grid'), S.result.placements, { clickable: true });
}

const esc = s => String(s).replace(/[&<>"]/g, ch => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[ch]));

/* ---------- 동작 ---------- */
function toggleSeat(id) {
  const i = S.disabled.indexOf(id);
  i < 0 ? S.disabled.push(id) : S.disabled.splice(i, 1);
  // 비활성화한 자리에 사람이 앉아 있었다면 배정을 무효로 둔다 (거짓 결과 방지).
  if (S.result?.placements?.[id]) { S.result = null; toast('좌석이 바뀌어 배정을 초기화했습니다'); }
  render();
}

function addMembers(text) {
  const names = text.split(/[\n,]/).map(s => s.trim()).filter(Boolean);
  if (!names.length) return toast('추가할 이름이 없습니다');
  names.forEach(name => S.members.push({ id: `m${Date.now()}${Math.random().toString(36).slice(2, 7)}`, name, front: false }));
  $('names').value = '';
  toast(`${names.length}명 추가`);
  render();
}

function removeMember(id) {
  S.members = S.members.filter(m => m.id !== id);
  S.avoidPairs = S.avoidPairs.filter(p => !p.includes(id));
  if (S.result?.placements && Object.values(S.result.placements).includes(id)) S.result = null;
  render();
}

function doArrange() {
  if (!S.members.length) return toast('명단을 먼저 입력하세요');

  const res = arrange({
    seats: allSeats(),
    members: S.members.map(m => ({ id: m.id, name: m.name })),
    seed: makeSeed(),
    rules: {
      frontRequired: S.members.filter(m => m.front).map(m => m.id),
      frontRows: S.frontRows,
      avoidPairs: S.avoidPairs,
      avoidPrevSeat: S.avoidPrevSeat,
      avoidPrevNeighbor: S.avoidPrevMate,
      prev: S.prev,
    },
  });

  if (!res.ok) {
    S.result = null; render();
    return toast(res.reason === 'seat_shortage'
      ? `자리가 부족합니다 (${res.detail.members}명 / ${res.detail.seats}석)`
      : '규칙이 서로 충돌해 배정할 수 없습니다');
  }

  S.prev = S.result?.placements ?? S.prev;   // 이번 결과 직전 것을 "지난번"으로
  S.result = res;
  render();
  toast(res.relaxed.length ? '배정 완료 (일부 규칙 완화)' : '배정 완료');
}

/* ---------- 뽑기 모드 ---------- */
const draw = { order: [], i: 0, shown: {} };

function openDraw() {
  if (!S.result?.placements) return toast('먼저 자리 배정을 하세요');
  draw.order = Object.entries(S.result.placements)
    .map(([seatId, mId]) => ({ seatId, mId }))
    .sort(() => Math.random() - 0.5);
  draw.i = 0; draw.shown = {};
  $('stage').classList.remove('hidden');
  updateDraw('준비', '준비되면 시작하세요');
}

function updateDraw(name, cap) {
  $('drawName').textContent = name;
  $('drawCap').textContent = cap;
  $('drawProgress').textContent = `${draw.i} / ${draw.order.length}`;
  paintGrid($('drawGrid'), draw.shown);
  const last = draw.order[draw.i - 1];
  if (last) $('drawGrid').querySelector(`[data-seat="${last.seatId}"]`)?.classList.add('landing');
  $('drawNext').disabled = draw.i >= draw.order.length;
}

function drawNext() {
  if (draw.i >= draw.order.length) return;
  const { seatId, mId } = draw.order[draw.i++];
  draw.shown[seatId] = mId;
  updateDraw(nameOf(mId), '방금 뽑힌 사람');
  if (draw.i >= draw.order.length) updateDraw('모두 배정됐습니다', `${draw.order.length}명 완료`);
}

/* ---------- 배선 ---------- */
function bindNumber(id, key, min, max) {
  $(id).value = S[key];
  $(id).oninput = e => {
    const v = Math.max(min, Math.min(max, +e.target.value || min));
    S[key] = v; S.result = null; render();
  };
}

function bindSwitch(id, key) {
  const el = $(id);
  const sync = () => el.classList.toggle('on', !!S[key]);
  const flip = () => { S[key] = !S[key]; sync(); save(); };
  el.onclick = flip;
  el.onkeydown = e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); flip(); } };
  sync();
}

function init() {
  load();

  bindNumber('rows', 'rows', 1, 12);
  bindNumber('cols', 'cols', 1, 12);
  bindNumber('frontRows', 'frontRows', 1, 6);
  $('aisle').value = String(S.aisleEvery || '');
  $('aisle').onchange = e => { S.aisleEvery = +e.target.value || 0; S.result = null; render(); };

  bindSwitch('swSeat', 'avoidPrevSeat');
  bindSwitch('swMate', 'avoidPrevMate');

  $('addNames').onclick = () => addMembers($('names').value);
  $('names').onkeydown = e => { if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) addMembers($('names').value); };
  $('clearNames').onclick = () => {
    if (!S.members.length || !confirm('명단을 전부 지울까요?')) return;
    S.members = []; S.avoidPairs = []; S.result = null; render();
  };

  $('addAvoid').onclick = () => {
    const a = $('avoidA').value, b = $('avoidB').value;
    if (!a || !b) return toast('두 명을 고르세요');
    if (a === b) return toast('서로 다른 두 명을 고르세요');
    if (S.avoidPairs.some(p => p.includes(a) && p.includes(b))) return toast('이미 등록된 조합입니다');
    S.avoidPairs.push([a, b]); render();
  };

  $('btnArrange').onclick = doArrange;
  $('btnPrint').onclick = () => { if (!S.result) return toast('먼저 자리 배정을 하세요'); print(); };
  $('btnDraw').onclick = openDraw;
  $('drawNext').onclick = drawNext;
  $('drawAll').onclick = () => { while (draw.i < draw.order.length) drawNext(); };
  $('drawExit').onclick = () => $('stage').classList.add('hidden');
  addEventListener('keydown', e => { if (e.key === 'Escape') $('stage').classList.add('hidden'); });

  const dark = $('darkToggle');
  const setDark = on => { document.body.classList.toggle('dark', on); localStorage.setItem('seatchange.dark', on ? '1' : '0'); };
  setDark(localStorage.getItem('seatchange.dark') === '1');
  dark.onclick = () => setDark(!document.body.classList.contains('dark'));

  render();
}

init();
