// 관리자 — AI 실험실(ohinfo ailab.html) 관리: 배정 · 모둠 구성 · 현황판 · 결과 조회.
// admin.html의 "AI 실험실" 메뉴가 window.AiAdmin.show()로 연다.
// 학생 사이트(kakainfo.com)와 주소가 달라 그쪽 모듈을 불러오지 않고 필요한 것만 여기 둔다.

import { db } from './firebase-config.js';
import {
  collection, addDoc, getDocs, getDoc, doc, query, where, updateDoc, deleteDoc, onSnapshot,
  serverTimestamp, writeBatch,
} from 'https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js';

const OHINFO = 'https://kakainfo.com';
const STEP = ['', '① 문제 정의', '② 데이터 수집', '③ 학습', '④ 평가', '⑤ 배포'];
const CAUSES = { few: '사진 수가 적어요', unbalanced: '레이블끼리 사진 수 차이가 커요', similarPhotos: '비슷한 사진만 모았어요', mixed: '다른 물건이 섞인 사진', similarLabels: '레이블끼리 너무 비슷해요', unknown: '잘 모르겠어요' };
const THEME_NAMES = { minimal: '미니멀', bw: '블랙앤화이트', glass: '리퀴드글래스', neon: '네온', warm: '따뜻한 느낌' };
const LANGS = ['ko', 'en', 'zh', 'ru'];

const E = s => String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');
const nv = v => String(v || '').replace(/학년|년급|학|반|班|кл\./g, '').trim();
const emailOf = id => `${id}@ohinfo.local`.toLowerCase();
const $ = id => document.getElementById(id);

const S = {
  tab: 'assign', asgs: [], schools: [], boards: [], asId: sessionStorage.getItem('aiadm_as') || '',
  students: [], pairs: [], projects: [], apps: {}, sel: new Set(), editId: '', trEdit: '', basket: [],
};
let unsubPairs = null;
let watchedAs = null;

function toast(msg, kind = '') {
  let box = $('aiToast');
  if (!box) { box = document.createElement('div'); box.id = 'aiToast'; document.body.appendChild(box); }
  const el = document.createElement('div');
  el.className = 'ai-t ' + kind; el.textContent = msg;
  box.appendChild(el);
  setTimeout(() => el.remove(), 3000);
}
async function guard(fn) {
  try { return await fn(); } catch (e) { console.error(e); toast('오류: ' + (e.code || e.message), 'err'); }
}

// ── 데이터 ──
async function loadBase() {
  const [a, s, c] = await Promise.all([
    getDocs(collection(db, 'ai_assignments')),
    getDocs(collection(db, 'schools')),
    getDocs(collection(db, 'classes')),
  ]);
  S.asgs = a.docs.map(d => ({ id: d.id, ...d.data() })).sort((x, y) => (y.createdAt?.toMillis?.() || 0) - (x.createdAt?.toMillis?.() || 0));
  S.schools = s.docs.map(d => d.data().name).filter(Boolean).sort();
  S.boards = c.docs.map(d => ({ id: d.id, ...d.data() })).filter(b => b.status === 'ON');
  if (S.asId && !S.asgs.find(x => x.id === S.asId)) S.asId = '';
  if (!S.asId && S.asgs[0]) S.asId = S.asgs[0].id;
}
const curAsg = () => S.asgs.find(a => a.id === S.asId);
// 모둠 인원(배정마다 선생님이 정함). 한 모둠 최대 인원은 그보다 1명 더(결석·전학 조정용).
const groupSize = () => Math.min(8, Math.max(1, Number((curAsg() || {}).groupSize) || 2));
const maxSize = () => Math.min(9, groupSize() + 1);

async function loadStudents() {
  const a = curAsg();
  if (!a) { S.students = []; return; }
  const snap = await getDocs(collection(db, 'students'));
  S.students = snap.docs.map(d => ({ id: d.id, ...d.data() }))
    .filter(s => (s.schoolName || '') === a.schoolName && nv(s.grade) === nv(a.grade) && nv(s.class) === nv(a.class))
    .sort((x, y) => (Number(x.number) || 0) - (Number(y.number) || 0));
}

// 지금 고른 배정의 모둠 목록을 실시간으로 본다. 배정이 바뀌었을 때만 다시 연결한다
// (처음 배정을 만든 직후처럼 고른 배정이 생기는 순간도 포함).
function watchPairs() {
  if (watchedAs === S.asId && unsubPairs) return;
  if (unsubPairs) { unsubPairs(); unsubPairs = null; }
  watchedAs = S.asId;
  if (!S.asId) { S.pairs = []; return; }
  unsubPairs = onSnapshot(query(collection(db, 'ai_pairs'), where('asId', '==', S.asId)), snap => {
    S.pairs = snap.docs.map(d => ({ id: d.id, ...d.data() })).sort((a, b) => (a.no || 0) - (b.no || 0));
    if (S.tab === 'pairs' || S.tab === 'board') render();
  });
}

async function loadResults() {
  const snap = await getDocs(query(collection(db, 'ai_projects'), where('asId', '==', S.asId)));
  S.projects = snap.docs.map(d => ({ id: d.id, ...d.data() }));
  const apps = await Promise.all(S.projects.map(p => getDoc(doc(db, 'ai_apps', p.id))));
  S.apps = {};
  apps.forEach((d, i) => { if (d.exists()) S.apps[S.projects[i].id] = d.data(); });
}

