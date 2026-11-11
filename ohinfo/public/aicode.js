// AI 코딩 — 모둠이 배포한 AI를 블록 코딩 프로그램에 쓴다.
//  ?id=pid        모둠원: 내 작품 만들기(작업은 ai_projects/{pid}.codes.{학생}에 자동 저장)
//  ?id=pid&c=key  누구나: 공유한 작품 실행(ai_apps/{pid}.codes.{key}, 학생 이름 없음)
// 블록 편집기는 Blockly(구글 오픈소스, Apache 2.0)를 쓴다.

import { db } from './firebase-config.js';
import { doc, getDoc, updateDoc, addDoc, collection, serverTimestamp } from 'https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js';
import { loadSession, authReady } from './session.js';
import { escHtml, SAFE_ID } from './escape.js';
import { bindDropZone, fetchFirstImage } from './ai-image.js?v=202611110001';
import { makeT, getLang, setLang } from './ai-i18n.js?v=202611110001';
import { labelName, newId, LANGS, classBoardKey, nv } from './ai-core.js?v=202611110001';
import { defineBlocks, toolbox, starter, compile, build, COSTUMES, registerVarsFlyout } from './ai-blocks.js?v=202611110001';
import { Stage, Runtime } from './ai-stage.js?v=202611110001';

const E = escHtml;
const $ = id => document.getElementById(id);
const params = new URLSearchParams(location.search);
const pid = params.get('id') || '';
const shareKey = params.get('c') || '';
const play = !!shareKey;
let lang = getLang();
const t = makeT(lang);
const BL = 'https://cdn.jsdelivr.net/npm/blockly@10.4.3/';
const BL_LANG = { ko: 'ko', en: 'en', zh: 'zh-hans', ru: 'ru' };

const S = { app: null, project: null, asg: null, session: null, fbBy: '', last: null, fb: null, fbFor: null, fbWant: '', me: '', kind: 'image', prob: 'class', code: null, ws: null, emoji: '🐱', title: '', key: '', model: null, photo: null, cam: null, showBlocks: false, last: null };
let stage, rt;

function toast(msg) { const el = $('toast'); el.textContent = msg; el.classList.add('on'); clearTimeout(toast._t); toast._t = setTimeout(() => el.classList.remove('on'), 2600); }
function fail(msg) { $('main').innerHTML = `<div class="ac-msg">${E(msg)}</div>`; }
function loadScript(src) {
  return new Promise((res, rej) => { const s = document.createElement('script'); s.src = src; s.onload = res; s.onerror = () => rej(new Error('lib')); document.head.appendChild(s); });
}

// ── 이름 ──
const labels = () => (S.app.labels || []).map(l => [labelName(l, lang) || l.name, l.id]);
const trName = o => (o && o.tr && o.tr[lang]) || (o && o.name) || '';
const features = () => (S.app.table ? S.app.table.features.map((f, i) => [trName(f), i]) : []);
const nameOf = id => { const l = (S.app.labels || []).find(x => x.id === id); return l ? (labelName(l, lang) || l.name) : ''; };

