// AI 실험실(학생) — 짝과 함께 이미지 분류 모델을 만드는 5단계.
//  ① 문제 정의(대표) → ② 데이터 수집(각자 맡은 레이블) → ③ 학습(대표: 티처블머신 /
//  짝: 테스트 사진) → ④ 평가(자동 채점 + 각자 별점, 함께 원인·고칠 점) → ⑤ 배포(웹앱 + ohdlet)
//
// 데이터: ai_assignments(반 배정) / ai_pairs(짝, 현황판 요약) / ai_projects(짝의 모델 하나)
//         / ai_projects/{pid}/images(사진 기록) / ai_apps(공개 웹앱)
// 짝 두 사람이 같은 프로젝트를 실시간으로 본다. "열린 단계"는 함께 쓰고, 지금 보고 있는
// 화면은 각자 고른다 — 한 사람이 넘어가도 다른 사람 화면이 끌려가지 않게.

import { db, auth } from './firebase-config.js';
import {
  doc, getDocs, setDoc, updateDoc, onSnapshot, collection, query, where, deleteDoc,
  serverTimestamp, runTransaction, deleteField, addDoc,
} from 'https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js';
import { loadSession, verifyStudentAuth, authReady, clearSession } from './session.js';
import { escHtml } from './escape.js';
import * as C from './ai-core.js';
import { makeT, getLang, setLang } from './ai-i18n.js';
import { prepareImage, bindDropZone, clearZones, fetchImageUrl } from './ai-image.js';
import { Uploader, driveConfigured, downloadZip, trashFile } from './ai-drive.js';
import { loadModel, fetchMetadata, predict, imageFromSrc, imageFromBlob } from './ai-model.js';
import { appHtml, probsByLabel, THEMES } from './ai-render.js';

const E = escHtml;
const $ = id => document.getElementById(id);
const TM_URL = 'https://teachablemachine.withgoogle.com/train/image';

// ── 상태 ──
const S = {
  session: null, me: '', lang: getLang(), t: null,
  asgs: [], asg: null, pair: null, project: null, pid: '',
  images: [], imagesReady: false, appDoc: null,
  viewStep: 0, tab: 'project', s3tab: '', board: [],
  labels: null, labelsDirty: false,                // ① 대표가 고치는 중인 레이블
  drafts: {},                                      // 입력 중인 글(서버 값이 덮어쓰지 않게)
  link: null,                                      // ③ 모델 링크 확인 결과
  evalRun: null, tryOne: null, previewLabel: 0,
  busy: {}, bannerFor: 0,
};
S.t = makeT(S.lang);
const t = (k, v) => S.t(k, v);
let unsub = { asg: null, pair: null, project: null, images: null, board: null, app: null };

const uploader = new Uploader({
  getToken: () => auth.currentUser.getIdToken(),
  writeRecord: item => setDoc(doc(db, 'ai_projects', item.pid, 'images', item.id), {
    labelId: item.labelId, kind: item.kind, owner: item.owner, thumb: item.thumb, fp: item.fp || '',
    driveId: item.driveId || '', ...(item.kind === 'test' ? { evalImg: item.evalImg } : {}),
    w: item.w || 0, h: item.h || 0, createdAt: serverTimestamp(),
  }),
  onChange: () => schedule(),
});

// ── 도움 함수 ──
const isLeader = () => !!(S.pair && S.pair.leaderId === S.me);
const members = () => (S.pair && S.pair.members) || [];
const nameOf = id => (S.pair && S.pair.memberNames && S.pair.memberNames[id]) || id;
const leaderName = () => nameOf(S.pair && S.pair.leaderId);
const pref = () => doc(db, 'ai_projects', S.pid);
const labelsOf = () => (S.project && S.project.labels) || [];
const minTrain = () => (S.asg && S.asg.minPerLabel) || C.DEFAULT_MIN_PER_LABEL;
const minTest = () => (S.asg && S.asg.minTestPerLabel) || C.DEFAULT_MIN_TEST_PER_LABEL;
const maxLabels = () => Math.min((S.asg && S.asg.maxLabels) || C.DEFAULT_MAX_LABELS, C.MAX_LABELS_HARD);
const imgs = (kind, labelId) => S.images.filter(i => i.kind === kind && (!labelId || i.labelId === labelId));
const ms = ts => (ts && ts.toMillis ? ts.toMillis() : (typeof ts === 'number' ? ts : 0));
// Cloudflare는 /ailab.html을 /ailab로 바꿔 보여 주므로 경로를 직접 자르지 않고 상대 주소로 만든다.
const appUrl = () => new URL(`aiapp.html?id=${encodeURIComponent(S.pid)}`, location.href).href;

function toast(msg, kind = '') {
  const el = document.createElement('div');
  el.className = 'toast ' + kind;
  el.textContent = msg;
  $('toasts').appendChild(el);
  setTimeout(() => el.classList.add('out'), 2600);
  setTimeout(() => el.remove(), 3100);
}

async function safeUpdate(ref, data) {
  try { await updateDoc(ref, data); return true; }
  catch (e) { console.error(e); toast(t('error') + ': ' + (e.code || e.message), 'err'); return false; }
}

const timers = {};
function debounce(key, fn, ms = 600) {
  clearTimeout(timers[key]);
  timers[key] = setTimeout(fn, ms);
}

// ── 화면 그리기 ──
let _raf = 0;
function schedule() {
  if (_raf) return;
  _raf = requestAnimationFrame(() => { _raf = 0; render(); });
}

function screen(title, sub, extra = '') {
  $('main').innerHTML = `<div class="empty"><div class="empty-ic">🤖</div><h2>${E(title)}</h2><p>${E(sub || '')}</p>${extra}</div>`;
}

function render() {
  applyStaticText();
  if (!S.asg) return;
  if (S.asg.status !== 'ON') return screen(t('noAssignment'), t('noAssignmentSub'));
  if (!S.pair) return screen(t('noPair'), t('noPairSub'));
  if (!S.project) return screen(t('loading'), '');

  // 입력 중이던 칸과 커서 위치를 지킨다.
  const ae = document.activeElement;
  const keep = ae && ae.id && $('main').contains(ae) ? { id: ae.id, s: ae.selectionStart, e: ae.selectionEnd } : null;
  const y = window.scrollY;

  // 다시 그리는 동안 생기는 포커스 이벤트(칸이 사라졌다 다시 생김)는 사용자가 한 일이
  // 아니다 — "쓰는 중" 표시를 저장하면 그 저장이 또 다시 그리기를 불러 끝없이 돈다.
  S.rendering = true;
  clearZones();
  $('main').innerHTML = headHtml() + (S.tab === 'board' ? boardHtml() : stepperHtml() + bannerHtml() + `<div class="step-body">${stepHtml()}</div>`) + statusHtml();
  afterRender();

  if (keep) {
    const el = $(keep.id);
    if (el) { el.focus({ preventScroll: true }); try { if (keep.s != null) el.setSelectionRange(keep.s, keep.e); } catch { /* select 등 */ } }
  }
  window.scrollTo(0, y);
  S.rendering = false;
}

function applyStaticText() {
  document.documentElement.lang = S.lang;
  document.title = `${t('appName')} — OHinfo`;
  $('navTitle').textContent = t('appName');
  document.querySelectorAll('.lang-item').forEach(el => el.classList.toggle('on', el.dataset.lang === S.lang));
}

function headHtml() {
  const ms_ = members().map(id => `<span class="mem${id === S.me ? ' me' : ''}">${E(nameOf(id))}${id === S.pair.leaderId ? ` <em>${E(t('leader'))}</em>` : ''}</span>`).join('');
  return `<div class="lab-head">
    <div class="lab-pair"><span class="pair-no">${E(t('pairN', { n: S.pair.no || '' }))}</span>${ms_}<span class="round">${E(t('modelN', { n: S.project.round || 1 }))}</span></div>
    <div class="seg" role="tablist">
      <button data-act="tab" data-v="project" class="${S.tab === 'project' ? 'on' : ''}">${E(t('tabProject'))}</button>
      <button data-act="tab" data-v="board" class="${S.tab === 'board' ? 'on' : ''}">${E(t('tabBoard'))}</button>
    </div>
  </div>`;
}

function stepperHtml() {
  const open = S.project.step || 1;
  return `<ol class="stepper">${C.STEPS.map(n => {
    const cls = [n === S.viewStep ? 'cur' : '', n < open ? 'done' : '', n > open ? 'lock' : ''].join(' ');
    return `<li><button class="${cls}" data-act="step" data-v="${n}" ${n > open ? `disabled title="${E(t('locked'))}"` : ''}>
      <span class="sn">${n < open ? '✓' : n}</span><span class="st">${E(t('s' + n))}</span></button></li>`;
  }).join('')}</ol>`;
}