// ── 그리기 ──
function render() {
  const pane = $('aiPane');
  if (!pane) return;
  document.querySelectorAll('[data-ai-tab]').forEach(b => {
    b.classList.toggle('accent', b.dataset.aiTab === S.tab);
    b.classList.toggle('ghost', b.dataset.aiTab !== S.tab);
  });
  const picker = S.tab === 'assign' ? '' : asgPicker();
  if (S.tab === 'assign') pane.innerHTML = assignHtml();
  else if (!curAsg()) pane.innerHTML = picker + '<div class="empty-state">먼저 [배정 관리]에서 AI 수업을 배정하세요.</div>';
  else if (S.tab === 'pairs') pane.innerHTML = picker + pairsHtml();
  else if (S.tab === 'board') pane.innerHTML = picker + boardHtml();
  else pane.innerHTML = picker + resultsHtml();
}

function asgPicker() {
  return `<div class="card"><div class="select-controls"><label>AI 수업</label>
    <select class="inp" data-ai="pickAs">${S.asgs.map(a => `<option value="${E(a.id)}" ${a.id === S.asId ? 'selected' : ''}>${E(a.title)} — ${E(a.schoolName)} ${E(a.grade)}학년 ${E(a.class)}반 ${a.status === 'ON' ? '' : '(닫힘)'}</option>`).join('')}</select></div></div>`;
}

function assignHtml() {
  const ed = S.asgs.find(a => a.id === S.editId) || {};
  const schoolOpts = S.schools.map(n => `<option ${n === ed.schoolName ? 'selected' : ''}>${E(n)}</option>`).join('');
  const num = (id, label, v, min, max) => `<label>${label}</label><input class="inp ai-num" id="${id}" type="number" min="${min}" max="${max}" value="${v}">`;
  const boardOpts = `<option value="">게시판 없음 (학생이 직접 올림)</option>` + S.boards.map(b => {
    const on = ed.board && ed.board.name === b.name && ed.board.schoolName === b.schoolName && (ed.board.grade || '') === (b.grade || '') && (ed.board.group || '') === (b.group || '');
    return `<option value="${E(b.id)}" ${on ? 'selected' : ''}>${E(b.name)} (${E(b.schoolName || '')} ${E(b.grade || '전체')}학년 ${E(b.group || '전체')}반)</option>`;
  }).join('');
  const list = S.asgs.map(a => {
    const n = 0;
    return `<div class="ai-asg">
      <div><b>${E(a.title)}</b> <span class="badge ${a.status === 'ON' ? 'on' : 'off'}">${a.status === 'ON' ? '열림' : '닫힘'}</span>
        <div class="ai-sub">${E(a.schoolName)} ${E(a.grade)}학년 ${E(a.class)}반 · 레이블당 사진 ${a.minPerLabel || 15}장 · 테스트 ${a.minTestPerLabel || 3}장 · 모둠 ${a.groupSize || 2}명 · 레이블 최대 ${a.maxLabels || 5}개 · 게시판: ${a.board ? E(a.board.name) : '없음'}</div></div>
      <div class="ai-btns">
        <label class="toggle" title="학생 화면 열기/닫기"><input type="checkbox" data-ai="status" data-id="${E(a.id)}" ${a.status === 'ON' ? 'checked' : ''}><div class="toggle-track"></div></label>
        <button class="btn sm" data-ai="goPairs" data-id="${E(a.id)}">모둠 구성</button>
        <button class="btn sm" data-ai="goBoard" data-id="${E(a.id)}">현황판</button>
        <button class="btn sm" data-ai="goResults" data-id="${E(a.id)}">결과</button>
        <button class="btn sm ghost" data-ai="edit" data-id="${E(a.id)}">수정</button>
        <button class="btn sm danger" data-ai="delAsg" data-id="${E(a.id)}">삭제</button>
      </div></div>`;
  }).join('') || '<div class="empty-state">아직 배정한 AI 수업이 없습니다.</div>';
  return `<div class="card"><h2>${S.editId ? 'AI 수업 설정 수정' : 'AI 수업 배정'}</h2>
    <div class="ai-form">
      <label>제목</label><input class="inp" id="aiT_title" placeholder="예: AI 이미지 분류 모델 만들기" value="${E(ed.title || '')}">
      <label>학교</label><select class="inp" id="aiT_school"><option value="">학교 선택</option>${schoolOpts}</select>
      <label>학년</label><select class="inp" id="aiT_grade">${[1, 2, 3].map(g => `<option ${String(g) === nv(ed.grade) ? 'selected' : ''}>${g}</option>`).join('')}</select>
      <label>반</label><div class="ai-btns"><select class="inp ai-num" id="aiT_class">${Array.from({ length: 15 }, (_, i) => i + 1).map(c => `<option ${String(c) === nv(ed.class) ? 'selected' : ''}>${c}</option>`).join('')}</select>
        ${S.editId ? '' : '<button class="btn sm accent" data-ai="basketAdd">+ 학급 담기</button>'}</div>
      ${S.editId ? '' : `<label>담은 학급</label><div id="aiBasket">${basketHtml()}</div>`}
      ${num('aiT_min', '레이블당 학습 사진(최소)', ed.minPerLabel || 15, 3, 200)}
      ${num('aiT_test', '레이블당 테스트 사진(권장)', ed.minTestPerLabel || 3, 1, 50)}
      ${num('aiT_group', '모둠 인원', ed.groupSize || 2, 1, 8)}
      ${num('aiT_max', '레이블 최대 개수', ed.maxLabels || 5, 2, 8)}
      <label>ohdlet 게시판</label><select class="inp" id="aiT_board">${boardOpts}</select>
    </div>
    <div class="ai-btns" style="margin-top:12px;">
      <button class="btn accent" data-ai="saveAsg">${S.editId ? '저장' : S.basket.length > 1 ? `${S.basket.length}개 학급에 배정하기` : '배정하기'}</button>
      ${S.editId ? '<button class="btn ghost" data-ai="cancelEdit">취소</button>' : ''}
    </div>
    <p class="ai-sub" style="margin-top:8px;">${S.editId ? '' : '같은 내용을 여러 반에 주려면 학년·반을 고르고 [학급 담기]를 반마다 누른 뒤 배정하세요(반마다 따로 배정됩니다). 담지 않으면 고른 반 하나에만 배정합니다. '}배정하면 그 반 학생 화면에 AI 실험실이 열립니다. 홈 화면 카드는 [앱 설정]에서 "AI 실험실"을 켜 주세요.</p></div>
    <div class="card"><h2>배정 목록</h2>${list}</div>`;
}

