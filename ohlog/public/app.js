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
  doc, setDoc, updateDoc, deleteDoc, addDoc, collection, onSnapshot, serverTimestamp, query, orderBy, limit,
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
  classCount: [], homeroom: [], teachers: [], clsMode: 'class', tchr: null, cls: null, clsTT: new Map(), stale: new Set(), feedback: [], fbAt: 0,
};

/* ───────── 공통 ───────── */
const $ = (id) => document.getElementById(id);
const store = {
  get: (k) => { try { return localStorage.getItem(k); } catch { return null; } },
  set: (k, v) => { try { localStorage.setItem(k, v); } catch { /* 사파리 사생활 보호 모드 등 */ } },
};
// 학년은 칸 바탕, 과목은 이름 앞 점 — 배경(푸른 라벤더)과 어울리게 같은 차가운 계열에서 채도를 낮춘다.
// 색 값(색조)만 CSS 변수로 넘기고, 채도·밝기·농도는 ohlog.css 가 라이트/다크에 맞게 정한다.
const GRADE_HUE = { 1: 198, 2: 228, 3: 268 };                     // 청회색 → 남색 → 연보라
const SUBJ_HUES = [214, 160, 346, 36, 262, 184, 300, 22];        // 슬레이트·세이지·로즈·샌드·라벤더·틸·모브·테라코타(모두 탁한 톤)
function subjectHue(name) { let h = 0; for (const c of String(name || '')) h = (h * 31 + c.charCodeAt(0)) >>> 0; return SUBJ_HUES[h % SUBJ_HUES.length]; }
const tone = (l) => `--gh:${GRADE_HUE[l.grade] ?? 268};--sh:${subjectHue(l.subject)}`;
const isPhone = () => matchMedia('(max-width: 899px)').matches;
const defaultView = () => (isPhone() ? 'week' : 'today'); // 폰(홈 화면 앱)에서는 처음에 시간표
// 글자 크기(설정) — rem 으로 된 글자가 전부 같이 변한다
const applyFs = (v) => document.documentElement.style.setProperty('--fs', v);
applyFs(store.get('classlog-fs') || '1');
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
      d.teachers.map((t) => `<option value="${t.id}">${esc(tLabel(t))}</option>`).join('');
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
  S.logs.clear(); S.plans.clear(); S.extras.clear(); S.tt.clear(); S.ttLoading.clear(); S.ttFail.clear(); S.clsTT.clear(); S.stale.clear(); S.users = []; S.feedback = [];
  S.weeks = []; S.curWeek = null; S.week = null;
}
async function startApp() {
  stopApp();
  show('app');
  buildMenu(); fillIcons(); fillCredit();
  const live = (name, map) => onSnapshot(sub(name), (snap) => {
    map.clear(); snap.forEach((d) => map.set(d.id, { id: d.id, ...d.data() })); renderAll();
  }, (e) => toast(`${name} 읽기 실패: ${e.code}`));
  S.unsub.push(live('logs', S.logs), live('plans', S.plans), live('extras', S.extras));
  if (S.admin) {
    S.unsub.push(onSnapshot(collection(db, 'classlog_users'), (snap) => {
      S.users = snap.docs.map((d) => ({ uid: d.id, ...d.data() })); renderAdmin(); buildMenu();
    }, (e) => toast('사용자 목록 실패: ' + e.code)));
    S.unsub.push(onSnapshot(query(collection(db, 'classlog_feedback'), orderBy('createdAt', 'desc'), limit(30)), (snap) => {
      S.feedback = snap.docs.map((d) => ({ id: d.id, ...d.data() })); renderAdmin();
    }, () => {}));
  }
  // 지난번 시간표를 먼저 보여주고(홈 화면 앱처럼 바로 열림), 뒤에서 새로 받아 바꾼다
  const cached = restoreTt();
  go(location.hash.slice(1) || defaultView(), true);
  if (cached) renderAll();
  try { await loadWeek(null); } catch (e) { toast('시간표 불러오기 실패: ' + e.message); }
  // 주말이면 다음 주를 먼저 보여준다
  if ([0, 6].includes(dow(todayISO()))) {
    const nx = S.weeks[S.weeks.findIndex((w) => w.r === S.curWeek) + 1];
    if (nx?.start) { S.week = nx.r; S.date = nx.start; }
  }
  renderAll();
  for (const r of [...S.stale]) loadWeek(r, true).then(renderAll).catch(() => {});
}