function bannerHtml() {
  const open = S.project.step || 1;
  if (open <= S.viewStep || S.bannerFor === open) return '';
  return `<div class="banner"><span>🎉 ${E(t('stepOpened'))} <b>${open}. ${E(t('s' + open))}</b></span>
    <button class="btn sm" data-act="step" data-v="${open}">${E(t('go'))} →</button>
    <button class="x" data-act="banner-x" aria-label="${E(t('close'))}">×</button></div>`;
}

function statusHtml() {
  const n = uploader.count;
  if (!n && uploader.state !== 'notConfigured') return '';
  let msg, cls = '';
  if (uploader.state === 'notConfigured') { msg = t('driveNotSet'); cls = 'warn'; }
  else if (uploader.state === 'retrying') { msg = `${t('pendingN', { n })} · ${t('uploadRetry')}`; cls = 'warn'; }
  else msg = `${t('pendingN', { n })} · ${t('uploading')}`;
  return `<div class="savebar ${cls}"><span class="spin"></span>${E(msg)}</div>`;
}

function stepHtml() {
  switch (S.viewStep) {
    case 1: return step1();
    case 2: return step2();
    case 3: return step3();
    case 4: return step4();
    case 5: return step5();
    default: return '';
  }
}

function tipsHtml(list) {
  return `<div class="tips"><b>${E(t('tipsTitle'))}</b><ul>${list.map(x => `<li>${E(x)}</li>`).join('')}</ul></div>`;
}
function lead(key) { return `<p class="lead">${E(t(key))}</p>`; }
function draftOr(key, v) { return S.drafts[key] != null ? S.drafts[key] : (v || ''); }

// ── ① 문제 정의 ──
function step1() {
  const p = S.project;
  const labels = S.labels || labelsOf();
  const leader = isLeader();
  const hasImg = id => imgs('train', id).length + imgs('test', id).length > 0;
  let body = lead('s1Lead') + tipsHtml(t('s1Tips'));
  if (!leader) {
    body += `<div class="note">${E(t('s1Wait', { name: leaderName() }))}</div>`;
    body += `<div class="card"><div class="field"><label>${E(t('topicLabel'))}</label><div class="ro">${E(p.topic || '…')}</div></div>
      <div class="field"><label>${E(t('labelsLabel'))}</label>
      <div class="ro-labels">${labels.length ? labels.map(l => `<div class="ro-label"><b>${E(l.name || '…')}</b><span class="tag${l.owner === S.me ? ' me' : ''}">${E(l.owner === S.me ? t('mine') : t('collector', { name: nameOf(l.owner) }))}</span>${trHtml(l)}</div>`).join('') : '<div class="ro">…</div>'}</div></div></div>`;
    if (p.defined && p.step >= 2) body += nextBtn(2, 's2');
    return body;
  }
  const opts = id => members().map(m => `<option value="${E(m)}" ${m === id ? 'selected' : ''}>${E(nameOf(m))}</option>`).join('');
  body += `<div class="card">
    <div class="field"><label for="f-topic">${E(t('topicLabel'))}</label>
      <input id="f-topic" data-field="topic" maxlength="40" placeholder="${E(t('topicPh'))}" value="${E(draftOr('topic', p.topic))}"></div>
    <div class="field"><label>${E(t('labelsLabel'))}</label>
      <div class="label-rows">${labels.map((l, i) => `<div class="label-row">
        <span class="ln">${i + 1}</span>
        <input id="f-lname-${E(l.id)}" data-field="lname" data-id="${E(l.id)}" maxlength="${C.LABEL_NAME_MAX}" placeholder="${E(t('labelPh'))}" value="${E(l.name)}" ${hasImg(l.id) ? 'disabled title="🔒"' : ''}>
        <select data-field="lowner" data-id="${E(l.id)}" aria-label="${E(t('owner'))}">${opts(l.owner)}</select>
        <button class="icon-btn" data-act="lremove" data-id="${E(l.id)}" ${labels.length <= 2 || hasImg(l.id) ? 'disabled' : ''} aria-label="${E(t('del'))}">×</button>
      </div>${trHtml(l)}`).join('')}</div>
      ${labels.length < maxLabels() ? `<button class="btn ghost sm" data-act="ladd">${E(t('addLabel'))}</button>` : ''}
    </div>
    <div id="s1err" class="err"></div>
    <button class="btn primary" data-act="s1confirm" ${S.busy.s1 ? 'disabled' : ''}>${E(S.busy.s1 ? t('translating') : (p.defined ? t('saveChanges') : t('s1Confirm')))}</button>
  </div>`;
  if (p.defined && p.step >= 2) body += nextBtn(2, 's2');
  return body;
}

function trHtml(l) {
  const tr = l.tr || {};
  const others = C.LANGS.filter(x => tr[x] && tr[x] !== l.name);
  if (!others.length) return '';
  return `<div class="tr-line">${others.map(x => `<span>${x.toUpperCase()} ${E(tr[x])}</span>`).join('')}</div>`;
}

function nextBtn(step, key) {
  return `<div class="next"><button class="btn primary" data-act="step" data-v="${step}">${E(t(key === 's2' ? 's2Next' : key))} →</button></div>`;
}

// ── ② 데이터 수집 ──
function photoGrid(kind, labelId, canDelete) {
  const done = imgs(kind, labelId).sort((a, b) => ms(b.createdAt) - ms(a.createdAt));
  const pend = uploader.pendingFor(kind, labelId);
  const cell = (im, pending) => `<div class="ph${pending ? ' pend' : ''}"><img src="${E(im.thumb)}" alt="" loading="lazy">
    ${pending ? '<span class="ph-spin"></span>' : ''}
    ${canDelete(im) ? `<button class="ph-x" data-act="photo-del" data-id="${E(im.id)}" data-pending="${pending ? 1 : 0}" aria-label="${E(t('del'))}">×</button>` : ''}</div>`;
  return `<div class="photos">${pend.map(i => cell(i, true)).join('')}${done.map(i => cell(i, false)).join('')}</div>`;
}

function zoneHtml(kind, labelId) {
  return `<div class="dz" tabindex="0" data-zone="${kind}:${E(labelId)}">
    <span>${E(t('dropHere'))}</span>
    <button class="btn sm" data-act="pick" data-zone="${kind}:${E(labelId)}">${E(t('chooseFiles'))}</button></div>`;
}

function howToHtml() {
  return `<div class="howto"><b>${E(t('howTo'))}</b><ol>${t('howToSteps').map(x => `<li>${E(x)}</li>`).join('')}</ol><p>${E(t('howToAlt'))}</p></div>`;
}

function step2() {
  const labels = labelsOf();
  const min = minTrain();
  const counts = labels.map(l => imgs('train', l.id).length);
  let body = lead('s2Lead') + `<div class="two">${howToHtml()}${tipsHtml(t('s2Tips'))}</div>`;
  if (C.isUnbalanced(counts)) body += `<div class="note warn">⚖️ ${E(t('unbalanced'))}</div>`;
  body += `<div class="lgrid">${labels.map(l => {
    const mine = l.owner === S.me;
    const c = imgs('train', l.id).length;
    const pct = Math.min(100, Math.round(c * 100 / min));
    const ownerCtl = isLeader() && members().length > 1
      ? `<select class="owner-sel" data-field="lowner2" data-id="${E(l.id)}" aria-label="${E(t('changeOwner'))}">${members().map(m => `<option value="${E(m)}" ${m === l.owner ? 'selected' : ''}>${E(nameOf(m))}</option>`).join('')}</select>`
      : `<span class="tag${mine ? ' me' : ''}">${E(mine ? t('mine') : t('collector', { name: nameOf(l.owner) }))}</span>`;
    return `<div class="lcard${mine ? ' mine' : ''}">
      <div class="lc-head"><b>${E(l.name)}</b>${ownerCtl}</div>
      <div class="prog"><div class="bar"><span style="width:${pct}%"></span></div>
        <span class="cnt">${E(t('countOf', { c, m: min }))}</span></div>
      <div class="lc-state ${c >= min ? 'ok' : ''}">${E(c >= min ? t('enough') : t('needMore', { n: min - c }))}</div>
      ${mine ? zoneHtml('train', l.id) : `<div class="not-mine">${E(t('notMine', { name: nameOf(l.owner) }))}</div>`}
      ${photoGrid('train', l.id, im => im.owner === S.me || isLeader())}
    </div>`;
  }).join('')}</div>`;
  if (S.project.step >= 3) body += nextBtn(3, 's2Next');
  return body;
}