function stuName(id) {
  const s = S.students.find(x => x.id === id);
  return s ? `${s.number || ''} ${s.name || ''}`.trim() : ((S.pairs.find(p => p.members?.includes(id)) || {}).memberNames || {})[id] || id;
}

function pairsHtml() {
  const used = new Set(S.pairs.flatMap(p => p.members || []));
  const free = S.students.filter(s => !used.has(s.id));
  const freeChips = free.map(s => `<button class="ai-chip${S.sel.has(s.id) ? ' on' : ''}" data-ai="sel" data-id="${E(s.id)}">${E(s.number || '')} ${E(s.name || '')}</button>`).join('') || '<span class="ai-sub">모든 학생이 모둠에 들어가 있습니다.</span>';
  const cards = S.pairs.map(p => {
    const mem = (p.members || []).map(id => `<div class="ai-mem">
      <button class="ai-star${id === p.leaderId ? ' on' : ''}" data-ai="leader" data-pair="${E(p.id)}" data-id="${E(id)}" title="대표로 지정">★</button>
      <span>${E(stuName(id))}</span>
      <button class="ai-x" data-ai="removeMem" data-pair="${E(p.id)}" data-id="${E(id)}" title="모둠에서 빼기">×</button></div>`).join('');
    const add = (p.members || []).length < maxSize() && free.length
      ? `<select class="inp ai-add" data-ai="addMem" data-pair="${E(p.id)}"><option value="">+ 학생 추가</option>${free.map(s => `<option value="${E(s.id)}">${E(s.number || '')} ${E(s.name || '')}</option>`).join('')}</select>` : '';
    return `<div class="ai-pair"><div class="ai-pair-h"><b>${p.no}모둠</b> <span class="ai-sub">${(p.members || []).length}명</span>${(p.members || []).length === 1 ? '<span class="ai-sub">혼자 진행</span>' : ''}
      <button class="btn sm danger" data-ai="delPair" data-id="${E(p.id)}">삭제</button></div>${mem}${add}</div>`;
  }).join('');
  const gs = groupSize();
  return `<div class="card"><h2>모둠 없는 학생 (${free.length}명)</h2>
    <div class="ai-chips">${freeChips}</div>
    <div class="ai-btns" style="margin-top:12px;">
      <button class="btn accent sm" data-ai="makePair" ${S.sel.size >= 1 && S.sel.size <= maxSize() ? '' : 'disabled'}>선택한 ${S.sel.size}명으로 모둠 만들기</button>
      <button class="btn sm" data-ai="autoPair" ${free.length ? '' : 'disabled'}>남은 학생 번호순으로 ${gs}명씩 모둠 짜기</button>
    </div>
    <p class="ai-sub">모둠 인원은 [배정 관리]의 "모둠 인원"(지금 ${gs}명)을 따릅니다. 나누어떨어지지 않으면 모둠 크기를 고르게 나눕니다(예: 25명·4명 → 4·4·4·4·3·3·3).
      ★ = 대표(문제 정의·학습 담당). 결석생은 ×로 빼고, 혼자 남은 학생은 1명 모둠으로 진행합니다. 한 모둠은 최대 ${maxSize()}명까지.</p></div>
    <div class="ai-pairs">${cards || '<div class="empty-state">아직 모둠이 없습니다.</div>'}</div>`;
}

