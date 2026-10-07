// AI 실험실(학생) — 모둠(관리자가 인원을 정함)이 함께 이미지 분류 모델을 만드는 5단계.
//  ① 문제 정의(대표) → ② 데이터 수집(각자 맡은 레이블) → ③ 학습(대표: 티처블머신 /
//  모둠원: 테스트 사진) → ④ 평가(자동 채점 + 각자 별점, 함께 원인·고칠 점) → ⑤ 배포(웹앱 + ohdlet)
//
// 데이터: ai_assignments(반 배정) / ai_pairs(모둠, 현황판 요약) / ai_projects(모둠의 모델 하나)
//         / ai_projects/{pid}/images(사진 기록) / ai_apps(공개 웹앱)
// 모둠원 모두가 같은 프로젝트를 실시간으로 본다. "열린 단계"는 함께 쓰고, 지금 보고 있는
// 화면은 각자 고른다 — 한 사람이 넘어가도 다른 사람 화면이 끌려가지 않게.

import { db, auth } from './firebase-config.js';
import {
  doc, getDocs, setDoc, updateDoc, onSnapshot, collection, query, where, deleteDoc,
  serverTimestamp, runTransaction, deleteField, addDoc,
} from 'https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js';
import { loadSession, verifyStudentAuth, authReady, clearSession } from './session.js';
import { escHtml } from './escape.js';
import * as C from './ai-core.js?v=202610070056';
import { makeT, getLang, setLang } from './ai-i18n.js?v=202610070056';
import { prepareImage, bindDropZone, clearZones, fetchFirstImage, onStrayDrop } from './ai-image.js?v=202610070056';
import { Uploader, driveConfigured, trashFile, fetchTrainPhotos, saveModelToDrive } from './ai-drive.js?v=202610070056';
import { loadModel, predict, imageFromSrc, imageFromBlob, trainModel, loadDriveModel, rememberModel, TRAIN_PARAMS } from './ai-model.js?v=202610070056';
import { appHtml, probsByLabel, THEMES } from './ai-render.js?v=202610070056';

const E = escHtml;
const $ = id => document.getElementById(id);