// ── ③ 학습 ──
function step3() {
  const leader = isLeader();
  const solo = members().length === 1;
  const tab = S.s3tab || (leader || solo ? 'train' : 'test');
  let body = lead('s3Lead');
  body += `<div class="seg sub">
    <button data-act="s3tab" data-v="train" class="${tab === 'train' ? 'on' : ''}">🧠 ${E(t('tabTrain'))}${leader ? '' : ` · ${E(leaderName())}`}</button>
    <button data-act="s3tab" data-v="test" class="${tab === 'test' ? 'on' : ''}">🧪 ${E(t('tabTest'))}</button></div>`;
  body += tab === 'train' ? trainTab(leader) : testTab();
  if (S.project.step >= 4) body += `<div class="next"><button class="btn primary" data-act="step" data-v="4">${E(t('s3Next'))} →</button></div>`;
  return body;
}

function trainTab(leader) {
  const p = S.project;
  const train = imgs('train').filter(i => i.driveId);
  const since = ms(p.lastDownloadAt);
  const fresh = since ? train.filter(i => ms(i.createdAt) > since) : [];
  let h = leader ? '' : `<div class="note">${E(t('leaderOnly', { name: leaderName() }))}</div>`;
  h += `<div class="card"><h3>${E(t('dlTitle'))}</h3><div class="row">
    <button class="btn" data-act="dl" data-v="all" ${!leader || !train.length || S.busy.dl ? 'disabled' : ''}>⬇ ${E(t('dlAll', { n: train.length }))}</button>
    ${since && fresh.length ? `<button class="btn" data-act="dl" data-v="new" ${!leader || S.busy.dl ? 'disabled' : ''}>⬇ ${E(t('dlNew', { n: fresh.length }))}</button>` : ''}
    </div>${S.busy.dl ? `<div class="muted"><span class="spin"></span>${E(t('dlWorking'))}</div>` : ''}
    ${!driveConfigured() ? `<div class="note warn">${E(t('driveNotSet'))}</div>` : ''}</div>`;
  h += `<div class="card"><h3>${E(t('guideTitle'))}</h3><ol class="guide">${t('guide').map(x => `<li>${E(x)}</li>`).join('')}</ol>
    <div class="labels-inline">${labelsOf().map(l => `<code>${E(l.name)}</code>`).join('')}</div>
    <a class="btn" href="${TM_URL}" target="_blank" rel="noopener">${E(t('openTM'))} ↗</a>
    <div class="note warn">⚠ ${E(t('keepOpen'))}</div></div>`;
  h += `<div class="card"><h3>${E(t('linkTitle'))}</h3>`;
  if (p.modelUrl && !S.link) {
    h += `<div class="linked">✅ ${E(t('linked'))}<div class="muted">${E(p.modelUrl)}</div>
      <div class="muted">${E(t('modelClasses', { n: (p.modelClasses || []).length }))}: ${(p.modelClasses || []).map(c => `<code>${E(c)} → ${E((labelsOf().find(l => l.id === (p.mapping || {})[c]) || {}).name || '?')}</code>`).join(' ')}</div></div>
      ${leader ? `<button class="btn ghost sm" data-act="relink">${E(t('relink'))}</button>` : ''}`;
  } else if (leader) {
    h += `<div class="row"><input id="f-link" data-field="link" placeholder="${E(t('linkPh'))}" value="${E(draftOr('link', ''))}">
      <button class="btn primary" data-act="linkcheck" ${S.busy.link ? 'disabled' : ''}>${E(t('linkCheck'))}</button></div>
      ${S.busy.link ? `<div class="muted"><span class="spin"></span>${E(t('loading'))}</div>` : ''}
      ${S.link && S.link.error ? `<div class="err">${E(t('l_' + S.link.error))}</div>` : ''}
      ${S.link && S.link.classes ? mappingHtml() : ''}`;
  } else {
    h += `<div class="muted">…</div>`;
  }
  return h + '</div>';
}

function mappingHtml() {
  const L = S.link;
  const labels = labelsOf();
  const chk = C.checkMapping(L.classes, labels, L.mapping);
  const rows = L.classes.map(c => `<div class="map-row">
    <code>${E(c)}</code><span>→</span>
    <select data-field="map" data-id="${E(c)}"><option value="">${E(t('mapPick'))}</option>
      ${labels.map(l => `<option value="${E(l.id)}" ${L.mapping[c] === l.id ? 'selected' : ''}>${E(l.name)}</option>`).join('')}</select>
    ${C.isDefaultClassName(c) && !L.mapping[c] ? `<span class="err sm">${E(t('mapDefault', { c }))}</span>` : ''}</div>`).join('');
  const msgs = [];
  if (chk.missing.length) msgs.push(t('mapMissing'));
  if (chk.dup.length) msgs.push(t('mapDup'));
  const unused = chk.unusedLabels.map(id => (labels.find(l => l.id === id) || {}).name).filter(Boolean);
  return `<div class="mapping"><b>${E(t('mapTitle'))}</b><p class="muted">${E(t('mapHint'))}</p>${rows}
    ${msgs.map(m => `<div class="err">${E(m)}</div>`).join('')}
    ${unused.length ? `<div class="note warn">${E(t('mapUnused', { list: unused.join(', ') }))}</div>` : ''}
    <button class="btn primary" data-act="mapsave" ${chk.ok ? '' : 'disabled'}>${E(t('mapSave'))}</button></div>`;
}

function testTab() {
  const labels = labelsOf();
  const min = minTest();
  const total = imgs('test').length;
  let h = `<div class="note">${E(t('s3TestLead'))}<br><b>${E(t('s3TestNote'))}</b></div>
    <div class="muted">${E(t('testCount', { c: total, m: min }))}</div>`;
  h += `<div class="lgrid">${labels.map(l => {
    const c = imgs('test', l.id).length;
    return `<div class="lcard test"><div class="lc-head"><b>${E(l.name)}</b><span class="cnt ${c >= min ? 'ok' : ''}">${c} / ${min}</span></div>
      ${zoneHtml('test', l.id)}
      ${photoGrid('test', l.id, () => true)}</div>`;
  }).join('')}</div>`;
  return h;
}

// ── ④ 평가 ──
function labelById(id) { return labelsOf().find(l => l.id === id); }

function step4() {
  const p = S.project;
  let h = lead('s4Lead');
  if (!p.modelUrl) return h + `<div class="note warn">${E(t('l_empty'))}</div>`;
  const tests = imgs('test');
  const rounds = C.evalRounds(p);
  const cur = rounds[rounds.length - 1];
  if (!tests.length) {
    return h + `<div class="note warn">${E(t('noTests'))}</div><div class="next"><button class="btn" data-act="goto-test">← ${E(t('tabTest'))}</button></div>`;
  }
  const run = S.evalRun;
  h += `<div class="card eval-top">
    <button class="btn primary" data-act="evalrun" ${run ? 'disabled' : ''}>▶ ${E(rounds.length ? t('rerun') : t('runEval'))}</button>
    ${run ? `<div class="muted"><span class="spin"></span>${E(run.i ? t('evaluating', { i: run.i, n: run.n }) : t('loadingModel'))}</div>` : ''}
    ${run && run.error ? `<div class="err">${E(t('l_loadFail'))}</div>` : ''}
    ${cur && ms(p.modelAt) > ms(cur.at) ? `<div class="note">${E(t('modelChanged'))}</div>` : ''}
    ${rounds.length > 1 ? `<div class="history"><b>${E(t('history'))}</b> ${rounds.map(r => `<span class="hchip">${E(t('roundN', { n: r.n }))} ${r.pct}%</span>`).join(' → ')}</div>` : ''}
  </div>`;
  if (cur) h += evalResultHtml(cur) + ratingHtml(cur) + causeHtml(cur);
  h += tryOneHtml();
  h += `<div class="note">${E(t('retrainHint'))}</div>`;
  h += `<div class="next two-btn"><button class="btn" data-act="step" data-v="2">← ${E(t('goCollect'))}</button>
    ${p.step >= 5 ? `<button class="btn primary" data-act="step" data-v="5">${E(t('goDeploy'))} →</button>` : `<span class="muted">${E(t('needStarToDeploy'))}</span>`}</div>`;
  return h;
}