function boardHtml() {
  const a = curAsg();
  const min = a.minPerLabel || 15;
  const steps = [0, 0, 0, 0, 0, 0];
  S.pairs.forEach(p => { steps[(p.summary && p.summary.step) || 1]++; });
  const done = S.pairs.filter(p => p.summary && p.summary.published).length;
  const cards = S.pairs.map(p => {
    const s = p.summary || {};
    const step = s.step || 1;
    const labels = (s.labels || []).map(l => `<span class="${l.c < min ? 'low' : ''}">${E(l.emoji || '')}${E(l.name)} ${l.c}/${min}${l.t ? ` · 테스트 ${l.t}` : ''}</span>`).join('');
    const lead = (p.members || []).map(id => `<option value="${E(id)}" ${id === p.leaderId ? 'selected' : ''}>${E((p.memberNames || {})[id] || id)}</option>`).join('');
    const needHelp = step === 2 && (s.labels || []).some(l => l.c < min / 2);
    return `<div class="ai-bcard${needHelp ? ' help' : ''}">
      <div class="ai-pair-h"><b>${p.no}모둠</b><span class="ai-step">${STEP[step]}</span></div>
      <div class="ai-sub">${(p.members || []).map(id => E((p.memberNames || {})[id] || id) + (id === p.leaderId ? '★' : '')).join(' · ')}</div>
      ${s.topic ? `<div><b>${E(s.topic)}</b>${s.round > 1 ? ` <span class="ai-sub">${s.round}번째 모델</span>` : ''}</div>` : ''}
      <div class="ai-lc">${labels}</div>
      <div class="ai-sub">${s.model ? '모델 연결 ✓' : ''}${s.acc != null ? ` · 정확도 ${s.acc}%` : ''}</div>
      ${s.published ? `<a href="${OHINFO}/aiapp.html?id=${encodeURIComponent(p.currentProjectId || '')}" target="_blank" rel="noopener">🎉 ${E(s.title || '웹앱')} ↗</a>` : ''}
      <label class="ai-sub">대표 <select class="inp ai-lead" data-ai="leaderSel" data-pair="${E(p.id)}">${lead}</select></label>
    </div>`;
  }).join('');
  return `<div class="stats-grid">${[1, 2, 3, 4, 5].map(n => `<div class="stat-card"><div class="stat-num">${steps[n]}</div><div class="stat-label">${STEP[n]}</div></div>`).join('')}
      <div class="stat-card"><div class="stat-num">${done}</div><div class="stat-label">공개 완료</div></div></div>
    <div class="ai-btns" style="margin-bottom:10px;"><button class="btn sm" data-ai="full">전체 화면</button>
      <span class="ai-sub">빨간 숫자 = 아직 ${min}장 미만 · 노란 카드 = 사진이 절반도 안 모인 모둠(도움 필요)</span></div>
    <div class="ai-board" id="aiBoard">${cards || '<div class="empty-state">모둠이 없습니다.</div>'}</div>`;
}

function resultsHtml() {
  if (!S.projects.length) return `<div class="ai-btns"><button class="btn sm" data-ai="reloadResults">새로고침</button></div><div class="empty-state">아직 진행한 프로젝트가 없습니다.</div>`;
  const pairOf = id => S.pairs.find(p => p.id === id) || {};
  const list = [...S.projects].sort((x, y) => (pairOf(x.pairId).no || 0) - (pairOf(y.pairId).no || 0) || (x.round || 0) - (y.round || 0));
  return `<div class="ai-btns" style="margin-bottom:10px;"><button class="btn sm" data-ai="reloadResults">새로고침</button><button class="btn sm accent" data-ai="csv">엑셀(CSV) 내려받기</button></div>` +
    list.map(p => projectHtml(p, pairOf(p.pairId))).join('');
}

function projectHtml(p, pair) {
  const names = pair.memberNames || {};
  const app = S.apps[p.id];
  const hidden = (app && app.hiddenPhrases) || {};
  const evals = Object.keys(p.evals || {}).filter(k => /^r\d+$/.test(k)).map(k => p.evals[k]).sort((a, b) => a.n - b.n);
  const cnt = (k, id) => (p.counts && p.counts[k] && p.counts[k][id]) || 0;
  const trEditing = S.trEdit === p.id;
  const labels = (p.labels || []).map(l => {
    const al = (p.appLabels || {})[l.id] || {};
    const custom = al.phrase === 4 && al.custom ? `<div class="ai-sub">직접 쓴 문구: <b>${E(l.name + al.custom)}</b>
      <button class="btn sm ${hidden[l.id] ? 'accent' : 'ghost'}" data-ai="hide" data-pid="${E(p.id)}" data-id="${E(l.id)}" ${app ? '' : 'disabled'}>${hidden[l.id] ? '숨김 해제' : '숨기기'}</button></div>` : '';
    const tr = trEditing
      ? LANGS.map(g => `<label class="ai-tr">${g}<input class="inp" data-tr="${E(l.id)}" data-lang="${g}" value="${E((l.tr || {})[g] || '')}"></label>`).join('')
      : LANGS.map(g => `<span class="ai-sub">${g}: ${E((l.tr || {})[g] || '-')}</span>`).join(' ');
    return `<tr><td><b>${E(l.emoji || al.emoji || '')} ${E(l.name)}</b>${custom}</td><td>${tr}</td><td>${cnt('train', l.id)}</td><td>${cnt('test', l.id)}</td><td>${E(names[l.owner] || l.owner)}</td></tr>`;
  }).join('');
  const evalHtml = evals.map(r => `<div class="ai-eval"><b>${r.n}회차 ${r.pct}%</b> (${r.correct}/${r.total})${r.modelVersion ? ` · ${r.modelVersion}번 모델` : ''}
      ${Object.entries(r.stars || {}).map(([sid, v]) => `<div>${E(names[sid] || sid)}: ${'★'.repeat(v.s || 0)}${'☆'.repeat(5 - (v.s || 0))} — ${E(v.reason || '')}</div>`).join('')}
      ${(r.cause || []).length ? `<div>원인: ${(r.cause || []).map(c => E(CAUSES[c] || c)).join(', ')}${r.causeText ? ` — ${E(r.causeText)}` : ''}</div>` : ''}
      ${r.fix ? `<div>고칠 점: ${E(r.fix)}</div>` : ''}</div>`).join('') || '<span class="ai-sub">평가 전</span>';
  const appLink = p.published ? `<a href="${OHINFO}/aiapp.html?id=${encodeURIComponent(p.id)}" target="_blank" rel="noopener">${E((app && app.title) || '웹앱')} ↗</a> <span class="ai-sub">${E(THEME_NAMES[(app && app.theme)] || '')}</span>` : '<span class="ai-sub">공개 전</span>';
  return `<div class="card ai-proj">
 <h2>${pair.no || '?'}모둠 · ${(pair.members || []).map(id => E(names[id] || id)).join(', ')} <span class="ai-sub">${p.round || 1}번째 모델 · ${STEP[p.step || 1]}</span></h2>
    <div><b>분류 대상:</b> ${E(p.topic || '-')}</div>
    <div class="table-wrap"><table class="ai-table"><thead><tr><th>레이블</th><th>번역 ${trEditing
      ? `<button class="btn sm accent" data-ai="trSave" data-pid="${E(p.id)}">저장</button><button class="btn sm ghost" data-ai="trCancel">취소</button>`
      : `<button class="btn sm ghost" data-ai="trEdit" data-pid="${E(p.id)}">고치기</button>`}</th><th>학습</th><th>테스트</th><th>담당</th></tr></thead><tbody>${labels}</tbody></table></div>
    <div><b>모델:</b> ${p.modelVersion ? `${p.modelVersion}번 모델${(p.models && p.models['v' + p.modelVersion] && p.models['v' + p.modelVersion].valAcc != null) ? ` (학습 확인 점수 ${p.models['v' + p.modelVersion].valAcc}%)` : ''} · 지금까지 ${Object.keys(p.models || {}).length}번 학습` : (p.modelUrl ? `<a href="${E(p.modelUrl)}" target="_blank" rel="noopener">${E(p.modelId || p.modelUrl)}</a>` : '-')}</div>
    <div><b>평가:</b> ${evalHtml}</div>
    <div><b>웹앱:</b> ${appLink}</div></div>`;
}