// ── 시작 ──
async function start() {
  document.documentElement.lang = lang;
  if (!SAFE_ID.test(pid) || (shareKey && !SAFE_ID.test(shareKey))) return fail(t('k_notFound'));
  let snap;
  try { snap = await getDoc(doc(db, 'ai_apps', pid)); } catch { return fail(t('k_notFound')); }
  if (!snap.exists()) return fail(play ? t('k_notFound') : t('k_notPublished'));
  S.app = snap.data();
  if (!S.app.published) return fail(t('k_notPublished'));
  S.kind = S.app.table ? 'table' : S.app.text ? 'text' : 'image';
  S.prob = S.app.table ? S.app.table.prob : 'class';
  if (play) {
    S.code = (S.app.codes || {})[shareKey];
    if (!S.code) return fail(t('k_notFound'));
    // 로그인한 친구라면 공유 작품에서도 맞아요/틀렸어요를 보낼 수 있다
    const ses = loadSession();
    if (ses) { S.fbBy = ses.id; authReady().catch(() => {}); }
  } else {
    const session = loadSession();
    if (!session) { location.href = 'index.html'; return; }
    S.me = session.id; S.session = session; S.fbBy = session.id;
    await authReady();
    try {
      const ps = await getDoc(doc(db, 'ai_projects', pid));
      if (!ps.exists()) return fail(t('k_notMember'));
      S.project = ps.data();
    } catch { return fail(t('k_notMember')); }
    S.code = (S.project.codes || {})[S.me] || null;
    // 배정: 선생님이 결과물로 블록 코딩을 골랐고 게시판이 있으면 작품을 게시판에 올릴 수 있다
    try { const as = await getDoc(doc(db, 'ai_assignments', S.project.asId)); S.asg = as.exists() ? as.data() : null; } catch { S.asg = null; }
  }
  S.emoji = (S.code && COSTUMES.includes(S.code.emoji)) ? S.code.emoji : '🐱';
  S.title = (S.code && S.code.title) || '';
  S.key = (S.code && S.code.key) || '';
  document.title = `${S.title || S.app.title || 'AI'} — ${t('k_appName')}`;
  try {
    await loadScript(BL + 'blockly_compressed.js');
    await loadScript(BL + 'blocks_compressed.js');
    await loadScript(BL + 'javascript_compressed.js');
    await loadScript(BL + `msg/${BL_LANG[lang] || 'ko'}.js`);
  } catch { return fail(t('k_libFail')); }
  layout();
  initBlocks();
  initStage();
  loadModel();
}

// ── 화면 ──
function layout() {
  const langSel = `<select class="ac-lang" id="langSel" aria-label="Language">${[['ko', '한국어'], ['zh', '中文'], ['ru', 'Рус'], ['en', 'English']].map(([v, n]) => `<option value="${v}" ${v === lang ? 'selected' : ''}>${n}</option>`).join('')}</select>`;
  $('top').innerHTML = `${play ? '' : `<a href="ailab.html">${E(t('k_back'))}</a>`}
    <h1>🧩 ${E(play ? (S.title || S.app.title || '') : (S.app.title || ''))}</h1>
    ${play ? '' : `<input class="ac-name" id="nameIn" maxlength="30" placeholder="${E(t('k_namePh'))}" value="${E(S.title)}" aria-label="${E(t('k_name'))}">`}
    <button class="ac-btn run" id="runBtn">${E(t('k_run'))}</button>
    <button class="ac-btn stop" id="stopBtn">${E(t('k_stop'))}</button>
    <span class="sp"></span>
    ${play ? `<button class="ac-btn" id="blocksBtn">${E(t('k_showBlocks'))}</button>` : `<span class="ac-status" id="saveSt"></span><button class="ac-btn" id="shareBtn">${E(t('k_share'))}</button>`}
    ${langSel}`;
  document.body.classList.toggle('play', play);
  $('main').innerHTML = `<div id="blocklyDiv"${play ? ' class="hidden"' : ''}></div>
    <aside class="ac-side">
      ${play ? '' : `<p class="muted" style="margin:0">${E(t('k_lead'))}</p>`}
      <div class="ac-stage" id="stageBox"><canvas id="stage"></canvas>
        <div class="ac-pick hidden" id="pickBox"><button class="ac-btn run" id="pickBtn">${E(t('k_photo'))}</button><span>${E(t('k_pickHint'))}</span></div>
        <form class="ac-ask hidden" id="askBox"><input id="askIn" autocomplete="off" placeholder="${E(t('k_answerPh'))}"><button type="submit">✓</button></form></div>
      ${play ? '' : `<div class="ac-card"><h3>${E(t('k_char'))}</h3><div class="ac-chars">${COSTUMES.map(e => `<button data-emoji="${e}" class="${e === S.emoji ? 'on' : ''}">${e}</button>`).join('')}</div></div>`}
      <div class="ac-card" id="inPanel">${inputPanel()}</div>
      <div class="ac-card"><h3>${E(t('k_result'))}</h3><div id="resBox"><span class="muted">${E(t('k_none'))}</span></div><div id="fbBox"></div></div>
      ${canPost() ? `<div class="ac-card" id="postCard">${postCardHtml()}</div>` : ''}
      ${play ? '' : `<div class="ac-card hidden" id="sharePanel"></div>`}
    </aside>`;
  $('langSel').addEventListener('change', e => { setLang(e.target.value); location.reload(); });
  $('runBtn').addEventListener('click', run);
  $('stopBtn').addEventListener('click', () => rt && rt.stop());
  if (play) $('blocksBtn').addEventListener('click', toggleBlocks);
  else {
    $('shareBtn').addEventListener('click', share);
    if (canPost()) $('postCard').addEventListener('click', e => { if (e.target.closest('#postBtn')) post(); });
    $('nameIn').addEventListener('input', () => { S.title = $('nameIn').value; scheduleSave(); });
    document.querySelectorAll('[data-emoji]').forEach(b => b.addEventListener('click', () => {
      S.emoji = b.dataset.emoji; document.querySelectorAll('[data-emoji]').forEach(x => x.classList.toggle('on', x === b));
      stage.reset(S.emoji); scheduleSave();
    }));
  }
  bindInputs();
  bindFeedback();
}