function evalResultHtml(r) {
  const per = r.per || {};
  const bars = labelsOf().map(l => {
    const x = per[l.id] || { total: 0, correct: 0 };
    const pct = x.total ? Math.round(x.correct * 100 / x.total) : 0;
    return `<div class="erow"><span>${E(l.name)}</span><div class="bar"><span style="width:${pct}%"></span></div><span class="cnt">${x.correct}/${x.total}</span></div>`;
  }).join('');
  const wrong = (r.wrong || []).map(w => {
    const im = S.images.find(i => i.id === w.imgId);
    return `<div class="wcard">${im ? `<img src="${E(im.thumb)}" alt="">` : '<div class="ph-gone">?</div>'}
      <div><span class="muted">${E(t('answer'))}</span> <b>${E((labelById(w.labelId) || {}).name || '?')}</b></div>
      <div><span class="muted">${E(t('aiSaid'))}</span> <b class="bad">${E((labelById(w.got) || {}).name || '?')}</b> ${w.p}%</div></div>`;
  }).join('');
  return `<div class="card"><div class="score"><span class="big">${r.pct}%</span><span>${E(t('score', { n: r.total, c: r.correct }))}</span><span class="hchip">${E(t('roundN', { n: r.n }))}</span></div>
    <div class="ebars">${bars}</div>
    <h4>${E(t('wrongTitle'))}</h4>${wrong ? `<div class="wgrid">${wrong}</div>` : `<div class="ok-msg">${E(t('allRight'))}</div>`}</div>`;
}

function ratingHtml(r) {
  const mine = (r.stars || {})[S.me] || {};
  const sel = S.drafts.star != null ? S.drafts.star : (mine.s || 0);
  const stars = [1, 2, 3, 4, 5].map(n => `<button class="star${n <= sel ? ' on' : ''}" data-act="star" data-v="${n}" aria-label="${n}">★</button>`).join('');
  const others = members().filter(m => m !== S.me).map(m => {
    const o = (r.stars || {})[m];
    return `<div class="peer"><b>${E(t('partnerEval', { name: nameOf(m) }))}</b> ${o ? `<span class="stars-ro">${'★'.repeat(o.s)}${'☆'.repeat(5 - o.s)}</span><div>${E(o.reason || '')}</div>` : '<span class="muted">…</span>'}</div>`;
  }).join('');
  return `<div class="card"><h3>${E(t('starsTitle'))}</h3><p>${E(t('starsQ'))}</p><div class="stars">${stars}</div>
    <textarea id="f-reason" data-field="reason" maxlength="300" rows="2" placeholder="${E(t('reasonPh'))}">${E(draftOr('reason', mine.reason))}</textarea>
    <div class="row"><button class="btn primary sm" data-act="starsave">${E(t('saveMine'))}</button>${mine.s ? `<span class="muted">✓ ${E(t('saved'))}</span>` : ''}</div>
    ${others}</div>`;
}

function editingNote(field) {
  const ed = (S.project.editing || {})[field];
  if (!ed || ed.by === S.me || Date.now() - ms(ed.at) > 60000) return '';
  return `<span class="typing">✎ ${E(t('typing', { name: nameOf(ed.by) }))}</span>`;
}

function causeHtml(r) {
  const causes = t('causes');
  const sel = new Set(r.cause || []);
  return `<div class="card"><h3>${E(t('causeTitle'))}</h3>
    <div class="checks">${Object.keys(causes).map(k => `<label class="check"><input type="checkbox" data-act="cause" data-v="${k}" ${sel.has(k) ? 'checked' : ''}> ${E(causes[k])}</label>`).join('')}</div>
    <div class="field">${editingNote('causeText')}<textarea id="f-causeText" data-field="causeText" maxlength="300" rows="2" placeholder="${E(t('causeTextPh'))}">${E(draftOr('causeText', r.causeText))}</textarea></div>
    <h3>${E(t('fixTitle'))}</h3>
    <div class="field">${editingNote('fix')}<textarea id="f-fix" data-field="fix" maxlength="300" rows="2" placeholder="${E(t('fixPh'))}">${E(draftOr('fix', r.fix))}</textarea></div></div>`;
}

function tryOneHtml() {
  const tr = S.tryOne;
  let res = '';
  if (tr && tr.busy) res = `<div class="muted"><span class="spin"></span>${E(t('thinking'))}</div>`;
  else if (tr && tr.probs) {
    res = `<div class="try-res"><img src="${E(tr.photo)}" alt=""><div class="ebars">${labelsOf().map(l => {
      const pct = Math.round((tr.probs[l.id] || 0) * 100);
      return `<div class="erow"><span>${E(l.name)}</span><div class="bar"><span style="width:${pct}%"></span></div><span class="cnt">${pct}%</span></div>`;
    }).join('')}</div></div>`;
  } else if (tr && tr.error) res = `<div class="err">${E(t('l_loadFail'))}</div>`;
  return `<details class="card" ${tr ? 'open' : ''}><summary><b>${E(t('tryOne'))}</b> <span class="muted">${E(t('tryOneHint'))}</span></summary>
    ${zoneHtml('try', 'x')}${res}</details>`;
}

// ── ⑤ 배포 ──
function appLabel(l) {
  const a = (S.project.appLabels || {})[l.id] || {};
  return {
    id: l.id, name: l.name, tr: l.tr || {}, emoji: a.emoji || '', phrase: Number.isInteger(a.phrase) ? a.phrase : 0,
    custom: a.custom || '', customLang: a.customLang || '', customTr: a.customTr || {},
  };
}
function appData() {
  const p = S.project;
  return {
    title: (S.drafts.title != null ? S.drafts.title : (p.app && p.app.title)) || '',
    theme: (p.app && p.app.theme) || 'minimal',
    srcLang: p.srcLang || 'ko',
    labels: labelsOf().map(appLabel),
    modelUrl: p.modelUrl || '', mapping: p.mapping || {},
    hiddenPhrases: (S.appDoc && S.appDoc.hiddenPhrases) || {},
  };
}
// 공개 뒤에 고친 게 있는지 비교하는 서명(번역 결과는 빼고).
function appSig(a) {
  return JSON.stringify({ title: a.title, theme: a.theme, m: a.modelUrl, map: a.mapping, l: a.labels.map(l => [l.id, l.name, l.emoji, l.phrase, l.custom]) });
}

function step5() {
  const p = S.project;
  const a = appData();
  const hidden = a.hiddenPhrases;
  let h = lead('s5Lead');
  h += `<div class="deploy"><div class="deploy-form">`;
  h += `<div class="card"><div class="field"><label for="f-title">${E(t('appTitle'))}</label>
    <input id="f-title" data-field="title" maxlength="${C.TITLE_MAX}" placeholder="${E(t('appTitlePh'))}" value="${E(a.title)}"></div>
    <label>${E(t('design'))}</label><div class="themes">${THEMES.map(th => `<button class="theme-card${a.theme === th ? ' on' : ''}" data-act="theme" data-v="${th}"><span class="sw sw-${th}"></span>${E(t('themes.' + th))}</button>`).join('')}</div></div>`;
  h += `<div class="card"><h3>${E(t('perLabel'))}</h3>${a.labels.map((l, i) => {
    const name = l.name;
    const err = l.phrase === C.CUSTOM_PHRASE ? C.validateCustomPhrase(draftOr('custom-' + l.id, l.custom)) : '';
    return `<div class="al">
      <div class="al-head"><b>${E(name)}</b><button class="btn ghost sm" data-act="preview-label" data-v="${i}">👁</button></div>
      <div class="emojis">${C.EMOJIS.map(em => `<button class="em${l.emoji === em ? ' on' : ''}" data-act="emoji" data-id="${E(l.id)}" data-v="${em}">${em}</button>`).join('')}</div>
      <div class="phrases">${C.PHRASES.map((ph, k) => `<label class="radio"><input type="radio" name="ph-${E(l.id)}" data-act="phrase" data-id="${E(l.id)}" data-v="${k}" ${l.phrase === k ? 'checked' : ''}> ${E(C.fillPhrase(ph[S.lang] || ph.ko, C.labelName(l, S.lang)))}</label>`).join('')}
        <label class="radio custom"><input type="radio" name="ph-${E(l.id)}" data-act="phrase" data-id="${E(l.id)}" data-v="${C.CUSTOM_PHRASE}" ${l.phrase === C.CUSTOM_PHRASE ? 'checked' : ''}> ${E(t('customLabel'))}:
          <span class="cust"><b>${E(name)}</b><input id="f-custom-${E(l.id)}" data-field="custom" data-id="${E(l.id)}" maxlength="${C.CUSTOM_PHRASE_MAX}" placeholder="${E(t('customPh'))}" value="${E(draftOr('custom-' + l.id, l.custom))}"></span></label>
        ${err && l.phrase === C.CUSTOM_PHRASE ? `<div class="err sm">${E(t('c_' + err))}</div>` : ''}
        ${hidden[l.id] ? `<div class="note warn">${E(t('hiddenNote'))}</div>` : ''}
      </div></div>`;
  }).join('')}</div>`;
  const dirty = p.published && p.pubSig !== appSig(a);
  h += `<div class="card"><div id="s5err" class="err"></div>
    <button class="btn primary" data-act="publish" ${S.busy.pub ? 'disabled' : ''}>${E(S.busy.pub ? t('publishing') : (p.published ? t('saveChanges') : t('publish')))}</button>
    ${p.published ? `<div class="url-box"><label>${E(t('publicUrl'))}${dirty ? '' : ' ✅'}</label><div class="row">
      <input id="f-url" readonly value="${E(appUrl())}"><button class="btn sm" data-act="copy">${E(t('copy'))}</button>
      <a class="btn sm" href="${E(appUrl())}" target="_blank" rel="noopener">${E(t('open'))} ↗</a></div></div>
      ${postHtml()}
      <button class="btn ghost" data-act="newmodel">＋ ${E(t('newModel'))}</button>` : ''}</div>`;
  h += `</div><div class="deploy-preview"><div class="pv-label">${E(t('previewAs'))}</div>
    <div class="pv-tabs">${a.labels.map((l, i) => `<button class="${i === S.previewLabel ? 'on' : ''}" data-act="preview-label" data-v="${i}">${E(l.emoji || '')} ${E(C.labelName(l, S.lang))}</button>`).join('')}</div>
    <div class="pv-frame">${previewHtml(a)}</div></div></div>`;
  return h;
}

