// 수업일지 — 컴시간 시간표 위에 반별 수업 기록·진도를 남긴다.
// 데이터(Firestore, ohweb-93062):
//   classlog_users/{uid}                 프로필(학교·컴시간 교사 번호·승인 상태)
//   classlog_users/{uid}/logs/{id}        일지 한 칸. id = 날짜_교시_학년-반
//   classlog_users/{uid}/plans/{id}       진도 계획(학년·과목별 단원·차시 목록). id = 학년_과목
//   classlog_users/{uid}/extras/{id}      직접 추가한 수업(보강·교환)
// 시간표는 /api/comci 가 컴시간에서 받아온다(Firestore에 저장하지 않음).
import { auth, db } from './firebase-config.js';
import { GoogleAuthProvider, signInWithPopup, signOut, onAuthStateChanged } from 'https://www.gstatic.com/firebasejs/10.12.2/firebase-auth.js';
import {
  doc, setDoc, updateDoc, deleteDoc, addDoc, collection, onSnapshot, serverTimestamp,
} from 'https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js';

const ADMIN_EMAIL = 'qjatjr7575@gmail.com';
const DAYS = ['일', '월', '화', '수', '목', '금', '토'];
const STATUS = { normal: '정상', makeup: '보강', self: '자습', cancel: '결강' };
const KIND = { makeup: '보강', swap: '교환', etc: '기타' };

const S = {
  user: null, profile: null, admin: false,
  logs: new Map(), plans: new Map(), extras: new Map(), users: [],
  weeks: [], times: [], tt: new Map(), ttLoading: new Map(), ttFail: new Set(), curWeek: null, ttDebug: null,
  view: 'today', date: todayISO(), week: null,
  progressKey: null, planKey: null, adminFilter: 'pending',
  unsub: [], profileUnsub: null,
};

/* ───────── 공통 ───────── */
const $ = (id) => document.getElementById(id);
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
function todayISO(d = new Date()) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}
function addDays(iso, n) {
  const [y, m, d] = iso.split('-').map(Number);
  return todayISO(new Date(y, m - 1, d + n));
}
const dow = (iso) => { const [y, m, d] = iso.split('-').map(Number); return new Date(y, m - 1, d).getDay(); };
const md = (iso) => `${Number(iso.slice(5, 7))}/${Number(iso.slice(8, 10))}`;
const dateLabel = (iso) => `${md(iso)}(${DAYS[dow(iso)]})`;
const classKey = (l) => `${l.grade}-${l.cls}|${l.subject}`;
const classLabel = (l) => `${l.grade}-${l.cls}`;
const planId = (grade, subject) => `${grade}_${String(subject).replace(/[\/.#\[\]\s]/g, '_')}`;
const logId = (l) => `${l.date}_${l.period}_${l.grade}-${l.cls}`;
const timeOf = (p) => { const t = S.times[p - 1]; const m = t && String(t).match(/\((.*?)\)/); return m ? m[1] : ''; };
const userRef = () => doc(db, 'classlog_users', S.user.uid);
const sub = (name) => collection(db, 'classlog_users', S.user.uid, name);

function toast(msg) {
  const t = $('toast');
  t.textContent = msg; t.classList.add('show');
  clearTimeout(toast._t); toast._t = setTimeout(() => t.classList.remove('show'), 2200);
}
function ask(title, msg, okLabel = '확인') {
  return new Promise((res) => {
    $('askTitle').textContent = title; $('askMsg').textContent = msg; $('askYes').textContent = okLabel;
    const m = $('askModal'); m.classList.add('show');
    const done = (v) => { m.classList.remove('show'); $('askYes').onclick = $('askNo').onclick = null; res(v); };
    $('askYes').onclick = () => done(true); $('askNo').onclick = () => done(false);
  });
}
async function api(qs) {
  const r = await fetch('/api/comci?' + qs);
  const d = await r.json().catch(() => ({ error: `HTTP ${r.status}` }));
  if (d.error) throw new Error(d.error);
  return d;
}
function show(screen) {
  for (const id of ['screenLogin', 'screenOnboard', 'screenPending']) $(id).classList.toggle('show', id === screen);
  $('app').classList.toggle('hidden', screen !== 'app');
}

/* ───────── 다크 모드(ohweb과 같은 방식) ───────── */
if (localStorage.getItem('dark') === '1') document.body.classList.add('dark');
function toggleDark() { localStorage.setItem('dark', document.body.classList.toggle('dark') ? '1' : '0'); }

/* ───────── 로그인·프로필 ───────── */
$('loginBtn').onclick = async () => {
  try { await signInWithPopup(auth, new GoogleAuthProvider()); }
  catch (e) { if (e.code !== 'auth/popup-closed-by-user') toast('로그인 실패: ' + (e.code || e.message)); }
};
async function logout() { await signOut(auth); }

onAuthStateChanged(auth, (user) => {
  S.profileUnsub?.(); S.profileUnsub = null;
  stopApp();
  S.user = user;
  S.admin = !!user && user.email === ADMIN_EMAIL;
  document.body.classList.toggle('is-admin', S.admin);
  if (!user) { show('screenLogin'); return; }
  S.profileUnsub = onSnapshot(userRef(), (snap) => {
    const before = S.profile;
    S.profile = snap.exists() ? snap.data() : null;
    route(before);
  }, (e) => { toast('프로필을 못 읽음: ' + e.code); show('screenLogin'); });
});

// 프로필 상태에 맞는 화면으로
function route(before) {
  const p = S.profile;
  if (S.forceOnboard || !p) { startOnboard(); return; }
  if (p.status !== 'approved') {
    stopApp();
    $('pendTitle').textContent = p.status === 'rejected' ? '승인되지 않았어요' : '승인 대기 중';
    $('pendSub').textContent = `${p.schoolName} · ${p.teacherName}`;
    $('pendMsg').textContent = p.status === 'rejected'
      ? '관리자가 신청을 거절했어요. 학교·이름을 다시 확인해 주세요.'
      : '관리자가 승인하면 바로 쓸 수 있어요. 이 화면은 승인되면 자동으로 바뀌어요.';
    show('screenPending');
    return;
  }
  const changed = !before || before.status !== 'approved' || before.schoolCode !== p.schoolCode || before.teacherId !== p.teacherId;
  if (changed) startApp(); else renderAll();
}

