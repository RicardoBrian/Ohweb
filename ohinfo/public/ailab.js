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
import * as C from './ai-core.js?v=202610180700';
import { makeT, getLang, setLang } from './ai-i18n.js?v=202610180700';
import { prepareImage, prepareCover, bindDropZone, clearZones, fetchFirstImage, onStrayDrop } from './ai-image.js?v=202610180700';
import { Uploader, driveConfigured, trashFile, fetchTrainPhotos, refetchTrainPhoto, saveModelToDrive, deviceId, devPhotoPut, devPhotoGet, devPhotoDel } from './ai-drive.js?v=202610180700';
import { loadModel, predict, imageFromSrc, imageFromBlob, trainModel, loadDriveModel, rememberModel, TRAIN_PARAMS } from './ai-model.js?v=202610180700';
import { appHtml, probsByLabel, THEMES, ACCENTS, FONTS, ensureFont } from './ai-render.js?v=202610180700';

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
  dev: {},                                         // 이 기기에만 있는 카메라 사진 { id: { thumb, evalImg } }
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
// 사진 모으는 방법(선생님이 배정에서 정함): search(구글 이미지) · draw(그리기) · camera(카메라). 없으면 지금처럼 검색만.
const sources = () => (S.asg && Array.isArray(S.asg.sources) && S.asg.sources.length ? S.asg.sources : ['search']);
// 카메라 사진은 기본으로 찍은 기기에만 둔다(사람 얼굴). 선생님이 '올리기 허용'을 켜면 지금처럼 드라이브로.
const camLocal = () => sources().includes('camera') && !(S.asg && S.asg.cameraUpload);
const DEV = deviceId();
// 표 데이터(CSV) 활동: 선생님이 배정에서 고른다. 화면 ①~④는 ai-table.js가 그린다(그때만 불러온다).
const isTable = () => !!(S.asg && S.asg.kind === 'table');
let TB = null, _tbLoading = null;
const TBon = () => (isTable() && TB ? TB : null);
function loadTable() {
  if (_tbLoading) return _tbLoading;
  _tbLoading = import('./ai-table.js?v=202610180700').then(M => {
    TB = M.makeTable({
      S, E, t: (k, v) => t(k, v), $, C, isLeader, members, nameOf, leaderName, pref, safeUpdate, schedule, toast, nextBtn, draftOr,
      ratingHtml, causeHtml, debounce, serverTimestamp, go: n => actions.step(n),
    });
    sync(); schedule();
  }).catch(e => { console.error(e); _tbLoading = null; screen(t('error'), e.message); });
  return _tbLoading;
}
// 문장(텍스트) 분류 활동: ①·⑤는 이미지 화면 그대로, ②~④는 ai-text.js가 그린다(그때만 불러온다).
const isText = () => !!(S.asg && S.asg.kind === 'text');
let TX = null, _txLoading = null;
const TXon = () => (isText() && TX ? TX : null);
function loadText() {
  if (_txLoading) return _txLoading;
  _txLoading = import('./ai-text.js?v=202610180700').then(M => {
    TX = M.makeText({
      S, E, t: (k, v) => t(k, v), $, C, isLeader, members, leaderName, pref, safeUpdate, schedule, toast, nextBtn, tipsHtml,
      ratingHtml, causeHtml, serverTimestamp, setDoc, deleteDoc, doc, db, labelsOf, imgs, isMine, ownerTag, ownerChips, namesOf, minTrain, minTest, ms,
    });
    schedule();
  }).catch(e => { console.error(e); _txLoading = null; screen(t('error'), e.message); });
  return _txLoading;
}
// 문장 활동의 ① 안내 문구(없으면 이미지 문구)
const tk = k => (isText() ? 'x_' + k : k);
// 단계 이름: 표 데이터는 ②가 "데이터 살펴보기"
const stepName = n => t(isTable() && n === 2 ? 'ts2' : 's' + n);
// 이 기기에만 있는 사진의 미리보기·평가용 그림(Firestore 기록에는 그림이 없다)
const thumbOf = im => (im.local ? ((S.dev[im.id] && S.dev[im.id].thumb) || '') : im.thumb);
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
  if (isTable() && !TB) { loadTable(); return screen(t('loading'), ''); }
  if (isText() && !TX) { loadText(); return screen(t('loading'), ''); }

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
  nudge();
}