function previewHtml(a) {
  const ls = a.labels;
  const top = ls[Math.min(S.previewLabel, ls.length - 1)] || ls[0];
  const probs = {};
  ls.forEach(l => { probs[l.id] = l === top ? 0.87 : 0.13 / Math.max(1, ls.length - 1); });
  const data = { ...a, labels: ls.map(l => ({ ...l, custom: S.drafts['custom-' + l.id] != null ? S.drafts['custom-' + l.id] : l.custom, customLang: l.customLang || S.lang })) };
  // 미리보기 사진 자리: 고른 레이블의 첫 사진
  const ph = imgs('train', top && top.id)[0] || imgs('test', top && top.id)[0];
  return appHtml(data, S.lang, S.t, { photo: ph ? ph.thumb : '', probs, sample: true, status: 'ready' });
}

function postHtml() {
  const b = S.asg.board;
  if (S.project.postId) return `<div class="note ok">✅ ${E(t('postedAlready'))}</div>`;
  if (!b || !b.name) return `<div class="note">${E(t('noBoard'))}</div>`;
  return `<button class="btn" data-act="post" ${S.busy.post ? 'disabled' : ''}>📌 ${E(t('postOhdlet'))}</button>`;
}

// ── 현황판 ──
function boardHtml() {
  const list = [...S.board].sort((a, b) => (a.no || 0) - (b.no || 0));
  if (!list.length) return `<div class="empty"><p>${E(t('boardEmpty'))}</p></div>`;
  return `<h2 class="board-title">${E(t('boardTitle'))}</h2><div class="board">${list.map(pr => {
    const s = pr.summary || {};
    const step = s.step || 1;
    const min = s.minPerLabel || minTrain();
    const needPhotos = step === 2 && (s.labels || []).some(l => l.c < min);
    const names = (pr.members || []).map(id => (pr.memberNames || {})[id] || '').join(' · ');
    return `<div class="bcard${pr.id === S.pair.id ? ' mine' : ''}">
      <div class="bc-head"><b>${E(t('pairN', { n: pr.no || '' }))}</b><span>${E(names)}</span></div>
      <div class="dots">${C.STEPS.map(n => `<span class="${n < step ? 'd' : n === step ? 'c' : ''}"></span>`).join('')}<em>${E(t('stepNow', { n: step, name: t('s' + step) }))}</em></div>
      ${s.topic ? `<div class="bc-topic">${E(s.topic)}</div>` : ''}
      <div class="bc-labels">${(s.labels || []).map(l => `<span>${E(l.emoji || '')}${E(l.name)} <b>${l.c}</b></span>`).join('')}</div>
      <div class="bc-state">${s.published ? `<span class="ok">🎉 ${E(t('done'))}</span> <a href="aiapp.html?id=${encodeURIComponent(pr.currentProjectId || '')}" target="_blank" rel="noopener">${E(t('viewApp'))} ↗</a>`
        : needPhotos ? `<span class="soft">📷 ${E(t('needPhotos'))}</span>`
        : s.acc != null ? `<span>${E(t('accuracy', { p: s.acc }))}</span>`
        : s.model ? `<span>${E(t('modelReady'))}</span>` : ''}</div>
    </div>`;
  }).join('')}</div>`;
}

// ── 그린 뒤: 사진 칸 연결 ──
function afterRender() {
  document.querySelectorAll('.dz[data-zone]').forEach(el => {
    const [kind, id] = el.dataset.zone.split(':');
    bindDropZone(el, (files, urls) => onPhotos(kind, id, files, urls));
  });
}

// ── 사진 넣기 ──
async function onPhotos(kind, labelId, files, urls) {
  if (kind === 'try') return tryPhoto(files, urls);
  const srcs = [...files, ...urls];
  for (const src of srcs) {
    try {
      const blob = typeof src === 'string' ? await fetchImageUrl(src) : src;
      const prep = await prepareImage(blob, kind);
      const fps = [...S.images.map(i => i.fp), ...uploader.items.map(i => i.fp)].filter(Boolean);
      if (C.isDuplicate(prep.fp, fps)) { toast(t('dupPhoto'), 'warn'); continue; }
      await uploader.add({ id: C.newId('im'), pid: S.pid, labelId, kind, owner: S.me, ...prep });
    } catch (e) {
      const m = e && e.message;
      toast(t(m === 'tooSmall' ? 'tooSmall' : m === 'fetchFail' ? 'fetchFail' : 'notImage'), 'warn');
    }
  }
}

async function tryPhoto(files, urls) {
  try {
    const blob = files[0] || (urls[0] ? await fetchImageUrl(urls[0]) : null);
    if (!blob) return;
    const photo = URL.createObjectURL(blob);
    S.tryOne = { busy: true, photo }; schedule();
    const loaded = await loadModel(S.project.modelUrl);
    const img = await imageFromBlob(blob);
    const preds = await predict(loaded, img);
    S.tryOne = { photo, probs: probsByLabel(preds, S.project.mapping || {}) };
  } catch (e) {
    S.tryOne = { error: true };
  }
  schedule();
}

async function deletePhoto(id, pending) {
  if (pending) return uploader.remove(id);
  if (!confirm(t('deleteConfirm'))) return;
  const im = S.images.find(i => i.id === id);
  if (!im) return;
  if (im.driveId) trashFile(() => auth.currentUser.getIdToken(), S.pid, im.driveId).catch(() => { /* 드라이브에 남아도 기록이 없으면 내려받기에 안 들어간다 */ });
  try { await deleteDoc(doc(db, 'ai_projects', S.pid, 'images', id)); }
  catch (e) { toast(t('error'), 'err'); }
}

// ── 동기화: 장수·열린 단계·현황판 요약 ──
function sync() {
  const p = S.project;
  if (!p || !S.imagesReady) return;
  debounce('sync', async () => {
    const p = S.project;
    if (!p) return;
    const counts = C.countImages(S.images);
    const upd = {};
    if (C.stableJson(counts) !== C.stableJson(p.counts || { train: {}, test: {} })) upd.counts = counts;
    const merged = { ...p, counts };
    const nu = C.nextUnlock(merged, S.asg);
    if (nu > (p.step || 1)) upd.step = nu;
    if (Object.keys(upd).length) await safeUpdate(pref(), upd);
    const summary = C.buildSummary({ ...merged, step: Math.max(nu, p.step || 1) }, S.asg);
    if (S.pair && !C.sameSummary(S.pair.summary, summary)) {
      try { await updateDoc(doc(db, 'ai_pairs', S.pair.id), { summary }); } catch (e) { console.warn('summary', e.code); }
    }
  }, 500);
}

// ── 구독 ──
function stop(k) { if (unsub[k]) { unsub[k](); unsub[k] = null; } }