/* ───────── 가입 신청(학교·이름 고르기) ───────── */
const OB = { school: null, teachers: [] };
function startOnboard() {
  stopApp();
  OB.school = null;
  $('obSchool').classList.remove('hidden'); $('obTeacher').classList.add('hidden');
  $('obSchools').innerHTML = ''; $('obQuery').value = S.profile?.schoolName || '';
  $('obCancel').classList.toggle('hidden', !S.profile);
  steps(1);
  show('screenOnboard');
}
function steps(n) { ['st1', 'st2', 'st3'].forEach((id, i) => $(id).classList.toggle('on', i < n)); }
$('obCancel').onclick = () => { S.forceOnboard = false; route(null); };
$('obQuery').onkeydown = (e) => { if (e.key === 'Enter') $('obSearch').click(); };
$('obSearch').onclick = async () => {
  const q = $('obQuery').value.trim();
  if (!q) return;
  $('obSchools').innerHTML = '<div class="spinner"></div>';
  try {
    const d = await api('q=' + encodeURIComponent(q));
    $('obSchools').innerHTML = d.schools.length
      ? d.schools.map((s, i) => `<button class="pick-item" data-i="${i}"><b>${esc(s.name)}</b><span class="muted small">${esc(s.region)}</span></button>`).join('')
      : '<div class="empty-state">검색 결과가 없어요. 학교 이름을 줄여서 검색해 보세요.</div>';
    $('obSchools').querySelectorAll('.pick-item').forEach((b) => (b.onclick = () => pickSchool(d.schools[b.dataset.i])));
  } catch (e) {
    $('obSchools').innerHTML = `<div class="empty-state">컴시간 연결 실패: ${esc(e.message)}</div>`;
  }
};
async function pickSchool(s) {
  OB.school = s; steps(2);
  $('obSchool').classList.add('hidden'); $('obTeacher').classList.remove('hidden');
  $('obSchoolName').textContent = `${s.region} ${s.name}`;
  $('obTeacherSel').innerHTML = '<option>불러오는 중…</option>'; $('obPreview').innerHTML = ''; $('obSubmit').disabled = true;
  try {
    const d = await api(`code=${s.sccode}`);
    OB.teachers = d.teachers;
    $('obTeacherSel').innerHTML = '<option value="">이름을 고르세요</option>' +
      d.teachers.map((t) => `<option value="${t.id}">${esc(t.name)}</option>`).join('');
    if (S.profile?.schoolCode === s.sccode) { $('obTeacherSel').value = S.profile.teacherId; previewTeacher(); }
  } catch (e) {
    $('obTeacherSel').innerHTML = `<option>불러오기 실패: ${esc(e.message)}</option>`;
  }
}
$('obBack').onclick = () => { steps(1); $('obSchool').classList.remove('hidden'); $('obTeacher').classList.add('hidden'); };
$('obTeacherSel').onchange = previewTeacher;
async function previewTeacher() {
  const id = Number($('obTeacherSel').value);
  $('obSubmit').disabled = !id;
  if (!id) { $('obPreview').innerHTML = ''; return; }
  steps(3);
  $('obPreview').innerHTML = '<div class="spinner"></div>';
  try {
    const d = await api(`code=${OB.school.sccode}&teacher=${id}`);
    S.times = d.times;
    $('obPreview').innerHTML = d.lessons.length
      ? `<div class="week-scroll">${weekTable(d.lessons.map(fromComci), d.weeks.find((w) => w.r === d.week)?.start, { preview: true })}</div>`
      : '<div class="empty-state">이번 주 수업이 없어요.</div>';
  } catch (e) {
    $('obPreview').innerHTML = `<div class="empty-state">시간표를 못 불러옴: ${esc(e.message)}</div>`;
  }
}
$('obSubmit').onclick = async () => {
  const id = Number($('obTeacherSel').value);
  const t = OB.teachers.find((x) => x.id === id);
  if (!t || !OB.school) return;
  const p = S.profile;
  const same = p && p.schoolCode === OB.school.sccode && p.teacherId === id;
  const data = {
    email: S.user.email,
    name: S.user.displayName || '',
    schoolCode: OB.school.sccode, schoolName: OB.school.name, region: OB.school.region || '',
    teacherId: id, teacherName: t.name,
    // 관리자 본인은 바로 승인. 이미 승인된 사람이 같은 이름을 다시 고르면 그대로 둔다.
    status: S.admin || (same && p.status === 'approved') ? 'approved' : 'pending',
    updatedAt: serverTimestamp(),
  };
  if (!p) data.createdAt = serverTimestamp();
  $('obSubmit').disabled = true;
  try {
    await setDoc(userRef(), data, { merge: true });
    S.forceOnboard = false;
    toast(data.status === 'approved' ? '저장했어요' : '신청했어요. 승인을 기다려 주세요.');
    route(null);
  } catch (e) {
    toast('저장 실패: ' + e.code); $('obSubmit').disabled = false;
  }
};
$('pendChange').onclick = () => { S.forceOnboard = true; startOnboard(); };
$('setChange').onclick = async () => {
  if (!S.admin && !(await ask('학교·이름 바꾸기', '바꾸면 관리자가 다시 승인할 때까지 일지를 쓸 수 없어요. 계속할까요?', '바꾸기'))) return;
  S.forceOnboard = true; startOnboard();
};

/* ───────── 앱 시작·종료 ───────── */
function stopApp() {
  S.unsub.forEach((u) => u()); S.unsub = [];
  S.logs.clear(); S.plans.clear(); S.extras.clear(); S.tt.clear(); S.ttLoading.clear(); S.ttFail.clear(); S.users = [];
  S.weeks = []; S.curWeek = null;
}
async function startApp() {
  stopApp();
  show('app');
  buildMenu();
  const live = (name, map) => onSnapshot(sub(name), (snap) => {
    map.clear(); snap.forEach((d) => map.set(d.id, { id: d.id, ...d.data() })); renderAll();
  }, (e) => toast(`${name} 읽기 실패: ${e.code}`));
  S.unsub.push(live('logs', S.logs), live('plans', S.plans), live('extras', S.extras));
  if (S.admin) {
    S.unsub.push(onSnapshot(collection(db, 'classlog_users'), (snap) => {
      S.users = snap.docs.map((d) => ({ uid: d.id, ...d.data() })); renderAdmin(); buildMenu();
    }, (e) => toast('사용자 목록 실패: ' + e.code)));
  }
  go(location.hash.slice(1) || 'today', true);
  try { await loadWeek(null); } catch (e) { toast('시간표 불러오기 실패: ' + e.message); }
  renderAll();
}

// 컴시간 한 주. r=null 이면 '오늘이 속한 주'
// 같은 주를 동시에 여러 번 부르지 않고, 실패한 주는 다시 부르지 않는다(화면이 무한히 재요청하지 않게).
function loadWeek(r, force) {
  if (r != null && S.tt.has(r) && !force) return Promise.resolve(r);
  const key = r ?? 'now';
  if (S.ttLoading.has(key)) return S.ttLoading.get(key);
  const p = S.profile;
  const job = api(`code=${p.schoolCode}&teacher=${p.teacherId}` + (r != null ? `&week=${r}` : ''))
    .then((d) => {
      S.weeks = d.weeks; S.times = d.times; S.ttDebug = d.debug;
      S.tt.set(r ?? d.week, d.lessons.map(fromComci));
      S.ttFail.delete(r ?? d.week);
      if (S.curWeek == null) S.curWeek = d.week;
      if (S.week == null) S.week = d.week;
      return d.week;
    })
    .catch((e) => { if (r != null) S.ttFail.add(r); throw e; })
    .finally(() => S.ttLoading.delete(key));
  S.ttLoading.set(key, job);
  return job;
}
const needWeek = (w) => w && !S.tt.has(w.r) && !S.ttFail.has(w.r);
const fromComci = (x) => ({
  date: x.date, day: x.day, period: x.period, grade: x.grade, cls: x.class,
  subject: x.subjectName, changed: x.changed, room: x.room, src: 'comci',
});
function weekOf(date) {
  return S.weeks.find((w) => w.start && date >= w.start && date <= addDays(w.start, 6));
}

