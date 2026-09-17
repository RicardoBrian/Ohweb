// ============================================================
//  OHtravel — app.js
// ============================================================

import {
  getFirestoreLite as getFirestore, collection, doc,
  addDoc, setDoc, updateDoc, deleteDoc,
  onSnapshot, serverTimestamp, getDoc,
  seedIfEmpty,
} from '../shared/firestore-lite.js';

const db = getFirestore('ohtravel-demo');

// 견본용 초기 여행 데이터 — 처음 열었을 때만 채워진다.
seedIfEmpty('ohtravel-demo', (s) => {
  const now = Date.now();
  s.put('trips', 'trip1', {
    title: '오사카·교토 5일', startDate: '2026-10-05', endDate: '2026-10-09',
    createdAt: { __ts: now - 86400000 },
  });
  s.put('trips/trip1/days', '2026-10-05', {
    accommodation: '오사카 난바 호텔', accommodationMap: '',
    todos: [{ text: '유심 수령', done: false }, { text: '숙소 체크인', done: false }],
  });
  s.put('trips/trip1/transports', 'tr1', {
    type: 'flight', fromCity: 'ICN', toCity: 'KIX',
    departDate: '2026-10-05', departTime: '09:00',
    arriveDate: '2026-10-05', arriveTime: '10:40',
    bookingNo: '', memo: '',
  });
});

// ══════════════════════════════════════
//  상수
// ══════════════════════════════════════
const TRANS_ICONS  = { flight:'✈️', train:'🚆', ship:'⛴️', bus:'🚌' };
const EXP_LABELS   = { food:'🍜 식비', transport:'🚌 교통', lodging:'🏨 숙박', sightseeing:'🎡 관광', shopping:'🛍️ 쇼핑', etc:'📦 기타' };
const EXP_KEYS     = ['food','transport','lodging','sightseeing','shopping','etc'];
const CURRENCIES   = { KRW:{s:'₩',n:'원'}, USD:{s:'$',n:'달러'}, JPY:{s:'¥',n:'엔'}, EUR:{s:'€',n:'유로'}, THB:{s:'฿',n:'바트'}, VND:{s:'₫',n:'동'}, SGD:{s:'S$',n:'싱가포르달러'}, GBP:{s:'£',n:'파운드'} };

const PACKING_TEMPLATES = {
  basic: ['여권','지갑 / 카드','핸드폰 충전기','이어폰','상비약','세면도구','선크림'],
  long:  ['여권','지갑 / 카드','핸드폰 충전기','이어폰','상비약','세면도구','선크림','노트북','어댑터','여분 의류','세탁 세제','비상금 (USD/EUR)','보조배터리'],
  biz:   ['여권','지갑 / 카드','명함','정장 / 비즈니스 캐주얼','노트북','충전기 세트','어댑터','보조배터리','상비약'],
};

const WC_EMOJI = {0:'☀️',1:'🌤️',2:'⛅',3:'☁️',45:'🌫️',48:'🌫️',51:'🌦️',53:'🌦️',55:'🌧️',61:'🌧️',63:'🌧️',65:'🌧️',71:'🌨️',73:'🌨️',75:'❄️',77:'❄️',80:'🌦️',81:'🌧️',82:'⛈️',85:'🌨️',86:'❄️',95:'⛈️',96:'⛈️',99:'⛈️'};

// IATA 공항코드 → 국기
const IATA_FLAGS = {
  ICN:'🇰🇷',GMP:'🇰🇷',PUS:'🇰🇷',CJU:'🇰🇷',RSU:'🇰🇷',KWJ:'🇰🇷',TAE:'🇰🇷',
  NRT:'🇯🇵',HND:'🇯🇵',KIX:'🇯🇵',ITM:'🇯🇵',CTS:'🇯🇵',FUK:'🇯🇵',OKA:'🇯🇵',NGO:'🇯🇵',SDJ:'🇯🇵',
  PEK:'🇨🇳',PKX:'🇨🇳',PVG:'🇨🇳',SHA:'🇨🇳',CAN:'🇨🇳',CTU:'🇨🇳',SZX:'🇨🇳',WUH:'🇨🇳',XIY:'🇨🇳',
  BKK:'🇹🇭',DMK:'🇹🇭',HKT:'🇹🇭',CNX:'🇹🇭',USM:'🇹🇭',KBV:'🇹🇭',HDY:'🇹🇭',
  SGN:'🇻🇳',HAN:'🇻🇳',DAD:'🇻🇳',PQC:'🇻🇳',VCA:'🇻🇳',
  SIN:'🇸🇬',
  CGK:'🇮🇩',DPS:'🇮🇩',SUB:'🇮🇩',MDC:'🇮🇩',LOP:'🇮🇩',PLM:'🇮🇩',
  KUL:'🇲🇾',PEN:'🇲🇾',LGK:'🇲🇾',BKI:'🇲🇾',KCH:'🇲🇾',
  MNL:'🇵🇭',CEB:'🇵🇭',KLO:'🇵🇭',ILO:'🇵🇭',DVO:'🇵🇭',
  TPE:'🇹🇼',TSA:'🇹🇼',KHH:'🇹🇼',TNN:'🇹🇼',
  HKG:'🇭🇰', MFM:'🇲🇴',
  DEL:'🇮🇳',BOM:'🇮🇳',BLR:'🇮🇳',MAA:'🇮🇳',CCU:'🇮🇳',HYD:'🇮🇳',
  KTM:'🇳🇵', CMB:'🇱🇰', MLE:'🇲🇻', DAC:'🇧🇩',
  PNH:'🇰🇭',REP:'🇰🇭', RGN:'🇲🇲',MDL:'🇲🇲', VTE:'🇱🇦', BWN:'🇧🇳',
  JFK:'🇺🇸',LAX:'🇺🇸',SFO:'🇺🇸',ORD:'🇺🇸',ATL:'🇺🇸',MIA:'🇺🇸',SEA:'🇺🇸',BOS:'🇺🇸',LAS:'🇺🇸',DFW:'🇺🇸',DEN:'🇺🇸',HNL:'🇺🇸',IAD:'🇺🇸',EWR:'🇺🇸',LGA:'🇺🇸',
  LHR:'🇬🇧',LGW:'🇬🇧',STN:'🇬🇧',MAN:'🇬🇧',EDI:'🇬🇧',BHX:'🇬🇧',
  CDG:'🇫🇷',ORY:'🇫🇷',NCE:'🇫🇷',LYS:'🇫🇷',MRS:'🇫🇷',
  FRA:'🇩🇪',MUC:'🇩🇪',BER:'🇩🇪',DUS:'🇩🇪',HAM:'🇩🇪',STR:'🇩🇪',CGN:'🇩🇪',
  FCO:'🇮🇹',MXP:'🇮🇹',VCE:'🇮🇹',NAP:'🇮🇹',PSA:'🇮🇹',BGY:'🇮🇹',BLQ:'🇮🇹',
  MAD:'🇪🇸',BCN:'🇪🇸',AGP:'🇪🇸',PMI:'🇪🇸',VLC:'🇪🇸',SVQ:'🇪🇸',
  AMS:'🇳🇱', ZRH:'🇨🇭',GVA:'🇨🇭', VIE:'🇦🇹', BRU:'🇧🇪',
  LIS:'🇵🇹',OPO:'🇵🇹', ATH:'🇬🇷',SKG:'🇬🇷',HER:'🇬🇷',RHO:'🇬🇷',CFU:'🇬🇷',
  IST:'🇹🇷',SAW:'🇹🇷',AYT:'🇹🇷',ADB:'🇹🇷',ESB:'🇹🇷',
  DXB:'🇦🇪',AUH:'🇦🇪',SHJ:'🇦🇪', DOH:'🇶🇦', RUH:'🇸🇦',JED:'🇸🇦',
  TLV:'🇮🇱', AMM:'🇯🇴', BEY:'🇱🇧', CAI:'🇪🇬',HRG:'🇪🇬',SSH:'🇪🇬',
  SYD:'🇦🇺',MEL:'🇦🇺',BNE:'🇦🇺',PER:'🇦🇺',ADL:'🇦🇺',CNS:'🇦🇺',
  AKL:'🇳🇿',CHC:'🇳🇿',WLG:'🇳🇿',
  YYZ:'🇨🇦',YVR:'🇨🇦',YUL:'🇨🇦',YYC:'🇨🇦',
  MEX:'🇲🇽',CUN:'🇲🇽',GDL:'🇲🇽',
  GRU:'🇧🇷',GIG:'🇧🇷',BSB:'🇧🇷',
  EZE:'🇦🇷',AEP:'🇦🇷',
  SVO:'🇷🇺',DME:'🇷🇺',LED:'🇷🇺',
  PRG:'🇨🇿', BUD:'🇭🇺', WAW:'🇵🇱',KRK:'🇵🇱',
  ARN:'🇸🇪',GOT:'🇸🇪', OSL:'🇳🇴', CPH:'🇩🇰', HEL:'🇫🇮',
  CMN:'🇲🇦',RAK:'🇲🇦', JNB:'🇿🇦',CPT:'🇿🇦', NBO:'🇰🇪', ADD:'🇪🇹',
  DAR:'🇹🇿',JRO:'🇹🇿',
};