function watchProject(pid) {
  if (S.pid === pid) return;
  ['project', 'images', 'app'].forEach(stop);
  S.pid = pid; S.project = null; S.images = []; S.imagesReady = false; S.labels = null; S.link = null;
  S.evalRun = null; S.tryOne = null; S.drafts = {}; S.viewStep = 0; S.appDoc = null;
  unsub.project = onSnapshot(pref(), snap => {
    if (!snap.exists()) return;
    S.project = { id: snap.id, ...snap.data({ serverTimestamps: 'estimate' }) };
    const ae = document.activeElement;
    const typingLabel = ae && ae.dataset && ae.dataset.field === 'lname';
    if (!S.labelsDirty && !typingLabel) S.labels = (S.project.labels || []).map(l => ({ ...l }));
    if (!S.viewStep) {
      const saved = Number(sessionStorage.getItem('ailab_view_' + pid));
      S.viewStep = saved && saved <= (S.project.step || 1) ? saved : (S.project.step || 1);
      S.bannerFor = S.project.step || 1;
    }
    sync(); schedule();
  }, e => { console.error(e); screen(t('error'), e.code || ''); });
  unsub.images = onSnapshot(collection(db, 'ai_projects', pid, 'images'), snap => {
    S.images = snap.docs.map(d => ({ id: d.id, ...d.data({ serverTimestamps: 'estimate' }) }));
    S.imagesReady = true;
    sync(); schedule();
  });
  unsub.app = onSnapshot(doc(db, 'ai_apps', pid), snap => { S.appDoc = snap.exists() ? snap.data() : null; schedule(); }, () => {});
  uploader.open(pid);
}

async function ensureProject(round) {
  const pair = S.pair;
  const pid = `${pair.id}_${round}`;
  await runTransaction(db, async tx => {
    const ref = doc(db, 'ai_projects', pid);
    const snap = await tx.get(ref);
    if (!snap.exists()) {
      tx.set(ref, {
        asId: S.asg.id, pairId: pair.id, round, memberEmails: pair.memberEmails,
        schoolName: S.asg.schoolName || '', grade: S.asg.grade || '', class: S.asg.class || '',
        // 빈 레이블 칸 2개를 짝에게 하나씩 미리 맡겨 둔다(대표가 바로 이름만 쓰면 되게).
        step: 1, defined: false, topic: '', counts: { train: {}, test: {} },
        labels: [0, 1].map(i => ({ id: C.newId('l'), name: '', owner: pair.members[i % pair.members.length], tr: {} })),
        appLabels: {}, app: { title: '', theme: 'minimal' }, published: false,
        createdAt: serverTimestamp(), updatedAt: serverTimestamp(),
      });
    }
    tx.update(doc(db, 'ai_pairs', pair.id), { round, currentProjectId: pid });
  });
}

function watchPair() {
  stop('pair');
  const q = query(collection(db, 'ai_pairs'), where('asId', '==', S.asg.id), where('members', 'array-contains', S.me));
  unsub.pair = onSnapshot(q, async snap => {
    const d = snap.docs[0];
    S.pair = d ? { id: d.id, ...d.data() } : null;
    if (!S.pair) { ['project', 'images', 'app'].forEach(stop); S.pid = ''; S.project = null; return schedule(); }
    if (!S.pair.currentProjectId) {
      try { await ensureProject(S.pair.round ? S.pair.round : 1); }
      catch (e) { console.error(e); screen(t('error'), e.code || e.message); }
      return;
    }
    watchProject(S.pair.currentProjectId);
    schedule();
  }, e => { console.error(e); screen(t('error'), e.code || ''); });
}

function watchBoard(on) {
  stop('board');
  if (!on) return;
  unsub.board = onSnapshot(query(collection(db, 'ai_pairs'), where('asId', '==', S.asg.id)), snap => {
    S.board = snap.docs.map(d => ({ id: d.id, ...d.data() }));
    schedule();
  });
}

function chooseAsg(a) {
  S.asg = a;
  sessionStorage.setItem('ailab_as', a.id);
  stop('asg');
  unsub.asg = onSnapshot(doc(db, 'ai_assignments', a.id), snap => {
    if (snap.exists()) { S.asg = { id: snap.id, ...snap.data() }; schedule(); }
  });
  watchPair();
}