// 시간표 보관(localStorage): 컴시간이 느리거나 끊겨도 마지막 시간표가 바로 보이게
const ttKey = () => `classlog:tt:${S.profile.schoolCode}:${S.profile.teacherId}`;
function saveTt() {
  store.set(ttKey(), JSON.stringify({ weeks: S.weeks, times: S.times, cur: S.curWeek, classCount: S.classCount, homeroom: S.homeroom, teachers: S.teachers, debug: S.ttDebug, tt: Object.fromEntries(S.tt) }));
}
function restoreTt() {
  try {
    const c = JSON.parse(store.get(ttKey()) || 'null');
    if (!c?.tt) return false;
    S.weeks = c.weeks || []; S.times = c.times || []; S.curWeek = c.cur ?? null; S.week = S.week ?? c.cur ?? null;
    S.classCount = c.classCount || []; S.homeroom = c.homeroom || []; S.teachers = c.teachers || []; S.ttDebug = c.debug || null;
    for (const [r, v] of Object.entries(c.tt)) { S.tt.set(Number(r), v); S.stale.add(Number(r)); }
    return S.tt.size > 0;
  } catch { return false; }
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
      S.weeks = d.weeks; S.times = d.times; S.ttDebug = d.debug; S.classCount = d.classCount || []; S.homeroom = d.homeroom || []; S.teachers = d.teachers || [];
      S.tt.set(r ?? d.week, d.lessons.map(fromComci));
      S.ttFail.delete(r ?? d.week); S.stale.delete(r ?? d.week);
      saveTt();
      // '오늘이 속한 주'는 week 를 안 주고 받았을 때만 알 수 있다(다른 주를 받은 응답으로 정하면 안 됨)
      if (r == null) S.curWeek = d.week;
      if (S.week == null) S.week = S.curWeek ?? d.week;
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
  ['수업', [['today', '오늘 수업', 'sun'], ['week', '시간표', 'calendar'], ['class', '학급·교사 시간표', 'people'], ['progress', '반별 진도', 'chart']]],
  ['관리', [['plan', '진도 계획', 'list'], ['export', '내보내기', 'download'], ['settings', '설정', 'gear'], ['admin', '승인 관리', 'check', true]]],
];
// 폰 하단 탭: 시간표가 맨 앞(처음 열면 시간표). 진도 계획·내보내기는 설정의 바로가기에서도 열 수 있다
const TABS = [['week', '시간표', 'calendar'], ['today', '오늘', 'sun'], ['progress', '진도', 'chart'], ['class', '학급·교사', 'people'], ['settings', '설정', 'gear']];
const ICONS = {
  sun: '<circle cx="12" cy="12" r="4"/><path d="M12 2.5v2M12 19.5v2M4.6 4.6l1.4 1.4M18 18l1.4 1.4M2.5 12h2M19.5 12h2M4.6 19.4 6 18M18 6l1.4-1.4"/>',
  calendar: '<rect x="3.5" y="5" width="17" height="15" rx="2"/><path d="M3.5 10h17M8 3v4M16 3v4"/>',
  chart: '<path d="M4 20V10M10 20V4M16 20v-7M22 20H2"/>',
  list: '<path d="M9 6h11M9 12h11M9 18h11"/><path d="m3.5 6 1 1 2-2M3.5 12l1 1 2-2M3.5 18l1 1 2-2"/>',
  download: '<path d="M12 4v11M7.5 10.5 12 15l4.5-4.5"/><path d="M4 19.5h16"/>',
  gear: '<circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.6 1.6 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.6 1.6 0 0 0-2.7 1.1V21a2 2 0 1 1-4 0v-.1A1.6 1.6 0 0 0 9 19.4a1.6 1.6 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1A1.6 1.6 0 0 0 3.3 14H3a2 2 0 1 1 0-4h.1A1.6 1.6 0 0 0 4.6 9a1.6 1.6 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1A1.6 1.6 0 0 0 9 4.6V3a2 2 0 1 1 4 0v.1a1.6 1.6 0 0 0 2.7 1.1l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.6 1.6 0 0 0 1.1 2.7H21a2 2 0 1 1 0 4h-.1a1.6 1.6 0 0 0-1.5 1.3Z"/>',
  check: '<circle cx="12" cy="12" r="8.5"/><path d="m8 12.2 2.7 2.7L16.2 9"/>',
  people: '<circle cx="9" cy="8" r="3"/><path d="M3.5 19c0-3 2.5-5 5.5-5s5.5 2 5.5 5"/><circle cx="17" cy="9" r="2.4"/><path d="M14.8 19c.2-2.3 1.9-4 3.9-4.3"/>',
  clipboard: '<rect x="5" y="5" width="14" height="16" rx="2"/><rect x="9" y="3.3" width="6" height="3.2" rx="1"/><path d="M8 12h8M8 16h6"/>',
  clock: '<circle cx="12" cy="12" r="8.5"/><path d="M12 7.5V12l3 2"/>',
  doc: '<path d="M7 3.5h7l4 4v13a1 1 0 0 1-1 1H7a1 1 0 0 1-1-1V4.5a1 1 0 0 1 1-1Z"/><path d="M14 3.5V8h4M8.5 13h7M8.5 16.5H13"/>',
  bell: '<path d="M6 17V11a6 6 0 0 1 12 0v6l1.5 2h-15z"/><path d="M10 21h4"/>',
  chat: '<path d="M4 5.5h16a1 1 0 0 1 1 1V16a1 1 0 0 1-1 1H9l-4.5 4V17H4a1 1 0 0 1-1-1V6.5a1 1 0 0 1 1-1Z"/>',
  phone: '<rect x="7" y="3" width="10" height="18" rx="2.5"/><path d="M11 18h2"/>',
  text: '<path d="M4 19 9.5 5 15 19M6 14h7M16.5 19l2.5-6 2.5 6M17.4 17h3.2"/>',
  ig: '<rect x="4" y="4" width="16" height="16" rx="4.5"/><circle cx="12" cy="12" r="3.6"/><circle cx="16.6" cy="7.4" r=".6"/>',
  mail: '<rect x="3.5" y="5.5" width="17" height="13" rx="2"/><path d="m4 7 8 6 8-6"/>',
};
const icon = (n, s) => `<svg width="${s}" height="${s}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${ICONS[n]}</svg>`;
// 카드 머리글: 아이콘 + 제목 + 한 줄 설명 (+ 오른쪽 버튼) — 상자마다 역할이 보이게
const ch = (ic, title, desc = '', right = '') => `<h2><span class="icon">${icon(ic, 17)}</span><span class="ttl">${title}${desc ? `<small>${desc}</small>` : ''}</span>${right ? `<span class="right">${right}</span>` : ''}</h2>`;
function fillIcons() { document.querySelectorAll('[data-ic]').forEach((el) => { el.innerHTML = icon(el.dataset.ic, 17); }); }
// 저작권·문의 푸터: 문구는 저작권만, 인스타·메일·피드백은 아이콘만(이름은 aria-label·title)
function fillCredit() {
  document.querySelectorAll('.credit-slot').forEach((el) => {
    el.innerHTML = `<div>© ${new Date().getFullYear()} 관산중학교 오범석 · 수업일지</div><div class="links">
      <a href="https://instagram.com/nosuk.beom" target="_blank" rel="noopener" aria-label="인스타그램 @nosuk.beom" title="인스타그램 @nosuk.beom">${icon('ig', 18)}</a>
      <a href="mailto:qjatjr7575@gmail.com" aria-label="메일 qjatjr7575@gmail.com" title="메일 qjatjr7575@gmail.com">${icon('mail', 18)}</a>
      ${el.dataset.fb ? `<button type="button" class="link-btn" data-act="feedback" aria-label="피드백 남기기" title="피드백 남기기">${icon('chat', 18)}</button>` : ''}</div>`;
  });
}
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
  if (!$('sec-' + view) || (view === 'admin' && !S.admin)) view = defaultView();
  S.view = view;
  document.querySelectorAll('.section').forEach((s) => s.classList.toggle('active', s.id === 'sec-' + view));
  const title = { today: '오늘 수업', week: '시간표', class: '학급·교사 시간표', progress: '반별 진도', plan: '진도 계획', export: '내보내기', settings: '설정', admin: '승인 관리' }[view];
  $('navTitle').textContent = title;
  if (replace) history.replaceState(null, '', '#' + view); else history.pushState(null, '', '#' + view);
  markMenu();
  renderView();
  window.scrollTo(0, 0);
}
window.addEventListener('popstate', () => { if (!$('app').classList.contains('hidden')) go(location.hash.slice(1) || defaultView(), true); });