const LS_TRIPS   = 'ohtravel_trips';
const LS_DAYS    = id => `ohtravel_days_${id}`;
const LS_TRANS   = id => `ohtravel_trans_${id}`;
const LS_WEATHER = id => `ohtravel_weather_${id}`;
const LS_FX      = 'ohtravel_fx';
const LS_CONFIG  = 'ohtravel_config';

// ══════════════════════════════════════
//  상태
// ══════════════════════════════════════
let isAuthed       = true; // 견본: 입장 코드 게이트 생략
let isAdminMode    = false;
let currentTripId  = null;
let isReadOnly     = false;
let isOnline       = navigator.onLine;
let unsubTrips     = null;
let unsubDays      = null;
let unsubTrans     = null;
let editingTransId = null;
let editingExpenses= [];
let currentTripRef = null;
let fxRates        = null;
let collapsedDays  = new Set();
let pendingDelete  = null;

// ══════════════════════════════════════
//  유틸
// ══════════════════════════════════════
const $ = id => document.getElementById(id);

function showToast(msg, withUndo = false) {
  const el = $('toast');
  $('toast-msg').textContent = msg;
  const undoBtn = $('toast-undo');
  undoBtn.style.display = withUndo ? '' : 'none';
  el.classList.add('show');
  clearTimeout(el._t);
  el._t = setTimeout(() => el.classList.remove('show'), withUndo ? 5000 : 2600);
}

window.undoDelete = function() {
  if (!pendingDelete) return;
  clearTimeout(pendingDelete.timerId);
  const p = pendingDelete; pendingDelete = null;
  $('toast').classList.remove('show');
  if (p.type === 'trip') {
    // Item still in localStorage — just re-render
    renderTripListFromCache();
    showToast('삭제 취소됨');
  } else if (p.type === 'transport') {
    // Restore to localStorage
    const list = JSON.parse(localStorage.getItem(LS_TRANS(p.tripId)) || '[]');
    list.push(p.data);
    localStorage.setItem(LS_TRANS(p.tripId), JSON.stringify(list));
    redrawTimeline(p.tripId);
    showToast('삭제 취소됨');
  }
};

function scheduleDelete(type, id, data, tripId) {
  if (pendingDelete) {
    clearTimeout(pendingDelete.timerId);
    executePendingDelete(pendingDelete);
  }
  const timerId = setTimeout(() => {
    executePendingDelete(pendingDelete);
    pendingDelete = null;
  }, 5000);
  pendingDelete = { type, id, data, tripId, timerId };
}

async function executePendingDelete(item) {
  if (!item) return;
  try {
    if (item.type === 'trip') {
      // Remove from localStorage
      const raw = localStorage.getItem(LS_TRIPS);
      if (raw) {
        const trips = JSON.parse(raw).filter(t => t.id !== item.id);
        localStorage.setItem(LS_TRIPS, JSON.stringify(trips));
      }
      await deleteDoc(doc(db, 'trips', item.id));
    } else if (item.type === 'transport') {
      await deleteDoc(doc(db, 'trips', item.tripId, 'transports', item.id));
    }
  } catch { /* 삭제 실패 무시 */ }
}

function escHtml(s) {
  return String(s ?? '').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;').replace(/'/g,'&#39;');
}