// ── 동작 ──
const actions = {
  tab(v) { S.tab = v; watchBoard(v === 'board'); schedule(); },
  step(v) {
    const n = Number(v);
    if (n > (S.project.step || 1)) return;
    S.viewStep = n; S.bannerFor = Math.max(S.bannerFor, S.project.step || 1);
    sessionStorage.setItem('ailab_view_' + S.pid, String(n));
    S.tryOne = null;
    schedule(); window.scrollTo({ top: 0, behavior: 'smooth' });
  },
  'banner-x'() { S.bannerFor = S.project.step || 1; schedule(); },
  s3tab(v) { S.s3tab = v; schedule(); },
  'goto-test'() { S.s3tab = 'test'; actions.step(3); },
  ladd() {
    const ls = S.labels || [];
    if (ls.length >= maxLabels()) return;
    const owners = members();
    // 아직 하나도 안 맡은 사람에게 먼저 준다.
    const owner = owners.find(m => !ls.some(l => l.owner === m)) || S.me;
    S.labels = [...ls, { id: C.newId('l'), name: '', owner, tr: {} }];
    saveLabels();
  },
  lremove(_, el) {
    S.labels = (S.labels || []).filter(l => l.id !== el.dataset.id);
    saveLabels();
  },
  async s1confirm() {
    const topic = (S.drafts.topic != null ? S.drafts.topic : S.project.topic || '').trim();
    const labels = (S.labels || []).map(l => ({ ...l, name: String(l.name || '').trim() }));
    const errs = [];
    if (!topic) errs.push('noTopic');
    errs.push(...C.validateLabels(labels, members(), maxLabels()));
    if (errs.length) { $('s1err').textContent = errs.map(e => t('e_' + e, { n: maxLabels() })).join(' '); return; }
    // 입력하며 걸어 둔 레이블 자동 저장이 번역 결과를 덮어쓰지 않게 먼저 멈춘다.
    clearTimeout(timers['labels-save']); clearTimeout(timers['labels']);
    S.labelsDirty = true;
    S.busy.s1 = true; schedule();
    const src = S.lang;
    const todo = labels.filter(l => l.trOf !== l.name);
    let topicTr = S.project.topicTr || {};
    if (todo.length || S.project.topic !== topic) {
      const texts = [...todo.map(l => C.withContext(l.name, topic)), topic];
      for (const lang of C.LANGS) {
        try {
          const r = await fetch('/api/translate', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ texts, targetLang: lang, sourceLang: 'auto' }) });
          const data = await r.json();
          if (data.error || !Array.isArray(data.translations)) throw new Error(data.error || 'translate');
          todo.forEach((l, i) => { l.tr = { ...(l.tr || {}), [lang]: C.stripContext(data.translations[i].text) }; });
          topicTr = { ...topicTr, [lang]: data.translations[texts.length - 1].text };
        } catch (e) { console.warn('번역 실패(원문으로 진행):', lang, e.message); }
      }
      todo.forEach(l => { l.tr = { ...(l.tr || {}), [src]: l.name }; l.trOf = l.name; });
    }
    const ok = await safeUpdate(pref(), {
      topic, topicTr, labels, defined: true, srcLang: S.project.srcLang || src,
      step: Math.max(S.project.step || 1, 2), updatedAt: serverTimestamp(),
    });
    S.busy.s1 = false; S.labelsDirty = false; delete S.drafts.topic;
    if (ok) S.labels = labels.map(l => ({ ...l }));
    if (ok) actions.step(2); else schedule();
  },
  pick(_, el) {
    const [kind, id] = el.dataset.zone.split(':');
    const inp = $('filePick');
    inp.dataset.zone = `${kind}:${id}`;
    inp.multiple = kind !== 'try';
    inp.click();
  },
  'photo-del'(_, el) { deletePhoto(el.dataset.id, el.dataset.pending === '1'); },
  async dl(v) {
    if (!isLeader()) return;
    const train = imgs('train').filter(i => i.driveId);
    const since = ms(S.project.lastDownloadAt);
    const list = v === 'new' ? train.filter(i => ms(i.createdAt) > since) : train;
    if (!list.length) return;
    S.busy.dl = true; schedule();
    try {
      // 파일 이름은 영문으로 — 브라우저·PC에 따라 한글 이름이 'download'로 바뀌는 경우가 있다.
      const name = `ai_photos${S.project.round > 1 ? '_' + S.project.round : ''}${v === 'new' ? '_new' : ''}.zip`;
      await downloadZip(() => auth.currentUser.getIdToken(), S.pid, list.map(i => i.driveId), name);
      await safeUpdate(pref(), { lastDownloadAt: serverTimestamp() });
      toast(t('dlDone'), 'ok');
    } catch (e) {
      toast(e.code === 'notConfigured' ? t('driveNotSet') : t('dlFail'), 'err');
    }
    S.busy.dl = false; schedule();
  },
  relink() { S.link = { classes: null }; schedule(); },
  async linkcheck() {
    const raw = (S.drafts.link || '').trim();
    const parsed = C.parseModelUrl(raw);
    if (parsed.error) { S.link = { error: parsed.error }; return schedule(); }
    S.busy.link = true; S.link = null; schedule();
    try {
      const { labels: classes } = await fetchMetadata(parsed.url);
      S.link = { url: parsed.url, id: parsed.id, classes, mapping: C.autoMapClasses(classes, labelsOf()) };
    } catch (e) {
      S.link = { error: e.code && t('l_' + e.code) !== 'l_' + e.code ? e.code : 'loadFail' };
    }
    S.busy.link = false; schedule();
  },
  async mapsave() {
    const L = S.link;
    if (!L || !L.classes) return;
    const chk = C.checkMapping(L.classes, labelsOf(), L.mapping);
    if (!chk.ok) return;
    const ok = await safeUpdate(pref(), {
      modelUrl: L.url, modelId: L.id, modelClasses: L.classes, mapping: L.mapping, mappingOk: true,
      modelAt: serverTimestamp(), updatedAt: serverTimestamp(),
    });
    if (ok) { S.link = null; delete S.drafts.link; toast(t('linked'), 'ok'); }
    schedule();
  },
  async evalrun() {
    const tests = imgs('test');
    if (!tests.length || S.evalRun) return;
    S.evalRun = { i: 0, n: tests.length }; schedule();
    try {
      const loaded = await loadModel(S.project.modelUrl, { fresh: true });
      const mapping = S.project.mapping || {};
      const results = [];
      for (const im of tests) {
        const img = await imageFromSrc(im.evalImg);
        const probs = probsByLabel(await predict(loaded, img), mapping);
        let best = '', bp = -1;
        for (const l of labelsOf()) { const p = probs[l.id] || 0; if (p > bp) { bp = p; best = l.id; } }
        results.push({ imgId: im.id, labelId: im.labelId, got: best, p: Math.round(bp * 100), ok: best === im.labelId });
        S.evalRun.i++; schedule();
      }
      const sc = C.scoreResults(results);
      const rounds = C.evalRounds(S.project);
      const n = rounds.length ? rounds[rounds.length - 1].n + 1 : 1;
      await safeUpdate(pref(), {
        [`evals.r${n}`]: {
          n, at: serverTimestamp(), total: sc.total, correct: sc.correct, pct: sc.pct, per: sc.per,
          wrong: results.filter(r => !r.ok).map(({ imgId, labelId, got, p }) => ({ imgId, labelId, got, p })),
          modelId: S.project.modelId || '', stars: {}, cause: [], causeText: '', fix: '',
        },
      });
      S.evalRun = null; S.drafts.star = null; delete S.drafts.reason; delete S.drafts.causeText; delete S.drafts.fix;
    } catch (e) {
      console.error(e);
      S.evalRun = { error: true, i: 0, n: 0 };
      setTimeout(() => { S.evalRun = null; schedule(); }, 4000);
    }
    schedule();
  },
  star(v) { S.drafts.star = Number(v); schedule(); },
  async starsave() {
    const cur = C.currentEval(S.project);
    if (!cur) return;
    const mine = (cur.stars || {})[S.me] || {};
    const s = S.drafts.star || mine.s || 0;
    const reason = (S.drafts.reason != null ? S.drafts.reason : mine.reason || '').trim();
    if (!s) return toast(t('needStar'), 'warn');
    if (!reason) return toast(t('needReason'), 'warn');
    const ok = await safeUpdate(pref(), { [`evals.${cur.key}.stars.${S.me}`]: { s, reason, at: serverTimestamp() } });
    if (ok) { toast(t('saved'), 'ok'); S.drafts.star = null; delete S.drafts.reason; }
    schedule();
  },
  async cause(v, el) {
    const cur = C.currentEval(S.project);
    if (!cur) return;
    const set = new Set(cur.cause || []);
    if (el.checked) set.add(v); else set.delete(v);
    await safeUpdate(pref(), { [`evals.${cur.key}.cause`]: [...set] });
  },
  async theme(v) { await safeUpdate(pref(), { 'app.theme': v }); },
  async emoji(v, el) { await safeUpdate(pref(), { [`appLabels.${el.dataset.id}.emoji`]: v }); },
  async phrase(v, el) { await safeUpdate(pref(), { [`appLabels.${el.dataset.id}.phrase`]: Number(v) }); },
  'preview-label'(v) { S.previewLabel = Number(v); schedule(); },
  async publish() {
    const a = appData();
    const err = $('s5err');
    if (!a.title.trim()) { err.textContent = t('e_title'); $('f-title') && $('f-title').focus(); return; }
    for (const l of a.labels) {
      if (l.phrase === C.CUSTOM_PHRASE) {
        const v = C.validateCustomPhrase(S.drafts['custom-' + l.id] != null ? S.drafts['custom-' + l.id] : l.custom);
        if (v) { err.textContent = `${l.name}: ${t('c_' + v)}`; return; }
      }
    }
    err.textContent = '';
    S.busy.pub = true; schedule();
    try {
      // 남아 있는 입력을 먼저 저장
      await flushDrafts();
      const fresh = appData();
      const upd = {};
      // 직접 쓴 문구: "레이블 + 뒷말" 문장 전체를 다른 언어로 번역해 둔다.
      for (const l of fresh.labels) {
        if (l.phrase !== C.CUSTOM_PHRASE || !l.custom) continue;
        const sentence = `${l.name}${l.custom}`;
        const al = (S.project.appLabels || {})[l.id] || {};
        if (al.customTrOf === sentence) continue;
        const tr = {};
        for (const lang of C.LANGS) {
          if (lang === (l.customLang || S.lang)) continue;
          try {
            const r = await fetch('/api/translate', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ texts: [sentence], targetLang: lang, sourceLang: 'auto' }) });
            const d = await r.json();
            if (d.translations && d.translations[0] && d.translations[0].text) tr[lang] = d.translations[0].text;
          } catch { /* 번역이 안 되면 원문을 보여 준다 */ }
        }
        upd[`appLabels.${l.id}.customTr`] = tr;
        upd[`appLabels.${l.id}.customTrOf`] = sentence;
        l.customTr = tr;
      }
      const pub = {
        title: fresh.title.trim().slice(0, C.TITLE_MAX), theme: fresh.theme, srcLang: fresh.srcLang,
        labels: fresh.labels.map(({ id, name, tr, emoji, phrase, custom, customLang, customTr }) => ({ id, name, tr, emoji, phrase, custom, customLang, customTr })),
        modelUrl: fresh.modelUrl, mapping: fresh.mapping, published: true, updatedAt: serverTimestamp(),
      };
      await setDoc(doc(db, 'ai_apps', S.pid), pub, { merge: true });
      await updateDoc(pref(), { ...upd, published: true, pubSig: appSig(fresh), 'app.publishedAt': serverTimestamp() });
      toast(t('published'), 'ok');
    } catch (e) {
      console.error(e); toast(t('error') + ': ' + (e.code || e.message), 'err');
    }
    S.busy.pub = false; schedule();
  },
  async copy() {
    try { await navigator.clipboard.writeText(appUrl()); toast(t('copied'), 'ok'); }
    catch { const el = $('f-url'); el.select(); document.execCommand('copy'); toast(t('copied'), 'ok'); }
  },
  async post() {
    const b = S.asg.board;
    if (!b || !b.name || S.project.postId) return;
    S.busy.post = true; schedule();
    try {
      const url = appUrl();
      const a = appData();
      const sx = { ko: 'Ko', zh: 'Zh', ru: 'Ru', en: 'En' };
      const texts = {};
      for (const lang of C.LANGS) {
        const tl = makeT(lang);
        texts['sub' + sx[lang]] = tl('postTitle', { title: a.title });
        texts['msg' + sx[lang]] = tl('postBody', { url, labels: a.labels.map(l => `${l.emoji || ''}${C.labelName(l, lang)}`).join(', ') });
      }
      const ref = await addDoc(collection(db, 'posts'), {
        classTitle: b.name, boardKey: C.classBoardKey(b), grade: b.grade || '', group: b.group || '',
        num: String(S.session.number || ''), name: S.session.name || '', studentId: S.me, srcLang: S.lang,
        ...texts, imgs: [], column: '', likes: 0, pinned: false, deleted: false,
        createdAt: serverTimestamp(), updatedAt: serverTimestamp(),
      });
      await updateDoc(pref(), { postId: ref.id });
      toast(t('posted'), 'ok');
    } catch (e) { console.error(e); toast(t('error') + ': ' + (e.code || e.message), 'err'); }
    S.busy.post = false; schedule();
  },
  async newmodel() {
    if (!confirm(t('newModelConfirm'))) return;
    try { await ensureProject((S.pair.round || S.project.round || 1) + 1); }
    catch (e) { toast(t('error') + ': ' + (e.code || e.message), 'err'); }
  },
};