// ── 동작 ──
function readForm() {
  const v = id => $(id).value;
  const board = S.boards.find(b => b.id === v('aiT_board'));
  return {
    title: v('aiT_title').trim(), schoolName: v('aiT_school'), grade: v('aiT_grade'), class: v('aiT_class'),
    minPerLabel: Math.max(3, Number(v('aiT_min')) || 15), minTestPerLabel: Math.max(1, Number(v('aiT_test')) || 3),
    maxLabels: Math.min(8, Math.max(2, Number(v('aiT_max')) || 5)),
    groupSize: Math.min(8, Math.max(1, Number(v('aiT_group')) || 2)),
    board: board ? { name: board.name, schoolName: board.schoolName || '', grade: board.grade || '', group: board.group || '' } : null,
  };
}

async function setPairMembers(pair, ids) {
  const names = { ...(pair.memberNames || {}) };
  ids.forEach(id => { const s = S.students.find(x => x.id === id); if (s) names[id] = s.name || id; });
  Object.keys(names).forEach(k => { if (!ids.includes(k)) delete names[k]; });
  const data = { members: ids, memberEmails: ids.map(emailOf), memberNames: names, leaderId: ids.includes(pair.leaderId) ? pair.leaderId : (ids[0] || '') };
  const b = writeBatch(db);
  b.update(doc(db, 'ai_pairs', pair.id), data);
  // 진행 중인 프로젝트도 같은 구성원으로 — 새로 들어온 학생이 바로 함께 볼 수 있게.
  if (pair.currentProjectId) b.update(doc(db, 'ai_projects', pair.currentProjectId), { memberEmails: data.memberEmails });
  await b.commit();
}

async function createPair(ids, no) {
  const names = {};
  ids.forEach(id => { const s = S.students.find(x => x.id === id); names[id] = (s && s.name) || id; });
  await addDoc(collection(db, 'ai_pairs'), {
    asId: S.asId, no, members: ids, memberEmails: ids.map(emailOf), memberNames: names, leaderId: ids[0],
    round: 0, currentProjectId: '', createdAt: serverTimestamp(),
  });
}

// 정한 인원(gs)으로 번호순 모둠 짜기. 나누어떨어지지 않으면 크기를 고르게(차이 최대 1명).
// 기본은 한 명 적은 모둠을 두지만(25명·4명 → 4·4·4·4·3·3·3), 그러면 너무 작아질 때
// (2명 모둠에서 1명이 남는 경우 등)는 모둠 수를 줄여 한 명 많은 모둠을 둔다(5명·2명 → 3·2).
export function splitGroups(ids, gs) {
  const n = ids.length;
  if (!n) return [];
  const sizes = count => { const base = Math.floor(n / count), extra = n % count; return Array.from({ length: count }, (_, i) => base + (i < extra ? 1 : 0)); };
  let count = Math.ceil(n / gs);
  if (Math.min(...sizes(count)) < Math.max(2, gs - 1) && Math.floor(n / gs) >= 1) count = Math.floor(n / gs);
  const out = [];
  let k = 0;
  for (const size of sizes(count)) out.push(ids.slice(k, k += size));
  return out;
}