// ── 다음에 누를 곳 안내 ──
// 지금 상태에서 학생이 다음에 누를 버튼을 골라 반짝이게 하고, 그 버튼이 새로 바뀌는 순간
// (사진이 다 모였다, 학습이 끝났다 …) 화면을 그 버튼으로 옮겨 준다. 단계를 옮긴 직후나
// 글을 쓰는 중에는 움직이지 않는다.
function nextTarget() {
  if (S.tab !== 'project' || !S.project) return '';
  const p = S.project, open = p.step || 1, leader = isLeader();
  const has = sel => (document.querySelector('#main ' + sel) ? sel : '');
  const nextBtnSel = '.next .btn.primary[data-act="step"]';
  if (TBon() && S.viewStep <= 4) return TBon().nextTarget(has);
  if (TXon() && S.viewStep >= 2 && S.viewStep <= 4) return TXon().nextTarget(has);
  switch (S.viewStep) {
    case 1:
      if (!leader) return open >= 2 ? has(nextBtnSel) : '';
      return p.defined && open >= 2 && !S.labelsDirty ? has(nextBtnSel) : has('[data-act="s1confirm"]:not([disabled])');
    case 2: {
      const mine = labelsOf().filter(isMine);
      const done = mine.every(l => imgs('train', l.id).length >= minTrain());
      return done && open >= 3 ? has(nextBtnSel) : '';
    }
    case 3: {
      const tab = S.s3tab || (leader || members().length === 1 ? 'train' : 'test');
      if (!C.hasModel(p)) return leader && tab === 'train' ? has('[data-act="train"]:not([disabled])') : '';
      if (S.training && !S.training.done && !S.training.error) return '';
      const testOk = labelsOf().every(l => imgs('test', l.id).length >= minTest());
      if (!testOk) return tab === 'test' ? '' : has('[data-act="s3tab"][data-v="test"]');
      return open >= 4 ? has(nextBtnSel) : '';
    }
    case 4: {
      const rounds = C.evalRounds(p);
      const cur = rounds[rounds.length - 1];
      if (!cur || (cur.modelVersion || 0) !== (p.modelVersion || 0)) return has('[data-act="evalrun"]:not([disabled])');
      const mine = (cur.stars || {})[S.me];
      if (!mine || !mine.s) return has('.stars');
      return open >= 5 ? has(nextBtnSel) : '';
    }
    case 5: {
      if (!p.published || p.pubSig !== appSig(appData())) return has('[data-act="publish"]:not([disabled])');
      if (!p.postId) return has('[data-act="post"]:not([disabled])');
      return has('a[href^="ohdlet.html?"]');
    }
    default: return '';
  }
}

function nudge() {
  document.querySelectorAll('#main .nudge').forEach(el => el.classList.remove('nudge'));
  let sel = '';
  try { sel = nextTarget(); } catch (e) { console.warn('nudge', e); }
  const el = sel ? document.querySelector('#main ' + sel) : null;
  if (el) el.classList.add('nudge');
  const key = `${S.pid}|${S.viewStep}|${sel}`;
  const prev = S.lastNext;
  S.lastNext = key;
  if (!el || !prev || prev === key) return;
  if (prev.split('|').slice(0, 2).join('|') !== key.split('|').slice(0, 2).join('|')) return;   // 단계를 막 옮겼으면 맨 위 그대로
  const ae = document.activeElement;
  if (ae && (ae.tagName === 'TEXTAREA' || (ae.tagName === 'INPUT' && !['radio', 'checkbox', 'button'].includes(ae.type)))) return;
  const r = el.getBoundingClientRect();
  if (r.top >= 70 && r.bottom <= window.innerHeight - 70) return;   // 이미 보이면 그대로
  el.scrollIntoView({ behavior: 'smooth', block: 'center' });
}

function applyStaticText() {
  document.documentElement.lang = S.lang;
  document.title = `${t('appName')} — kakainfo`;
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
      <span class="sn">${n < open ? '✓' : n}</span><span class="st">${E(stepName(n))}</span></button></li>`;
  }).join('')}</ol>`;
}