// 날짜의 수업 칸: 컴시간 + 직접 추가 + (시간표에 없는 날의) 일지
function slotsFor(date) {
  const w = weekOf(date);
  const out = [];
  if (w && S.tt.has(w.r)) out.push(...S.tt.get(w.r).filter((l) => l.date === date));
  for (const x of S.extras.values()) if (x.date === date) out.push({ ...x, src: 'extra', extraId: x.id });
  const have = new Set(out.map(logId));
  for (const l of S.logs.values()) if (l.date === date && !have.has(l.id)) out.push({ date, period: l.period, grade: l.grade, cls: l.cls, subject: l.subject, src: 'log' });
  return out.sort((a, b) => a.period - b.period || a.grade - b.grade || a.cls - b.cls);
}
// 내가 맡은 반(학년-반|과목) — 시간표·추가 수업·일지에서 모은다
function myClasses() {
  const m = new Map();
  const add = (l) => { if (l.subject) m.set(classKey(l), { grade: l.grade, cls: l.cls, subject: l.subject }); };
  for (const ls of S.tt.values()) ls.forEach(add);
  S.extras.forEach(add); S.logs.forEach(add);
  return [...m.values()].sort((a, b) => a.subject.localeCompare(b.subject) || a.grade - b.grade || a.cls - b.cls);
}
const ord = (l) => l.date + String(l.period).padStart(2, '0');
const logsOf = (k) => [...S.logs.values()].filter((l) => classKey(l) === k).sort((a, b) => ord(b).localeCompare(ord(a)));
const planOf = (grade, subject) => S.plans.get(planId(grade, subject));

// 반의 진도 = 계획표에서 기록된 가장 뒤 차시
function progressOf(k, grade, subject) {
  const plan = planOf(grade, subject);
  if (!plan?.items?.length) return null;
  const done = new Map();
  for (const l of S.logs.values()) if (classKey(l) === k && l.planItem && l.status !== 'cancel') {
    const prev = done.get(l.planItem);
    if (!prev || l.date < prev) done.set(l.planItem, l.date);
  }
  let last = -1;
  plan.items.forEach((it, i) => { if (done.has(it.id)) last = i; });
  return { plan, done, last, next: plan.items[last + 1] || null };
}

/* ───────── 메뉴·화면 이동 ───────── */
const MENU = [
  ['수업', [['today', '오늘 수업', 'sun'], ['week', '주간 시간표', 'calendar'], ['progress', '반별 진도', 'chart']]],
  ['관리', [['plan', '진도 계획', 'list'], ['export', '내보내기', 'download'], ['settings', '설정', 'gear'], ['admin', '승인 관리', 'check', true]]],
];
const TABS = [['today', '오늘', 'sun'], ['week', '주간', 'calendar'], ['progress', '진도', 'chart'], ['plan', '계획', 'list'], ['settings', '설정', 'gear']];
const ICONS = {
  sun: '<circle cx="12" cy="12" r="4"/><path d="M12 2.5v2M12 19.5v2M4.6 4.6l1.4 1.4M18 18l1.4 1.4M2.5 12h2M19.5 12h2M4.6 19.4 6 18M18 6l1.4-1.4"/>',
  calendar: '<rect x="3.5" y="5" width="17" height="15" rx="2"/><path d="M3.5 10h17M8 3v4M16 3v4"/>',
  chart: '<path d="M4 20V10M10 20V4M16 20v-7M22 20H2"/>',
  list: '<path d="M9 6h11M9 12h11M9 18h11"/><path d="m3.5 6 1 1 2-2M3.5 12l1 1 2-2M3.5 18l1 1 2-2"/>',
  download: '<path d="M12 4v11M7.5 10.5 12 15l4.5-4.5"/><path d="M4 19.5h16"/>',
  gear: '<circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.6 1.6 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.6 1.6 0 0 0-2.7 1.1V21a2 2 0 1 1-4 0v-.1A1.6 1.6 0 0 0 9 19.4a1.6 1.6 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1A1.6 1.6 0 0 0 3.3 14H3a2 2 0 1 1 0-4h.1A1.6 1.6 0 0 0 4.6 9a1.6 1.6 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1A1.6 1.6 0 0 0 9 4.6V3a2 2 0 1 1 4 0v.1a1.6 1.6 0 0 0 2.7 1.1l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.6 1.6 0 0 0 1.1 2.7H21a2 2 0 1 1 0 4h-.1a1.6 1.6 0 0 0-1.5 1.3Z"/>',
  check: '<circle cx="12" cy="12" r="8.5"/><path d="m8 12.2 2.7 2.7L16.2 9"/>',
};
const icon = (n, s) => `<svg width="${s}" height="${s}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${ICONS[n]}</svg>`;
function buildMenu() {
  const pending = S.users.filter((u) => u.status === 'pending').length;
  $('sideMenu').innerHTML = MENU.map(([head, items]) => `<div class="side-head">${head}</div>` + items.map(([id, label, ic, adminOnly]) =>
    `<button type="button" class="side-item${adminOnly ? ' admin-only' : ''}" data-go="${id}">${icon(ic, 18)}${label}${id === 'admin' && pending ? ` <span class="badge off" style="margin-left:auto">${pending}</span>` : ''}</button>`).join('')).join('');
  $('tabbar').innerHTML = TABS.map(([id, label, ic]) => `<button type="button" class="tab" data-go="${id}">${icon(ic, 22)}${label}</button>`).join('');
  document.querySelectorAll('.admin-link').forEach((el) => el.classList.toggle('hidden', !S.admin));
  markMenu();
}
function markMenu() {
  document.querySelectorAll('[data-go].side-item, [data-go].tab').forEach((b) => b.classList.toggle('on', b.dataset.go === S.view));
}
function go(view, replace) {
  if (!$('sec-' + view) || (view === 'admin' && !S.admin)) view = 'today';
  S.view = view;
  document.querySelectorAll('.section').forEach((s) => s.classList.toggle('active', s.id === 'sec-' + view));
  const title = { today: '오늘 수업', week: '주간 시간표', progress: '반별 진도', plan: '진도 계획', export: '내보내기', settings: '설정', admin: '승인 관리' }[view];
  $('navTitle').textContent = title;
  if (replace) history.replaceState(null, '', '#' + view); else history.pushState(null, '', '#' + view);
  markMenu();
  renderView();
  window.scrollTo(0, 0);
}
window.addEventListener('popstate', () => { if (!$('app').classList.contains('hidden')) go(location.hash.slice(1) || 'today', true); });

function renderAll() { if ($('app').classList.contains('hidden')) return; buildMenu(); renderView(); }
function renderView() {
  ({ today: renderToday, week: renderWeek, progress: renderProgress, plan: renderPlan, export: renderExport, settings: renderSettings, admin: renderAdmin })[S.view]?.();
}