// ① 레이블 저장(대표만). 입력할 때마다가 아니라 잠깐 멈췄을 때 저장한다.
function saveLabels() {
  S.labelsDirty = true;
  schedule();
  debounce('labels', async () => {
    const labels = (S.labels || []).map(({ id, name, owner, tr, trOf }) => ({ id, name: String(name || '').slice(0, C.LABEL_NAME_MAX), owner, tr: tr || {}, ...(trOf ? { trOf } : {}) }));
    await safeUpdate(pref(), { labels, updatedAt: serverTimestamp() });
    S.labelsDirty = false;
  }, 500);
}

// 입력 칸: 글자는 drafts에 두고, 함께 보는 칸은 잠깐 멈추면 저장한다.
async function saveField(field, el) {
  const v = el.value;
  const cur = C.currentEval(S.project);
  switch (field) {
    case 'topic': return safeUpdate(pref(), { topic: v.slice(0, 40), updatedAt: serverTimestamp() });
    case 'title': return safeUpdate(pref(), { 'app.title': v.slice(0, C.TITLE_MAX) });
    case 'causeText': case 'fix':
      if (cur) return safeUpdate(pref(), { [`evals.${cur.key}.${field}`]: v.slice(0, 300) });
      return;
    case 'custom': {
      const id = el.dataset.id;
      if (C.validateCustomPhrase(v)) return;  // 잘못된 글은 저장하지 않는다(화면에 이유가 보인다)
      return safeUpdate(pref(), { [`appLabels.${id}.custom`]: v, [`appLabels.${id}.customLang`]: S.lang });
    }
  }
}
const SAVED_FIELDS = new Set(['topic', 'title', 'causeText', 'fix', 'custom']);
async function flushDrafts() {
  for (const key of Object.keys(timers)) {
    if (!key.startsWith('field:')) continue;
    clearTimeout(timers[key]);
    const el = $(key.slice(6));
    if (el) await saveField(el.dataset.field, el);
  }
}

function draftKey(el) {
  const f = el.dataset.field;
  return f === 'custom' ? 'custom-' + el.dataset.id : f;
}

function bindEvents() {
  const main = $('main');
  main.addEventListener('click', e => {
    const el = e.target.closest('[data-act]');
    if (!el || !main.contains(el)) return;
    const act = el.dataset.act;
    if (el.type === 'checkbox' || el.type === 'radio') return; // change에서 처리
    if (actions[act]) { e.preventDefault(); actions[act](el.dataset.v, el); }
  });
  main.addEventListener('change', e => {
    const el = e.target;
    if (el.dataset.act && (el.type === 'checkbox' || el.type === 'radio') && actions[el.dataset.act]) return actions[el.dataset.act](el.dataset.v, el);
    const f = el.dataset.field;
    if (f === 'lowner') { S.labels = (S.labels || []).map(l => l.id === el.dataset.id ? { ...l, owner: el.value } : l); saveLabels(); }
    if (f === 'lowner2') {
      const labels = labelsOf().map(l => l.id === el.dataset.id ? { ...l, owner: el.value } : l);
      safeUpdate(pref(), { labels });
    }
    if (f === 'map' && S.link) { S.link.mapping = { ...S.link.mapping, [el.dataset.id]: el.value }; schedule(); }
  });
  main.addEventListener('input', e => {
    const el = e.target;
    const f = el.dataset.field;
    if (!f) return;
    if (f === 'lname') {
      S.labels = (S.labels || []).map(l => l.id === el.dataset.id ? { ...l, name: el.value } : l);
      S.labelsDirty = true;
      return debounce('labels-save', saveLabels, 400);
    }
    S.drafts[draftKey(el)] = el.value;
    if (f === 'custom' || f === 'title') schedule(); // 미리보기·오류 문구 갱신
    if (SAVED_FIELDS.has(f)) debounce('field:' + el.id, () => saveField(f, el), 700);
  });
  main.addEventListener('focusin', e => {
    if (S.rendering) return;
    const f = e.target.dataset && e.target.dataset.field;
    if (f !== 'causeText' && f !== 'fix') return;
    const ed = (S.project.editing || {})[f];
    if (ed && ed.by === S.me && Date.now() - ms(ed.at) < 30000) return; // 이미 표시해 둠
    updateDoc(pref(), { [`editing.${f}`]: { by: S.me, at: serverTimestamp() } }).catch(() => {});
  });
  main.addEventListener('focusout', e => {
    if (S.rendering) return;
    const el = e.target;
    const f = el.dataset && el.dataset.field;
    if ((f === 'causeText' || f === 'fix') && ((S.project.editing || {})[f] || {}).by === S.me) updateDoc(pref(), { [`editing.${f}`]: deleteField() }).catch(() => {});
    if (SAVED_FIELDS.has(f) && timers['field:' + el.id]) {
      clearTimeout(timers['field:' + el.id]); delete timers['field:' + el.id];
      saveField(f, el).then(() => { delete S.drafts[draftKey(el)]; });
    } else if (SAVED_FIELDS.has(f)) {
      setTimeout(() => { if (document.activeElement !== el) delete S.drafts[draftKey(el)]; }, 1500);
    }
  });

  const pick = $('filePick');
  pick.addEventListener('change', () => {
    const [kind, id] = (pick.dataset.zone || '').split(':');
    const files = Array.from(pick.files || []);
    pick.value = '';
    if (kind) onPhotos(kind, id, files, []);
  });

  window.addEventListener('beforeunload', e => {
    if (uploader.count && driveConfigured()) { e.preventDefault(); e.returnValue = t('leaveWarn'); return t('leaveWarn'); }
  });

  // 상단 메뉴
  document.querySelectorAll('.lang-item').forEach(el => el.addEventListener('click', () => {
    S.lang = el.dataset.lang; setLang(S.lang); S.t = makeT(S.lang);
    $('langDD').classList.add('hidden'); schedule();
  }));
  $('langBtn').addEventListener('click', e => { e.stopPropagation(); $('langDD').classList.toggle('hidden'); });
  document.addEventListener('click', () => $('langDD').classList.add('hidden'));
  $('darkBtn').addEventListener('click', () => {
    document.body.classList.toggle('dark');
    localStorage.setItem('dark', document.body.classList.contains('dark') ? '1' : '0');
  });
}

// ── 시작 ──
async function start() {
  if (localStorage.getItem('dark') === '1') document.body.classList.add('dark');
  applyStaticText();
  bindEvents();
  const session = loadSession();
  if (!session) { location.href = 'index.html'; return; }
  S.session = session; S.me = session.id;
  $('navName').textContent = session.name || '';
  verifyStudentAuth(session).then(fresh => { if (fresh) { S.session = fresh; $('navName').textContent = fresh.name || ''; } });
  await authReady();
  screen(t('loading'), '');
  let list = [];
  try {
    const snap = await getDocs(query(collection(db, 'ai_assignments'), where('status', '==', 'ON')));
    list = snap.docs.map(d => ({ id: d.id, ...d.data() }));
  } catch (e) { console.error(e); return screen(t('error'), e.code || e.message); }
  const mine = list.filter(a => (!a.schoolName || a.schoolName === session.schoolName)
    && (!a.grade || C.nv(a.grade) === C.nv(session.grade)) && (!a.class || C.nv(a.class) === C.nv(session.class)));
  S.asgs = session.isMaster ? list : mine;
  if (!S.asgs.length) { S.asg = { status: 'OFF' }; return render(); }
  const saved = S.asgs.find(a => a.id === sessionStorage.getItem('ailab_as'));
  if (S.asgs.length === 1 || saved) return chooseAsg(saved || S.asgs[0]);
  screen(t('chooseAssignment'), '', `<div class="choose">${S.asgs.map(a => `<button class="btn" data-asg="${E(a.id)}">${E(a.title || a.id)}</button>`).join('')}</div>`);
  $('main').querySelectorAll('[data-asg]').forEach(b => b.addEventListener('click', () => chooseAsg(S.asgs.find(a => a.id === b.dataset.asg))));
}

$('logoutBtn').addEventListener('click', () => { clearSession(); location.href = 'index.html'; });
start();