const classKey = c => `${nv(c.grade)}-${nv(c.class)}`;
function basketHtml() {
  if (!S.basket.length) return '<span class="ai-sub">없음 — 위에서 고른 반 하나에만 배정합니다.</span>';
  return `<div class="ai-chips">${S.basket.map(c => `<button class="ai-chip on" data-ai="basketDel" data-k="${E(classKey(c))}" title="빼기">${E(c.grade)}학년 ${E(c.class)}반 ×</button>`).join('')}
    <button class="ai-chip" data-ai="basketClear">모두 비우기</button></div>`;
}
// 담기·빼기는 폼 전체를 다시 그리지 않는다(입력해 둔 제목 등이 지워지지 않게).
function refreshBasket() {
  const box = $('aiBasket'); if (box) box.innerHTML = basketHtml();
  const btn = document.querySelector('#section-ailab [data-ai="saveAsg"]');
  if (btn && !S.editId) btn.textContent = S.basket.length > 1 ? `${S.basket.length}개 학급에 배정하기` : '배정하기';
}
// 고른 게시판이 특정 반 게시판이면, 다른 반에는 같은 이름의 그 반 게시판을 찾아 쓴다(없으면 고른 게시판 그대로).
function boardFor(board, c) {
  if (!board || !board.group) return board;
  const b = S.boards.find(x => x.name === board.name && (x.schoolName || '') === board.schoolName && nv(x.grade) === nv(c.grade) && nv(x.group) === nv(c.class));
  return b ? { name: b.name, schoolName: b.schoolName || '', grade: b.grade || '', group: b.group || '' } : board;
}

const nextNo = () => S.pairs.reduce((m, p) => Math.max(m, p.no || 0), 0) + 1;

async function go(tab, asId) {
  if (asId && asId !== S.asId) { S.asId = asId; sessionStorage.setItem('aiadm_as', asId); S.sel.clear(); }
  watchPairs();
  S.tab = tab;
  render();
  if (tab === 'pairs') { await guard(loadStudents); render(); }
  if (tab === 'results') { $('aiPane').insertAdjacentHTML('beforeend', '<div class="empty-state">불러오는 중...</div>'); await guard(loadResults); render(); }
}