/* ───────── 오늘 ───────── */
async function renderToday() {
  const date = S.date;
  $('todayDate').value = date;
  $('todayTitle').textContent = date === todayISO() ? '오늘 수업' : `${dateLabel(date)} 수업`;
  $('todaySub').textContent = `${S.profile.schoolName} · ${S.profile.teacherName}`;
  const w = weekOf(date);
  if (needWeek(w)) {
    $('todayList').innerHTML = '<div class="spinner"></div>';
    try { await loadWeek(w.r); } catch (e) { toast('시간표 불러오기 실패: ' + e.message); }
    if (S.date === date && S.view === 'today') renderToday();
    return;
  }
  renderTodaySide();
  const slots = slotsFor(date);
  const written = slots.filter((s) => S.logs.has(logId(s))).length;
  $('todayCount').textContent = slots.length ? `수업 ${slots.length} · 작성 ${written}` : '수업';
  $('todayNote').innerHTML = !S.weeks.length ? ''
    : !w ? '<p class="muted small" style="margin-bottom:8px">컴시간에 이 날짜 시간표가 없어요(컴시간은 이번 주·다음 주 정도만 보여줘요). 기록한 수업과 직접 추가한 수업만 보여요.</p>' : '';
  if (!slots.length) {
    $('todayList').innerHTML = `<div class="empty-state">${[0, 6].includes(dow(date)) ? '주말이에요.' : '수업이 없어요.'}</div>`;
    return;
  }
  $('todayList').innerHTML = slots.map((s, i) => {
    const log = S.logs.get(logId(s));
    const prog = progressOf(classKey(s), s.grade, s.subject);
    const what = log ? [planTitle(log), log.content].filter(Boolean).join(' · ') || '작성함'
      : prog?.next ? `다음 차시: ${prog.next.title}` : '아직 안 썼어요';
    return `<div class="lesson" data-slot="${i}">
      <div class="per"><b>${s.period}</b><small>${esc(timeOf(s.period))}</small></div>
      <div style="min-width:0">
        <div class="who">${esc(classLabel(s))} <span class="muted small" style="font-weight:600">${esc(s.subject)}</span>
          ${s.changed ? '<span class="badge warn">변경</span>' : ''}${s.src === 'extra' ? `<span class="badge on">${KIND[s.kind] || '추가'}</span>` : ''}
          ${log && log.status !== 'normal' ? `<span class="badge muted">${STATUS[log.status]}</span>` : ''}${s.room ? `<span class="muted small">${esc(s.room)}</span>` : ''}</div>
        <div class="what ${log ? 'has' : ''}">${esc(what)}</div>
      </div>
      <div>${log ? '<span class="badge ok">작성</span>' : '<span class="badge muted">미작성</span>'}</div>
    </div>`;
  }).join('');
  $('todayList').querySelectorAll('.lesson').forEach((el) => (el.onclick = () => openLog(slots[el.dataset.slot])));
}
// 이번 주(오늘까지) 아직 안 쓴 수업 + 반마다 지금 진도
function renderTodaySide() {
  const today = todayISO();
  const w = weekOf(today);
  const back = [];
  if (w && S.tt.has(w.r)) for (let d = 0; d < 5; d++) {
    const date = addDays(w.start, d);
    if (date > today) break;
    back.push(...slotsFor(date).filter((s) => !S.logs.has(logId(s))));
  }
  $('backlogCount').textContent = back.length ? `${back.length}건` : '';
  $('todayBacklog').innerHTML = back.length
    ? '<div class="mini-list">' + back.map((s, i) => `<button type="button" class="mini-item" data-b="${i}"><b>${esc(classLabel(s))}</b><span class="grow">${esc(s.subject)}</span><small>${dateLabel(s.date)} ${s.period}교시</small></button>`).join('') + '</div>'
    : `<p class="muted small">${w ? '이번 주 수업 일지를 모두 썼어요.' : '시간표를 불러오는 중이에요.'}</p>`;
  $('todayBacklog').querySelectorAll('[data-b]').forEach((b) => (b.onclick = () => openLog(back[b.dataset.b])));
  const mine = myClasses();
  $('todayProg').innerHTML = mine.length ? '<div class="mini-list">' + mine.map((c) => {
    const k = classKey(c);
    const prog = progressOf(k, c.grade, c.subject);
    const last = logsOf(k).find((l) => l.status !== 'cancel');
    const now = prog ? (prog.last >= 0 ? `${prog.plan.items[prog.last].title} (${prog.last + 1}/${prog.plan.items.length})` : '시작 전') : last ? planTitle(last) || last.content || '기록 있음' : '기록 없음';
    return `<button type="button" class="mini-item" data-k="${esc(k)}"><b>${esc(classLabel(c))}</b><span class="grow">${esc(now)}</span><small>${esc(c.subject)}</small></button>`;
  }).join('') + '</div>' : '<p class="muted small">맡은 반이 아직 없어요.</p>';
  $('todayProg').querySelectorAll('[data-k]').forEach((b) => (b.onclick = () => { S.progressKey = b.dataset.k; go('progress'); }));
}
function planTitle(log) {
  if (!log.planItem) return log.unit || '';
  const it = planOf(log.grade, log.subject)?.items?.find((x) => x.id === log.planItem);
  return it ? it.title : log.unit || '';
}
$('todayDate').onchange = (e) => { if (e.target.value) { S.date = e.target.value; renderToday(); } };

/* ───────── 주간 ───────── */
async function renderWeek() {
  const sel = $('weekSel');
  sel.innerHTML = S.weeks.map((w) => `<option value="${w.r}">${esc(w.label)}${w.r === S.curWeek ? ' (이번 주)' : ''}</option>`).join('');
  if (!S.weeks.length) { $('weekGrid').innerHTML = '<div class="spinner"></div>'; return; }
  sel.value = S.week;
  const w = S.weeks.find((x) => x.r === S.week) || S.weeks[0];
  $('weekSub').textContent = `${S.profile.schoolName} · ${S.profile.teacherName}`;
  if (needWeek(w)) {
    $('weekGrid').innerHTML = '<div class="spinner"></div>';
    try { await loadWeek(w.r); } catch (e) { toast('시간표 불러오기 실패: ' + e.message); }
    if (S.view === 'week') renderWeek();
    return;
  }
  const slots = [];
  for (let d = 0; d < 5; d++) slots.push(...slotsFor(addDays(w.start, d)));
  $('weekGrid').innerHTML = weekTable(slots, w.start);
  $('weekGrid').querySelectorAll('.slot').forEach((b) => (b.onclick = () => openLog(slots[b.dataset.i])));
}
$('weekSel').onchange = (e) => { S.week = Number(e.target.value); renderWeek(); };