function renderAll() { if ($('app').classList.contains('hidden')) return; buildMenu(); renderView(); }
function renderView() {
  ({ today: renderToday, week: renderWeek, class: renderClass, progress: renderProgress, plan: renderPlan, export: renderExport, settings: renderSettings, admin: renderAdmin })[S.view]?.();
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
  const nowP = date === todayISO() ? currentPeriod() : 0;
  $('todayList').innerHTML = slots.map((s, i) => {
    const log = S.logs.get(logId(s));
    const prog = progressOf(classKey(s), s.grade, s.subject);
    const what = log ? [planTitle(log), log.content].filter(Boolean).join(' · ') || '작성함'
      : prog?.next ? `다음 차시: ${prog.next.title}` : '아직 안 썼어요';
    return `<div class="lesson ${s.period === nowP ? 'now' : ''}" style="${tone(s)}" data-slot="${i}" role="button" tabindex="0">
      <div class="per"><b>${s.period}</b><small>${esc(timeOf(s.period))}</small></div>
      <div style="min-width:0">
        <div class="who">${esc(classLabel(s))} <span class="subj">${esc(s.subject)}</span>
          ${s.period === nowP ? '<span class="badge now-badge">지금</span>' : ''}${s.changed ? '<span class="badge warn">변경</span>' : ''}${s.src === 'extra' ? `<span class="badge on">${KIND[s.kind] || '추가'}</span>` : ''}
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
// 진도 표시: 직접 적은(또는 목록에서 고른) 글자가 먼저, 없으면 계획표의 차시 이름
function planTitle(log) {
  if (log.unit) return log.unit;
  if (!log.planItem) return '';
  return planOf(log.grade, log.subject)?.items?.find((x) => x.id === log.planItem)?.title || '';
}
// 지금이 몇 교시인지(교시별 시작 시각에서 50분)
function currentPeriod() {
  const d = new Date(); const now = d.getHours() * 60 + d.getMinutes();
  for (let p = 1; p <= S.times.length; p++) {
    const m = timeOf(p).match(/(\d+):(\d+)/); if (!m) continue;
    const st = Number(m[1]) * 60 + Number(m[2]);
    if (now >= st && now < st + 50) return p;
  }
  return 0;
}
$('todayList').addEventListener('keydown', (e) => { if ((e.key === 'Enter' || e.key === ' ') && e.target.classList.contains('lesson')) { e.preventDefault(); e.target.click(); } });
$('todayDate').onchange = (e) => { if (e.target.value) { S.date = e.target.value; renderToday(); } };

/* ───────── 주간 ───────── */
// 주 선택(내 시간표·학급 시간표가 같은 주를 본다): 이전·다음 버튼과 목록
function syncWeekControls() {
  // 폰에서 잘리지 않게 "10/26 ~ 10/31" 짧은 모양으로
  const opts = S.weeks.map((w) => `<option value="${w.r}">${w.start ? `${md(w.start)} ~ ${md(addDays(w.start, 5))}` : esc(w.label)}${w.r === S.curWeek ? ' · 이번 주' : ''}</option>`).join('');
  for (const id of ['weekSel', 'clsWeekSel']) { $(id).innerHTML = opts; if (S.week != null) $(id).value = S.week; }
  const i = S.weeks.findIndex((w) => w.r === S.week);
  document.querySelectorAll('[data-act="wk"]').forEach((b) => {
    const n = Number(b.dataset.n);
    b.disabled = n === -1 ? i <= 0 : n === 1 ? i < 0 || i >= S.weeks.length - 1 : S.week === S.curWeek;
  });
}
async function renderWeek() {
  syncWeekControls();
  if (!S.weeks.length) { $('weekGrid').innerHTML = '<div class="spinner"></div>'; return; }
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
for (const id of ['weekSel', 'clsWeekSel']) $(id).onchange = (e) => { S.week = Number(e.target.value); renderView(); };

// 요일×교시 표. preview: 가입 화면 미리보기(누를 수 없음). cell: 칸 모양을 바꿀 때(학급 시간표)
function weekTable(slots, start, { preview, cell } = {}) {
  const maxP = Math.max(6, ...slots.map((s) => s.period), S.times.length ? Math.min(S.times.length, 7) : 0);
  const today = todayISO();
  let h = '<table class="week-grid"><tr><th></th>';
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
      h += `<td class="${date && date === today ? 'tdy' : ''}">` + here.map(([s, i]) => cell ? cell(s, i) : ownCell(s, i, preview)).join('') + '</td>';
    }
    h += '</tr>';
  }
  return h + '</table>';
}
function ownCell(s, i, preview) {
  const log = preview ? null : S.logs.get(logId(s));
  const cls = ['slot', log ? 'done' : '', s.changed ? 'chg' : '', s.src === 'extra' ? 'extra' : '', log?.status === 'cancel' ? 'off' : ''].join(' ');
  const note = log ? planTitle(log) || log.content || '' : '';
  return `<button type="button" class="${cls}" data-i="${i}" style="${tone(s)}${preview ? ';cursor:default' : ''}" ${preview ? 'disabled' : ''}><b>${esc(classLabel(s))}</b><small>${esc(s.subject)}</small>${note ? `<i>${esc(note)}</i>` : ''}</button>`;
}

/* ───────── 학급·교사 시간표(보기 전용) ───────── */
// 학급별: 담임이 반 시간표를 확인 / 교사별: 다른 선생님 수업 확인. 칸은 div 라서 눌러도 일지가 열리지 않는다(일지는 내 수업만).
const tLabel = (t) => `${t.name}${t.subjects?.length ? ` · ${t.subjects.join('·')}` : ''}`;
async function renderClass() {
  syncWeekControls();
  const cc = S.classCount;
  if (!cc.length || !S.weeks.length) { $('clsGrid').innerHTML = '<div class="spinner"></div>'; return; }
  const teacherMode = S.clsMode === 'teacher';
  $('clsMode').querySelectorAll('button').forEach((b) => b.classList.toggle('on', b.dataset.v === (teacherMode ? 'teacher' : 'class')));
  for (const id of ['clsGrade', 'clsNum']) $(id).classList.toggle('hidden', teacherMode);
  $('clsTeacher').classList.toggle('hidden', !teacherMode);
  const w = S.weeks.find((x) => x.r === S.week) || S.weeks[0];
  let key, qs, title, badge = '', sub;
  if (teacherMode) {
    if (!S.teachers.length) { $('clsGrid').innerHTML = '<div class="spinner"></div>'; return; }
    if (!S.tchr || !S.teachers.some((t) => t.id === S.tchr)) S.tchr = (S.teachers.find((t) => t.id !== S.profile.teacherId) || S.teachers[0]).id;
    $('clsTeacher').innerHTML = S.teachers.map((t) => `<option value="${t.id}">${esc(tLabel(t))}${t.id === S.profile.teacherId ? ' (나)' : ''}</option>`).join('');
    $('clsTeacher').value = S.tchr;
    const t = S.teachers.find((x) => x.id === S.tchr);
    title = `${t.name} 선생님 시간표`; sub = `${t.subjects.join('·') || '담당 과목 없음'} · 반·과목 (컴시간 기준)`;
    badge = t.id === S.profile.teacherId ? '<span class="badge on">나 · 일지는 ‘시간표’에서</span>' : '<span class="badge muted">보기 전용</span>';
    key = `${w.r}|t${t.id}`; qs = `code=${S.profile.schoolCode}&week=${w.r}&teacher=${t.id}`;
  } else {
    if (!S.cls) {
      const hr = S.homeroom[0], mine = myClasses()[0];
      S.cls = hr ? { grade: hr.grade, cls: hr.class } : mine ? { grade: mine.grade, cls: mine.cls } : { grade: 1, cls: 1 };
    }
    const grades = []; for (let g = 1; g < cc.length; g++) if (cc[g] > 0) grades.push(g);
    if (!grades.includes(S.cls.grade)) S.cls = { grade: grades[0] || 1, cls: 1 };
    S.cls.cls = Math.min(Math.max(S.cls.cls, 1), cc[S.cls.grade] || 1);
    $('clsGrade').innerHTML = grades.map((g) => `<option value="${g}">${g}학년</option>`).join('');
    $('clsGrade').value = S.cls.grade;
    $('clsNum').innerHTML = Array.from({ length: cc[S.cls.grade] || 1 }, (_, i) => `<option value="${i + 1}">${i + 1}반</option>`).join('');
    $('clsNum').value = S.cls.cls;
    const { grade, cls } = S.cls;
    title = `${grade}학년 ${cls}반 시간표`; sub = '과목 · 선생님 (컴시간 기준)';
    badge = S.homeroom.some((h) => h.grade === grade && h.class === cls) ? '<span class="badge on">내 담임 반</span>' : '<span class="badge muted">보기 전용</span>';
    key = `${w.r}|${grade}-${cls}`; qs = `code=${S.profile.schoolCode}&week=${w.r}&grade=${grade}&class=${cls}`;
  }
  $('clsTitle').textContent = title; $('clsSub').textContent = sub; $('clsBadge').innerHTML = badge;
  if (!S.clsTT.has(key)) {
    $('clsGrid').innerHTML = '<div class="spinner"></div>';
    try {
      const d = await api(qs);
      S.clsTT.set(key, (teacherMode ? d.lessons : d.classLessons) || []);
    } catch (e) { $('clsGrid').innerHTML = `<div class="empty-state">불러오지 못했어요: ${esc(e.message)}</div>`; return; }
    if (S.view === 'class') renderClass();
    return;
  }
  const lessons = S.clsTT.get(key);
  $('clsGrid').innerHTML = lessons.length ? weekTable(lessons, w.start, {
    cell: teacherMode
      ? (l) => `<div class="slot ro ${l.changed ? 'chg' : ''}" style="--gh:${GRADE_HUE[l.grade] ?? 268};--sh:${subjectHue(l.subjectName)}"><b>${l.grade}-${l.class}</b><small>${esc(l.subjectName)}${l.room ? ` · ${esc(l.room)}` : ''}</small></div>`
      : (l) => `<div class="slot ro bysubj ${l.changed ? 'chg' : ''} ${l.teacher === S.profile.teacherId ? 'mine' : ''}" style="--gh:${subjectHue(l.subjectName)};--sh:${subjectHue(l.subjectName)}"><b>${esc(l.subjectName)}</b><small>${esc(l.teacherName)}${l.room ? ` · ${esc(l.room)}` : ''}</small></div>`,
  }) : '<div class="empty-state">이 주에는 수업이 없어요.</div>';
}
$('clsGrade').onchange = (e) => { S.cls = { grade: Number(e.target.value), cls: 1 }; renderClass(); };
$('clsNum').onchange = (e) => { S.cls = { ...S.cls, cls: Number(e.target.value) }; renderClass(); };
$('clsTeacher').onchange = (e) => { S.tchr = Number(e.target.value); renderClass(); };
$('clsMode').onclick = (e) => { const b = e.target.closest('button'); if (!b) return; S.clsMode = b.dataset.v; renderClass(); };

/* ───────── 일지 쓰기 ───────── */
// 진도는 '직접 적기'가 기본. ▾ 를 누르면 계획표·이전에 쓴 진도에서 골라 채운다.
let LM = null;        // 지금 열린 칸
let LM_SNAP = '';     // 열었을 때 입력 상태(닫을 때 바뀌었는지 확인)
let LM_PICK = null;   // 목록에서 고른 계획 차시 { id, title } — 글자를 안 고쳤을 때만 계획표와 연결
let LM_NEXT = null;   // 같은 날 다음 미작성 수업
const lmState = () => JSON.stringify([segVal('lmStatus'), $('lmUnit').value, $('lmContent').value, $('lmHomework').value, $('lmNote').value]);

function openLog(slot) {
  LM = slot;
  const id = logId(slot);
  const log = S.logs.get(id);
  const k = classKey(slot);
  closeCombos();
  $('lmTitle').textContent = `${classLabel(slot)} · ${slot.subject}`;
  $('lmSub').textContent = `${dateLabel(slot.date)} ${slot.period}교시${timeOf(slot.period) ? ` (${timeOf(slot.period)})` : ''}${slot.changed ? ' · 변경된 수업' : ''}${slot.src === 'extra' ? ` · ${KIND[slot.kind] || '직접 추가'}` : ''}`;
  // 같은 반 바로 전 기록
  const prev = logsOf(k).find((l) => l.id !== id && ord(l) < ord(slot));
  $('lmPrev').innerHTML = prev
    ? `<div class="inset" style="margin-bottom:14px"><div class="muted small" style="font-weight:700">지난 수업 · ${dateLabel(prev.date)} ${prev.period}교시</div>
       <div style="font-weight:700;margin-top:2px">${esc(planTitle(prev) || '(진도 미기록)')}</div>${prev.content ? `<div class="small" style="white-space:pre-wrap;margin-top:2px">${esc(prev.content)}</div>` : ''}${prev.homework ? `<div class="muted small" style="margin-top:2px">과제: ${esc(prev.homework)}</div>` : ''}</div>`
    : '';
  setSeg('lmStatus', log?.status || (slot.src === 'extra' && slot.kind === 'makeup' ? 'makeup' : 'normal'));
  $('lmUnit').value = log ? planTitle(log) : '';
  LM_PICK = log?.planItem ? { id: log.planItem, title: planTitle(log) } : null;
  $('lmContent').value = log?.content || '';
  $('lmHomework').value = log?.homework || '';
  $('lmNote').value = log?.note || '';
  updateSuggest();
  const day = slotsFor(slot.date);
  LM_NEXT = day.slice(day.findIndex((x) => logId(x) === id) + 1).find((x) => !S.logs.has(logId(x))) || null;
  $('lmSaveNext').classList.toggle('hidden', !LM_NEXT);
  $('lmDelete').classList.toggle('hidden', !log && slot.src !== 'extra');
  $('lmDelete').textContent = log ? '일지 삭제' : '추가한 수업 삭제';
  $('logModal').classList.add('show');
  LM_SNAP = lmState();
}
// 비어 있고 계획표가 있으면 '다음 차시' 한 줄만 작게 권한다(누를 때만 채움)
function updateSuggest() {
  const el = $('lmSuggest');
  const prog = LM && progressOf(classKey(LM), LM.grade, LM.subject);
  if (prog?.next && !$('lmUnit').value.trim()) {
    el.innerHTML = `<button type="button" class="suggest">다음 차시 · <span>${esc(prog.next.title)}</span></button>`;
    el.firstChild.onclick = () => { $('lmUnit').value = prog.next.title; LM_PICK = { id: prog.next.id, title: prog.next.title }; updateSuggest(); };
  } else el.innerHTML = '';
}
$('lmUnit').addEventListener('input', updateSuggest);

function closeCombos() { document.querySelectorAll('.combo-menu').forEach((m) => m.classList.add('hidden')); }
document.addEventListener('pointerdown', (e) => { if (!e.target.closest('.combo')) closeCombos(); });
function toggleCombo(menuId, html) {
  const m = $(menuId);
  const willOpen = m.classList.contains('hidden');
  closeCombos();
  if (!willOpen) return;
  m.innerHTML = html; m.classList.remove('hidden');
  m.scrollIntoView({ block: 'nearest' });
}
// 진도 목록: ① 계획표(다음 차시 강조·한 날짜 표시) ② 이 학년·과목에서 이전에 쓴 진도
function unitMenuHtml(slot) {
  const k = classKey(slot);
  const plan = planOf(slot.grade, slot.subject);
  const prog = progressOf(k, slot.grade, slot.subject);
  let h = '';
  if (plan?.items?.length) {
    h += '<div class="combo-sec">진도 계획표에서 고르기</div>';
    let unit = null;
    for (const it of plan.items) {
      if (it.unit !== unit) { unit = it.unit; h += `<div class="combo-grp">${esc(unit || '단원 없음')}</div>`; }
      const d = prog?.done.get(it.id), isNext = prog?.next?.id === it.id;
      h += `<button type="button" class="combo-opt ${isNext ? 'next' : ''} ${d ? 'done' : ''}" data-plan="${esc(it.id)}" data-text="${esc(it.title)}"><span class="tx">${esc(it.title)}</span><small>${isNext ? '다음 차시' : d ? `✓ ${md(d)}` : ''}</small></button>`;
    }
  }
  const seen = new Set(), prev = [];
  for (const l of [...S.logs.values()].filter((x) => x.grade === slot.grade && x.subject === slot.subject && x.id !== logId(slot)).sort((a, b) => ord(b).localeCompare(ord(a)))) {
    const t = planTitle(l);
    if (!t || seen.has(t)) continue;
    seen.add(t); prev.push({ t, plan: l.planItem || '', from: `${classLabel(l)} · ${md(l.date)}` });
    if (prev.length >= 10) break;
  }
  if (prev.length) {
    h += '<div class="combo-sec">이전에 쓴 진도</div>';
    for (const p of prev) h += `<button type="button" class="combo-opt" data-plan="${esc(p.plan)}" data-text="${esc(p.t)}"><span class="tx">${esc(p.t)}</span><small>${esc(p.from)}</small></button>`;
  }
  return h || '<div class="combo-empty">아직 고를 항목이 없어요. 직접 적으면 다음부터 여기에 나타나고, 진도 계획을 만들면 계획표도 나와요.</div>';
}
function contentMenuHtml(slot) {
  const k = classKey(slot);
  const seen = new Set(), rows = [];
  const logs = [...S.logs.values()].filter((x) => x.grade === slot.grade && x.subject === slot.subject && x.id !== logId(slot) && x.content)
    .sort((a, b) => (classKey(b) === k) - (classKey(a) === k) || ord(b).localeCompare(ord(a)));
  for (const l of logs) { if (seen.has(l.content)) continue; seen.add(l.content); rows.push(l); if (rows.length >= 8) break; }
  return rows.length
    ? '<div class="combo-sec">이전에 쓴 수업 내용</div>' + rows.map((l) => `<button type="button" class="combo-opt" data-text="${esc(l.content)}"><span class="tx">${esc(l.content)}</span><small>${esc(classLabel(l))} · ${md(l.date)}</small></button>`).join('')
    : '<div class="combo-empty">이 학년·과목에서 쓴 수업 내용이 아직 없어요.</div>';
}
$('lmUnitBtn').onclick = () => toggleCombo('lmUnitMenu', unitMenuHtml(LM));
$('lmContentBtn').onclick = () => toggleCombo('lmContentMenu', contentMenuHtml(LM));
$('lmUnitMenu').onclick = (e) => {
  const b = e.target.closest('.combo-opt'); if (!b) return;
  $('lmUnit').value = b.dataset.text; LM_PICK = b.dataset.plan ? { id: b.dataset.plan, title: b.dataset.text } : null;
  closeCombos(); updateSuggest();
};
$('lmContentMenu').onclick = (e) => {
  const b = e.target.closest('.combo-opt'); if (!b) return;
  const cur = $('lmContent').value.trim();
  $('lmContent').value = cur ? `${cur}\n${b.dataset.text}` : b.dataset.text;
  closeCombos();
};

function setSeg(id, v) { $(id).querySelectorAll('button').forEach((b) => b.classList.toggle('on', b.dataset.v === v)); }
const segVal = (id) => $(id).querySelector('button.on')?.dataset.v;
for (const id of ['lmStatus', 'exKind', 'fbKind']) $(id).onclick = (e) => { const b = e.target.closest('button'); if (b) setSeg(id, b.dataset.v); };
const closeLog = () => { $('logModal').classList.remove('show'); closeCombos(); LM = null; };
// 쓰던 내용이 있으면 닫기 전에 한 번 묻는다(실수로 바깥을 눌러도 안 날아가게)
async function tryCloseLog() {
  if (LM && lmState() !== LM_SNAP && !(await ask('저장하지 않고 닫을까요?', '쓰던 내용이 사라져요.', '닫기'))) return;
  closeLog();
}
$('lmCancel').onclick = tryCloseLog;
$('logModal').addEventListener('mousedown', (e) => { if (e.target === $('logModal')) tryCloseLog(); });
async function saveLog() {
  if (!LM) return false;
  const s = LM, unit = $('lmUnit').value.trim();
  const data = {
    date: s.date, period: s.period, grade: s.grade, cls: s.cls, subject: s.subject,
    status: segVal('lmStatus') || 'normal',
    planItem: LM_PICK && LM_PICK.title === unit ? LM_PICK.id : '',
    unit, content: $('lmContent').value.trim(),
    homework: $('lmHomework').value.trim(), note: $('lmNote').value.trim(),
    updatedAt: serverTimestamp(),
  };
  $('lmSave').disabled = $('lmSaveNext').disabled = true;
  try { await setDoc(doc(sub('logs'), logId(s)), data); toast('저장했어요'); return true; }
  catch (e) { toast('저장 실패: ' + e.code); return false; }
  finally { $('lmSave').disabled = $('lmSaveNext').disabled = false; }
}
$('lmSave').onclick = async () => { if (await saveLog()) closeLog(); };
$('lmSaveNext').onclick = async () => { const nx = LM_NEXT; if (await saveLog()) { closeLog(); if (nx) openLog(nx); } };
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
for (const m of ['extraModal', 'fbModal']) $(m).addEventListener('mousedown', (e) => { if (e.target === $(m)) $(m).classList.remove('show'); });
document.addEventListener('keydown', (e) => {
  if (e.key !== 'Escape') return;
  if ($('askModal').classList.contains('show')) return;
  if ($('logModal').classList.contains('show')) { tryCloseLog(); return; }
  document.querySelectorAll('.modal-overlay.show').forEach((m) => m.classList.remove('show'));
});

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
    return head + `<button type="button" class="class-card ${k === S.progressKey ? 'on' : ''}" style="${tone(c)}" data-k="${esc(k)}">
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
  let html = `<div class="card">${ch('clipboard', `${esc(classLabel(cur))} ${esc(cur.subject)} 수업 기록`, '날짜순 · 눌러서 고칠 수 있어요', '<button class="btn sm" data-act="export-class">내보내기</button>')}`;
  html += logs.length ? '<div class="timeline">' + logs.map((l) => `<div class="tl-item" data-id="${esc(l.id)}">
      <div class="d">${dateLabel(l.date)}<small>${l.period}교시${l.status !== 'normal' ? ` · ${STATUS[l.status]}` : ''}</small></div>
      <div><div class="u">${esc(planTitle(l) || '(진도 미기록)')}</div>${l.content ? `<div class="c">${esc(l.content)}</div>` : ''}
      ${l.homework || l.note ? `<div class="n">${l.homework ? `과제: ${esc(l.homework)}` : ''}${l.homework && l.note ? ' · ' : ''}${l.note ? `특이사항: ${esc(l.note)}` : ''}</div>` : ''}</div>
    </div>`).join('') + '</div>' : '<div class="empty-state">아직 기록이 없어요. 오늘 수업이나 주간 시간표에서 칸을 눌러 적어보세요.</div>';
  html += '</div>';

  $('progressDetail').innerHTML = html;
  // 같은 학년·과목 반끼리 계획표 대비 진도 비교(넓은 화면에서는 오른쪽 칸)
  html = `<div class="card">${ch('chart', `${cur.grade}학년 ${esc(cur.subject)} 반별 진도 비교`, '반마다 어느 차시까지 했는지', `<button class="btn sm" data-go-plan="${esc(planId(cur.grade, cur.subject))}">${plan ? '계획 고치기' : '계획 만들기'}</button>`)}`;
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
      ${ch('list', `${P.grade}학년 ${esc(P.subject)} 차시 목록`, '단원 이름 아래에 차시를 적어요', `${P.dirty ? '<span class="badge warn">저장 안 됨</span>' : ''}<button class="btn accent sm" id="planSave" ${P.dirty ? '' : 'disabled'}>저장</button>`)}
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
      ${ch('doc', '여러 줄 붙여넣기', '많은 차시를 한 번에 넣을 때')}
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
  $('ttDebug').textContent = d ? `해석: ${d.mode} · 분리 ${d.sep} · 겹침 ${d.clashes} · 전체 수업 ${d.cells}칸 · 담임표 ${d.homeroom}` : '';
  const fs = store.get('classlog-fs') || '1';
  $('fsSeg').querySelectorAll('button').forEach((b) => b.classList.toggle('on', b.dataset.v === fs));
  const ios = /iphone|ipad|ipod/i.test(navigator.userAgent);
  const standalone = navigator.standalone || matchMedia('(display-mode: standalone)').matches;
  $('iosTip').classList.toggle('hidden', !(ios && !standalone));
}
$('fsSeg').onclick = (e) => { const b = e.target.closest('button'); if (!b) return; store.set('classlog-fs', b.dataset.v); applyFs(b.dataset.v); renderSettings(); };

/* ───────── 승인 관리(관리자) ───────── */
const FB_KIND = { idea: '기능 제안', ux: '불편한 점', bug: '오류 신고', etc: '기타' };
function renderAdmin() {
  if (!S.admin || S.view !== 'admin') return;
  $('adminFeedback').innerHTML = S.feedback.length ? S.feedback.map((f) => `<div class="user-row"><div style="min-width:0">
    <div class="nm">${esc(FB_KIND[f.kind] || '기타')} <span class="muted small" style="font-weight:500">${esc(f.teacherName)} · ${esc(f.schoolName)}${f.createdAt?.toDate ? ` · ${md(todayISO(f.createdAt.toDate()))}` : ''}</span></div>
    <div style="white-space:pre-wrap;font-size:0.92rem;margin-top:2px">${esc(f.text)}</div></div></div>`).join('') : '<div class="empty-state">아직 받은 피드백이 없어요.</div>';
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

/* ───────── 피드백(질문방과 같은 Apps Script → 텔레그램 알림) ───────── */
// ohinfo 질문방(qna.html)이 쓰는 웹앱을 그대로 쓴다. 알림이 실패해도 Firestore 에는 남는다.
const GAS_URL = 'https://script.google.com/macros/s/AKfycbzepbMXVCYAwoBcmFbmWQWRes1bSGfvhVHKGFNX6VHanVy-1mirxLkyHlROp0-agBX2/exec';
const GAS_SECRET = 'ohweb-upload-2026';
function openFeedback() {
  if (S.profile?.status !== 'approved') { toast('승인된 뒤에 보낼 수 있어요'); return; }
  $('fbText').value = ''; $('fbCount').textContent = '0'; setSeg('fbKind', 'idea');
  $('fbModal').classList.add('show');
}
$('fbText').addEventListener('input', () => { $('fbCount').textContent = String($('fbText').value.length); });
$('fbCancel').onclick = () => $('fbModal').classList.remove('show');
$('fbSend').onclick = async () => {
  const text = $('fbText').value.trim();
  if (!text) { toast('내용을 적어주세요'); return; }
  if (Date.now() - S.fbAt < 15000) { toast('잠시 뒤에 다시 보내주세요'); return; }
  const kind = segVal('fbKind') || 'etc', p = S.profile;
  $('fbSend').disabled = true;
  try {
    await addDoc(collection(db, 'classlog_feedback'), {
      uid: S.user.uid, email: S.user.email, teacherName: p.teacherName, schoolName: p.schoolName,
      kind, text, view: S.view, ua: navigator.userAgent.slice(0, 160), createdAt: serverTimestamp(),
    });
    fetch(GAS_URL, { method: 'POST', body: JSON.stringify({
      secret: GAS_SECRET, action: 'notify',
      studentName: `[수업일지 ${FB_KIND[kind]}] ${p.teacherName}`, school: p.schoolName, grade: '', class: '', number: '',
      preview: `${text}\n— ${p.teacherName} (${p.schoolName}, ${S.user.email})`,
    }) }).catch(() => {}); // 알림 실패는 조용히(기록은 이미 저장됨)
    S.fbAt = Date.now();
    $('fbModal').classList.remove('show'); toast('보냈어요. 고맙습니다!');
  } catch (e) { toast('보내기 실패: ' + e.code); }
  $('fbSend').disabled = false;
};

/* ───────── 버튼 공통 처리 ───────── */
document.addEventListener('click', async (e) => {
  if (e.target.closest('[data-home]')) { e.preventDefault(); go(defaultView()); return; }
  const goBtn = e.target.closest('[data-go]');
  if (goBtn) { go(goBtn.dataset.go); return; }
  const a = e.target.closest('[data-act]');
  if (!a) return;
  const act = a.dataset.act;
  if (act === 'logout') logout();
  else if (act === 'dark') toggleDark();
  else if (act === 'day') { const n = Number(a.dataset.n); S.date = n ? addDays(S.date, n) : todayISO(); renderToday(); }
  else if (act === 'add-extra') openExtra();
  else if (act === 'feedback') openFeedback();
  else if (act === 'wk') {
    const n = Number(a.dataset.n), i = S.weeks.findIndex((w) => w.r === S.week);
    S.week = n === 0 ? S.curWeek : S.weeks[i + n]?.r ?? S.week;
    renderView();
  }
  else if (act === 'csv') downloadCsv();
  else if (act === 'print') window.print();
  else if (act === 'export-class') { go('export'); $('exClass').value = S.progressKey; $('exFrom').value = ''; renderExport(); }
  else if (act === 'reload-tt') {
    const r = S.week ?? S.curWeek;
    S.tt.clear(); S.ttFail.clear(); S.clsTT.clear();
    try { await loadWeek(r, true); toast('시간표를 다시 받았어요(최대 10분 전 자료일 수 있어요)'); } catch (err) { toast('실패: ' + err.message); }
    renderAll();
  }
});

fillIcons(); fillCredit();