// ── 상태 ──
const S = {
  session: null, me: '', lang: getLang(), t: null,
  asgs: [], asg: null, pair: null, project: null, pid: '',
  images: [], imagesReady: false, appDoc: null,
  viewStep: 0, tab: 'project', s3tab: '', board: [],
  labels: null, labelsDirty: false,                // ① 대표가 고치는 중인 레이블
  drafts: {},                                      // 입력 중인 글(서버 값이 덮어쓰지 않게)
  training: null,                                  // ③ 이 PC에서 하는 학습 진행 상황(대표)
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
    w: item.w || 0, h: item.h || 0, small: !!item.small, createdAt: serverTimestamp(),
  }),
  onChange: () => schedule(),
  onDrop: (item, code) => toast(code === 'auth' ? t('error') + ' (auth)' : t('notImage'), 'warn'),
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
  // 한글은 글자를 조합하는 동안(ㄱ+ㅗ → 고) 입력칸이 바뀌면 조합이 끊겨 "ㄱㅗ"로 남는다.
  // 조합이 끝날 때(compositionend)까지 미뤘다가 그린다.
  if (S.composing) { S.renderPending = true; return; }
  S.renderPending = false;
  applyStaticText();
  if (!S.asg) return;
  if (S.asg.status !== 'ON') return screen(t('noAssignment'), t('noAssignmentSub'));
  if (!S.pair) {
    screen(t('noPair'), t('noPairSub'), S.asgs.length > 1 ? `<div class="choose"><button class="btn" id="reChoose">${E(t('otherClass'))}</button></div>` : '');
    const b = $('reChoose'); if (b) b.addEventListener('click', showChooser);
    return;
  }
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
      <div class="ro-labels">${labels.length ? labels.map(l => `<div class="ro-label"><b>${E(l.name || '…')}</b>${ownerTag(l)}${trHtml(l)}</div>`).join('') : '<div class="ro">…</div>'}</div></div></div>`;
    if (p.defined && p.step >= 2) body += nextBtn(2, 's2');
    return body;
  }
  body += `<div class="card">
    <div class="field"><label for="f-topic">${E(t('topicLabel'))}</label>
      <input id="f-topic" data-field="topic" maxlength="40" placeholder="${E(t('topicPh'))}" value="${E(draftOr('topic', p.topic))}"></div>
    <div class="field"><label>${E(t('labelsLabel'))}</label>
      <div class="label-rows">${labels.map((l, i) => `<div class="label-row">
        <span class="ln">${i + 1}</span>
        <input id="f-lname-${E(l.id)}" data-field="lname" data-id="${E(l.id)}" maxlength="${C.LABEL_NAME_MAX}" placeholder="${E(t('labelPh'))}" value="${E(l.name)}" ${hasImg(l.id) ? 'disabled title="🔒"' : ''}>
        <button class="icon-btn" data-act="lremove" data-id="${E(l.id)}" ${labels.length <= 2 || hasImg(l.id) ? 'disabled' : ''} aria-label="${E(t('del'))}">×</button>
      </div><div class="owner-line"><span class="muted">${E(t('owner'))}</span>${ownerChips(l, 's1')}</div>${trHtml(l)}`).join('')}</div>
      ${labels.length < maxLabels() ? `<button class="btn ghost sm" data-act="ladd">${E(t('addLabel'))}</button>` : ''}
    </div>
    <div id="s1err" class="err"></div>
    <button class="btn primary" data-act="s1confirm" ${S.busy.s1 ? 'disabled' : ''}>${E(S.busy.s1 ? t('translating') : (p.defined ? t('saveChanges') : t('s1Confirm')))}</button>
  </div>`;
  if (p.defined && p.step >= 2) body += nextBtn(2, 's2');
  return body;
}

// 레이블을 모으는 사람: 모둠이면 여러 명. 대표는 이름 칩을 눌러 켜고 끈다.
const namesOf = l => C.ownersOf(l).map(nameOf).join(', ');
const isMine = l => C.ownersOf(l).includes(S.me);
function ownerChips(l, scope) {
  const on = new Set(C.ownersOf(l));
  return `<div class="ochips" role="group" aria-label="${E(t('owner'))}">${members().map(m =>
    `<button type="button" class="ochip${on.has(m) ? ' on' : ''}" data-act="otoggle" data-scope="${scope}" data-id="${E(l.id)}" data-m="${E(m)}">${E(nameOf(m))}</button>`).join('')}</div>`;
}
function ownerTag(l) {
  return `<span class="tag${isMine(l) ? ' me' : ''}">${E(isMine(l) ? t('mine') : t('collector', { name: namesOf(l) }))}</span>`;
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
  const cell = (im, pending) => `<div class="ph${pending ? ' pend' : ''}${im.small ? ' small' : ''}"${im.small ? ` title="${E(t('smallPhoto'))}"` : ''}><img src="${E(im.thumb)}" alt="" loading="lazy">
    ${im.small ? `<span class="ph-small">${E(t('smallBadge'))}</span>` : ''}
    ${pending ? '<span class="ph-spin"></span>' : ''}
    ${canDelete(im) ? `<button class="ph-x" data-act="photo-del" data-id="${E(im.id)}" data-pending="${pending ? 1 : 0}" aria-label="${E(t('del'))}">×</button>` : ''}</div>`;
  return `<div class="photos">${pend.map(i => cell(i, true)).join('')}${done.map(i => cell(i, false)).join('')}</div>`;
}

function zoneHtml(kind, labelId, standalone = false) {
  return `<div class="dz" tabindex="0"${standalone ? ` data-dropzone="${kind}:${E(labelId)}"` : ''}>
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
    const mine = isMine(l);
    const c = imgs('train', l.id).length;
    const pct = Math.min(100, Math.round(c * 100 / min));
    return `<div class="lcard${mine ? ' mine' : ''}"${mine ? ` data-dropzone="train:${E(l.id)}"` : ''}>
      <div class="lc-head"><b>${E(l.name)}</b>${ownerTag(l)}</div>
      ${isLeader() && members().length > 1 ? ownerChips(l, 's2') : ''}
      <div class="prog"><div class="bar"><span style="width:${pct}%"></span></div>
        <span class="cnt">${E(t('countOf', { c, m: min }))}</span></div>
      <div class="lc-state ${c >= min ? 'ok' : ''}">${E(c >= min ? t('enough') : t('needMore', { n: min - c }))}${imgs('train', l.id).some(i => i.small) ? ` <span class="warn-txt">· ${E(t('smallCount', { n: imgs('train', l.id).filter(i => i.small).length }))}</span>` : ''}</div>
      ${mine ? zoneHtml('train', l.id) : `<div class="not-mine">${E(t('notMine', { name: namesOf(l) }))}</div>`}
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

// 학습 단계별 진행률(%) — 사진 받기 0~20, 기본 모델 20~25, 특징 뽑기 25~50, 학습 50~95, 저장 95~100.
const PHASE_SPAN = { photos: [0, 20], base: [20, 25], extract: [25, 50], train: [50, 95], save: [95, 100] };
function phasePct(tr) {
  const [a, b] = PHASE_SPAN[tr.phase] || [0, 0];
  return Math.round(a + (b - a) * (tr.n ? Math.min(1, tr.i / tr.n) : 0));
}

function trainTab(leader) {
  const p = S.project;
  const labels = labelsOf();
  const tr = S.training;
  const remote = p.training && p.training.state === 'running' && p.training.by !== S.me && Date.now() - ms(p.training.at) < 5 * 60000 ? p.training : null;
  const busy = !!(tr && !tr.done && !tr.error);
  const pending = uploader.items.filter(i => i.kind === 'train').length;
  const newN = C.newSinceTraining(p, S.images);
  const v = p.modelVersion || 0;
  let h = leader ? '' : `<div class="note">${E(t('leaderOnly', { name: leaderName() }))}</div>`;

  h += `<div class="card"><h3>${E(t('trainData'))}</h3><div class="tdata">${labels.map(l => {
    const list = imgs('train', l.id).filter(i => i.driveId);
    const small = list.filter(i => i.small).length;
    return `<div class="trow"><b>${E(l.name)}</b><span class="cnt">${E(t('countOf', { c: list.length, m: minTrain() }))}</span>${small ? `<span class="warn-txt">${E(t('smallCount', { n: small }))}</span>` : ''}</div>`;
  }).join('')}</div>
    ${newN ? `<div class="note warn">${E(t('newSince', { n: newN }))}</div>` : ''}
    ${pending ? `<div class="note">${E(t('pendingFirst', { n: pending }))}</div>` : ''}
    ${!driveConfigured() ? `<div class="note warn">${E(t('driveNotSet'))}</div>` : ''}</div>`;

  const P = TRAIN_PARAMS;
  h += `<div class="card"><h3>${E(t('paramsTitle'))}</h3><div class="params">${[['epochs', P.epochs], ['batch', P.batchSize], ['lr', P.learningRate]].map(([k, val]) =>
    `<details class="param"><summary><b>${E(t('params.' + k + '.name'))}</b> <code>${val}</code> <span class="info" aria-hidden="true">ⓘ</span></summary><p>${E(t('params.' + k + '.help'))}</p></details>`).join('')}</div></div>`;

  h += '<div class="card train-box">';
  if (leader) {
    h += `<button class="btn primary big" data-act="train" ${busy || pending || !driveConfigured() ? 'disabled' : ''}>🧠 ${E(v ? t('retrain', { n: v + 1 }) : t('trainStart'))}</button>`;
  }
  const show = busy ? tr : remote;
  if (show) {
    const pct = busy ? phasePct(tr) : (remote.pct || 0);
    const label = busy ? t('phase_' + tr.phase, { i: tr.i, n: tr.n }) : t('trainingBy', { name: nameOf(remote.by), pct });
    h += `<div class="tprog"><div class="bar"><span style="width:${pct}%"></span></div><div class="muted"><span class="spin"></span>${E(label)}</div></div>`;
  }
  if (tr && tr.error) h += `<div class="err">${E(t(tr.error))}</div>`;
  if (tr && tr.done) h += `<div class="note ok">✅ ${E(t('trainDone', { n: tr.v }))}</div>`;
  const models = Object.values(p.models || {}).filter(m => m && m.v).sort((a, b) => b.v - a.v);
  if (models.length) {
    h += `<h4>${E(t('modelList'))}</h4><div class="mlist">${models.map(m => `<div class="mitem${m.v === v ? ' cur' : ''}">
      <b>${E(t('modelItem', { n: m.v, c: m.photos || 0 }))}</b>${m.valAcc != null ? ` · ${E(t('valAcc', { p: m.valAcc }))}` : ''}</div>`).join('')}</div>
      <p class="muted sm">ⓘ ${E(t('valHelp'))}</p>`;
  } else if (!leader && !show) {
    h += `<div class="muted">${E(t('noModelYet'))}</div>`;
  }
  return h + '</div>';
}

function testTab() {
  const labels = labelsOf();
  const min = minTest();
  const total = imgs('test').length;
  let h = `<div class="note">${E(t('s3TestLead'))}<br><b>${E(t('s3TestNote'))}</b></div>
    <div class="muted">${E(t('testCount', { c: total, m: min }))}</div>`;
  h += `<div class="lgrid">${labels.map(l => {
    const c = imgs('test', l.id).length;
    return `<div class="lcard test" data-dropzone="test:${E(l.id)}"><div class="lc-head"><b>${E(l.name)}</b><span class="cnt ${c >= min ? 'ok' : ''}">${c} / ${min}</span></div>
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
  if (!C.hasModel(p)) return h + `<div class="note warn">${E(t('noModelYet'))}</div>`;
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
    ${run && run.error ? `<div class="err">${E(t('modelLoadFail'))}</div>` : ''}
    ${cur && (cur.modelVersion || 0) !== (p.modelVersion || 0) ? `<div class="note warn">${E(t('notEvaluated', { n: p.modelVersion }))} ${E(t('modelChanged'))}</div>` : ''}
    ${C.newSinceTraining(p, S.images) ? `<div class="note">${E(t('newSince', { n: C.newSinceTraining(p, S.images) }))}</div>` : ''}
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
  return `<div class="card"><div class="score"><span class="big">${r.pct}%</span><span>${E(t('score', { n: r.total, c: r.correct }))}</span><span class="hchip">${E(t('roundN', { n: r.n }))}</span>${r.modelVersion ? `<span class="hchip">${E(t('evalWith', { n: r.modelVersion }))}</span>` : ''}</div>
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
  } else if (tr && tr.error) res = `<div class="err">${E(t('modelLoadFail'))}</div>`;
  return `<details class="card" ${tr ? 'open' : ''}><summary><b>${E(t('tryOne'))}</b> <span class="muted">${E(t('tryOneHint'))}</span></summary>
    ${zoneHtml('try', 'x', true)}${res}</details>`;
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
    modelVersion: p.modelVersion || 0, modelUrl: p.modelVersion ? '' : (p.modelUrl || ''), mapping: p.mapping || {},
    hiddenPhrases: (S.appDoc && S.appDoc.hiddenPhrases) || {},
  };
}
// 공개 뒤에 고친 게 있는지 비교하는 서명(번역 결과는 빼고).
function appSig(a) {
  return JSON.stringify({ title: a.title, theme: a.theme, v: a.modelVersion, m: a.modelUrl, map: a.mapping, l: a.labels.map(l => [l.id, l.name, l.emoji, l.phrase, l.custom]) });
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
        <div class="err sm" id="err-c-${E(l.id)}">${err && l.phrase === C.CUSTOM_PHRASE ? E(t('c_' + err)) : ''}</div>
        ${hidden[l.id] ? `<div class="note warn">${E(t('hiddenNote'))}</div>` : ''}
      </div></div>`;
  }).join('')}</div>`;
  const dirty = p.published && p.pubSig !== appSig(a);
  const evaluated = C.evalRounds(p).some(r => (r.modelVersion || 0) === (p.modelVersion || 0));
  h += `<div class="card">${p.modelVersion ? `<div class="deploy-model"><b>${E(t('deployModel', { n: p.modelVersion }))}</b></div>
    ${evaluated ? '' : `<div class="note warn">${E(t('deployNotEval', { n: p.modelVersion }))}</div>`}` : ''}
    <div id="s5err" class="err"></div>
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

// 제목·직접 쓰기를 입력하는 동안: 입력칸은 건드리지 않고 미리보기와 그 칸의 오류 문구만 바꾼다.
function updatePreview(el) {
  const frame = document.querySelector('.pv-frame');
  if (frame) frame.innerHTML = previewHtml(appData());
  if (el && el.dataset.field === 'custom') {
    const box = $('err-c-' + el.dataset.id);
    if (box) { const v = C.validateCustomPhrase(el.value); box.textContent = v ? t('c_' + v) : ''; }
  }
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
  document.querySelectorAll('[data-dropzone]').forEach(el => {
    const [kind, id] = el.dataset.dropzone.split(':');
    bindDropZone(el, (files, urls) => onPhotos(kind, id, files, urls));
  });
}

// ── 학습 진행 상황 ──
// 이 PC 화면은 매번, 모둠원 화면(Firestore)은 10%마다만 알린다(쓰기를 줄이려고).
let _lastPushed = -1;
function setPhase(phase, i, n, force = false) {
  S.training = { phase, i, n };
  schedule();
  const pct = phasePct(S.training);
  if (force || pct - _lastPushed >= 10 || pct < _lastPushed) {
    _lastPushed = pct;
    updateDoc(pref(), { training: { state: 'running', by: S.me, phase, pct, at: serverTimestamp() } }).catch(() => {});
  }
}

// 평가·연습에 쓸 지금 모델: 실험실에서 학습한 N번 모델(드라이브), 예전 방식이면 티처블머신 링크.
function currentModel() {
  const p = S.project;
  if (p.modelVersion) return loadDriveModel(() => auth.currentUser.getIdToken(), S.pid, p.modelVersion);
  return loadModel(p.modelUrl, { fresh: true });
}

// ── 사진 넣기 ──
async function onPhotos(kind, labelId, files, urls) {
  if (kind === 'try') return tryPhoto(files, urls);
  // 파일은 한 장씩, 끌어온 주소들은 "사진 한 장의 후보들"이라 그중 처음 되는 것 하나만.
  const srcs = files.length ? files : (urls.length ? [urls] : []);
  for (const src of srcs) {
    try {
      const prep = Array.isArray(src)
        ? await fetchFirstImage(src, b => prepareImage(b, kind))
        : await prepareImage(src, kind);
      const fps = [...S.images.map(i => i.fp), ...uploader.items.map(i => i.fp)].filter(Boolean);
      if (C.isDuplicate(prep.fp, fps)) { toast(t('dupPhoto'), 'warn'); continue; }
      await uploader.add({ id: C.newId('im'), pid: S.pid, labelId, kind, owner: S.me, ...prep });
      if (prep.small) toast(t('smallPhoto'), 'warn');
    } catch (e) {
      const m = e && e.message;
      toast(t(m === 'tooSmall' ? 'tooSmall' : m === 'fetchFail' ? 'fetchFail' : 'notImage'), 'warn');
    }
  }
}

async function tryPhoto(files, urls) {
  try {
    const blob = files[0] || (urls.length ? await fetchFirstImage(urls) : null);
    if (!blob) return;
    const photo = URL.createObjectURL(blob);
    S.tryOne = { busy: true, photo }; schedule();
    const loaded = await currentModel();
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
  S.pid = pid; S.project = null; S.images = []; S.imagesReady = false; S.labels = null; S.training = null;
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
        // 빈 레이블 칸 2개를 만들고 모둠원을 번갈아 나눠 맡겨 둔다(대표가 바로 이름만 쓰면 되게).
        step: 1, defined: false, topic: '', counts: { train: {}, test: {} },
        labels: [0, 1].map(i => ({ id: C.newId('l'), name: '', owners: pair.members.filter((_, k) => k % 2 === i || pair.members.length === 1), tr: {} })),
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
    // 맡은 레이블이 가장 적은 모둠원에게 준다.
    const load = m => ls.filter(l => C.ownersOf(l).includes(m)).length;
    const owner = [...members()].sort((a, b) => load(a) - load(b))[0] || S.me;
    S.labels = [...ls, { id: C.newId('l'), name: '', owners: [owner], tr: {} }];
    saveLabels();
  },
  // 모으는 사람 켜고 끄기(대표). ①은 고치는 중인 목록에, ②는 바로 저장.
  otoggle(_, el) {
    if (!isLeader()) return;
    const flip = l => {
      if (l.id !== el.dataset.id) return l;
      const set = new Set(C.ownersOf(l));
      if (set.has(el.dataset.m)) set.delete(el.dataset.m); else set.add(el.dataset.m);
      const { owner, ...rest } = l;
      return { ...rest, owners: members().filter(m => set.has(m)) };
    };
    if (el.dataset.scope === 's1') { S.labels = (S.labels || []).map(flip); saveLabels(); }
    else {
      const labels = labelsOf().map(flip).map(l => { const { owner, ...rest } = l; return { ...rest, owners: C.ownersOf(l) }; });
      if (labels.some(l => !C.ownersOf(l).length)) return toast(t('e_noOwner'), 'warn');
      safeUpdate(pref(), { labels });
    }
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
  // ③ 학습(대표만): 드라이브의 학습 사진 → 이 PC에서 학습 → 드라이브에 N번 모델로 저장.
  async train() {
    if (!isLeader() || (S.training && !S.training.done && !S.training.error)) return;
    const labels = labelsOf();
    const v = (S.project.modelVersion || 0) + 1;
    const list = imgs('train').filter(i => i.driveId && labels.some(l => l.id === i.labelId));
    if (!list.length) return;
    const getToken = () => auth.currentUser.getIdToken();
    setPhase('photos', 0, list.length, true);
    try {
      const blobs = await fetchTrainPhotos(getToken, S.pid, list.map(i => i.driveId), (i, n) => setPhase('photos', i, n));
      const used = list.filter(i => blobs.has(i.driveId));
      const res = await trainModel({
        labelIds: labels.map(l => l.id),
        samples: used.map(i => ({ labelId: i.labelId, blob: blobs.get(i.driveId) })),
        onPhase: (ph, i, n) => setPhase(ph, i, n),
      });
      setPhase('save', 0, 1, true);
      await saveModelToDrive(getToken, S.pid, v, res.files);
      rememberModel(S.pid, v, res.loaded);
      const counts = {};
      used.forEach(i => { counts[i.labelId] = (counts[i.labelId] || 0) + 1; });
      await updateDoc(pref(), {
        modelVersion: v, mapping: C.identityMapping(labels), mappingOk: true,
        trainedIds: used.map(i => i.id), modelAt: serverTimestamp(),
        [`models.v${v}`]: { v, at: serverTimestamp(), photos: used.length, counts, valAcc: res.valAcc != null ? Math.round(res.valAcc * 100) : null },
        training: { state: 'done', by: S.me, at: serverTimestamp() },
      });
      S.training = { done: true, v };
      toast(t('trainDone', { n: v }), 'ok');
    } catch (e) {
      console.error(e);
      S.training = { error: e.code === 'baseFail' ? 'baseFail' : 'trainFail' };
      updateDoc(pref(), { training: { state: 'error', by: S.me, at: serverTimestamp() } }).catch(() => {});
    }
    schedule();
  },
  async evalrun() {
    const tests = imgs('test');
    if (!tests.length || S.evalRun) return;
    S.evalRun = { i: 0, n: tests.length }; schedule();
    try {
      const loaded = await currentModel();
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
          modelVersion: S.project.modelVersion || 0, stars: {}, cause: [], causeText: '', fix: '',
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
        modelVersion: fresh.modelVersion, modelUrl: fresh.modelUrl, mapping: fresh.mapping, published: true, updatedAt: serverTimestamp(),
      };
      await setDoc(doc(db, 'ai_apps', S.pid), pub, { merge: true });
      // 서버(/api/ai-model)가 모델을 미리 받아 두게 한 번 불러 둔다 — 첫 방문자가 기다리지 않게.
      if (pub.modelVersion) fetch(`/api/ai-model?pid=${encodeURIComponent(S.pid)}&v=${pub.modelVersion}`).then(r => r.arrayBuffer()).catch(() => {});
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
function saveLabels(redraw = true) {
  S.labelsDirty = true;
  if (redraw) schedule();
  debounce('labels', async () => {
    const labels = (S.labels || []).map(l => ({ id: l.id, name: String(l.name || '').slice(0, C.LABEL_NAME_MAX), owners: C.ownersOf(l), tr: l.tr || {}, ...(l.trOf ? { trOf: l.trOf } : {}) }));
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
  });
  main.addEventListener('input', e => {
    const el = e.target;
    const f = el.dataset.field;
    if (!f) return;
    if (f === 'lname') {
      S.labels = (S.labels || []).map(l => l.id === el.dataset.id ? { ...l, name: el.value } : l);
      S.labelsDirty = true;
      return debounce('labels-save', () => saveLabels(false), 400);
    }
    S.drafts[draftKey(el)] = el.value;
    if (f === 'custom' || f === 'title') updatePreview(el); // 입력칸은 그대로 두고 미리보기만
    if (SAVED_FIELDS.has(f)) debounce('field:' + el.id, () => saveField(f, el), 700);
  });
  main.addEventListener('compositionstart', () => { S.composing = true; });
  main.addEventListener('compositionend', () => { S.composing = false; if (S.renderPending) schedule(); });
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
  // 마스터 계정은 열린 수업이 전부 보인다 — 그중 내가 모둠에 들어 있는 수업을 먼저 고른다.
  const inPair = new Set();
  try {
    const ps = await getDocs(query(collection(db, 'ai_pairs'), where('members', 'array-contains', S.me)));
    ps.docs.forEach(d => inPair.add(d.data().asId));
  } catch (e) { console.warn('pairs', e.code); }
  const all = session.isMaster ? list : mine;
  const withPair = all.filter(a => inPair.has(a.id));
  S.asgs = [...withPair, ...all.filter(a => !inPair.has(a.id))];
  S.inPair = inPair;
  if (!S.asgs.length) { S.asg = { status: 'OFF' }; return render(); }
  const pool = withPair.length ? withPair : S.asgs;
  const saved = pool.find(a => a.id === sessionStorage.getItem('ailab_as'));
  if (pool.length === 1 || saved) return chooseAsg(saved || pool[0]);
  showChooser();
}

function showChooser() {
  stop('pair'); stop('asg'); ['project', 'images', 'app'].forEach(stop);
  S.asg = null; S.pair = null; S.project = null; S.pid = '';
  const label = a => `${a.title || a.id} · ${C.nv(a.grade)}-${C.nv(a.class)}${S.inPair && S.inPair.has(a.id) ? '' : ' (' + t('noGroupShort') + ')'}`;
  screen(t('chooseAssignment'), '', `<div class="choose">${S.asgs.map(a => `<button class="btn" data-asg="${E(a.id)}">${E(label(a))}</button>`).join('')}</div>`);
  $('main').querySelectorAll('[data-asg]').forEach(b => b.addEventListener('click', () => chooseAsg(S.asgs.find(a => a.id === b.dataset.asg))));
}

onStrayDrop(() => toast(t('dropInside'), 'warn'));
$('logoutBtn').addEventListener('click', () => { clearSession(); location.href = 'index.html'; });
start();