// 요일×교시 표. preview: 가입 화면 미리보기(누를 수 없음)
function weekTable(slots, start, { preview } = {}) {
  const maxP = Math.max(6, ...slots.map((s) => s.period), S.times.length ? Math.min(S.times.length, 7) : 0);
  const today = todayISO();
  let h = '<table class="week-grid"><tr><th style="width:52px"></th>';
  for (let d = 0; d < 5; d++) {
    const date = start ? addDays(start, d) : null;
    h += `<th class="${date === today ? 'today' : ''}">${DAYS[d + 1]}${date ? `<small>${md(date)}</small>` : ''}</th>`;
  }
  h += '</tr>';
  for (let p = 1; p <= maxP; p++) {
    h += `<tr><td class="per">${p}<small>${esc(timeOf(p))}</small></td>`;
    for (let d = 1; d <= 5; d++) {
      const date = start ? addDays(start, d - 1) : null;
      const here = slots.map((s, i) => [s, i]).filter(([s]) => s.period === p && (date ? s.date === date : s.day === d));
      h += '<td>' + here.map(([s, i]) => {
        const log = preview ? null : S.logs.get(logId(s));
        const cls = ['slot', log ? 'done' : '', s.changed ? 'chg' : '', s.src === 'extra' ? 'extra' : '', log?.status === 'cancel' ? 'off' : ''].join(' ');
        const note = log ? planTitle(log) || log.content || '' : '';
        return `<button type="button" class="${cls}" data-i="${i}" ${preview ? 'disabled style="cursor:default"' : ''}><b>${esc(classLabel(s))}</b><small>${esc(s.subject)}</small>${note ? `<i>${esc(note)}</i>` : ''}</button>`;
      }).join('') + '</td>';
    }
    h += '</tr>';
  }
  return h + '</table>';
}

/* ───────── 일지 쓰기 ───────── */
let LM = null; // 지금 열린 칸
function openLog(slot) {
  LM = slot;
  const id = logId(slot);
  const log = S.logs.get(id);
  const k = classKey(slot);
  $('lmTitle').textContent = `${classLabel(slot)} · ${slot.subject}`;
  $('lmSub').textContent = `${dateLabel(slot.date)} ${slot.period}교시${timeOf(slot.period) ? ` (${timeOf(slot.period)})` : ''}${slot.changed ? ' · 변경된 수업' : ''}${slot.src === 'extra' ? ` · ${KIND[slot.kind] || '직접 추가'}` : ''}`;
  // 같은 반 바로 전 기록
  const prev = logsOf(k).find((l) => l.id !== id && ord(l) < ord(slot));
  $('lmPrev').innerHTML = prev
    ? `<div class="card" style="padding:12px 14px;margin-bottom:14px;box-shadow:none;background:var(--fill)"><div class="muted small" style="font-weight:700">지난 수업 · ${dateLabel(prev.date)} ${prev.period}교시</div>
       <div style="font-weight:700;margin-top:2px">${esc(planTitle(prev) || '-')}</div>${prev.content ? `<div class="small" style="white-space:pre-wrap;margin-top:2px">${esc(prev.content)}</div>` : ''}${prev.homework ? `<div class="muted small" style="margin-top:2px">과제: ${esc(prev.homework)}</div>` : ''}</div>`
    : '';
  // 진도 계획
  const prog = progressOf(k, slot.grade, slot.subject);
  const plan = planOf(slot.grade, slot.subject);
  $('lmPlanField').classList.toggle('hidden', !plan?.items?.length);
  if (plan?.items?.length) {
    let unit = null;
    const opts = ['<option value="">(계획표에서 고르지 않음)</option>'];
    plan.items.forEach((it) => {
      if (it.unit !== unit) { if (unit !== null) opts.push('</optgroup>'); opts.push(`<optgroup label="${esc(it.unit || '단원 없음')}">`); unit = it.unit; }
      const d = prog?.done.get(it.id);
      opts.push(`<option value="${esc(it.id)}">${esc(it.title)}${d && (!log || log.planItem !== it.id) ? ` ✓ ${md(d)}` : ''}</option>`);
    });
    opts.push('</optgroup>');
    $('lmPlan').innerHTML = opts.join('');
    // 저장된 차시가 없으면(계획을 나중에 만든 경우 포함) 이 반의 다음 차시를 미리 골라둔다
    $('lmPlan').value = log?.planItem || prog?.next?.id || '';
  }
  setSeg('lmStatus', log?.status || (slot.src === 'extra' && slot.kind === 'makeup' ? 'makeup' : 'normal'));
  $('lmUnit').value = log?.unit || '';
  $('lmContent').value = log?.content || '';
  $('lmHomework').value = log?.homework || '';
  $('lmNote').value = log?.note || '';
  $('lmDelete').classList.toggle('hidden', !log && slot.src !== 'extra');
  $('lmDelete').textContent = log ? '일지 삭제' : '추가한 수업 삭제';
  $('logModal').classList.add('show');
}
function setSeg(id, v) { $(id).querySelectorAll('button').forEach((b) => b.classList.toggle('on', b.dataset.v === v)); }
const segVal = (id) => $(id).querySelector('button.on')?.dataset.v;
for (const id of ['lmStatus', 'exKind']) $(id).onclick = (e) => { const b = e.target.closest('button'); if (b) setSeg(id, b.dataset.v); };
const closeLog = () => { $('logModal').classList.remove('show'); LM = null; };
$('lmCancel').onclick = closeLog;
$('lmSave').onclick = async () => {
  if (!LM) return;
  const s = LM;
  const data = {
    date: s.date, period: s.period, grade: s.grade, cls: s.cls, subject: s.subject,
    status: segVal('lmStatus') || 'normal',
    planItem: $('lmPlanField').classList.contains('hidden') ? '' : $('lmPlan').value,
    unit: $('lmUnit').value.trim(), content: $('lmContent').value.trim(),
    homework: $('lmHomework').value.trim(), note: $('lmNote').value.trim(),
    updatedAt: serverTimestamp(),
  };
  $('lmSave').disabled = true;
  try {
    await setDoc(doc(sub('logs'), logId(s)), data);
    toast('저장했어요'); closeLog();
  } catch (e) { toast('저장 실패: ' + e.code); }
  $('lmSave').disabled = false;
};
$('lmDelete').onclick = async () => {
  if (!LM) return;
  const s = LM;
  const log = S.logs.get(logId(s));
  if (log) {
    if (!(await ask('일지 삭제', `${dateLabel(s.date)} ${s.period}교시 ${classLabel(s)} 일지를 지울까요?`, '삭제'))) return;
    await deleteDoc(doc(sub('logs'), logId(s))).catch((e) => toast('삭제 실패: ' + e.code));
  } else if (s.src === 'extra') {
    if (!(await ask('수업 삭제', '직접 추가한 이 수업을 지울까요?', '삭제'))) return;
    await deleteDoc(doc(sub('extras'), s.extraId)).catch((e) => toast('삭제 실패: ' + e.code));
  }
  closeLog(); toast('지웠어요');
};
for (const m of ['logModal', 'extraModal']) $(m).addEventListener('mousedown', (e) => { if (e.target === $(m)) $(m).classList.remove('show'); });
document.addEventListener('keydown', (e) => { if (e.key === 'Escape') document.querySelectorAll('.modal-overlay.show').forEach((m) => m.id !== 'askModal' && m.classList.remove('show')); });