const actions = {
  async saveAsg() {
    const f = readForm();
    if (!f.title || !f.schoolName) return toast('제목과 학교를 입력하세요.', 'err');
    await guard(async () => {
      if (S.editId) {
        await updateDoc(doc(db, 'ai_assignments', S.editId), f);
        toast('저장했습니다.', 'ok');
      } else {
        const classes = S.basket.length ? S.basket : [{ grade: f.grade, class: f.class }];
        const dup = classes.filter(c => S.asgs.some(a => a.title === f.title && a.schoolName === f.schoolName && classKey(a) === classKey(c)));
        if (dup.length && !confirm(`같은 제목으로 이미 배정한 반이 있습니다: ${dup.map(c => `${c.grade}-${c.class}`).join(', ')}\n그래도 새로 배정할까요?`)) return;
        const b = writeBatch(db);
        classes.forEach(c => b.set(doc(collection(db, 'ai_assignments')), { ...f, grade: c.grade, class: c.class, board: boardFor(f.board, c), status: 'ON', createdAt: serverTimestamp() }));
        await b.commit();
        toast(classes.length > 1 ? `${classes.length}개 학급에 배정했습니다.` : '배정했습니다.', 'ok');
        S.basket = [];
      }
      S.editId = '';
      await loadBase(); render();
    });
  },
  edit(el) { S.editId = el.dataset.id; render(); window.scrollTo({ top: 0, behavior: 'smooth' }); },
  cancelEdit() { S.editId = ''; render(); },
  basketAdd() {
    const c = { grade: $('aiT_grade').value, class: $('aiT_class').value };
    if (S.basket.some(x => classKey(x) === classKey(c))) return toast(`${c.grade}학년 ${c.class}반은 이미 담았습니다.`);
    S.basket.push(c);
    S.basket.sort((x, y) => x.grade - y.grade || x.class - y.class);
    refreshBasket();
  },
  basketDel(el) { S.basket = S.basket.filter(x => classKey(x) !== el.dataset.k); refreshBasket(); },
  basketClear() { S.basket = []; refreshBasket(); },
  async delAsg(el) {
    const a = S.asgs.find(x => x.id === el.dataset.id);
    if (!a || !confirm(`"${a.title}" 배정을 지울까요?\n모둠 구성도 함께 지워집니다. 학생들이 만든 프로젝트와 공개 웹앱은 남습니다.`)) return;
    await guard(async () => {
      const pairs = await getDocs(query(collection(db, 'ai_pairs'), where('asId', '==', a.id)));
      const b = writeBatch(db);
      pairs.docs.forEach(d => b.delete(d.ref));
      b.delete(doc(db, 'ai_assignments', a.id));
      await b.commit();
      if (S.asId === a.id) S.asId = '';
      await loadBase(); watchPairs(); render();
    });
  },
  goPairs(el) { go('pairs', el.dataset.id); },
  goBoard(el) { go('board', el.dataset.id); },
  goResults(el) { go('results', el.dataset.id); },
  sel(el) { const id = el.dataset.id; if (S.sel.has(id)) S.sel.delete(id); else if (S.sel.size < maxSize()) S.sel.add(id); render(); },
  async makePair() {
    const ids = [...S.sel];
    if (!ids.length || ids.length > 3) return;
    await guard(async () => { await createPair(ids, nextNo()); S.sel.clear(); });
  },
  async autoPair() {
    const used = new Set(S.pairs.flatMap(p => p.members || []));
    const free = S.students.filter(s => !used.has(s.id)).map(s => s.id);
    if (!free.length) return;
    const groups = splitGroups(free, groupSize());
    if (!confirm(`${groups.length}개 모둠(${groups.map(g => g.length).join('·')}명)을 만들까요?`)) return;
    await guard(async () => { let no = nextNo(); for (const g of groups) await createPair(g, no++); S.sel.clear(); });
  },
  async leader(el) {
    await guard(() => updateDoc(doc(db, 'ai_pairs', el.dataset.pair), { leaderId: el.dataset.id }));
  },
  async removeMem(el) {
    const p = S.pairs.find(x => x.id === el.dataset.pair);
    const ids = (p.members || []).filter(x => x !== el.dataset.id);
    if (!ids.length) return actions.delPair({ dataset: { id: p.id } });
    await guard(() => setPairMembers(p, ids));
  },
  async delPair(el) {
    const p = S.pairs.find(x => x.id === el.dataset.id);
    if (!p || !confirm(`${p.no}모둠을 지울까요? 학생들이 만든 프로젝트는 남습니다.`)) return;
    await guard(() => deleteDoc(doc(db, 'ai_pairs', p.id)));
  },
  full() { const el = $('aiBoard'); if (el && el.requestFullscreen) el.requestFullscreen(); },
  async reloadResults() { await guard(loadResults); render(); },
  trEdit(el) { S.trEdit = el.dataset.pid; render(); },
  trCancel() { S.trEdit = ''; render(); },
  async trSave(el) {
    const p = S.projects.find(x => x.id === el.dataset.pid);
    const labels = (p.labels || []).map(l => {
      const tr = { ...(l.tr || {}) };
      document.querySelectorAll(`[data-tr="${CSS.escape(l.id)}"]`).forEach(inp => { tr[inp.dataset.lang] = inp.value.trim(); });
      return { ...l, tr };
    });
    await guard(async () => {
      await updateDoc(doc(db, 'ai_projects', p.id), { labels });
      const app = S.apps[p.id];
      if (app) await updateDoc(doc(db, 'ai_apps', p.id), { labels: (app.labels || []).map(al => ({ ...al, tr: (labels.find(l => l.id === al.id) || {}).tr || al.tr })) });
      p.labels = labels; S.trEdit = '';
      if (app) app.labels = (app.labels || []).map(al => ({ ...al, tr: (labels.find(l => l.id === al.id) || {}).tr || al.tr }));
      toast('번역을 고쳤습니다.', 'ok'); render();
    });
  },
  async hide(el) {
    const pid = el.dataset.pid, id = el.dataset.id;
    const app = S.apps[pid];
    if (!app) return;
    const hp = { ...(app.hiddenPhrases || {}) };
    if (hp[id]) delete hp[id]; else hp[id] = true;
    await guard(async () => { await updateDoc(doc(db, 'ai_apps', pid), { hiddenPhrases: hp }); app.hiddenPhrases = hp; render(); });
  },
  csv() {
    const rows = [['모둠', '이름', '대표', '모델', '분류 대상', '레이블(학습 사진 수)', '단계', '회차별 정확도', '별점', '이유', '원인', '고칠 점', '웹앱 주소']];
    const pairOf = id => S.pairs.find(p => p.id === id) || {};
    for (const p of S.projects) {
      const pair = pairOf(p.pairId);
      const evals = Object.keys(p.evals || {}).filter(k => /^r\d+$/.test(k)).map(k => p.evals[k]).sort((a, b) => a.n - b.n);
      const last = evals[evals.length - 1] || {};
      const labels = (p.labels || []).map(l => `${l.name}(${(p.counts && p.counts.train && p.counts.train[l.id]) || 0})`).join(' / ');
      for (const id of (pair.members || [])) {
        const st = (last.stars || {})[id] || {};
        rows.push([pair.no || '', (pair.memberNames || {})[id] || id, id === pair.leaderId ? '대표' : '', p.round || 1, p.topic || '', labels,
          STEP[p.step || 1], evals.map(r => `${r.n}회 ${r.pct}%`).join(' → '), st.s || '', st.reason || '',
          (last.cause || []).map(c => CAUSES[c] || c).join(', ') + (last.causeText ? ` (${last.causeText})` : ''), last.fix || '',
          p.published ? `${OHINFO}/aiapp.html?id=${p.id}` : '']);
      }
    }
    const csv = '﻿' + rows.map(r => r.map(c => `"${String(c).replace(/"/g, '""')}"`).join(',')).join('\r\n');
    const a = document.createElement('a');
    a.href = URL.createObjectURL(new Blob([csv], { type: 'text/csv;charset=utf-8' }));
    a.download = `ai_results_${(curAsg() || {}).grade || ''}-${(curAsg() || {}).class || ''}.csv`;
    document.body.appendChild(a); a.click(); a.remove();
  },
};

const changeActions = {
  async status(el) { await guard(async () => { await updateDoc(doc(db, 'ai_assignments', el.dataset.id), { status: el.checked ? 'ON' : 'OFF' }); await loadBase(); render(); }); },
  pickAs(el) { go(S.tab, el.value); },
  async addMem(el) {
    if (!el.value) return;
    const p = S.pairs.find(x => x.id === el.dataset.pair);
    await guard(() => setPairMembers(p, [...(p.members || []), el.value]));
  },
  async leaderSel(el) { await guard(() => updateDoc(doc(db, 'ai_pairs', el.dataset.pair), { leaderId: el.value })); },
};