function bannerHtml() {
  const open = S.project.step || 1;
  if (open <= S.viewStep || S.bannerFor === open) return '';
  return `<div class="banner"><span>🎉 ${E(t('stepOpened'))} <b>${open}. ${E(stepName(open))}</b></span>
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
  if (TBon() && S.viewStep >= 1 && S.viewStep <= 4) return TBon().step(S.viewStep);
  if (TXon() && S.viewStep >= 2 && S.viewStep <= 4) return TXon().step(S.viewStep);
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
  let body = lead('s1Lead') + tipsHtml(t(tk('s1Tips')));
  if (!leader) {
    body += `<div class="note">${E(t('s1Wait', { name: leaderName() }))}</div>`;
    body += `<div class="card"><div class="field"><label>${E(t(tk('topicLabel')))}</label><div class="ro">${E(p.topic || '…')}</div></div>
      <div class="field"><label>${E(t('labelsLabel'))}</label>
      <div class="ro-labels">${labels.length ? labels.map(l => `<div class="ro-label"><b>${E(l.name || '…')}</b>${ownerTag(l)}${trHtml(l)}</div>`).join('') : '<div class="ro">…</div>'}</div></div></div>`;
    if (p.defined && p.step >= 2) body += nextBtn(2, 's2');
    return body;
  }
  body += `<div class="card">
    <div class="field"><label for="f-topic">${E(t(tk('topicLabel')))}</label>
      <input id="f-topic" data-field="topic" maxlength="40" placeholder="${E(t(tk('topicPh')))}" value="${E(draftOr('topic', p.topic))}"></div>
    <div class="field"><label>${E(t('labelsLabel'))}</label>
      <div class="label-rows">${labels.map((l, i) => `<div class="label-row">
        <span class="ln">${i + 1}</span>
        <input id="f-lname-${E(l.id)}" data-field="lname" data-id="${E(l.id)}" maxlength="${C.LABEL_NAME_MAX}" placeholder="${E(t('labelPh'))}" value="${E(l.name)}">
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
  const cell = (im, pending) => `<div class="ph${pending ? ' pend' : ''}${im.small ? ' small' : ''}"${im.small ? ` title="${E(t('smallPhoto'))}"` : ''}>${thumbOf(im) ? `<img src="${E(thumbOf(im))}" alt="" loading="lazy">` : `<span class="ph-dev" title="${E(t('devPhoto'))}">📱</span>`}
    ${im.small ? `<span class="ph-small">${E(t('smallBadge'))}</span>` : ''}
    ${pending ? '<span class="ph-spin"></span>' : ''}
    ${canDelete(im) ? `<button class="ph-x" data-act="photo-del" data-id="${E(im.id)}" data-pending="${pending ? 1 : 0}" aria-label="${E(t('del'))}">×</button>` : ''}</div>`;
  return `<div class="photos">${pend.map(i => cell(i, true)).join('')}${done.map(i => cell(i, false)).join('')}</div>`;
}

// 그리기·카메라 버튼(선생님이 배정에서 켠 것만). only: 'camera'면 카메라만.
function captureBtns(kind, labelId, only = '') {
  const src = sources();
  const z = `${kind}:${E(labelId)}`;
  return [
    src.includes('draw') && only !== 'camera' ? `<button class="btn sm" data-act="cap" data-v="draw" data-zone="${z}">✍️ ${E(t('capDraw'))}</button>` : '',
    src.includes('camera') ? `<button class="btn sm" data-act="cap" data-v="camera" data-zone="${z}">📸 ${E(t('capCamera'))}</button>` : '',
  ].join('');
}

function zoneHtml(kind, labelId, standalone = false) {
  const src = sources();
  if (!src.includes('search')) {
    // 태블릿 수업: 끌어다 놓기 대신 그리기·카메라만
    return `<div class="dz cap-only"><span>${E(t('capHint'))}</span><div class="cap-btns">${captureBtns(kind, labelId)}</div></div>`;
  }
  const extra = captureBtns(kind, labelId);
  return `<div class="dz" tabindex="0"${standalone ? ` data-dropzone="${kind}:${E(labelId)}"` : ''}>
    <span>${E(t('dropHere'))}</span>
    <button class="btn sm" data-act="pick" data-zone="${kind}:${E(labelId)}">${E(t('chooseFiles'))}</button>${extra ? `<div class="cap-btns">${extra}</div>` : ''}</div>`;
}

function howToHtml() {
  if (!sources().includes('search')) {
    const steps = [sources().includes('draw') ? t('capHowDraw') : '', sources().includes('camera') ? t('capHowCam') : '', camLocal() ? t('capLocalNote') : ''].filter(Boolean);
    return `<div class="howto"><b>${E(t('howTo'))}</b><ol>${steps.map(x => `<li>${E(x)}</li>`).join('')}</ol></div>`;
  }
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
    // 이 기기에 저장되어 올라가기를 기다리는 사진도 바로 센다(올라가는 동안 막대가 멈춰 보이지 않게)
    const c = imgs('train', l.id).length + uploader.pendingFor('train', l.id).length;
    const pct = Math.min(100, Math.round(c * 100 / min));
    return `<div class="lcard${mine ? ' mine' : ''}"${mine ? ` data-dropzone="train:${E(l.id)}"` : ''}>
      <div class="lc-head"><b>${E(l.name)}</b>${ownerTag(l)}</div>
      ${isLeader() && members().length > 1 ? ownerChips(l, 's2') : ''}
      <div class="prog"><div class="bar"><span style="width:${pct}%"></span></div>
        <span class="cnt">${E(t('countOf', { c, m: min }))}</span></div>
      <div class="lc-state ${c >= min ? 'ok' : ''}">${E(c >= min ? t('enough') : t('needMore', { n: min - c }))}${imgs('train', l.id).some(i => i.small) ? ` <span class="warn-txt">· ${E(t('smallCount', { n: imgs('train', l.id).filter(i => i.small).length }))}</span>` : ''}</div>
      ${mine ? zoneHtml('train', l.id) : `<div class="not-mine">${E(t('notMine', { name: namesOf(l) }))}</div>${camLocal() ? `<div class="cap-btns">${captureBtns('train', l.id, 'camera')}</div>` : ''}`}
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
    const list = imgs('train', l.id).filter(i => i.driveId || i.local);
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
  if (tr && tr.error === 'noChange') {
    // 사진을 보충했으면 경고는 저절로 사라진다.
    if (C.sameTrainingData(p, S.images, labels)) h += `<div class="note warn">${E(t('noChange', { n: v }))}<div class="next"><button class="btn" data-act="step" data-v="2">← ${E(t('goCollect'))}</button></div></div>`;
  } else if (tr && tr.error) h += `<div class="err">${E(t(tr.error))}</div>`;
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
    const c = imgs('test', l.id).length + uploader.pendingFor('test', l.id).length;
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
    return `<div class="wcard">${im && thumbOf(im) ? `<img src="${E(thumbOf(im))}" alt="">` : `<div class="ph-gone">${im && im.local ? '📱' : '?'}</div>`}
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

function causeHtml(r, key = 'causes', fixPh = 'fixPh') {
  const causes = t(key);
  const sel = new Set(r.cause || []);
  return `<div class="card"><h3>${E(t('causeTitle'))}</h3>
    <div class="checks">${Object.keys(causes).map(k => `<label class="check"><input type="checkbox" data-act="cause" data-v="${k}" ${sel.has(k) ? 'checked' : ''}> ${E(causes[k])}</label>`).join('')}</div>
    <div class="field">${editingNote('causeText')}<textarea id="f-causeText" data-field="causeText" maxlength="300" rows="2" placeholder="${E(t('causeTextPh'))}">${E(draftOr('causeText', r.causeText))}</textarea></div>
    <h3>${E(t('fixTitle'))}</h3>
    <div class="field">${editingNote('fix')}<textarea id="f-fix" data-field="fix" maxlength="300" rows="2" placeholder="${E(t(fixPh))}">${E(draftOr('fix', r.fix))}</textarea></div></div>`;
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
    accent: (p.app && p.app.accent) || '', font: (p.app && p.app.font) || '',
    srcLang: p.srcLang || 'ko',
    cover: (p.app && p.app.cover) || '',
    desc: (S.drafts.desc != null ? S.drafts.desc : (p.app && p.app.desc)) || '',
    descLang: (p.app && p.app.descLang) || S.lang, descTr: (p.app && p.app.descTr) || {},
    labels: labelsOf().map(appLabel),
    modelVersion: p.modelVersion || 0, modelUrl: p.modelVersion ? '' : (p.modelUrl || ''), mapping: p.mapping || {},
    inputs: isTable() || isText() ? [] : sources().filter(x => x !== 'search'),
    ...(TBon() ? { table: TBon().appTable() } : {}),
    ...(TXon() ? { text: TXon().appText() } : {}),
    hiddenPhrases: (S.appDoc && S.appDoc.hiddenPhrases) || {},
  };
}
// 공개 뒤에 고친 게 있는지 비교하는 서명(번역 결과는 빼고).
function appSig(a) {
  // 표 데이터 앱만 고른 모델·단위를 더한다(이미지 앱의 서명은 예전 그대로 — 이미 공개한 앱이 '바뀜'으로 보이지 않게)
  const tb = a.table ? { tb: [a.table.key, a.table.unit] } : {};
  return JSON.stringify({ ...tb, accent: a.accent, font: a.font, title: a.title, desc: a.desc, cover: a.cover ? a.cover.length + a.cover.slice(-24) : '', theme: a.theme, v: a.modelVersion, m: a.modelUrl, map: a.mapping, l: a.labels.map(l => [l.id, l.name, l.emoji, l.phrase, l.custom]) });
}

function step5() {
  FONTS.forEach(ensureFont);   // 글꼴 고르기 견본용(⑤ 화면에서만)
  const p = S.project;
  const a = appData();
  const hidden = a.hiddenPhrases;
  let h = lead('s5Lead');
  h += `<div class="deploy"><div class="deploy-form">`;
  h += `<div class="card"><div class="field"><label for="f-title">${E(t('appTitle'))}</label>
    <input id="f-title" data-field="title" maxlength="${C.TITLE_MAX}" placeholder="${E(t('appTitlePh'))}" value="${E(a.title)}"></div>
    <label>${E(t('design'))}</label><div class="themes">${THEMES.map(th => `<button class="theme-card${a.theme === th ? ' on' : ''}" data-act="theme" data-v="${th}"><span class="sw sw-${th}"></span>${E(t('themes.' + th))}</button>`).join('')}</div>
    <label>${E(t('accentLabel'))}</label><div class="accents">
      <button class="acc def${!a.accent ? ' on' : ''}" data-act="accent" data-v="" title="${E(t('accentDefault'))}">${E(t('accentDefault'))}</button>
      ${ACCENTS.map(c => `<button class="acc${a.accent === c ? ' on' : ''}" data-act="accent" data-v="${c}" style="--c:${c}" aria-label="${c}"></button>`).join('')}</div>
    <label>${E(t('fontLabel'))}</label><div class="fonts">
      ${['', ...FONTS].map(f => `<button class="font-card${a.font === f ? ' on' : ''}" data-act="font" data-v="${f}"><span class="ff ff-${f || 'base'}">가나다 Abc</span>${E(t('fonts.' + (f || 'base')))}</button>`).join('')}</div></div>`;
  // 대문 꾸미기: 어떤 앱인지 한눈에 보이게 사진 한 장과 짧은 설명(둘 다 선택)
  h += `<div class="card"><h3>${E(t('coverTitle'))}</h3><p class="muted sm">${E(t('coverHelp'))}</p>
    ${a.cover ? `<div class="cover-pv"><img src="${E(a.cover)}" alt=""><button class="btn sm" data-act="cover-del">${E(t('coverDel'))}</button></div>` : ''}
    <div class="dz" tabindex="0" data-dropzone="cover:x"><span>${E(a.cover ? t('coverChange') : t('coverAdd'))}</span>
      <button class="btn sm" data-act="pick" data-zone="cover:x">${E(t('chooseFiles'))}</button>
      <button class="btn sm" data-act="cap" data-v="draw" data-zone="cover:x">✍️ ${E(t('capDraw'))}</button></div>
    ${S.busy.cover ? `<div class="muted"><span class="spin"></span>${E(t('uploading'))}</div>` : ''}
    <div class="field"><label for="f-desc">${E(t('descLabel'))}</label>
      <textarea id="f-desc" data-field="desc" maxlength="${C.DESC_MAX}" rows="2" placeholder="${E(t('descPh'))}">${E(a.desc)}</textarea></div>
    ${(S.appDoc && S.appDoc.hiddenPhrases && (S.appDoc.hiddenPhrases._cover || S.appDoc.hiddenPhrases._desc)) ? `<div class="note warn">${E(t('hiddenCover'))}</div>` : ''}</div>`;
  if (TBon() && !TBon().isClass()) h += TBon().unitCard();
  else h += `<div class="card"><h3>${E(t('perLabel'))}</h3>${a.labels.map((l, i) => {
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
  h += `<div class="card">${TBon() ? TBon().deployLine() : ''}${p.modelVersion ? `<div class="deploy-model"><b>${E(t('deployModel', { n: p.modelVersion }))}</b></div>
    ${evaluated ? '' : `<div class="note warn">${E(t('deployNotEval', { n: p.modelVersion }))}</div>`}` : ''}
    <div id="s5err" class="err"></div>
    <button class="btn primary" data-act="publish" ${S.busy.pub ? 'disabled' : ''}>${E(S.busy.pub ? t('publishing') : (p.published ? t('saveChanges') : t('publish')))}</button>
    ${p.published ? `<div class="url-box"><label>${E(t('publicUrl'))}${dirty ? '' : ' ✅'}</label><div class="row">
      <input id="f-url" readonly value="${E(appUrl())}"><button class="btn sm" data-act="copy">${E(t('copy'))}</button>
      <a class="btn sm" href="${E(appUrl())}" target="_blank" rel="noopener">${E(t('open'))} ↗</a></div></div>
      ${postHtml()}
      <button class="btn ghost" data-act="newmodel">＋ ${E(t('newModel'))}</button>` : ''}</div>`;
  h += `</div><div class="deploy-preview"><div class="pv-label">${E(t('previewAs'))}</div>
    <div class="pv-tabs">${TBon() ? '' : a.labels.map((l, i) => `<button class="${i === S.previewLabel ? 'on' : ''}" data-act="preview-label" data-v="${i}">${E(l.emoji || '')} ${E(C.labelName(l, S.lang))}</button>`).join('')}</div>
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
  if (TBon()) {
    if (!a.table) return `<div class="note warn">${E(t('tNoPick'))}</div>`;
    return appHtml(a, S.lang, S.t, { ...TBon().sampleState(a.table), sample: true });
  }
  if (TXon()) return appHtml(a, S.lang, S.t, { ...TXon().sampleState(a, S.previewLabel), sample: true });
  const ls = a.labels;
  const top = ls[Math.min(S.previewLabel, ls.length - 1)] || ls[0];
  const probs = {};
  ls.forEach(l => { probs[l.id] = l === top ? 0.87 : 0.13 / Math.max(1, ls.length - 1); });
  const data = { ...a, labels: ls.map(l => ({ ...l, custom: S.drafts['custom-' + l.id] != null ? S.drafts['custom-' + l.id] : l.custom, customLang: l.customLang || S.lang })) };
  // 미리보기 사진 자리: 고른 레이블의 첫 사진
  const ph = imgs('train', top && top.id)[0] || imgs('test', top && top.id)[0];
  return appHtml(data, S.lang, S.t, { photo: ph ? thumbOf(ph) : '', probs, sample: true, status: 'ready' });
}

// ohdlet에서 그 게시판을 바로 여는 주소
function ohdletUrl(b) {
  const q = new URLSearchParams({ board: b.name, school: b.schoolName || '', grade: b.grade || '', group: b.group || '' });
  return 'ohdlet.html?' + q.toString();
}

function postHtml() {
  const b = S.asg.board;
  const link = b && b.name ? ` <a class="btn ghost sm" href="${E(ohdletUrl(b))}" target="_blank" rel="noopener">↗ ${E(t('openOhdlet'))}</a>` : '';
  if (S.project.postId) return `<div class="note ok">✅ ${E(t('postedAlready'))}${link}</div>`;
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
      <div class="dots">${C.STEPS.map(n => `<span class="${n < step ? 'd' : n === step ? 'c' : ''}"></span>`).join('')}<em>${E(t('stepNow', { n: step, name: stepName(step) }))}</em></div>
      ${s.topic ? `<div class="bc-topic">${E(s.topic)}</div>` : ''}
      <div class="bc-labels">${(s.labels || []).map(l => `<span>${E(l.emoji || '')}${E(l.name)} <b>${l.c}</b></span>`).join('')}</div>
      <div class="bc-state">${s.published ? `<span class="ok">🎉 ${E(t('done'))}</span> <a href="aiapp.html?id=${encodeURIComponent(pr.currentProjectId || '')}" target="_blank" rel="noopener">${E(t('viewApp'))} ↗</a>`
        : needPhotos ? `<span class="soft">${isText() ? '✍️' : '📷'} ${E(t(isText() ? 'xNeedSent' : 'needPhotos'))}</span>`
        : s.acc != null ? `<span>${E(t('accuracy', { p: s.acc }))}</span>`
        : s.mae != null ? `<span>${E(t('tMaeBoard', { v: s.mae }))}</span>`
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
async function onPhotos(kind, labelId, files, urls, { captured = false } = {}) {
  if (kind === 'try') return tryPhoto(files, urls);
  if (kind === 'cover') return setCover(files, urls);
  // 파일은 한 장씩, 끌어온 주소들은 "사진 한 장의 후보들"이라 그중 처음 되는 것 하나만.
  const srcs = files.length ? files : (urls.length ? [urls] : []);
  for (const src of srcs) {
    try {
      const prep = Array.isArray(src)
        ? await fetchFirstImage(src, b => prepareImage(b, kind))
        : await prepareImage(src, kind);
      const fps = [...S.images.map(i => i.fp), ...uploader.items.map(i => i.fp)].filter(Boolean);
      // 그리기·카메라로 직접 만든 사진은 하나하나 일부러 만든 것이라 '같은 사진' 검사를 하지 않는다
      // (연속 찍기는 비슷한 장면이 많아 검사하면 거의 다 걸러진다)
      if (!captured && C.isDuplicate(prep.fp, fps)) { toast(t('dupPhoto'), 'warn'); continue; }
      await uploader.add({ id: C.newId('im'), pid: S.pid, labelId, kind, owner: S.me, ...prep });
      if (prep.small) toast(t('smallPhoto'), 'warn');
    } catch (e) {
      const m = e && e.message;
      toast(t(m === 'tooSmall' ? 'tooSmall' : m === 'fetchFail' ? 'fetchFail' : 'notImage'), 'warn');
    }
  }
}

async function setCover(files, urls) {
  if (S.busy.cover) return;
  S.busy.cover = true; schedule();
  try {
    const url = files.length ? await prepareCover(files[0]) : (urls.length ? await fetchFirstImage(urls, prepareCover) : '');
    if (url) await safeUpdate(pref(), { 'app.cover': url });
  } catch (e) {
    const m = e && e.message;
    toast(t(m === 'tooSmall' ? 'tooSmall' : m === 'fetchFail' ? 'fetchFail' : 'notImage'), 'warn');
  }
  S.busy.cover = false; schedule();
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
  catch (e) { toast(t('error'), 'err'); return; }
  if (im.local) { devPhotoDel(id); delete S.dev[id]; }
}

// ── 카메라 사진(이 기기에만) ──
// 그림은 이 기기의 브라우저에만 저장하고, Firestore에는 그림 없는 기록만 쓴다(장수·단계 계산은 그대로 된다).
async function addDevicePhoto(kind, labelId, blob) {
  let prep;
  try { prep = await prepareImage(blob, kind); }
  catch (e) { return toast(t(e && e.message === 'tooSmall' ? 'tooSmall' : 'notImage'), 'warn'); }
  const id = C.newId('im');
  await devPhotoPut(id, { blob: prep.blob, thumb: prep.thumb, evalImg: prep.evalImg });
  S.dev[id] = { thumb: prep.thumb, evalImg: prep.evalImg || '' };
  try {
    await setDoc(doc(db, 'ai_projects', S.pid, 'images', id), {
      labelId, kind, owner: S.me, thumb: '', fp: prep.fp || '', driveId: '', local: true, dev: DEV,
      w: prep.w || 0, h: prep.h || 0, small: !!prep.small, createdAt: serverTimestamp(),
    });
  } catch (e) {
    console.error(e); devPhotoDel(id); delete S.dev[id]; toast(t('error'), 'err');
  }
}

// 이 기기에서 찍은 사진의 미리보기를 불러온다(다른 기기에서 찍은 건 📱 표시만).
async function loadDevPhotos() {
  const need = S.images.filter(i => i.local && i.dev === DEV && !(i.id in S.dev));
  if (!need.length) return;
  for (const im of need) S.dev[im.id] = { thumb: '', evalImg: '' };
  for (const im of need) {
    const v = await devPhotoGet(im.id);
    if (v) S.dev[im.id] = { thumb: v.thumb, evalImg: v.evalImg };
  }
  schedule();
}

// ── 동기화: 장수·열린 단계·현황판 요약 ──
function sync() {
  const p = S.project;
  if (!p || !S.imagesReady) return;
  debounce('sync', async () => {
    const p = S.project;
    if (!p) return;
    if (isTable() && !TB) return;   // 표 데이터 화면을 불러온 뒤에 센다
    const counts = C.countImages(S.images);
    const upd = {};
    if (C.stableJson(counts) !== C.stableJson(p.counts || { train: {}, test: {} })) upd.counts = counts;
    const merged = { ...p, counts };
    const nu = TBon() ? TBon().unlock(merged) : C.nextUnlock(merged, S.asg);
    if (nu > (p.step || 1)) upd.step = nu;
    if (Object.keys(upd).length) await safeUpdate(pref(), upd);
    const sp = { ...merged, step: Math.max(nu, p.step || 1) };
    const summary = TBon() ? TBon().summary(sp) : C.buildSummary(sp, S.asg);
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
    loadDevPhotos();
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
        labels: isTable() ? [] : [0, 1].map(i => ({ id: C.newId('l'), name: '', owners: pair.members.filter((_, k) => k % 2 === i || pair.members.length === 1), tr: {} })),
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
    inp.multiple = kind !== 'try' && kind !== 'cover';
    inp.click();
  },
  // ✍️ 그리기 · 📸 카메라: 필요할 때만 불러온다.
  async cap(mode, el) {
    const [kind, labelId] = el.dataset.zone.split(':');
    const M = await import('./ai-capture.js?v=202610180700');
    if (kind === 'cover') return M.openDraw({ t, title: t('coverTitle'), single: true, onAdd: blob => setCover([blob], []) });
    const lab = labelById(labelId);
    const local = mode === 'camera' && camLocal() && kind !== 'try';
    const onAdd = blob => (kind === 'try' ? onPhotos('try', labelId, [blob], []) : local ? addDevicePhoto(kind, labelId, blob) : onPhotos(kind, labelId, [blob], [], { captured: true }));
    const opts = { t, title: kind === 'try' ? t('tryOne') : `${lab ? lab.name : ''}${kind === 'test' ? ' · ' + t('tabTest') : ''}`, onAdd, single: kind === 'try', note: local ? t('capLocalNote') : '' };
    (mode === 'draw' ? M.openDraw : M.openCamera)(opts);
  },
  'photo-del'(_, el) { deletePhoto(el.dataset.id, el.dataset.pending === '1'); },
  'cover-del'() { safeUpdate(pref(), { 'app.cover': '' }); },
  // ③ 학습(대표만): 드라이브의 학습 사진 → 이 PC에서 학습 → 드라이브에 N번 모델로 저장.
  async train() {
    if (!isLeader() || (S.training && !S.training.done && !S.training.error)) return;
    const labels = labelsOf();
    const v = (S.project.modelVersion || 0) + 1;
    const list = imgs('train').filter(i => i.driveId && labels.some(l => l.id === i.labelId));
    // 카메라 사진(이 기기에만)은 드라이브가 아니라 이 기기에서 꺼낸다.
    const devList = imgs('train').filter(i => i.local && !i.driveId && labels.some(l => l.id === i.labelId));
    if (!list.length && !devList.length) return;
    // 사진이 지난 학습 때와 똑같으면 다시 학습해도 같은 모델이 나온다 — 학습하지 않고 알려 준다.
    if (C.sameTrainingData(S.project, S.images, labels)) {
      S.training = { error: 'noChange' };
      toast(t('noChange', { n: S.project.modelVersion }), 'warn');
      return schedule();
    }
    const getToken = () => auth.currentUser.getIdToken();
    setPhase('photos', 0, list.length + devList.length, true);
    try {
      const blobs = list.length ? await fetchTrainPhotos(getToken, S.pid, list.map(i => i.driveId), (i, n) => setPhase('photos', i, n + devList.length)) : new Map();
      const got = list.filter(i => blobs.has(i.driveId));
      const devSamples = [];
      for (const i of devList) {
        const v = await devPhotoGet(i.id);
        if (v && v.blob) devSamples.push({ id: i.id, labelId: i.labelId, blob: v.blob, local: true });
      }
      if (devSamples.length < devList.length) toast(t('devMissing', { n: devList.length - devSamples.length }), 'warn');
      const res = await trainModel({
        labelIds: labels.map(l => l.id),
        samples: [...got.map(i => ({ id: i.id, driveId: i.driveId, labelId: i.labelId, blob: blobs.get(i.driveId) })), ...devSamples],
        onPhase: (ph, i, n) => setPhase(ph, i, n),
        retry: s => (s.local ? Promise.resolve(null) : refetchTrainPhoto(getToken, S.pid, s.driveId)),
      });
      const skipped = new Set(res.skipped || []);
      const devUsed = new Set(devSamples.map(x => x.id));
      const used = [...got, ...devList.filter(i => devUsed.has(i.id))].filter(i => !skipped.has(i.id));
      if (skipped.size) toast(t('skippedPhotos', { n: skipped.size }), 'warn');
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
      S.training = { error: e.code === 'baseFail' || e.code === 'photoFail' ? e.code : 'trainFail' };
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
      let missing = 0;
      for (const im of tests) {
        // 카메라 사진(이 기기에만)은 그 사진을 찍은 기기에서만 평가할 수 있다.
        const src = im.local ? (S.dev[im.id] && S.dev[im.id].evalImg) : im.evalImg;
        if (!src) { missing++; S.evalRun.i++; continue; }
        const img = await imageFromSrc(src);
        const probs = probsByLabel(await predict(loaded, img), mapping);
        let best = '', bp = -1;
        for (const l of labelsOf()) { const p = probs[l.id] || 0; if (p > bp) { bp = p; best = l.id; } }
        results.push({ imgId: im.id, labelId: im.labelId, got: best, p: Math.round(bp * 100), ok: best === im.labelId });
        S.evalRun.i++; schedule();
      }
      if (missing) toast(t('devMissing', { n: missing }), 'warn');
      if (!results.length) throw new Error('noTests');
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
  async accent(v) { await safeUpdate(pref(), { 'app.accent': ACCENTS.includes(v) ? v : '' }); },
  async font(v) { await safeUpdate(pref(), { 'app.font': FONTS.includes(v) ? v : '' }); },
  async emoji(v, el) { await safeUpdate(pref(), { [`appLabels.${el.dataset.id}.emoji`]: v }); },
  async phrase(v, el) { await safeUpdate(pref(), { [`appLabels.${el.dataset.id}.phrase`]: Number(v) }); },
  'preview-label'(v) { S.previewLabel = Number(v); schedule(); },
  async publish() {
    const a = appData();
    const err = $('s5err');
    if (!a.title.trim()) { err.textContent = t('e_title'); $('f-title') && $('f-title').focus(); return; }
    if (isTable() && !a.table) { err.textContent = t('tNoPick'); return; }
    if (isText() && !a.text) { err.textContent = t('noModelYet'); return; }
    // 대문(사진 + 설명)은 꼭 넣는다 — 어떤 앱인지 한눈에 보이게
    if (!a.cover) { err.textContent = t('e_cover'); return; }
    if (!a.desc.trim()) { err.textContent = t('e_desc'); $('f-desc') && $('f-desc').focus(); return; }
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
      // 앱 설명도 다른 언어로 번역해 둔다(바뀌었을 때만).
      const desc = fresh.desc.trim().slice(0, C.DESC_MAX);
      let descTr = (S.project.app && S.project.app.descTr) || {};
      if (desc && (S.project.app || {}).descTrOf !== desc) {
        descTr = {};
        for (const lang of C.LANGS) {
          if (lang === fresh.descLang) continue;
          try {
            const r = await fetch('/api/translate', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ texts: [desc], targetLang: lang, sourceLang: 'auto' }) });
            const d = await r.json();
            if (d.translations && d.translations[0] && d.translations[0].text) descTr[lang] = d.translations[0].text;
          } catch { /* 번역이 안 되면 원문을 보여 준다 */ }
        }
        upd['app.descTr'] = descTr;
        upd['app.descTrOf'] = desc;
      }
      const pub = {
        title: fresh.title.trim().slice(0, C.TITLE_MAX), theme: fresh.theme, accent: fresh.accent, font: fresh.font, srcLang: fresh.srcLang,
        cover: fresh.cover || '', desc, descLang: fresh.descLang, descTr, inputs: fresh.inputs,
        labels: fresh.labels.map(({ id, name, tr, emoji, phrase, custom, customLang, customTr }) => ({ id, name, tr, emoji, phrase, custom, customLang, customTr })),
        modelVersion: fresh.modelVersion, modelUrl: fresh.modelUrl, mapping: fresh.mapping, published: true, updatedAt: serverTimestamp(),
        ...(fresh.table ? { table: (({ key, ...rest }) => rest)(fresh.table) } : {}),
        ...(fresh.text ? { text: fresh.text } : {}),
      };
      await setDoc(doc(db, 'ai_apps', S.pid), pub, { merge: true });
      // 서버(/api/ai-model)가 모델을 미리 받아 두게 한 번 불러 둔다 — 첫 방문자가 기다리지 않게.
      if (pub.modelVersion && !pub.text) fetch(`/api/ai-model?pid=${encodeURIComponent(S.pid)}&v=${pub.modelVersion}`).then(r => r.arrayBuffer()).catch(() => {});
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
        texts['sub' + sx[lang]] = `[${C.nv(S.asg.grade)}-${C.nv(S.asg.class)}] ` + tl('postTitle', { title: a.title });
        texts['msg' + sx[lang]] = tl('postBody', { url, labels: a.labels.map(l => `${l.emoji || ''}${C.labelName(l, lang)}`).join(', ') });
      }
      const ref = await addDoc(collection(db, 'posts'), {
        classTitle: b.name, boardKey: C.classBoardKey(b), grade: b.grade || '', group: b.group || '',
        num: String(S.session.number || ''), name: S.session.name || '', studentId: S.me, srcLang: S.lang,
        ...texts, imgs: [], column: '', likes: 0, pinned: false, deleted: false,
        // 선생님이 배정에서 "반별로 나누기"를 고르면 ohdlet에서 같은 반 학생에게만 보인다.
        ...((S.asg.boardScope || 'class') === 'class' ? { aiScope: 'class', aiGrade: C.nv(S.asg.grade), aiClass: C.nv(S.asg.class) } : {}),
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
    case 'desc': return safeUpdate(pref(), { 'app.desc': v.slice(0, C.DESC_MAX), 'app.descLang': S.lang });
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
const SAVED_FIELDS = new Set(['topic', 'title', 'desc', 'causeText', 'fix', 'custom']);
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
    if (el.tagName === 'SELECT') return; // change에서 처리
    const fn = actions[act] || (TBon() && TBon().actions[act]) || (TXon() && TXon().actions[act]);
    if (fn) { e.preventDefault(); fn(el.dataset.v, el); }
  });
  main.addEventListener('change', e => {
    const el = e.target;
    const fn = el.dataset.act && (actions[el.dataset.act] || (TBon() && TBon().actions[el.dataset.act]));
    if (fn && (el.type === 'checkbox' || el.type === 'radio' || el.tagName === 'SELECT')) return fn(el.dataset.v, el);
    const f = el.dataset.field;
  });
  main.addEventListener('input', e => {
    const el = e.target;
    const f = el.dataset.field;
    if (!f) return;
    if (f === 'lname') {
      S.labels = (S.labels || []).map(l => l.id === el.dataset.id ? { ...l, name: el.value } : l);
      S.labelsDirty = true;
      // 확정한 뒤(사진을 모으는 중)에는 고친 이름을 바로 저장하지 않는다 — [바뀐 내용 저장]을 눌러야
      // 이름 검사와 번역을 거쳐 한꺼번에 바뀐다(지우는 도중 빈 이름이 친구 화면에 보이지 않게).
      if (S.project && S.project.defined) return nudge();
      return debounce('labels-save', () => saveLabels(false), 400);
    }
    if (TXon() && TXon().onInput(el)) return;
    if (TBon()) {
      const r = TBon().onInput(el);
      if (r === 'preview') updatePreview(el);
      if (r) return;
    }
    S.drafts[draftKey(el)] = el.value;
    if (f === 'custom' || f === 'title' || f === 'desc') updatePreview(el); // 입력칸은 그대로 두고 미리보기만
    if (SAVED_FIELDS.has(f)) debounce('field:' + el.id, () => saveField(f, el), 700);
  });
  main.addEventListener('keydown', e => { if (TXon()) TXon().onKey(e); });
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