/* ───────── 수업 직접 추가 ───────── */
function openExtra() {
  $('exDate').value = S.date; $('exPeriod').value = 1;
  const mine = myClasses();
  $('subjectList').innerHTML = [...new Set(mine.map((c) => c.subject))].map((s) => `<option value="${esc(s)}">`).join('');
  if (mine[0]) { $('exGrade').value = mine[0].grade; $('exCls').value = mine[0].cls; $('exSubject').value = mine[0].subject; }
  setSeg('exKind', 'makeup');
  $('extraModal').classList.add('show');
}
$('exCancel').onclick = () => $('extraModal').classList.remove('show');
$('exSave').onclick = async () => {
  const data = {
    date: $('exDate').value, period: Number($('exPeriod').value), grade: Number($('exGrade').value), cls: Number($('exCls').value),
    subject: $('exSubject').value.trim(), kind: segVal('exKind') || 'etc', createdAt: serverTimestamp(),
  };
  if (!data.date || !(data.period > 0) || !(data.grade > 0) || !(data.cls > 0) || !data.subject) { toast('날짜·교시·학년·반·과목을 채워주세요'); return; }
  try { await addDoc(sub('extras'), data); $('extraModal').classList.remove('show'); toast('추가했어요'); }
  catch (e) { toast('추가 실패: ' + e.code); }
};

/* ───────── 반별 진도 ───────── */
function renderProgress() {
  const mine = myClasses();
  if (!mine.length) { $('classCards').innerHTML = '<div class="empty-state">시간표를 불러오는 중이거나 맡은 수업이 없어요.</div>'; $('progressDetail').innerHTML = $('progressMatrix').innerHTML = ''; return; }
  if (!S.progressKey || !mine.some((c) => classKey(c) === S.progressKey)) S.progressKey = classKey(mine[0]);
  let subject = null;
  $('classCards').innerHTML = mine.map((c) => {
    const k = classKey(c);
    const logs = logsOf(k);
    const prog = progressOf(k, c.grade, c.subject);
    const last = logs.find((l) => l.status !== 'cancel');
    const head = c.subject !== subject ? `${subject !== null ? '</div>' : ''}<div class="muted small" style="font-weight:700;margin:${subject !== null ? 16 : 0}px 0 8px">${esc(c.subject)}</div><div class="class-cards">` : '';
    subject = c.subject;
    const pct = prog ? Math.round(((prog.last + 1) / prog.plan.items.length) * 100) : 0;
    return head + `<button type="button" class="class-card ${k === S.progressKey ? 'on' : ''}" data-k="${esc(k)}">
      <div class="t">${esc(classLabel(c))}<small>${esc(c.subject)}</small></div>
      <div class="u">${esc(prog ? (prog.last >= 0 ? prog.plan.items[prog.last].title : '아직 시작 전') : last ? planTitle(last) || last.content || '기록 있음' : '기록 없음')}</div>
      <div class="m">기록 ${logs.length}회${last ? ` · 마지막 ${dateLabel(last.date)}` : ''}${prog ? ` · ${prog.last + 1}/${prog.plan.items.length}차시` : ''}</div>
      ${prog ? `<div class="bar"><span style="width:${pct}%"></span></div>` : ''}
    </button>`;
  }).join('') + '</div>';
  $('classCards').querySelectorAll('.class-card').forEach((b) => (b.onclick = () => { S.progressKey = b.dataset.k; renderProgress(); }));

  const cur = mine.find((c) => classKey(c) === S.progressKey);
  const logs = logsOf(S.progressKey);
  const plan = planOf(cur.grade, cur.subject);
  const peers = mine.filter((c) => c.grade === cur.grade && c.subject === cur.subject);
  let html = `<div class="card"><h2>${esc(classLabel(cur))} ${esc(cur.subject)} 수업 기록<span class="right"><button class="btn sm" data-act="export-class">내보내기</button></span></h2>`;
  html += logs.length ? '<div class="timeline">' + logs.map((l) => `<div class="tl-item" data-id="${esc(l.id)}">
      <div class="d">${dateLabel(l.date)}<small>${l.period}교시${l.status !== 'normal' ? ` · ${STATUS[l.status]}` : ''}</small></div>
      <div><div class="u">${esc(planTitle(l) || '(진도 미기록)')}</div>${l.content ? `<div class="c">${esc(l.content)}</div>` : ''}
      ${l.homework || l.note ? `<div class="n">${l.homework ? `과제: ${esc(l.homework)}` : ''}${l.homework && l.note ? ' · ' : ''}${l.note ? `특이사항: ${esc(l.note)}` : ''}</div>` : ''}</div>
    </div>`).join('') + '</div>' : '<div class="empty-state">아직 기록이 없어요. 오늘 수업이나 주간 시간표에서 칸을 눌러 적어보세요.</div>';
  html += '</div>';

  $('progressDetail').innerHTML = html;
  // 같은 학년·과목 반끼리 계획표 대비 진도 비교(넓은 화면에서는 오른쪽 칸)
  html = `<div class="card"><h2>${cur.grade}학년 ${esc(cur.subject)} 반별 진도 비교<span class="right"><button class="btn sm" data-go-plan="${esc(planId(cur.grade, cur.subject))}">${plan ? '계획 고치기' : '계획 만들기'}</button></span></h2>`;
  if (plan?.items?.length) {
    const progs = peers.map((c) => progressOf(classKey(c), c.grade, c.subject));
    html += '<div class="matrix-wrap"><table class="matrix"><tr><th class="item">차시</th>' + peers.map((c) => `<th>${esc(classLabel(c))}</th>`).join('') + '</tr>';
    let unit = null;
    plan.items.forEach((it, i) => {
      if (it.unit !== unit) { unit = it.unit; html += `<tr><td class="unit" colspan="${peers.length + 1}">${esc(unit || '')}</td></tr>`; }
      html += `<tr><td class="item">${esc(it.title)}</td>` + progs.map((p) => {
        const d = p.done.get(it.id);
        return `<td class="${p.last === i ? 'here' : ''}">${d ? `<span class="ck">✓<small>${md(d)}</small></span>` : ''}</td>`;
      }).join('') + '</tr>';
    });
    html += '</table></div>';
  } else {
    html += '<p class="muted small">진도 계획(단원·차시 목록)을 만들면 반마다 어디까지 나갔는지 표로 비교할 수 있어요.</p>';
  }
  $('progressMatrix').innerHTML = html + '</div>';
  $('progressDetail').querySelectorAll('.tl-item').forEach((el) => (el.onclick = () => {
    const l = S.logs.get(el.dataset.id);
    openLog({ date: l.date, period: l.period, grade: l.grade, cls: l.cls, subject: l.subject, src: 'log' });
  }));
  $('progressMatrix').querySelector('[data-go-plan]')?.addEventListener('click', (e) => { S.planKey = e.currentTarget.dataset.goPlan; go('plan'); });
}