function autoLink(text) {
  const parts = String(text).split(/(https?:\/\/[^\s<>"']+)/g);
  return parts.map((part, i) =>
    i % 2 === 1
      ? `<a href="${escHtml(part)}" target="_blank" rel="noopener" class="auto-link">${escHtml(part)}</a>`
      : escHtml(part)
  ).join('');
}

function fmtDate(d) {
  if (!d) return '';
  return new Date(d+'T00:00:00').toLocaleDateString('ko-KR',{year:'numeric',month:'long',day:'numeric',weekday:'short'});
}
function fmtDateShort(d) {
  if (!d) return '';
  return new Date(d+'T00:00:00').toLocaleDateString('ko-KR',{month:'numeric',day:'numeric',weekday:'short'});
}
function fmtMoney(n) { return Number(n).toLocaleString('ko-KR') + '원'; }
function localDateStr(d) {
  const y = d.getFullYear(), m = String(d.getMonth()+1).padStart(2,'0'), day = String(d.getDate()).padStart(2,'0');
  return `${y}-${m}-${day}`;
}
function todayStr() { return localDateStr(new Date()); }
function isToday(d) { return d === todayStr(); }
function isPast(d)  { return d < todayStr(); }
function genId()    { return Math.random().toString(36).slice(2,10); }

function getAirportFlag(code) {
  if (!code) return '';
  const upper = code.trim().toUpperCase();
  return IATA_FLAGS[upper] ? IATA_FLAGS[upper] + ' ' : '';
}

function calcDDay(s, e) {
  const today = new Date(); today.setHours(0,0,0,0);
  const start = new Date(s+'T00:00:00'), end = new Date(e+'T00:00:00');
  if (today < start) return { label:`D-${Math.ceil((start-today)/86400000)}`, type:'upcoming' };
  if (today <= end)  return { label:`진행 중 ${Math.ceil((today-start)/86400000)+1}/${Math.ceil((end-start)/86400000)+1}일`, type:'ongoing' };
  return { label:'종료', type:'past' };
}

function generateDays(s, e) {
  const days = []; let cur = new Date(s+'T00:00:00'); const end = new Date(e+'T00:00:00'); let i = 1;
  while (cur <= end) { days.push({ date: localDateStr(cur), dayIndex: i++ }); cur.setDate(cur.getDate()+1); }
  return days;
}

// ── 환율 ──
async function loadFxRates() {
  const cached = localStorage.getItem(LS_FX);
  if (cached) { const p = JSON.parse(cached); if (p.expires > Date.now()) { fxRates = p.rates; return; } }
  try {
    const res = await fetch('https://open.er-api.com/v6/latest/USD');
    const data = await res.json();
    fxRates = data.rates;
    localStorage.setItem(LS_FX, JSON.stringify({ rates: fxRates, expires: Date.now() + 86400000 }));
  } catch { /* 환율 없이 진행 */ }
}

function toKRW(amount, currency) {
  if (!currency || currency === 'KRW' || !fxRates) return Number(amount);
  const usd = Number(amount) / (fxRates[currency] || 1);
  return Math.round(usd * (fxRates['KRW'] || 1300));
}

function fmtExpenseAmount(amount, currency) {
  const c = CURRENCIES[currency] || CURRENCIES.KRW;
  if (!currency || currency === 'KRW') return fmtMoney(amount);
  const krw = toKRW(amount, currency);
  return `${c.s}${Number(amount).toLocaleString()} <span class="expense-krw">(≈${fmtMoney(krw)})</span>`;
}

// ══════════════════════════════════════
//  접근 제어
// ══════════════════════════════════════
async function getAccessConfig() {
  // Try Firestore, fallback to localStorage cache, then defaults
  try {
    const snap = await getDoc(doc(db, 'config', 'access'));
    const cfg = snap.exists() ? snap.data() : {};
    const result = {
      entryCode:     cfg.entryCode     || 'demo',
      adminPassword: cfg.adminPassword || 'demo',
    };
    localStorage.setItem(LS_CONFIG, JSON.stringify(result));
    return result;
  } catch {
    const cached = localStorage.getItem(LS_CONFIG);
    if (cached) return JSON.parse(cached);
    return { entryCode: 'demo', adminPassword: 'demo' };
  }
}

function showEntryScreen() {
  $('screen-entry').classList.remove('hidden');
}
function hideEntryScreen() {
  $('screen-entry').classList.add('hidden');
}

async function handleEntrySubmit() {
  const code = $('inp-entry-code').value.trim();
  if (!code) return;
  const cfg = await getAccessConfig();
  if (code === cfg.entryCode) {
    sessionStorage.setItem('ohtravel_authed', '1');
    isAuthed = true;
    hideEntryScreen();
    boot();
  } else {
    $('entry-error').style.display = '';
    $('inp-entry-code').value = '';
    $('inp-entry-code').focus();
    setTimeout(() => { $('entry-error').style.display = 'none'; }, 3000);
  }
}

// ── 관리자 인증 ──
function openAdminAuth() {
  $('inp-admin-password').value = '';
  $('admin-auth-error').style.display = 'none';
  $('modal-admin-auth').classList.add('open');
  setTimeout(() => $('inp-admin-password').focus(), 100);
}

async function verifyAdmin() {
  const pw = $('inp-admin-password').value.trim();
  const cfg = await getAccessConfig();
  if (pw === cfg.adminPassword) {
    $('modal-admin-auth').classList.remove('open');
    isAdminMode = true;
    $('inp-new-entry-code').value   = '';
    $('inp-new-admin-pw').value     = '';
    $('modal-admin-panel').classList.add('open');
  } else {
    $('admin-auth-error').style.display = '';
    $('inp-admin-password').value = '';
    setTimeout(() => { $('admin-auth-error').style.display = 'none'; }, 3000);
  }
}

async function saveAdminSettings() {
  const newCode = $('inp-new-entry-code').value.trim();
  const newPw   = $('inp-new-admin-pw').value.trim();
  if (!newCode && !newPw) { showToast('변경할 내용을 입력하세요'); return; }
  const cfg = await getAccessConfig();
  const updated = {
    entryCode:     newCode || cfg.entryCode,
    adminPassword: newPw   || cfg.adminPassword,
  };
  try {
    await setDoc(doc(db, 'config', 'access'), updated);
    localStorage.setItem(LS_CONFIG, JSON.stringify(updated));
    $('modal-admin-panel').classList.remove('open');
    showToast('설정 저장됨 ✓');
  } catch(err) {
    showToast('저장 실패: ' + (err?.message || err));
  }
}

// ══════════════════════════════════════
//  다크 모드 & 온라인
// ══════════════════════════════════════
function initDarkToggle() {
  const ne = $('nav-end');
  // Remove existing toggle if any
  ne.querySelectorAll('.dark-toggle').forEach(el => el.remove());
  const t = document.createElement('div'); t.className = 'dark-toggle'; t.title = '다크모드';
  t.onclick = () => { document.body.classList.toggle('dark'); localStorage.setItem('ohtravel_dark', document.body.classList.contains('dark')?'1':'0'); };
  ne.appendChild(t);
  if (localStorage.getItem('ohtravel_dark') === '1') document.body.classList.add('dark');
}
window.addEventListener('online',  () => { isOnline = true;  const b=$('offline-banner'); if(b) b.style.display='none'; });
window.addEventListener('offline', () => { isOnline = false; const b=$('offline-banner'); if(b) b.style.display='block'; });

// ══════════════════════════════════════
//  라우팅
// ══════════════════════════════════════
function parseURL() { const p = new URLSearchParams(location.search); return { tripId: p.get('tripId'), view: p.get('view') }; }
function navigate(tripId, shareMode=false) {
  history.pushState({}, '', tripId ? `?tripId=${tripId}${shareMode?'&view=share':''}` : '?');
  boot();
}
window.addEventListener('popstate', boot);
function boot() {
  if (!isAuthed) { showEntryScreen(); return; }
  hideEntryScreen();
  const { tripId, view } = parseURL();
  isReadOnly = view === 'share';
  if (tripId) { currentTripId = tripId; showTimelineView(tripId); }
  else        { currentTripId = null; isReadOnly = false; showDashboardView(); }
}

// ══════════════════════════════════════
//  대시보드
// ══════════════════════════════════════
function showDashboardView() {
  $('view-dashboard').style.display = ''; $('view-timeline').style.display = 'none';
  initDarkToggle();
  if (unsubDays)  { unsubDays();  unsubDays  = null; }
  if (unsubTrans) { unsubTrans(); unsubTrans = null; }
  if (!isOnline) { $('offline-banner').style.display='block'; renderTripListFromCache(); }
  else           { $('offline-banner').style.display='none';  listenTrips(); }
}

function listenTrips() {
  if (unsubTrips) { unsubTrips(); unsubTrips = null; }
  $('trip-list').innerHTML = [1,2].map(()=>`<div class="skeleton" style="height:120px;"></div>`).join('');
  unsubTrips = onSnapshot(collection(db,'trips'), snap => {
    const trips = []; snap.forEach(d => trips.push({id:d.id,...d.data()}));
    trips.sort((a,b) => (a.startDate||'').localeCompare(b.startDate||''));
    localStorage.setItem(LS_TRIPS, JSON.stringify(trips));
    renderTripList(trips);
  }, () => renderTripListFromCache());
}

function renderTripListFromCache() { const r = localStorage.getItem(LS_TRIPS); renderTripList(r ? JSON.parse(r) : []); }

function renderTripList(trips) {
  const list = $('trip-list'), empty = $('trip-list-empty');
  list.innerHTML = '';
  if (!trips?.length) { empty.style.display = ''; return; }
  empty.style.display = 'none';
  trips.forEach(trip => {
    const dd = calcDDay(trip.startDate, trip.endDate);
    const budgetBadge = trip.budget ? `<span class="badge neutral">예산 ${fmtMoney(trip.budget)}</span>` : '';
    const card = document.createElement('div');
    card.className = 'trip-card';
    card.innerHTML = `
      <div class="trip-card-header">
        <div class="trip-card-title">${escHtml(trip.title||'제목 없음')}</div>
        <div class="trip-card-dday ${dd.type}">${dd.label}</div>
      </div>
      <div class="trip-card-date">${fmtDate(trip.startDate)} ~ ${fmtDate(trip.endDate)}</div>
      ${budgetBadge ? `<div>${budgetBadge}</div>` : ''}
      <div class="trip-card-actions">
        <button class="btn sm icon-btn btn-packing-card" data-id="${trip.id}">🎒 준비물</button>
        <button class="btn sm icon-btn btn-dup-card" data-id="${trip.id}">📋 복제</button>
        <button class="btn sm icon-btn btn-share-card" data-id="${trip.id}">🔗 공유</button>
        <button class="btn sm danger btn-del-trip" data-id="${trip.id}">삭제</button>
      </div>`;
    card.addEventListener('click', e => {
      if (e.target.closest('.btn-packing-card,.btn-dup-card,.btn-share-card,.btn-del-trip')) return;
      navigate(trip.id);
    });
    card.querySelector('.btn-packing-card').addEventListener('click', e => {
      e.stopPropagation();
      currentTripRef = trip; currentTripId = trip.id;
      openPackingModal(trip.id);
    });
    card.querySelector('.btn-dup-card').addEventListener('click', e => {
      e.stopPropagation();
      duplicateTrip(trip);
    });
    card.querySelector('.btn-share-card').addEventListener('click', e => {
      e.stopPropagation();
      const url = `${location.origin}${location.pathname}?tripId=${trip.id}&view=share`;
      navigator.clipboard.writeText(url).then(() => showToast('공유 링크 복사됨'));
    });
    card.querySelector('.btn-del-trip').addEventListener('click', async e => {
      e.stopPropagation();
      if (!confirm(`"${trip.title}" 여행을 삭제할까요?`)) return;
      // Optimistically remove card from DOM
      card.style.display = 'none';
      scheduleDelete('trip', trip.id, trip, null);
      showToast(`"${escHtml(trip.title)}" 삭제됨`, true);
    });
    list.appendChild(card);
  });
}

// ── 여행 복제 ──
async function duplicateTrip(trip) {
  try {
    await addDoc(collection(db,'trips'), {
      title:     (trip.title || '여행') + ' (복사)',
      startDate: trip.startDate,
      endDate:   trip.endDate,
      budget:    trip.budget || 0,
      createdAt: serverTimestamp(),
    });
    showToast('여행 복제됨 ✓');
  } catch(err) { showToast('복제 실패: ' + (err?.message||err)); }
}

// ── 새 여행 등록 ──
function openNewTripModal() {
  $('inp-trip-title').value = $('inp-trip-start').value = $('inp-trip-end').value = '';
  $('modal-new-trip').classList.add('open');
  setTimeout(() => $('inp-trip-title').focus(), 100);
}
async function saveNewTrip() {
  const title = $('inp-trip-title').value.trim(), start = $('inp-trip-start').value, end = $('inp-trip-end').value;
  if (!title)       { showToast('여행 제목을 입력하세요'); return; }
  if (!start||!end) { showToast('날짜를 입력하세요'); return; }
  if (start > end)  { showToast('종료일이 시작일보다 빠릅니다'); return; }
  try {
    const ref = await addDoc(collection(db,'trips'), {title, startDate:start, endDate:end, createdAt:serverTimestamp()});
    $('modal-new-trip').classList.remove('open');
    showToast('여행이 등록되었습니다 🎉');
    navigate(ref.id);
  } catch(err) { showToast(`등록 실패: ${err?.message||err}`); }
}

// ── 여행 편집 ──
function openEditTripModal(tripId) {
  $('inp-edit-trip-title').value = currentTripRef?.title || '';
  $('inp-edit-trip-start').value = currentTripRef?.startDate || '';
  $('inp-edit-trip-end').value   = currentTripRef?.endDate   || '';
  $('btn-save-edit-trip').onclick = () => saveEditTrip(tripId);
  $('modal-edit-trip').classList.add('open');
}
async function saveEditTrip(tripId) {
  const title = $('inp-edit-trip-title').value.trim();
  const start = $('inp-edit-trip-start').value;
  const end   = $('inp-edit-trip-end').value;
  if (!title)       { showToast('제목을 입력하세요'); return; }
  if (!start||!end) { showToast('날짜를 입력하세요'); return; }
  if (start > end)  { showToast('종료일이 시작일보다 빠릅니다'); return; }
  $('modal-edit-trip').classList.remove('open');
  currentTripRef = { ...currentTripRef, title, startDate:start, endDate:end };
  $('trip-title-display').textContent = title;
  $('trip-date-range').textContent = `${fmtDate(start)} ~ ${fmtDate(end)}`;
  const raw = localStorage.getItem(LS_TRIPS);
  if (raw) { const trips = JSON.parse(raw).map(t => t.id===tripId ? {...t,title,startDate:start,endDate:end} : t); localStorage.setItem(LS_TRIPS, JSON.stringify(trips)); }
  try { await updateDoc(doc(db,'trips',tripId), {title, startDate:start, endDate:end}); showToast('여행 정보 저장됨 ✓'); }
  catch { showToast('오프라인 — 로컬 저장됨'); }
  const dayData   = JSON.parse(localStorage.getItem(LS_DAYS(tripId)) || '{}');
  const transData = JSON.parse(localStorage.getItem(LS_TRANS(tripId)) || '[]');
  const weather   = JSON.parse(localStorage.getItem(LS_WEATHER(tripId)) || '{}');
  renderTimeline(generateDays(start, end), dayData, transData, weather, tripId);
  updateBudgetBar(currentTripRef, dayData);
}

// ══════════════════════════════════════
//  타임라인 뷰
// ══════════════════════════════════════
async function showTimelineView(tripId) {
  $('view-dashboard').style.display = 'none'; $('view-timeline').style.display = '';
  initDarkToggle();
  if (unsubTrips) { unsubTrips(); unsubTrips = null; }

  let trip = null;
  if (isOnline) { try { const s = await getDoc(doc(db,'trips',tripId)); if (s.exists()) trip = {id:s.id,...s.data()}; } catch {} }
  if (!trip)    { const r = localStorage.getItem(LS_TRIPS); trip = r ? JSON.parse(r).find(t=>t.id===tripId) : null; }
  if (!trip)    { $('trip-title-display').textContent = '여행을 찾을 수 없습니다'; return; }

  currentTripRef = trip;
  $('trip-title-display').textContent = trip.title || '제목 없음';
  $('trip-date-range').textContent = `${fmtDate(trip.startDate)} ~ ${fmtDate(trip.endDate)}`;

  const editTripBtn = $('btn-edit-trip');

  if (isReadOnly) {
    $('btn-back').style.display = 'none';
    editTripBtn.style.display   = 'none';
    $('timeline-header-actions').innerHTML = `<div class="readonly-banner">🔒 읽기 전용 공유 모드</div>`;
    $('timeline-sidebar').innerHTML = '';
  } else {
    $('btn-back').style.display = '';
    editTripBtn.style.display   = '';
    editTripBtn.onclick = () => openEditTripModal(tripId);

    const actionBtnsHtml = `
      <button class="btn sm" data-action="transport">✈️ 교통 등록</button>
      <button class="btn sm" data-action="bulk-accom">🏨 숙소 일괄</button>
      <button class="btn sm" data-action="packing">🎒 준비물</button>
      <button class="btn sm" data-action="budget">💰 예산 설정</button>
      <button class="btn sm" data-action="stats">📊 통계</button>
      <button class="btn sm" data-action="share">🔗 공유</button>
      <button class="btn sm" data-action="print">🖨️ 인쇄</button>`;

    $('timeline-header-actions').innerHTML = actionBtnsHtml;
    $('timeline-sidebar').innerHTML = actionBtnsHtml;

    const bindActions = container => {
      container.addEventListener('click', e => {
        const btn = e.target.closest('[data-action]');
        if (!btn) return;
        const a = btn.dataset.action;
        if      (a==='transport')  openTransportModal(null, tripId);
        else if (a==='bulk-accom') openBulkAccomModal(tripId);
        else if (a==='packing')    openPackingModal(tripId);
        else if (a==='budget')     openBudgetModal(tripId);
        else if (a==='stats')      openStatsModal(tripId);
        else if (a==='share') {
          const url = `${location.origin}${location.pathname}?tripId=${tripId}&view=share`;
          navigator.clipboard.writeText(url).then(() => showToast('공유 링크 복사됨'));
        }
        else if (a==='print') window.print();
      });
    };
    bindActions($('timeline-header-actions'));
    bindActions($('timeline-sidebar'));
  }

  const days = generateDays(trip.startDate, trip.endDate);
  if (!isOnline) {
    const dayData   = JSON.parse(localStorage.getItem(LS_DAYS(tripId)) || '{}');
    const transData = JSON.parse(localStorage.getItem(LS_TRANS(tripId)) || '[]');
    const weather   = JSON.parse(localStorage.getItem(LS_WEATHER(tripId)) || '{}');
    renderTimeline(days, dayData, transData, weather, tripId);
    updateBudgetBar(trip, dayData);
  } else {
    listenTimeline(tripId, days, trip);
  }
}

function listenTimeline(tripId, days, trip) {
  if (unsubDays)  { unsubDays();  unsubDays  = null; }
  if (unsubTrans) { unsubTrans(); unsubTrans = null; }
  $('timeline-list').innerHTML = days.slice(0,3).map(()=>`<div class="skeleton" style="height:130px;margin-bottom:16px;"></div>`).join('');
  let dayData = {}, transData = [];
  const weather = JSON.parse(localStorage.getItem(LS_WEATHER(tripId)) || '{}');
  const redraw = () => { renderTimeline(days, dayData, transData, weather, tripId); updateBudgetBar(trip, dayData); };

  unsubDays = onSnapshot(collection(db,'trips',tripId,'days'), snap => {
    dayData = {}; snap.forEach(d => { dayData[d.id] = d.data(); });
    localStorage.setItem(LS_DAYS(tripId), JSON.stringify(dayData));
    redraw();
    fetchWeatherForTrip(trip, dayData, tripId).then(w => { Object.assign(weather, w); localStorage.setItem(LS_WEATHER(tripId), JSON.stringify(weather)); redraw(); });
  }, () => { dayData = JSON.parse(localStorage.getItem(LS_DAYS(tripId))||'{}'); redraw(); });

  unsubTrans = onSnapshot(collection(db,'trips',tripId,'transports'), snap => {
    transData = []; snap.forEach(d => transData.push({id:d.id,...d.data()}));
    // 시간순 정렬
    transData.sort((a,b) => {
      const da = (a.departDate||'') + (a.departTime||'');
      const db2 = (b.departDate||'') + (b.departTime||'');
      return da.localeCompare(db2);
    });
    localStorage.setItem(LS_TRANS(tripId), JSON.stringify(transData));
    redraw();
  }, () => { transData = JSON.parse(localStorage.getItem(LS_TRANS(tripId))||'[]'); redraw(); });
}

function redrawTimeline(tripId) {
  if (!currentTripRef) return;
  const dayData   = JSON.parse(localStorage.getItem(LS_DAYS(tripId)) || '{}');
  const transData = JSON.parse(localStorage.getItem(LS_TRANS(tripId)) || '[]');
  const weather   = JSON.parse(localStorage.getItem(LS_WEATHER(tripId)) || '{}');
  renderTimeline(generateDays(currentTripRef.startDate, currentTripRef.endDate), dayData, transData, weather, tripId);
  updateBudgetBar(currentTripRef, dayData);
}

// ── 예산 바 ──
function updateBudgetBar(trip, dayData) {
  const budget = trip?.budget || 0;
  const spent  = calcTotalSpentKRW(dayData);
  if (!budget) { $('budget-bar-wrap').style.display = 'none'; return; }
  $('budget-bar-wrap').style.display = '';
  const pct = Math.min(Math.round(spent/budget*100), 100);
  $('budget-label-spent').textContent = `지출 ${fmtMoney(spent)}`;
  $('budget-label-total').textContent = `예산 ${fmtMoney(budget)}`;
  const fill = $('budget-bar-fill'); fill.style.width = pct+'%'; fill.classList.toggle('over', spent > budget);
}

function calcTotalSpentKRW(dayData) {
  return Object.values(dayData).reduce((sum, d) =>
    sum + (d.expenses||[]).reduce((s,e) => s + toKRW(e.amount, e.currency), 0), 0);
}

// ══════════════════════════════════════
//  날짜 카드 렌더
// ══════════════════════════════════════
function renderTimeline(days, dayData, transData, weather, tripId) {
  const container = $('timeline-list'); container.innerHTML = '';
  const today = todayStr();

  // 숙소 미정 요약
  renderMissingAccomSummary(days, dayData);

  // 날짜 이동 드롭다운
  renderDateJump(days);

  days.forEach(({ date, dayIndex }) => {
    const data     = dayData[date] || {};
    // Transport: filter and sort by departDate, then departTime
    const dayTrans = transData
      .filter(t => t.departDate <= date && t.arriveDate >= date)
      .sort((a,b) => ((a.departDate||'')+(a.departTime||'')).localeCompare((b.departDate||'')+(b.departTime||'')));

    const w = weather[data.city]?.[date];

    const wrapper = document.createElement('div');
    wrapper.className = 'day-row';

    const dot = document.createElement('div');
    dot.className = `timeline-dot${isToday(date)?' today-dot':isPast(date)?' past-dot':''}`;
    wrapper.appendChild(dot);
    wrapper.appendChild(buildDayCard(date, dayIndex, data, dayTrans, w, tripId));
    container.appendChild(wrapper);
  });

  // 오늘 카드로 스크롤
  const todayCard = container.querySelector(`#day-${today}`);
  if (todayCard) setTimeout(() => todayCard.scrollIntoView({behavior:'smooth',block:'start'}), 300);
}

function renderMissingAccomSummary(days, dayData) {
  const el = $('accom-missing-summary');
  if (isReadOnly) { el.innerHTML = ''; return; }
  const today = todayStr();
  const missing = days.filter(d => d.date >= today && !dayData[d.date]?.accommodation);
  if (!missing.length) { el.innerHTML = ''; return; }
  const preview = missing.slice(0,3).map(d => fmtDateShort(d.date)).join(', ');
  const more = missing.length > 3 ? ` 외 ${missing.length-3}건` : '';
  el.innerHTML = `<div class="missing-accom-banner" title="클릭 시 첫 미정 날짜로 이동">🏨 숙소 미정 <strong>${missing.length}일</strong> — ${preview}${more}</div>`;
  el.querySelector('.missing-accom-banner').onclick = () => {
    const card = document.getElementById(`day-${missing[0].date}`);
    if (card) card.scrollIntoView({behavior:'smooth',block:'start'});
  };
}

function renderDateJump(days) {
  const wrap = $('date-jump-wrap');
  if (days.length < 5) { wrap.innerHTML = ''; return; }
  const select = document.createElement('select');
  select.className = 'inp date-jump-select';
  select.innerHTML = `<option value="">📅 날짜 이동...</option>` +
    days.map(d => `<option value="${d.date}">Day ${d.dayIndex} · ${fmtDateShort(d.date)}</option>`).join('');
  select.onchange = () => {
    if (!select.value) return;
    const card = document.getElementById(`day-${select.value}`);
    if (card) card.scrollIntoView({behavior:'smooth',block:'start'});
    setTimeout(() => { select.value = ''; }, 100);
  };
  wrap.innerHTML = '';
  wrap.appendChild(select);
}

function buildDayCard(date, dayIndex, data, dayTrans, weather, tripId) {
  const card = document.createElement('div');
  const hasMissingAccom = !data.accommodation;
  const isTravelDay = dayTrans.some(t => t.departDate === date || t.arriveDate === date);
  const isCollapsed = collapsedDays.has(date);

  let cls = 'day-card';
  if (isToday(date)) cls += ' today';
  if (isTravelDay)   cls += ' travel-day';
  if (hasMissingAccom && !isReadOnly) cls += ' missing-accom';
  if (isCollapsed)   cls += ' collapsed';
  card.className = cls;
  card.id = `day-${date}`;

  // 헤더
  const cityTag      = data.city ? `<span class="city-tag">📍 ${escHtml(data.city)}</span>` : '';
  const weatherBadge = weather
    ? `<span class="weather-badge">${WC_EMOJI[weather.code]||'🌡️'} ${weather.max}° / ${weather.min}°</span>`
    : (data.city ? '' : '');
  const missingBadge = hasMissingAccom && !isReadOnly
    ? `<span class="missing-accom-badge">숙소 미입력</span>` : '';
  const editBtn = isReadOnly ? '' : `<button class="btn sm icon-btn day-edit-btn" onclick="openEditModal('${date}','${tripId}')">편집</button>`;
  const collapseBtn = `<button class="btn sm icon-btn collapse-btn" onclick="toggleDayCollapse('${date}',event)">${isCollapsed?'▼':'▲'}</button>`;

  const themeHtml = data.theme
    ? `<div class="day-theme-display">✨ ${escHtml(data.theme)}</div>` : '';

  // 교통
  const transHtml = dayTrans.length
    ? dayTrans.map(t => {
        const isDepart = t.departDate===date, isArrive = t.arriveDate===date;
        const badge = (!isDepart&&!isArrive) ? '<span class="transit-day-badge">이동 중</span>' : '';
        const timeStr = [
          isDepart&&t.departTime?`출발 ${t.departTime}`:'',
          isArrive&&t.arriveTime?`도착 ${t.arriveTime}`:''
        ].filter(Boolean).join(' / ');
        const fromFlag = getAirportFlag(t.fromCity);
        const toFlag   = getAirportFlag(t.toCity);
        const editBtn2 = isReadOnly?'':
          `<button class="btn sm icon-btn" onclick="openTransportModal('${t.id}','${tripId}')">편집</button>` +
          `<button class="btn sm danger" onclick="deleteTransport('${t.id}','${tripId}')">삭제</button>`;
        return `
          <div class="transport-item">
            <div class="transport-route">${TRANS_ICONS[t.type]||'🚗'} <b>${fromFlag}${escHtml(t.fromCity||'?')}</b><span class="arrow">→</span><b>${toFlag}${escHtml(t.toCity||'?')}</b>${badge}</div>
            ${timeStr?`<div class="transport-meta">🕐 ${timeStr}</div>`:''}
            ${t.bookingNo?`<div class="transport-booking">📋 ${escHtml(t.bookingNo)}</div>`:''}
            ${t.memo?`<div class="transport-booking" style="color:var(--text-2)">💬 ${escHtml(t.memo)}</div>`:''}
            <div class="transport-actions">
              <button class="btn sm icon-btn" onclick="copyTransport('${escHtml(t.fromCity||'')}','${escHtml(t.toCity||'')}','${escHtml(t.bookingNo||'')}')">복사</button>
              ${editBtn2}
            </div>
          </div>`;
      }).join('')
    : `<div class="t-cap" style="color:var(--text-3);font-style:italic;">등록된 교통 없음</div>`;

  // 숙소
  let accomHtml = `<div class="t-cap" style="color:var(--text-3);font-style:italic;">미정</div>`;
  if (data.accommodation) {
    const mapBtn = data.accommodationMap ? ` <a href="${escHtml(data.accommodationMap)}" target="_blank" rel="noopener" class="accom-link">🗺 지도</a>` : '';
    accomHtml = `<div class="accom-row">${escHtml(data.accommodation)}${mapBtn}</div>`;
  }

  // 지출
  const expenses = data.expenses || [];
  const expTotalKRW = expenses.reduce((s,e) => s+toKRW(e.amount,e.currency), 0);
  const expHtml = expenses.length
    ? `<div class="expense-list">${expenses.map(e=>`
        <div class="expense-row">
          <span class="expense-cat">${EXP_LABELS[e.category]||e.category}</span>
          <span class="expense-name">${escHtml(e.name)}</span>
          <span class="expense-amount">${fmtExpenseAmount(e.amount,e.currency)}</span>
        </div>`).join('')}</div><div class="expense-total">합계 ${fmtMoney(expTotalKRW)}</div>`
    : `<div class="t-cap" style="color:var(--text-3);font-style:italic;">지출 없음</div>`;

  // 메모 (자동 링크)
  const memoHtml = data.memo
    ? `<div class="memo-box">${autoLink(data.memo)}</div>`
    : `<div class="t-cap" style="color:var(--text-3);font-style:italic;">메모 없음</div>`;

  // To-Do
  const todos     = data.todos || [];
  const todoClass = isReadOnly ? 'class="todo-list readonly-todos"' : 'class="todo-list"';
  const todoItems = todos.map((todo,i) => `
    <li class="todo-item${todo.done?' done':''}" id="td-${date}-${i}">
      <input type="checkbox" ${todo.done?'checked':''} ${isReadOnly?'disabled':''}
        onchange="toggleTodo('${tripId}','${date}',${i},this.checked)" />
      <label>${escHtml(todo.text)}</label>
    </li>`).join('');
  const addTodoRow = isReadOnly ? '' : `
    <div class="todo-add-row">
      <input class="todo-add-inp" id="ti-${date}" placeholder="할 일 추가..."
        onkeydown="if(event.key==='Enter')addTodo('${tripId}','${date}')" />
      <button class="btn sm icon-btn" onclick="addTodo('${tripId}','${date}')">+</button>
    </div>`;

  // 요약 줄 (접힌 상태)
  const summaryParts = [
    data.city || '도시 미정',
    data.accommodation ? data.accommodation : '숙소 미정',
    dayTrans.length ? `교통 ${dayTrans.length}건` : '',
    expenses.length ? `지출 ${fmtMoney(expTotalKRW)}` : '',
  ].filter(Boolean);

  card.innerHTML = `
    <div class="day-card-header" onclick="toggleDayCollapse('${date}',event)">
      <div class="day-label-group">
        <span class="day-label">Day ${dayIndex}</span>
        <span class="day-label-date">${fmtDateShort(date)}</span>
        ${cityTag}${weatherBadge}${missingBadge}
      </div>
      <div class="day-header-actions" onclick="event.stopPropagation()">
        ${editBtn}
        ${collapseBtn}
      </div>
    </div>
    ${themeHtml}
    <div class="day-card-summary">${summaryParts.join(' · ')}</div>
    <div class="day-sections">
      <div class="day-section"><div class="day-section-label">✈️ 교통</div>${transHtml}</div>
      <div class="day-section"><div class="day-section-label">🏨 숙소</div>${accomHtml}</div>
      <div class="day-section"><div class="day-section-label">💰 지출</div>${expHtml}</div>
      <div class="day-section"><div class="day-section-label">📝 메모</div>${memoHtml}</div>
      <div class="day-section"><div class="day-section-label">✅ To-Do</div><ul ${todoClass}>${todoItems}</ul>${addTodoRow}</div>
    </div>`;
  return card;
}

window.toggleDayCollapse = function(date, e) {
  if (e) e.stopPropagation();
  const card = document.getElementById(`day-${date}`);
  if (!card) return;
  if (collapsedDays.has(date)) collapsedDays.delete(date);
  else collapsedDays.add(date);
  card.classList.toggle('collapsed', collapsedDays.has(date));
  const btn = card.querySelector('.collapse-btn');
  if (btn) btn.textContent = collapsedDays.has(date) ? '▼' : '▲';
};

// ══════════════════════════════════════
//  날씨
// ══════════════════════════════════════
async function fetchWeatherForTrip(trip, dayData, tripId) {
  const citySet = new Set(Object.values(dayData).map(d=>d.city).filter(Boolean));
  const result  = {};
  await Promise.all([...citySet].map(async city => {
    try {
      const geoRes  = await fetch(`https://geocoding-api.open-meteo.com/v1/search?name=${encodeURIComponent(city)}&count=1&language=ko`);
      const geoJson = await geoRes.json();
      if (!geoJson.results?.length) return;
      const { latitude:lat, longitude:lon } = geoJson.results[0];
      const today   = todayStr();
      const maxDate = localDateStr(new Date(Date.now()+15*86400000));
      if (!result[city]) result[city] = {};

      const fs = trip.startDate > today ? trip.startDate : today;
      const fe = trip.endDate   < maxDate ? trip.endDate : maxDate;
      if (fs <= fe) {
        const fj = await (await fetch(`https://api.open-meteo.com/v1/forecast?latitude=${lat}&longitude=${lon}&daily=weathercode,temperature_2m_max,temperature_2m_min&timezone=auto&start_date=${fs}&end_date=${fe}`)).json();
        fj.daily?.time?.forEach((d,i) => { result[city][d] = {code:fj.daily.weathercode[i],max:Math.round(fj.daily.temperature_2m_max[i]),min:Math.round(fj.daily.temperature_2m_min[i])}; });
      }
      const ae = trip.endDate < today ? trip.endDate : localDateStr(new Date(Date.now()-86400000));
      if (trip.startDate <= ae) {
        const aj = await (await fetch(`https://archive-api.open-meteo.com/v1/archive?latitude=${lat}&longitude=${lon}&daily=weathercode,temperature_2m_max,temperature_2m_min&timezone=auto&start_date=${trip.startDate}&end_date=${ae}`)).json();
        aj.daily?.time?.forEach((d,i) => { result[city][d] = {code:aj.daily.weathercode[i],max:Math.round(aj.daily.temperature_2m_max[i]),min:Math.round(aj.daily.temperature_2m_min[i])}; });
      }
    } catch { /* 날씨 실패 무시 */ }
  }));
  return result;
}

// ══════════════════════════════════════
//  교통 모달
// ══════════════════════════════════════
window.openTransportModal = function(transId, tripId) {
  editingTransId = transId;
  $('modal-transport-title').textContent = transId ? '교통 편집' : '교통 등록';
  if (transId) {
    const t = (JSON.parse(localStorage.getItem(LS_TRANS(tripId))||'[]')).find(x=>x.id===transId)||{};
    $('inp-trans-type').value        = t.type||'flight';
    $('inp-trans-from-city').value   = t.fromCity||'';
    $('inp-trans-to-city').value     = t.toCity||'';
    $('inp-trans-depart-date').value = t.departDate||'';
    $('inp-trans-depart-time').value = t.departTime||'';
    $('inp-trans-arrive-date').value = t.arriveDate||'';
    $('inp-trans-arrive-time').value = t.arriveTime||'';
    $('inp-trans-booking').value     = t.bookingNo||'';
    $('inp-trans-memo').value        = t.memo||'';
  } else {
    ['inp-trans-from-city','inp-trans-to-city','inp-trans-depart-time','inp-trans-arrive-time','inp-trans-booking','inp-trans-memo'].forEach(id => $(id).value='');
    $('inp-trans-type').value='flight';
    if (currentTripRef) { $('inp-trans-depart-date').value=$('inp-trans-arrive-date').value=currentTripRef.startDate; }
  }
  $('btn-save-transport').onclick = () => saveTransport(tripId);
  $('modal-transport').classList.add('open');
};
window.closeTransportModal = function() { $('modal-transport').classList.remove('open'); editingTransId=null; };

async function saveTransport(tripId) {
  const payload = {
    type:$('inp-trans-type').value, fromCity:$('inp-trans-from-city').value.trim(),
    toCity:$('inp-trans-to-city').value.trim(), departDate:$('inp-trans-depart-date').value,
    departTime:$('inp-trans-depart-time').value, arriveDate:$('inp-trans-arrive-date').value,
    arriveTime:$('inp-trans-arrive-time').value, bookingNo:$('inp-trans-booking').value.trim(),
    memo:$('inp-trans-memo').value.trim(),
  };
  if (!payload.departDate||!payload.arriveDate) { showToast('날짜를 입력하세요'); return; }
  if (payload.departDate > payload.arriveDate)  { showToast('도착일이 출발일보다 빠릅니다'); return; }
  closeTransportModal();
  const list = JSON.parse(localStorage.getItem(LS_TRANS(tripId))||'[]');
  if (editingTransId) {
    const i=list.findIndex(t=>t.id===editingTransId); if(i>=0) list[i]={...list[i],...payload};
  } else {
    list.push({id:genId(),...payload});
  }
  // Re-sort after save
  list.sort((a,b)=>((a.departDate||'')+(a.departTime||'')).localeCompare((b.departDate||'')+(b.departTime||'')));
  localStorage.setItem(LS_TRANS(tripId), JSON.stringify(list));
  try {
    if (editingTransId) await updateDoc(doc(db,'trips',tripId,'transports',editingTransId), payload);
    else await addDoc(collection(db,'trips',tripId,'transports'), payload);
    showToast('교통 저장됨 ✓');
  } catch { showToast('오프라인 — 로컬 저장됨'); }
}

window.deleteTransport = async function(transId, tripId) {
  if (!confirm('이 교통 정보를 삭제할까요?')) return;
  const list = JSON.parse(localStorage.getItem(LS_TRANS(tripId))||'[]');
  const item = list.find(t=>t.id===transId);
  const newList = list.filter(t=>t.id!==transId);
  localStorage.setItem(LS_TRANS(tripId), JSON.stringify(newList));
  redrawTimeline(tripId);
  scheduleDelete('transport', transId, item, tripId);
  showToast('교통 정보 삭제됨', true);
};

window.copyTransport = function(from, to, booking) {
  const text = [from&&`출발: ${from}`, to&&`도착: ${to}`, booking&&`예약: ${booking}`].filter(Boolean).join('\n');
  navigator.clipboard.writeText(text).then(() => showToast('복사됨'));
};

// ══════════════════════════════════════
//  숙소 일괄 등록
// ══════════════════════════════════════
function openBulkAccomModal(tripId) {
  $('inp-bulk-accom-name').value = '';
  $('inp-bulk-accom-map').value  = '';
  $('inp-bulk-start').value = currentTripRef?.startDate || '';
  $('inp-bulk-end').value   = currentTripRef?.endDate   || '';
  $('btn-save-bulk-accom').onclick = () => saveBulkAccom(tripId);
  $('modal-bulk-accom').classList.add('open');
}

async function saveBulkAccom(tripId) {
  const name  = $('inp-bulk-accom-name').value.trim();
  const map   = $('inp-bulk-accom-map').value.trim();
  const start = $('inp-bulk-start').value;
  const end   = $('inp-bulk-end').value;
  if (!name)        { showToast('숙소 이름을 입력하세요'); return; }
  if (!start||!end) { showToast('날짜를 입력하세요'); return; }
  if (start > end)  { showToast('종료일이 시작일보다 빠릅니다'); return; }
  $('modal-bulk-accom').classList.remove('open');

  const days    = generateDays(start, end);
  const cacheKey= LS_DAYS(tripId);
  const dayData = JSON.parse(localStorage.getItem(cacheKey)||'{}');

  const saves = days.map(async ({ date }) => {
    if (!dayData[date]) dayData[date] = {};
    dayData[date].accommodation    = name;
    dayData[date].accommodationMap = map;
    try {
      const ref = doc(db,'trips',tripId,'days',date);
      try { await updateDoc(ref, {accommodation:name, accommodationMap:map}); }
      catch { await setDoc(ref, dayData[date]); }
    } catch { /* offline */ }
  });

  await Promise.all(saves);
  localStorage.setItem(cacheKey, JSON.stringify(dayData));
  showToast(`${days.length}일치 숙소 등록 완료 ✓`);

  if (currentTripRef) {
    const transData = JSON.parse(localStorage.getItem(LS_TRANS(tripId))||'[]');
    const weather   = JSON.parse(localStorage.getItem(LS_WEATHER(tripId))||'{}');
    renderTimeline(generateDays(currentTripRef.startDate, currentTripRef.endDate), dayData, transData, weather, tripId);
    updateBudgetBar(currentTripRef, dayData);
  }
}

// ══════════════════════════════════════
//  예산
// ══════════════════════════════════════
function openBudgetModal(tripId) {
  $('inp-budget').value = currentTripRef?.budget || '';
  $('btn-save-budget').onclick = () => saveBudget(tripId);
  $('modal-budget').classList.add('open');
}
async function saveBudget(tripId) {
  const budget = Number($('inp-budget').value);
  if (!budget||budget<0) { showToast('올바른 금액을 입력하세요'); return; }
  $('modal-budget').classList.remove('open');
  currentTripRef = {...currentTripRef, budget};
  const raw = localStorage.getItem(LS_TRIPS);
  if (raw) { const trips=JSON.parse(raw).map(t=>t.id===tripId?{...t,budget}:t); localStorage.setItem(LS_TRIPS,JSON.stringify(trips)); }
  try { await updateDoc(doc(db,'trips',tripId),{budget}); showToast(`예산 ${fmtMoney(budget)} 저장됨 ✓`); }
  catch { showToast('오프라인 — 로컬 저장됨'); }
  updateBudgetBar(currentTripRef, JSON.parse(localStorage.getItem(LS_DAYS(tripId))||'{}'));
}

// ══════════════════════════════════════
//  여행 통계
// ══════════════════════════════════════
function openStatsModal(tripId) {
  const dayData = JSON.parse(localStorage.getItem(LS_DAYS(tripId))||'{}');
  const days    = generateDays(currentTripRef.startDate, currentTripRef.endDate);
  const today   = todayStr();

  const elapsed   = days.filter(d => d.date <= today).length;
  const remaining = days.filter(d => d.date > today).length;
  const cities    = [...new Set(Object.values(dayData).map(d=>d.city).filter(Boolean))];
  const catTotals = {};
  let   totalKRW  = 0;

  Object.values(dayData).forEach(d => {
    (d.expenses||[]).forEach(e => {
      const krw = toKRW(e.amount, e.currency);
      totalKRW += krw;
      catTotals[e.category] = (catTotals[e.category]||0) + krw;
    });
  });

  const avgDaily    = elapsed > 0 ? Math.round(totalKRW/elapsed) : 0;
  const budget      = currentTripRef?.budget || 0;
  const maxCat      = Math.max(...Object.values(catTotals), 1);
  const missingAccom = days.filter(d => d.date >= today && !dayData[d.date]?.accommodation).length;

  const catBarsHtml = EXP_KEYS.filter(k => catTotals[k]).map(k => `
    <div class="cat-bar-row">
      <span class="cat-bar-label">${EXP_LABELS[k]}</span>
      <div class="cat-bar-track"><div class="cat-bar-fill" style="width:${Math.round(catTotals[k]/maxCat*100)}%"></div></div>
      <span class="cat-bar-amt">${fmtMoney(catTotals[k])}</span>
    </div>`).join('') || '<div class="t-cap">지출 내역 없음</div>';

  $('stats-content').innerHTML = `
    <div class="stat-grid">
      <div class="stat-box"><div class="num">${days.length}</div><div class="lbl">총 여행 일수</div></div>
      <div class="stat-box"><div class="num">${elapsed}</div><div class="lbl">경과 일수</div></div>
      <div class="stat-box"><div class="num">${remaining}</div><div class="lbl">남은 일수</div></div>
      <div class="stat-box"><div class="num">${cities.length}</div><div class="lbl">방문 도시</div></div>
    </div>
    ${missingAccom ? `<div style="background:var(--danger-light);color:var(--danger);border-radius:var(--radius-sm);padding:10px 14px;font-size:.88rem;font-weight:600;margin-bottom:16px;">🏨 숙소 미정 ${missingAccom}일 남음</div>` : ''}
    ${cities.length ? `<div style="margin-bottom:16px;"><div class="day-section-label" style="margin-bottom:8px;">방문 도시</div><div style="display:flex;flex-wrap:wrap;gap:6px;">${cities.map(c=>`<span class="city-tag">${escHtml(c)}</span>`).join('')}</div></div>` : ''}
    <div style="margin-bottom:16px;">
      <div class="day-section-label" style="margin-bottom:10px;">지출 현황</div>
      <div class="stat-grid" style="margin-bottom:12px;">
        <div class="stat-box"><div class="num" style="font-size:1.2rem;">${fmtMoney(totalKRW)}</div><div class="lbl">총 지출</div></div>
        <div class="stat-box"><div class="num" style="font-size:1.2rem;">${fmtMoney(avgDaily)}</div><div class="lbl">일평균 지출</div></div>
      </div>
      ${budget ? `<div class="stat-box" style="margin-bottom:12px;">
        <div style="display:flex;justify-content:space-between;font-size:.85rem;font-weight:600;margin-bottom:6px;">
          <span>예산 대비</span>
          <span style="color:${totalKRW>budget?'var(--danger)':'var(--success)'};">${Math.round(totalKRW/budget*100)}%</span>
        </div>
        <div class="budget-bar-track"><div class="budget-bar-fill ${totalKRW>budget?'over':''}" style="width:${Math.min(Math.round(totalKRW/budget*100),100)}%"></div></div>
        <div style="font-size:.78rem;color:var(--text-2);margin-top:6px;">잔여 ${fmtMoney(Math.max(budget-totalKRW,0))}</div>
      </div>` : ''}
      ${catBarsHtml}
    </div>`;
  $('modal-stats').classList.add('open');
}

// ══════════════════════════════════════
//  준비물
// ══════════════════════════════════════
function openPackingModal(tripId) {
  if (!currentTripRef) { currentTripRef = JSON.parse(localStorage.getItem(LS_TRIPS)||'[]').find(t=>t.id===tripId)||null; }
  if (!currentTripRef?.packing) currentTripRef = { ...currentTripRef, packing:[] };
  $('modal-packing').classList.add('open');
  renderPackingList(tripId);
}
function renderPackingList(tripId) {
  const items = currentTripRef?.packing || [];
  const done  = items.filter(i=>i.done).length;
  $('packing-list').innerHTML = items.map((item,idx) => `
    <li class="todo-item${item.done?' done':''}" style="justify-content:space-between;">
      <div style="display:flex;align-items:center;gap:8px;flex:1;">
        <input type="checkbox" ${item.done?'checked':''} onchange="togglePacking('${tripId}',${idx},this.checked)" />
        <label>${escHtml(item.text)}</label>
      </div>
      <button class="btn sm danger" style="padding:3px 8px;font-size:.72rem;" onclick="deletePacking('${tripId}',${idx})">×</button>
    </li>`).join('');
  $('packing-progress').textContent = `${done} / ${items.length} 완료`;
}
window.addPackingItem = function() {
  const inp = $('inp-packing-item'), text = inp.value.trim();
  if (!text) return;
  if (!currentTripRef.packing) currentTripRef.packing = [];
  currentTripRef.packing.push({text, done:false}); inp.value='';
  savePacking(currentTripId); renderPackingList(currentTripId);
};
window.togglePacking = function(tripId, idx, done) {
  if (!currentTripRef?.packing) return;
  currentTripRef.packing[idx].done = done;
  savePacking(tripId); renderPackingList(tripId);
};
window.deletePacking = function(tripId, idx) {
  if (!currentTripRef?.packing) return;
  currentTripRef.packing.splice(idx,1);
  savePacking(tripId); renderPackingList(tripId);
};
function applyPackingTemplate(key, tripId) {
  if (!currentTripRef.packing) currentTripRef.packing=[];
  const existing = new Set(currentTripRef.packing.map(i=>i.text));
  (PACKING_TEMPLATES[key]||[]).filter(t=>!existing.has(t)).forEach(t=>currentTripRef.packing.push({text:t,done:false}));
  savePacking(tripId); renderPackingList(tripId); showToast('템플릿 적용됨');
}
async function savePacking(tripId) {
  const packing = currentTripRef?.packing||[];
  const raw = localStorage.getItem(LS_TRIPS);
  if (raw) { const trips=JSON.parse(raw).map(t=>t.id===tripId?{...t,packing}:t); localStorage.setItem(LS_TRIPS,JSON.stringify(trips)); }
  try { await updateDoc(doc(db,'trips',tripId),{packing}); } catch {}
}

// ══════════════════════════════════════
//  날짜 카드 편집
// ══════════════════════════════════════
window.openEditModal = function(date, tripId) {
  const data = JSON.parse(localStorage.getItem(LS_DAYS(tripId))||'{}')?.[date]||{};
  $('modal-day-title').textContent = `${fmtDateShort(date)} 편집`;
  $('inp-theme').value     = data.theme||'';
  $('inp-city').value       = data.city||'';
  $('inp-accom-name').value = data.accommodation||'';
  $('inp-accom-map').value  = data.accommodationMap||'';
  $('inp-memo').value       = data.memo||'';
  $('inp-todos').value      = (data.todos||[]).map(t=>t.text).join('\n');
  const memoField = $('memo-field');
  if (data.memo) { memoField.style.display=''; $('memo-toggle-icon').textContent='▲ 접기'; }
  else           { memoField.style.display='none'; $('memo-toggle-icon').textContent='▼ 펼치기'; }
  editingExpenses = JSON.parse(JSON.stringify(data.expenses||[]));
  renderEditExpenses();
  $('btn-save-day').onclick = () => saveDayEdit(tripId, date);
  $('modal-edit-day').classList.add('open');
};
window.closeEditModal  = function() { $('modal-edit-day').classList.remove('open'); };
window.toggleMemoField = function() {
  const f = $('memo-field'), shown = f.style.display !== 'none';
  f.style.display = shown ? 'none' : '';
  $('memo-toggle-icon').textContent = shown ? '▼ 펼치기' : '▲ 접기';
};

function renderEditExpenses() {
  $('expense-list-edit').innerHTML = editingExpenses.map((e,i) => `
    <div class="expense-item-edit">
      <span class="exp-cat">${EXP_LABELS[e.category]||e.category}</span>
      <span class="exp-name">${escHtml(e.name)}</span>
      <span class="exp-amt">${e.currency&&e.currency!=='KRW'?`${CURRENCIES[e.currency]?.s||''}${Number(e.amount).toLocaleString()}`:fmtMoney(e.amount)}</span>
      <button class="btn sm danger" style="padding:3px 8px;font-size:.72rem;margin-left:auto;" onclick="removeEditExpense(${i})">×</button>
    </div>`).join('') || `<div class="t-cap" style="margin-bottom:6px;">없음</div>`;
}
window.removeEditExpense = function(idx) { editingExpenses.splice(idx,1); renderEditExpenses(); };

function addEditExpense() {
  const cat=($('inp-exp-cat').value), name=($('inp-exp-name').value.trim()), amount=Number($('inp-exp-amount').value), currency=$('inp-exp-currency').value;
  if (!name||!amount) { showToast('항목명과 금액을 입력하세요'); return; }
  editingExpenses.push({id:genId(), category:cat, name, amount, currency});
  $('inp-exp-name').value=''; $('inp-exp-amount').value='';
  renderEditExpenses();
}

async function saveDayEdit(tripId, date) {
  const prevData = JSON.parse(localStorage.getItem(LS_DAYS(tripId))||'{}')?.[date]||{};
  const todosRaw = $('inp-todos').value.trim();
  const todos    = todosRaw ? todosRaw.split('\n').filter(l=>l.trim()).map(text => {
    const prev = (prevData.todos||[]).find(t=>t.text===text.trim());
    return { text:text.trim(), done: prev?.done||false };
  }) : [];
  const payload = {
    theme:$('inp-theme').value.trim(),
    city:$('inp-city').value.trim(), accommodation:$('inp-accom-name').value.trim(),
    accommodationMap:$('inp-accom-map').value.trim(), memo:$('inp-memo').value.trim(),
    todos, expenses:editingExpenses,
  };
  closeEditModal();
  const cacheKey = LS_DAYS(tripId);
  const dayData  = JSON.parse(localStorage.getItem(cacheKey)||'{}');
  dayData[date]  = payload;
  localStorage.setItem(cacheKey, JSON.stringify(dayData));
  try {
    const ref = doc(db,'trips',tripId,'days',date);
    try { await updateDoc(ref, payload); } catch { await setDoc(ref, payload); }
    showToast('저장됨 ✓');
  } catch { showToast('오프라인 — 로컬 저장됨'); }
  if (currentTripRef) {
    const transData = JSON.parse(localStorage.getItem(LS_TRANS(tripId))||'[]');
    const weather   = JSON.parse(localStorage.getItem(LS_WEATHER(tripId))||'{}');
    renderTimeline(generateDays(currentTripRef.startDate, currentTripRef.endDate), dayData, transData, weather, tripId);
    updateBudgetBar(currentTripRef, dayData);
    fetchWeatherForTrip(currentTripRef, dayData, tripId).then(w => {
      Object.assign(weather, w); localStorage.setItem(LS_WEATHER(tripId), JSON.stringify(weather));
      renderTimeline(generateDays(currentTripRef.startDate, currentTripRef.endDate), dayData, transData, weather, tripId);
    });
  }
}

// ══════════════════════════════════════
//  To-Do 인라인
// ══════════════════════════════════════
window.toggleTodo = async function(tripId, date, idx, done) {
  const cacheKey=LS_DAYS(tripId), dayData=JSON.parse(localStorage.getItem(cacheKey)||'{}');
  if (!dayData[date]?.todos) return;
  dayData[date].todos[idx].done=done; localStorage.setItem(cacheKey, JSON.stringify(dayData));
  const el=$(`td-${date}-${idx}`); if(el) el.classList.toggle('done',done);
  try { await updateDoc(doc(db,'trips',tripId,'days',date),{todos:dayData[date].todos}); } catch {}
};

window.addTodo = async function(tripId, date) {
  const inp=$(`ti-${date}`), text=inp?.value.trim(); if(!text) return;
  const cacheKey=LS_DAYS(tripId), dayData=JSON.parse(localStorage.getItem(cacheKey)||'{}');
  if (!dayData[date]) dayData[date]={};
  if (!dayData[date].todos) dayData[date].todos=[];
  dayData[date].todos.push({text,done:false}); localStorage.setItem(cacheKey,JSON.stringify(dayData)); inp.value='';
  try { const ref=doc(db,'trips',tripId,'days',date); try{await updateDoc(ref,{todos:dayData[date].todos});}catch{await setDoc(ref,dayData[date]);} } catch {}
  if (currentTripRef) {
    const transData=JSON.parse(localStorage.getItem(LS_TRANS(tripId))||'[]');
    const weather=JSON.parse(localStorage.getItem(LS_WEATHER(tripId))||'{}');
    renderTimeline(generateDays(currentTripRef.startDate,currentTripRef.endDate),dayData,transData,weather,tripId);
  }
};

// ══════════════════════════════════════
//  이벤트 바인딩
// ══════════════════════════════════════
document.addEventListener('DOMContentLoaded', () => {
  if (!isOnline) { const b=$('offline-banner'); if(b) b.style.display='block'; }
  loadFxRates();

  // 입장 코드
  $('btn-entry-submit').addEventListener('click', handleEntrySubmit);

  // 관리자 gear
  $('btn-admin-gear').addEventListener('click', openAdminAuth);
  $('btn-verify-admin').addEventListener('click', verifyAdmin);
  $('btn-save-admin-settings').addEventListener('click', saveAdminSettings);

  // 대시보드
  $('btn-new-trip').addEventListener('click', openNewTripModal);
  $('btn-cancel-new-trip').addEventListener('click', () => $('modal-new-trip').classList.remove('open'));
  $('btn-save-new-trip').addEventListener('click', saveNewTrip);
  $('inp-trip-title').addEventListener('keydown', e => { if(e.key==='Enter') saveNewTrip(); });

  // 뒤로가기
  $('btn-back').addEventListener('click', () => {
    if(unsubDays)  { unsubDays();  unsubDays=null; }
    if(unsubTrans) { unsubTrans(); unsubTrans=null; }
    currentTripRef=null; navigate(null);
  });

  // 지출
  $('btn-add-expense').addEventListener('click', addEditExpense);
  $('inp-exp-amount').addEventListener('keydown', e => { if(e.key==='Enter') addEditExpense(); });

  // 준비물 템플릿
  $('tpl-basic').addEventListener('click', () => applyPackingTemplate('basic', currentTripId));
  $('tpl-long').addEventListener('click',  () => applyPackingTemplate('long',  currentTripId));
  $('tpl-biz').addEventListener('click',   () => applyPackingTemplate('biz',   currentTripId));
  $('btn-clear-packing').addEventListener('click', () => {
    if (!currentTripRef?.packing) return;
    currentTripRef.packing=currentTripRef.packing.filter(i=>!i.done);
    savePacking(currentTripId); renderPackingList(currentTripId);
  });

  boot();
});