function inputPanel() {
  const ask = `<button class="ac-btn" id="askAI">${E(t('k_ask'))}</button>`;
  if (S.kind === 'image') {
    const draw = (S.app.inputs || []).includes('draw');
    return `<h3>${E(t('k_input'))}</h3><div class="ac-row"><button class="ac-btn" id="camBtn">${E(t('k_camOn'))}</button>
      <button class="ac-btn" id="photoBtn">${E(t('k_photo'))}</button>${draw ? `<button class="ac-btn" id="drawBtn">${E(t('k_draw'))}</button>` : ''}${ask}</div>
      <p class="muted" style="margin:6px 0 0">${E(t('k_dropHint'))}</p>
      <video class="ac-cam hidden" id="cam" autoplay playsinline muted></video><img class="ac-photo hidden" id="photo" alt="">`;
  }
  if (S.kind === 'text') return `<h3>${E(t('k_input'))}</h3><textarea class="ac-text" id="txtIn" rows="2" maxlength="100" placeholder="${E(t('k_textPh'))}"></textarea><div class="ac-row" style="margin-top:6px">${ask}</div>`;
  return `<h3>${E(t('k_input'))}</h3>${S.app.table.features.map((f, i) => `<label class="ac-f"><span>${E(trName(f))}</span>${f.type === 'num'
    ? `<input type="number" data-fi="${i}" step="${f.step}" value="${E(f.def)}">`
    : `<select data-fi="${i}">${f.opts.map((o, k) => `<option value="${E(o)}" ${o === f.def ? 'selected' : ''}>${E(((f.optTr || [])[k] || {})[lang] || o)}</option>`).join('')}</select>`}</label>`).join('')}<div class="ac-row" style="margin-top:6px">${ask}</div>`;
}
function bindInputs() {
  $('askAI').addEventListener('click', async () => {
    const r = await classify(S.kind, S.kind === 'text' ? $('txtIn').value : rt ? rt.inputs.slice() : tableInputs());
    if (r && rt) rt.setResult(r);
  });
  if (S.kind === 'image') {
    $('camBtn').addEventListener('click', () => camera(!S.cam));
    $('photoBtn').addEventListener('click', () => $('filePick').click());
    $('filePick').addEventListener('change', () => { const f = $('filePick').files[0]; $('filePick').value = ''; if (f) setPhoto(f); });
    // 끌어다 놓기·붙여넣기(Ctrl+V): 사진 파일, 구글 이미지에서 끌어온 사진 모두 — 입력 칸과 무대 어디든
    const dropPhoto = async (files, urls) => {
      try { const b = files[0] || (urls.length ? await fetchFirstImage(urls) : null); if (b) setPhoto(b); }
      catch { toast(t('k_dropFail')); }
    };
    bindDropZone($('inPanel'), dropPhoto);
    bindDropZone($('stageBox'), dropPhoto);
    $('pickBtn').addEventListener('click', () => $('filePick').click());
    const d = $('drawBtn');
    if (d) d.addEventListener('click', async () => { const M = await import('./ai-capture.js?v=202611110001'); M.openDraw({ t, single: true, onAdd: b => setPhoto(b) }); });
  }
  if (S.kind === 'table') document.querySelectorAll('[data-fi]').forEach(el => el.addEventListener('input', () => {
    const i = Number(el.dataset.fi), f = S.app.table.features[i];
    if (rt) rt.inputs[i] = f.type === 'num' ? Number(el.value) : el.value;
  }));
}
const tableInputs = () => S.app.table.features.map(f => f.def);
function showInputs(vals) {
  document.querySelectorAll('[data-fi]').forEach(el => { const v = vals[Number(el.dataset.fi)]; if (v != null && document.activeElement !== el) el.value = v; });
}