function bind() {
  const sec = $('section-ailab');
  sec.addEventListener('click', e => {
    const tab = e.target.closest('[data-ai-tab]');
    if (tab) return go(tab.dataset.aiTab);
    const el = e.target.closest('[data-ai]');
    if (!el || el.tagName === 'SELECT' || el.type === 'checkbox') return;
    if (actions[el.dataset.ai]) actions[el.dataset.ai](el);
  });
  sec.addEventListener('change', e => {
    const el = e.target.closest('[data-ai]');
    if (el && changeActions[el.dataset.ai]) changeActions[el.dataset.ai](el);
  });
}

const STYLE = `
#section-ailab .ai-form { display: grid; grid-template-columns: 160px 1fr; gap: 8px 12px; align-items: center; max-width: 640px; }
#section-ailab .ai-form label { font-size: .85rem; font-weight: 700; color: var(--sub); }
@media (max-width: 600px) { #section-ailab .ai-form { grid-template-columns: 1fr; } }
#section-ailab .ai-num { max-width: 120px; }
#section-ailab .ai-btns { display: flex; flex-wrap: wrap; gap: 6px; align-items: center; }
#section-ailab .ai-sub { font-size: .8rem; color: var(--sub); }
#section-ailab .ai-asg { display: flex; justify-content: space-between; gap: 12px; flex-wrap: wrap; padding: 12px 0; border-top: 1px solid var(--border-card); }
#section-ailab .ai-asg:first-of-type { border-top: 0; }
#section-ailab .ai-chips { display: flex; flex-wrap: wrap; gap: 6px; }
#section-ailab .ai-chip { border: 1px solid var(--border-card); background: var(--glass); border-radius: 999px; padding: 6px 12px; cursor: pointer; font: inherit; font-size: .85rem; color: var(--text); }
#section-ailab .ai-chip.on { background: var(--accent); color: #fff; border-color: transparent; }
#section-ailab .ai-pairs, #section-ailab .ai-board { display: grid; grid-template-columns: repeat(auto-fill, minmax(220px, 1fr)); gap: 10px; }
#section-ailab .ai-pair, #section-ailab .ai-bcard { background: var(--glass-strong); border: 1px solid var(--border-card); border-radius: 14px; padding: 12px; display: flex; flex-direction: column; gap: 6px; font-size: .88rem; }
#section-ailab .ai-bcard.help { background: rgba(255,193,7,.16); }
#section-ailab .ai-board:fullscreen { background: var(--bg); padding: 24px; overflow: auto; grid-template-columns: repeat(auto-fill, minmax(260px, 1fr)); align-content: start; }
#section-ailab .ai-pair-h { display: flex; justify-content: space-between; align-items: center; gap: 6px; }
#section-ailab .ai-step { font-size: .8rem; font-weight: 700; color: var(--accent); }
#section-ailab .ai-mem { display: flex; align-items: center; gap: 6px; }
#section-ailab .ai-mem span { flex: 1; }
#section-ailab .ai-star { border: 0; background: none; font-size: 18px; cursor: pointer; color: var(--border-card); -webkit-text-stroke: 1px var(--sub); }
#section-ailab .ai-star.on { color: #ffb800; -webkit-text-stroke: 0; }
#section-ailab .ai-x { border: 0; background: none; font-size: 18px; cursor: pointer; color: var(--sub); }
#section-ailab .ai-add, #section-ailab .ai-lead { padding: 4px 8px; font-size: .8rem; width: auto; }
#section-ailab .ai-lc { display: flex; flex-wrap: wrap; gap: 4px; }
#section-ailab .ai-lc span { background: var(--glass); border-radius: 999px; padding: 1px 8px; font-size: .78rem; }
#section-ailab .ai-lc span.low { color: #e53935; font-weight: 700; }
#section-ailab .ai-table { width: 100%; border-collapse: collapse; font-size: .85rem; margin: 8px 0; }
#section-ailab .ai-table th, #section-ailab .ai-table td { padding: 6px 8px; border-bottom: 1px solid var(--border-card); text-align: left; vertical-align: top; }
#section-ailab .ai-tr { display: inline-flex; align-items: center; gap: 4px; font-size: .75rem; margin: 2px 6px 2px 0; }
#section-ailab .ai-tr input { width: 110px; padding: 4px 6px; }
#section-ailab .ai-proj > div { margin: 6px 0; font-size: .9rem; }
#section-ailab .ai-eval { background: var(--glass); border-radius: 10px; padding: 8px 10px; margin: 6px 0; }
#aiToast { position: fixed; bottom: 24px; left: 50%; transform: translateX(-50%); z-index: 9999; display: flex; flex-direction: column; gap: 6px; align-items: center; }
#aiToast .ai-t { background: #222; color: #fff; padding: 9px 16px; border-radius: 999px; font-size: .88rem; }
#aiToast .ai-t.err { background: #c62828; } #aiToast .ai-t.ok { background: #2e7d32; }
`;

let _inited = false;
window.AiAdmin = {
  async show() {
    await window.AdminAuth.ready;
    if (!window.AdminAuth.isValid()) return;
    if (!_inited) {
      _inited = true;
      const st = document.createElement('style'); st.textContent = STYLE; document.head.appendChild(st);
      bind();
    }
    $('aiPane').innerHTML = '<div class="empty-state">불러오는 중...</div>';
    await guard(loadBase);
    watchPairs();
    render();
    if (S.tab === 'pairs') { await guard(loadStudents); render(); }
    if (S.tab === 'results') { await guard(loadResults); render(); }
  },
};