/* ───────── 진도 계획 ───────── */
let PLAN_DRAFT = null; // { id, grade, subject, items }
function planTargets() {
  const m = new Map();
  for (const c of myClasses()) m.set(planId(c.grade, c.subject), { grade: c.grade, subject: c.subject });
  for (const p of S.plans.values()) m.set(p.id, { grade: p.grade, subject: p.subject });
  return [...m.entries()].sort((a, b) => a[1].subject.localeCompare(b[1].subject) || a[1].grade - b[1].grade);
}
function renderPlan() {
  const targets = planTargets();
  if (!targets.length) { $('planSel').innerHTML = ''; $('planSide').innerHTML = ''; $('planBody').innerHTML = '<div class="card"><div class="empty-state">시간표를 불러오면 맡은 학년·과목이 여기에 나와요.</div></div>'; return; }
  if (!S.planKey || !targets.some(([id]) => id === S.planKey)) S.planKey = targets[0][0];
  $('planSel').innerHTML = targets.map(([id, t]) => `<option value="${esc(id)}">${t.grade}학년 ${esc(t.subject)}${S.plans.get(id)?.items?.length ? ` (${S.plans.get(id).items.length}차시)` : ''}</option>`).join('');
  $('planSel').value = S.planKey;
  if (!PLAN_DRAFT || PLAN_DRAFT.id !== S.planKey) {
    const t = targets.find(([id]) => id === S.planKey)[1];
    const saved = S.plans.get(S.planKey);
    PLAN_DRAFT = { id: S.planKey, grade: t.grade, subject: t.subject, items: (saved?.items || []).map((x) => ({ ...x })), dirty: false };
  }
  drawPlan();
}
// 연속한 같은 단원끼리 묶는다 → [{ unit, idx: [항목 번호…] }]
function planGroups(items) {
  const gs = [];
  items.forEach((it, i) => {
    if (!gs.length || gs.at(-1).unit !== it.unit) gs.push({ unit: it.unit, idx: [] });
    gs.at(-1).idx.push(i);
  });
  return gs;
}
function drawPlan() {
  const P = PLAN_DRAFT;
  const used = new Set([...S.logs.values()].filter((l) => l.planItem).map((l) => l.planItem));
  const groups = planGroups(P.items);
  $('planBody').innerHTML = `
    <div class="card">
      <h2>${P.grade}학년 ${esc(P.subject)} 차시 목록<span class="right">${P.dirty ? '<span class="badge warn">저장 안 됨</span>' : ''}<button class="btn accent sm" id="planSave" ${P.dirty ? '' : 'disabled'}>저장</button></span></h2>
      ${P.items.length ? '' : '<p class="muted small" style="margin-bottom:12px">아직 차시가 없어요. 단원을 추가하거나, 아래 "여러 줄 붙여넣기"로 한 번에 넣으세요.</p>'}
      ${groups.map((g, gi) => `
        <div class="plan-unit">
          <input class="inp unit-name" data-g="${gi}" value="${esc(g.unit)}" placeholder="단원 이름 (예: 2. 일차방정식)">
        </div>
        <div class="plan-rows">${g.idx.map((i, k) => `
          <div class="plan-row" data-i="${i}">
            <span class="no">${i + 1}</span>
            <input class="inp" data-f="title" value="${esc(P.items[i].title)}" placeholder="차시 내용">
            <span class="acts"><button data-a="up" title="위로" ${k === 0 ? 'disabled' : ''}>↑</button><button data-a="down" title="아래로" ${k === g.idx.length - 1 ? 'disabled' : ''}>↓</button><button data-a="del" ${used.has(P.items[i].id) ? 'disabled title="일지에 쓰인 차시는 못 지워요"' : 'title="삭제"'}>✕</button></span>
          </div>`).join('')}
        </div>
        <button class="btn ghost sm plan-add" data-g="${gi}">+ 이 단원에 차시 추가</button>`).join('')}
      <div class="row" style="margin-top:14px"><button class="btn sm" id="planAddUnit">+ 단원 추가</button></div>
    </div>`;
  if (!$('planBulk')) $('planSide').innerHTML = `
    <div class="card">
      <h2>여러 줄 붙여넣기</h2>
      <p class="muted small" style="margin-bottom:10px"><b>#</b>으로 시작하는 줄은 단원, 나머지는 그 단원의 차시예요.</p>
      <textarea class="inp" id="planBulk" style="min-height:140px" placeholder="# 1. 문자와 식&#10;문자의 사용&#10;식의 값&#10;# 2. 일차방정식&#10;등식의 성질"></textarea>
      <div class="modal-actions"><button class="btn" id="planBulkAdd">목록 뒤에 추가</button></div>
    </div>`;
  const dirty = () => { P.dirty = true; drawPlan(); };
  const markDirty = () => {
    if (P.dirty) return;
    P.dirty = true;
    const b = $('planSave'); b.disabled = false; b.insertAdjacentHTML('beforebegin', '<span class="badge warn">저장 안 됨</span>');
  };
  $('planBody').querySelectorAll('.plan-row input').forEach((inp) => (inp.oninput = () => {
    P.items[inp.closest('.plan-row').dataset.i].title = inp.value; markDirty();
  }));
  // 단원 이름을 고치면 그 묶음의 차시 모두에 반영(다시 그리지 않아 입력 중 커서 유지)
  $('planBody').querySelectorAll('.unit-name').forEach((inp) => (inp.oninput = () => {
    for (const i of groups[inp.dataset.g].idx) P.items[i].unit = inp.value;
    markDirty();
  }));
  $('planBody').querySelectorAll('.unit-name').forEach((inp) => (inp.onchange = () => drawPlan()));
  $('planBody').querySelectorAll('.plan-row .acts button').forEach((b) => (b.onclick = () => {
    const i = Number(b.closest('.plan-row').dataset.i);
    if (b.dataset.a === 'del') P.items.splice(i, 1);
    if (b.dataset.a === 'up') [P.items[i - 1], P.items[i]] = [P.items[i], P.items[i - 1]];
    if (b.dataset.a === 'down') [P.items[i + 1], P.items[i]] = [P.items[i], P.items[i + 1]];
    dirty();
  }));
  $('planBody').querySelectorAll('.plan-add').forEach((b) => (b.onclick = () => {
    const g = groups[b.dataset.g];
    P.items.splice(g.idx.at(-1) + 1, 0, { id: newId(), unit: g.unit, title: '' });
    dirty();
  }));
  $('planAddUnit').onclick = () => { P.items.push({ id: newId(), unit: `${groups.length + 1}단원`, title: '' }); dirty(); };
  $('planBulkAdd').onclick = () => {
    let unit = P.items.at(-1)?.unit || '';
    for (const raw of $('planBulk').value.split('\n')) {
      const line = raw.trim();
      if (!line) continue;
      if (line.startsWith('#')) unit = line.replace(/^#+\s*/, '');
      else P.items.push({ id: newId(), unit, title: line });
    }
    $('planBulk').value = '';
    dirty();
  };
  $('planSave').onclick = async () => {
    const items = P.items.map((x) => ({ id: x.id, unit: x.unit.trim(), title: x.title.trim() })).filter((x) => x.title);
    try {
      await setDoc(doc(sub('plans'), P.id), { grade: P.grade, subject: P.subject, items, updatedAt: serverTimestamp() });
      P.items = items; P.dirty = false; toast('계획을 저장했어요'); drawPlan();
    } catch (e) { toast('저장 실패: ' + e.code); }
  };
}
const newId = () => Math.random().toString(36).slice(2, 10);
$('planSel').onchange = async (e) => {
  if (PLAN_DRAFT?.dirty && !(await ask('저장 안 한 변경', '저장하지 않은 차시 목록이 있어요. 버리고 넘어갈까요?', '버리기'))) { e.target.value = S.planKey; return; }
  S.planKey = e.target.value; PLAN_DRAFT = null; if ($('planBulk')) $('planBulk').value = ''; renderPlan();
};

/* ───────── 내보내기 ───────── */
function exportRows() {
  const from = $('exFrom').value, to = $('exTo').value, k = $('exClass').value;
  return [...S.logs.values()]
    .filter((l) => (!from || l.date >= from) && (!to || l.date <= to) && (!k || classKey(l) === k))
    .sort((a, b) => ord(a).localeCompare(ord(b)) || a.grade - b.grade || a.cls - b.cls);
}
function renderExport() {
  if (!$('exFrom').value) { const t = todayISO(); $('exFrom').value = t.slice(0, 8) + '01'; $('exTo').value = t; }
  const cur = $('exClass').value;
  $('exClass').innerHTML = '<option value="">모든 반</option>' + myClasses().map((c) => `<option value="${esc(classKey(c))}">${esc(classLabel(c))} ${esc(c.subject)}</option>`).join('');
  $('exClass').value = cur;
  const rows = exportRows();
  const label = $('exClass').value ? $('exClass').selectedOptions[0].textContent : '모든 반';
  $('exTitle').textContent = `${S.profile.teacherName} 수업일지 · ${label} · ${$('exFrom').value} ~ ${$('exTo').value} (${rows.length}건)`;
  $('exTable').innerHTML = rows.length ? `<table class="export-table"><tr><th>날짜</th><th>교시</th><th>반</th><th>과목</th><th>상태</th><th>진도</th><th>수업 내용</th><th>과제</th><th>특이사항</th></tr>${
    rows.map((l) => `<tr><td>${dateLabel(l.date)}</td><td>${l.period}</td><td>${esc(classLabel(l))}</td><td>${esc(l.subject)}</td><td>${STATUS[l.status] || ''}</td><td>${esc(planTitle(l))}</td><td class="pre">${esc(l.content)}</td><td>${esc(l.homework)}</td><td class="pre">${esc(l.note)}</td></tr>`).join('')
  }</table>` : '<div class="empty-state">이 기간에 기록이 없어요.</div>';
}
for (const id of ['exFrom', 'exTo', 'exClass']) $(id).onchange = renderExport;
function downloadCsv() {
  const rows = exportRows();
  const cell = (v) => `"${String(v ?? '').replace(/"/g, '""')}"`;
  const lines = [['날짜', '요일', '교시', '학년', '반', '과목', '상태', '진도', '단원·차시(직접)', '수업 내용', '과제', '특이사항']]
    .concat(rows.map((l) => [l.date, DAYS[dow(l.date)], l.period, l.grade, l.cls, l.subject, STATUS[l.status] || '', planTitle(l), l.unit, l.content, l.homework, l.note]));
  const blob = new Blob(['﻿' + lines.map((r) => r.map(cell).join(',')).join('\r\n')], { type: 'text/csv;charset=utf-8' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = `수업일지_${$('exFrom').value}_${$('exTo').value}.csv`;
  a.click(); setTimeout(() => URL.revokeObjectURL(a.href), 1000);
}

/* ───────── 설정 ───────── */
function renderSettings() {
  const p = S.profile;
  $('setInfo').innerHTML = `<div class="pick-list">
    <div class="pick-item" style="cursor:default"><span class="muted small" style="width:70px">계정</span>${esc(S.user.email)}</div>
    <div class="pick-item" style="cursor:default"><span class="muted small" style="width:70px">학교</span>${esc(p.region)} ${esc(p.schoolName)}</div>
    <div class="pick-item" style="cursor:default"><span class="muted small" style="width:70px">이름</span>${esc(p.teacherName)} <span class="muted small">(컴시간 ${p.teacherId}번)</span></div>
  </div>`;
  const d = S.ttDebug;
  $('ttDebug').textContent = d ? `해석: ${d.mode} · 분리 ${d.sep} · 겹침 ${d.clashes} · 전체 수업 ${d.cells}칸` : '';
}

/* ───────── 승인 관리(관리자) ───────── */
function renderAdmin() {
  if (!S.admin || S.view !== 'admin') return;
  const f = S.adminFilter;
  const list = S.users.filter((u) => f === 'all' || u.status === f)
    .sort((a, b) => (b.updatedAt?.seconds || 0) - (a.updatedAt?.seconds || 0));
  const badge = { pending: '<span class="badge warn">대기</span>', approved: '<span class="badge ok">승인</span>', rejected: '<span class="badge off">거절</span>' };
  $('adminList').innerHTML = list.length ? list.map((u) => `<div class="user-row">
    <div style="min-width:0"><div class="nm">${esc(u.teacherName)} ${badge[u.status] || ''} <span class="muted small">${esc(u.name)}</span></div>
      <div class="em">${esc(u.email)} · ${esc(u.region)} ${esc(u.schoolName)} (컴시간 ${u.teacherId}번)</div></div>
    <div class="row">
      ${u.status !== 'approved' ? `<button class="btn accent sm" data-uid="${esc(u.uid)}" data-s="approved">승인</button>` : ''}
      ${u.status === 'pending' ? `<button class="btn danger sm" data-uid="${esc(u.uid)}" data-s="rejected">거절</button>` : ''}
      ${u.status === 'approved' && u.uid !== S.user.uid ? `<button class="btn sm" data-uid="${esc(u.uid)}" data-s="pending">승인 취소</button>` : ''}
    </div></div>`).join('') : '<div class="empty-state">해당하는 선생님이 없어요.</div>';
  $('adminList').querySelectorAll('[data-uid]').forEach((b) => (b.onclick = async () => {
    const data = { status: b.dataset.s, updatedAt: serverTimestamp() };
    if (b.dataset.s === 'approved') data.approvedAt = serverTimestamp();
    try { await updateDoc(doc(db, 'classlog_users', b.dataset.uid), data); toast('바꿨어요'); }
    catch (e) { toast('실패: ' + e.code); }
  }));
}
$('adminSeg').onclick = (e) => {
  const b = e.target.closest('button'); if (!b) return;
  S.adminFilter = b.dataset.f;
  $('adminSeg').querySelectorAll('button').forEach((x) => x.classList.toggle('on', x === b));
  renderAdmin();
};

/* ───────── 버튼 공통 처리 ───────── */
document.addEventListener('click', async (e) => {
  const goBtn = e.target.closest('[data-go]');
  if (goBtn) { go(goBtn.dataset.go); return; }
  const a = e.target.closest('[data-act]');
  if (!a) return;
  const act = a.dataset.act;
  if (act === 'logout') logout();
  else if (act === 'dark') toggleDark();
  else if (act === 'day') { const n = Number(a.dataset.n); S.date = n ? addDays(S.date, n) : todayISO(); renderToday(); }
  else if (act === 'add-extra') openExtra();
  else if (act === 'csv') downloadCsv();
  else if (act === 'print') window.print();
  else if (act === 'export-class') { go('export'); $('exClass').value = S.progressKey; $('exFrom').value = ''; renderExport(); }
  else if (act === 'reload-tt') {
    const r = S.week ?? S.curWeek;
    S.tt.clear(); S.ttFail.clear();
    try { await loadWeek(r, true); toast('시간표를 다시 받았어요(최대 10분 전 자료일 수 있어요)'); } catch (err) { toast('실패: ' + err.message); }
    renderAll();
  }
});