// ── 카메라·사진 ──
async function camera(on) {
  const v = $('cam'), btn = $('camBtn');
  if (!v) return;
  if (!on) {
    if (S.cam) S.cam.getTracks().forEach(x => x.stop());
    S.cam = null; v.classList.add('hidden'); btn.textContent = t('k_camOn'); btn.classList.remove('on'); return;
  }
  if (S.cam) return;
  try {
    S.cam = await navigator.mediaDevices.getUserMedia({ video: { facingMode: 'user', width: { ideal: 640 } }, audio: false });
    v.srcObject = S.cam; v.classList.remove('hidden'); $('photo').classList.add('hidden');
    btn.textContent = t('k_camOff'); btn.classList.add('on');
  } catch { toast(t('capNoCam')); S.cam = null; }
}
let _pickResolve = null;
function pickPhoto() {
  return new Promise(res => { _pickResolve = res; $('pickBox').classList.remove('hidden'); });
}
function endPick() {
  $('pickBox').classList.add('hidden');
  if (_pickResolve) { const r = _pickResolve; _pickResolve = null; r(); }
}
function setPhoto(blob) {
  if (!blob || !/^image\//.test(blob.type || 'image/')) return;
  const img = $('photo');
  if (img.src) URL.revokeObjectURL(img.src);
  // 사진이 다 열린 뒤에 "사진 올리기" 블록을 끝낸다(바로 다음 블록이 그 사진으로 묻도록)
  img.onload = () => { if (_pickResolve) endPick(); };
  img.src = URL.createObjectURL(blob); img.classList.remove('hidden');
  S.photo = img;
  if (S.cam) camera(false);
}

// ── AI ──
let _modelP = null;
function loadModel() {
  if (S.kind === 'text') _modelP = import('./ai-text-core.js?v=202611110001').then(M => ({ text: M }));
  else if (S.kind === 'table') _modelP = import('./ai-table-core.js?v=202611110001').then(M => ({ table: M }));
  else _modelP = import('./ai-model.js?v=202611110001').then(async M => ({ M, loaded: await (S.app.modelVersion ? M.loadDriveModel(null, pid, S.app.modelVersion) : M.loadModel(S.app.modelUrl)) }));
  _modelP.catch(e => { console.error(e); toast(t('k_loadFail')); });
}
async function classify(kind, arg) {
  if (kind !== S.kind) return null;
  let m;
  try { m = await _modelP; } catch { toast(t('k_loadFail')); return null; }
  let r;
  if (kind === 'text') {
    const txt = String(arg || '').trim();
    if (!txt) return null;
    const p = await m.text.predictAny(S.app.text, txt).catch(() => m.text.predictText(S.app.text.model, txt));
    r = { probs: p.probs, words: p.words, input: txt };
  } else if (kind === 'table') {
    const vals = Array.isArray(arg) ? arg : tableInputs();
    showInputs(vals);
    const p = m.table.appPredict(S.app.table, vals.map((v, i) => (v == null ? S.app.table.features[i].def : v)));
    r = S.prob === 'class' ? { probs: Object.fromEntries(p.p.map((x, i) => ['c' + i, x])) } : { value: p.v };
  } else {
    let src = null;
    if (S.cam && $('cam').videoWidth) {
      const v = $('cam'), c = document.createElement('canvas');
      c.width = v.videoWidth; c.height = v.videoHeight; c.getContext('2d').drawImage(v, 0, 0);
      src = c;
    } else if (S.photo && S.photo.complete && S.photo.naturalWidth) src = S.photo;
    if (!src) { toast(t('k_needInput')); return null; }
    S.lastSrc = { el: src, cam: src.tagName === 'CANVAS' };
    const preds = await m.M.predict(m.loaded, src);
    const probs = {};
    for (const x of preds || []) { const id = (S.app.mapping || {})[x.className]; if (id) probs[id] = (probs[id] || 0) + x.probability; }
    r = { probs };
  }
  if (r.probs) S.last = { got: topId(r.probs), text: kind === 'text' ? r.input : '', src: kind === 'image' ? S.lastSrc : null };
  showResult(r);
  return r;
}
const topId = probs => { let top = '', bp = -1; for (const [id, p] of Object.entries(probs || {})) if (p > bp) { bp = p; top = id; } return top; };

// ── 맞아요/틀렸어요 → 만든 모둠에게(ai_apps/{pid}/feedback). 모둠이 ⑤에서 데이터로 넣고 다시 학습한다 ──
// 블록이 계속 물어봐도 고르는 중(틀렸어요 → 정답 고르기)이면 그대로 둔다.
function fbRender() {
  const box = $('fbBox');
  if (!box) return;
  if (!S.fbBy || S.kind === 'table' || !S.last) { box.innerHTML = ''; return; }
  if (S.fb === 'sent') { box.innerHTML = `<div class="ac-fb muted">✅ ${E(t('fbThanks'))}</div>`; return; }
  if (S.fb === 'wrong' || S.fb === 'sending') {
    box.innerHTML = `<div class="ac-fb"><b>${E(t('fbPick'))}</b><div class="ac-opts">${(S.app.labels || []).map(l =>
      `<button class="ac-btn${S.fbWant === l.id ? ' on' : ''}" data-fbpick="${E(l.id)}">${E(l.emoji || '')} ${E(nameOf(l.id))}</button>`).join('')}</div>
      <div class="ac-row"><button class="ac-btn run" data-fb="send" ${S.fbWant && S.fb !== 'sending' ? '' : 'disabled'}>${E(t('fbSend'))}</button><button class="ac-btn" data-fb="cancel">${E(t('fbCancel'))}</button></div></div>`;
    return;
  }
  const cam = S.last.src && S.last.src.cam;
  box.innerHTML = `<div class="ac-fb"><span>${E(t('fbAsk'))}<br><small class="muted">${E(t(cam && S.app.camFeedback ? 'fbPrivacyCam' : 'fbPrivacy'))}</small></span>
    <div class="ac-row"><button class="ac-btn" data-fb="ok">👍 ${E(t('fbRight'))}</button><button class="ac-btn" data-fb="wrong">👎 ${E(t('fbWrong'))}</button></div></div>`;
}
// 보낼 사진: 긴 쪽 320px JPEG(웹앱 피드백과 같은 크기). 카메라 사진은 선생님이 허락한 수업만.
function fbPhoto(src) {
  if (!src || (src.cam && !S.app.camFeedback)) return '';
  const el = src.el, w = el.naturalWidth || el.width, h = el.naturalHeight || el.height;
  if (!w || !h) return '';
  const k = Math.min(1, 320 / Math.max(w, h)), c = document.createElement('canvas');
  c.width = Math.round(w * k); c.height = Math.round(h * k);
  c.getContext('2d').drawImage(el, 0, 0, c.width, c.height);
  const u = c.toDataURL('image/jpeg', 0.75);
  return u.length < 59000 ? u : '';
}
async function fbSend(ok) {
  const f = S.fbFor;
  if (!f) return;
  const want = ok ? f.got : S.fbWant;
  if (!want) return;
  S.fb = 'sending'; fbRender();
  try {
    await authReady();
    const data = { by: S.fbBy, ok: !!ok, got: f.got, want, note: '', status: 'new', lang, at: serverTimestamp() };
    if (f.text) data.text = String(f.text).slice(0, 100);
    else if (f.img) data.img = f.img;
    await addDoc(collection(db, 'ai_apps', pid, 'feedback'), data);
    S.fb = 'sent';
  } catch (e) { console.error('[aicode] feedback', e); toast(t('error') + ' ' + (e.code || '')); S.fb = ok ? null : 'wrong'; }
  fbRender();
}
function bindFeedback() {
  $('fbBox').addEventListener('click', e => {
    const pick = e.target.closest('[data-fbpick]');
    if (pick) { S.fbWant = pick.dataset.fbpick; return fbRender(); }
    const b = e.target.closest('[data-fb]');
    if (!b) return;
    const v = b.dataset.fb;
    if (v === 'cancel') { S.fb = null; S.fbFor = null; return fbRender(); }
    if (v === 'send') return fbSend(false);
    // 누른 순간의 결과·사진을 붙잡아 둔다(블록이 계속 물어봐도 바뀌지 않게)
    S.fbFor = { got: S.last.got, text: S.last.text, img: S.kind === 'image' ? fbPhoto(S.last.src) : '' };
    if (v === 'ok') fbSend(true);
    else { S.fb = 'wrong'; S.fbWant = ''; fbRender(); }
  });
}
function showResult(r) {
  if (S.fb !== 'wrong' && S.fb !== 'sending') { S.fb = null; S.fbFor = null; }
  fbRender();
  const box = $('resBox');
  if (r.value != null) {
    const u = S.app.table && S.app.table.unit ? ' ' + S.app.table.unit : '';
    box.innerHTML = `<div class="ac-res">${E(trName(S.app.table.target))}: ${E(String(Math.round(r.value * 100) / 100))}${E(u)}</div>`;
    return;
  }
  let top = '', bp = -1;
  for (const [id, p] of Object.entries(r.probs)) if (p > bp) { bp = p; top = id; }
  box.innerHTML = `<div class="ac-res">${E(nameOf(top))}</div>${(S.app.labels || []).map(l => {
    const pct = Math.round((r.probs[l.id] || 0) * 100);
    return `<div class="ac-bar"><span>${E(nameOf(l.id))}</span><span class="tr"><span style="width:${pct}%"></span></span><span>${pct}%</span></div>`;
  }).join('')}`;
}

// ── 블록 ──
function initBlocks() {
  const ctx = { t, kind: S.kind, prob: S.prob, labels, features };
  defineBlocks(window.Blockly, window.javascript, ctx);
  S.ws = window.Blockly.inject('blocklyDiv', {
    renderer: 'zelos', toolbox: play ? undefined : toolbox(ctx), readOnly: play, media: BL + 'media/',
    trashcan: !play, zoom: { controls: true, wheel: true, startScale: 0.75 }, move: { scrollbars: true, drag: true, wheel: true },
    grid: { spacing: 24, length: 2, colour: '#e3e3e8', snap: true },
  });
  registerVarsFlyout(window.Blockly, S.ws);
  let json = null;
  try { json = S.code && S.code.json ? JSON.parse(S.code.json) : null; } catch { json = null; }
  try { window.Blockly.serialization.workspaces.load(json || starter(ctx), S.ws); }
  catch (e) { console.warn('load', e); window.Blockly.serialization.workspaces.load(starter(ctx), S.ws); }
  // 불러오면서 생긴 변경 알림이 지나간 뒤부터 저장한다(열기만 해도 저장되지 않게)
  if (!play) setTimeout(() => S.ws.addChangeListener(e => { if (!e.isUiEvent && e.type !== 'finished_loading') scheduleSave(); }), 300);
}
function toggleBlocks() {
  S.showBlocks = !S.showBlocks;
  $('blocklyDiv').classList.toggle('hidden', !S.showBlocks);
  document.body.classList.toggle('blocks', S.showBlocks);
  $('blocksBtn').textContent = t(S.showBlocks ? 'k_hideBlocks' : 'k_showBlocks');
  window.Blockly.svgResize(S.ws);
}

// ── 무대·실행 ──
let _askResolve = null;
function initStage() {
  stage = new Stage($('stage'));
  stage.reset(S.emoji);
  rt = new Runtime({
    stage, nameOf, inputs: S.kind === 'table' ? tableInputs() : [],
    classify: (kind, arg) => classify(kind, arg),
    camera: on => camera(on),
    pickPhoto: () => (S.kind === 'image' ? pickPhoto() : Promise.resolve()),
    onInputs: vals => showInputs(vals),
    ask: q => new Promise(res => {
      _askResolve = res;
      $('askBox').classList.remove('hidden'); $('askIn').value = ''; $('askIn').focus();
    }),
    cancelAsk: () => { if (_askResolve) { _askResolve(''); _askResolve = null; } $('askBox').classList.add('hidden'); if ($('pickBox')) endPick(); },
    onState: on => { $('runBtn').classList.toggle('on', on); },
    onError: () => toast(t('k_error')),
  });
  $('askBox').addEventListener('submit', e => {
    e.preventDefault();
    const v = $('askIn').value;
    $('askBox').classList.add('hidden');
    if (_askResolve) { _askResolve(v); _askResolve = null; }
  });
  window.__aicode = { stage, rt };   // 시험·디버그용(화면 동작에는 쓰지 않음)
  // 마우스: 무대 좌표·누름 상태(감지 블록), 캐릭터/무대 클릭(이벤트 블록)
  const cv = $('stage');
  const track = e => { const p = stage.toStage(e.clientX, e.clientY); stage.mouse.x = Math.round(Math.max(-240, Math.min(240, p.x))); stage.mouse.y = Math.round(Math.max(-180, Math.min(180, p.y))); };
  cv.addEventListener('pointermove', track);
  cv.addEventListener('pointerdown', e => { track(e); stage.mouse.down = true; if (stage.hit(e.clientX, e.clientY)) rt.click(); else rt.stageClick(); });
  window.addEventListener('pointerup', () => { stage.mouse.down = false; });
  // 키보드: 글 쓰는 칸·블록 편집 중에는 무대로 보내지 않는다
  const KEY = { ' ': 'space', ArrowUp: 'up', ArrowDown: 'down', ArrowLeft: 'left', ArrowRight: 'right' };
  const keyOf = e => KEY[e.key] || (/^[a-z0-9]$/i.test(e.key) ? e.key.toLowerCase() : '');
  const typing = e => { const el = e.target; return el && (/^(INPUT|TEXTAREA|SELECT)$/.test(el.tagName) || el.isContentEditable || (el.closest && el.closest('#blocklyDiv'))); };
  window.addEventListener('keydown', e => {
    const k = keyOf(e); if (!k || typing(e) || e.ctrlKey || e.metaKey || e.altKey) return;
    if (!rt.stopped && KEY[e.key]) e.preventDefault();   // 실행 중 화살표·스페이스로 화면이 움직이지 않게
    rt.key(k, true);
  });
  window.addEventListener('keyup', e => { const k = keyOf(e); if (k) rt.key(k, false); });
  window.addEventListener('blur', () => rt.keys.clear());
}
function run() {
  let factory;
  try { factory = build(compile(window.Blockly, window.javascript, S.ws)); }
  catch (e) { console.error(e); return toast(t('k_error')); }
  stage.reset(S.emoji);
  rt.start(factory);
}

// ── 저장·공유(모둠원) ──
let _saveT = 0;
function scheduleSave() {
  if (play) return;
  $('saveSt').textContent = t('k_saving');
  clearTimeout(_saveT);
  _saveT = setTimeout(save, 1200);
}
function payload() {
  return { json: JSON.stringify(window.Blockly.serialization.workspaces.save(S.ws)), emoji: S.emoji, title: (S.title || '').trim().slice(0, 30) };
}
async function save() {
  const p = payload();
  if (p.json.length > 90000) { $('saveSt').textContent = ''; return toast(t('k_tooBig')); }
  if (!S.key) S.key = newId('k');
  try {
    await updateDoc(doc(db, 'ai_projects', pid), { [`codes.${S.me}`]: { ...p, key: S.key, shared: !!(S.code && S.code.shared), ...(S.code && S.code.postId ? { postId: S.code.postId } : {}), at: serverTimestamp() } });
    S.code = { ...(S.code || {}), ...p, key: S.key };
    $('saveSt').textContent = t('k_saved');
  } catch (e) { console.error(e); $('saveSt').textContent = ''; toast(t('error') + ' ' + (e.code || '')); }
}
async function share() {
  clearTimeout(_saveT);
  await save();
  const p = payload();
  try {
    // 공개 문서에는 학생 이름·번호 없이 작품만(무작위 키)
    await updateDoc(doc(db, 'ai_apps', pid), { [`codes.${S.key}`]: { ...p, at: serverTimestamp() } });
    await updateDoc(doc(db, 'ai_projects', pid), { [`codes.${S.me}.shared`]: true });
    S.code.shared = true;
  } catch (e) { console.error(e); toast(t('error') + ' ' + (e.code || '')); return false; }
  const url = playUrl();
  const panel = $('sharePanel');
  panel.classList.remove('hidden');
  panel.innerHTML = `<h3>🔗 ${E(t('k_shared'))}</h3><p class="muted">${E(t('k_shareHelp'))}</p>
    <div class="ac-url"><input id="shareUrl" readonly value="${E(url)}"><button class="ac-btn" id="copyBtn">${E(t('copy'))}</button><a class="ac-btn" href="${E(url)}" target="_blank" rel="noopener">${E(t('open'))} ↗</a></div>
    <h3 style="margin-top:12px">${E(t('k_groupWorks'))}</h3><div class="ac-works" id="works"></div>`;
  $('copyBtn').addEventListener('click', async () => { try { await navigator.clipboard.writeText(url); } catch { $('shareUrl').select(); document.execCommand('copy'); } toast(t('copied')); });
  groupWorks();
  toast(t('k_shared'));
  return true;
}
const playUrl = () => new URL(`aicode.html?id=${encodeURIComponent(pid)}&c=${encodeURIComponent(S.key)}`, location.href).href;

// ── 정보 게시판에 올리기(블록 코딩 결과물) ──
// 결과물이 '웹앱만'이면 올리지 않는다(값이 없는 예전 배정은 둘 다).
const canPost = () => !play && !!(S.asg && S.asg.board && S.asg.board.name) && S.asg.output !== 'app';
function boardUrl() {
  const b = S.asg.board;
  return 'ohdlet.html?' + new URLSearchParams({ board: b.name, school: b.schoolName || '', grade: b.grade || '', group: b.group || '' }).toString();
}
function postCardHtml() {
  const done = S.code && S.code.postId;
  return `<h3>${E(t('k_post'))}</h3><p class="muted" style="margin:0 0 8px">${E(t('k_postHelp'))}</p>
    ${done ? `<p style="margin:0 0 8px">✅ ${E(t('k_posted'))} <a href="${E(boardUrl())}" target="_blank" rel="noopener">${E(t('openOhdlet'))} ↗</a></p>` : ''}
    <button class="ac-btn${done ? '' : ' run'}" id="postBtn">${E(done ? t('k_postAgain') : t('k_post'))}</button>`;
}
async function post() {
  const btn = $('postBtn');
  btn.disabled = true;
  try {
    if (!(await share())) return;
    const url = playUrl();
    const img = $('stage').toDataURL('image/jpeg', 0.8);   // 지금 실행 화면(480×360)
    const b = S.asg.board, a = S.asg;
    const title = (S.title || '').trim() || S.app.title || t('k_untitled');
    const sx = { ko: 'Ko', zh: 'Zh', ru: 'Ru', en: 'En' };
    const texts = {};
    for (const lg of LANGS) {
      const tl = makeT(lg);
      texts['sub' + sx[lg]] = `[${nv(a.grade)}-${nv(a.class)}] ` + tl('k_postTitle', { title });
      texts['msg' + sx[lg]] = tl('k_postBody', { url });
    }
    const ref = await addDoc(collection(db, 'posts'), {
      classTitle: b.name, boardKey: classBoardKey(b), grade: b.grade || '', group: b.group || '',
      num: String(S.session.number || ''), name: S.session.name || '', studentId: S.me, srcLang: lang,
      ...texts, imgs: [img], column: '', likes: 0, pinned: false, deleted: false,
      ...((a.boardScope || 'class') === 'class' ? { aiScope: 'class', aiGrade: nv(a.grade), aiClass: nv(a.class) } : {}),
      createdAt: serverTimestamp(), updatedAt: serverTimestamp(),
    });
    await updateDoc(doc(db, 'ai_projects', pid), { [`codes.${S.me}.postId`]: ref.id });
    S.code = { ...(S.code || {}), postId: ref.id };
    toast(t('k_posted'));
  } catch (e) { console.error(e); toast(t('error') + ' ' + (e.code || '')); }
  finally { $('postCard').innerHTML = postCardHtml(); }
}
async function groupWorks() {
  try {
    const ps = await getDoc(doc(db, 'ai_projects', pid));
    const codes = (ps.data() || {}).codes || {};
    let names = {};
    try { const pair = await getDoc(doc(db, 'ai_pairs', ps.data().pairId)); names = (pair.data() || {}).memberNames || {}; } catch { /* 이름 없이 */ }
    const list = Object.entries(codes).filter(([, c]) => c && c.shared && c.key);
    $('works').innerHTML = list.length ? list.map(([id, c]) => `<a href="aicode.html?id=${encodeURIComponent(pid)}&c=${encodeURIComponent(c.key)}" target="_blank" rel="noopener">${E(c.emoji || '')} ${E(c.title || t('k_untitled'))} — ${E(t('k_by', { name: names[id] || '' }))}</a>`).join('') : `<span class="muted">${E(t('k_noWorks'))}</span>`;
  } catch { /* 목록은 없어도 된다 */ }
}

start().catch(e => { console.error(e); fail(t('error')); });
