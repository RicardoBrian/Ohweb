// 직접 만든 데이터 모으기: ✍️ 그리기 판, 📸 카메라.
// AI 실험실(②·③ 사진 넣기, ④ 한 장 넣어 보기)과 공개 웹앱이 같이 쓴다.
// 필요할 때만 불러온다(import()) — 검색 사진만 쓰는 수업 화면은 무게가 그대로다.
//
// openDraw / openCamera({ t, title, onAdd, single, note })
//   onAdd(blob): 사진 한 장이 만들어질 때마다 부른다(async 가능).
//   single: true면 한 장 넣고 바로 닫는다(웹앱·한 장 넣어 보기).

const DRAW_SIZE = 384;      // 그리기 판 크기(정사각형). 학습 사진 최소 크기(120px)보다 넉넉하게
const CAM_MAX = 640;        // 카메라 사진 긴 변
const BURST_N = 10;         // 연속 찍기 장수
const BURST_GAP = 350;      // 연속 찍기 간격(ms)

let styled = false;
function style() {
  if (styled) return;
  styled = true;
  const css = `
.cap-ov { position: fixed; inset: 0; z-index: 9000; background: rgba(15, 18, 30, .55); display: flex; align-items: center; justify-content: center; padding: 12px; }
.cap-box { background: #fff; color: #1d1f27; border-radius: 18px; width: min(460px, 100%); max-height: 100%; overflow: auto; padding: 16px; display: flex; flex-direction: column; gap: 12px; box-shadow: 0 20px 60px rgba(0,0,0,.25); font: 15px/1.5 "IBM Plex Sans KR", system-ui, sans-serif; }
.cap-h { display: flex; justify-content: space-between; align-items: center; gap: 8px; }
.cap-h b { font-size: 16px; }
.cap-x { border: 0; background: none; font-size: 26px; line-height: 1; cursor: pointer; color: #666; padding: 2px 6px; }
.cap-pad { width: 100%; aspect-ratio: 1; border: 2px solid #d6d9e3; border-radius: 12px; background: #fff; touch-action: none; display: block; cursor: crosshair; }
.cap-vid { width: 100%; border-radius: 12px; background: #111; display: block; max-height: 60vh; object-fit: contain; }
.cap-vid.mirror { transform: scaleX(-1); }
.cap-row { display: flex; flex-wrap: wrap; gap: 8px; align-items: center; }
.cap-row .grow { flex: 1; }
.cap-btn { font-family: inherit; font-weight: 600; font-size: 15px; line-height: 1; padding: 12px 16px; border-radius: 12px; border: 1px solid #d6d9e3; background: #f4f5f9; color: #1d1f27; cursor: pointer; }
.cap-btn.primary { background: #3b5bdb; border-color: #3b5bdb; color: #fff; }
.cap-btn:disabled { opacity: .5; cursor: default; }
.cap-pen { display: flex; gap: 6px; }
.cap-pen button { width: 38px; height: 38px; border-radius: 50%; border: 1px solid #d6d9e3; background: #fff; display: grid; place-items: center; cursor: pointer; }
.cap-pen button.on { border-color: #3b5bdb; box-shadow: 0 0 0 2px #3b5bdb inset; }
.cap-pen i { display: block; background: #111; border-radius: 50%; }
.cap-msg { font-size: 13px; color: #555; }
.cap-err { font-size: 14px; color: #c62828; }
.cap-count { font-size: 13px; color: #2e7d32; font-weight: 600; }
.cap-flash { animation: capflash .25s; }
@keyframes capflash { from { filter: brightness(2); } to { filter: none; } }
@media (prefers-color-scheme: dark) { .cap-box { background: #1e2130; color: #eef0f6; } .cap-btn { background: #2a2e40; color: #eef0f6; border-color: #3a3f55; } .cap-msg { color: #b6bbcc; } }
`;
  const el = document.createElement('style');
  el.textContent = css;
  document.head.appendChild(el);
}

function shell(t, title) {
  style();
  const ov = document.createElement('div');
  ov.className = 'cap-ov';
  ov.innerHTML = `<div class="cap-box" role="dialog" aria-modal="true"><div class="cap-h"><b></b><button class="cap-x" aria-label="${t('close')}">×</button></div><div class="cap-body"></div></div>`;
  ov.querySelector('b').textContent = title;
  document.body.appendChild(ov);
  return ov;
}

const toBlob = (c, type = 'image/jpeg', q = 0.92) => new Promise(res => c.toBlob(res, type, q));

// ── ✍️ 그리기 ──
export function openDraw({ t, title, onAdd, single = false, note = '' }) {
  const ov = shell(t, title || t('capDraw'));
  const body = ov.querySelector('.cap-body');
  body.innerHTML = `
    <canvas class="cap-pad" width="${DRAW_SIZE}" height="${DRAW_SIZE}"></canvas>
    <div class="cap-row">
      <div class="cap-pen" role="group" aria-label="${t('capPen')}">
        ${[8, 16, 28].map((w, i) => `<button type="button" data-w="${w}" class="${i === 1 ? 'on' : ''}" aria-label="${w}"><i style="width:${4 + i * 5}px;height:${4 + i * 5}px"></i></button>`).join('')}
      </div>
      <span class="grow"></span>
      <button type="button" class="cap-btn" data-a="clear">${t('capClear')}</button>
      <button type="button" class="cap-btn primary" data-a="add" disabled>${t(single ? 'capUse' : 'capAdd')}</button>
    </div>
    <div class="cap-count" aria-live="polite"></div>
    ${note ? `<div class="cap-msg">${note}</div>` : ''}`;
  const cv = body.querySelector('canvas');
  const g = cv.getContext('2d');
  const addBtn = body.querySelector('[data-a="add"]');
  const countEl = body.querySelector('.cap-count');
  let width = 16, drawing = false, last = null, dirty = false, added = 0;
  const clear = () => { g.fillStyle = '#fff'; g.fillRect(0, 0, DRAW_SIZE, DRAW_SIZE); dirty = false; addBtn.disabled = true; };
  clear();
  const pos = e => { const r = cv.getBoundingClientRect(); return { x: (e.clientX - r.left) * DRAW_SIZE / r.width, y: (e.clientY - r.top) * DRAW_SIZE / r.height }; };
  const dot = p => { g.beginPath(); g.arc(p.x, p.y, width / 2, 0, Math.PI * 2); g.fillStyle = '#111'; g.fill(); };
  cv.addEventListener('pointerdown', e => {
    e.preventDefault(); cv.setPointerCapture(e.pointerId);
    drawing = true; last = pos(e); dot(last); dirty = true; addBtn.disabled = false;
  });
  cv.addEventListener('pointermove', e => {
    if (!drawing) return;
    e.preventDefault();
    const p = pos(e);
    g.strokeStyle = '#111'; g.lineWidth = width; g.lineCap = 'round'; g.lineJoin = 'round';
    g.beginPath(); g.moveTo(last.x, last.y); g.lineTo(p.x, p.y); g.stroke();
    last = p;
  });
  const end = () => { drawing = false; last = null; };
  cv.addEventListener('pointerup', end); cv.addEventListener('pointercancel', end); cv.addEventListener('pointerleave', end);
  body.querySelectorAll('.cap-pen button').forEach(b => b.addEventListener('click', () => {
    width = Number(b.dataset.w);
    body.querySelectorAll('.cap-pen button').forEach(x => x.classList.toggle('on', x === b));
  }));
  body.querySelector('[data-a="clear"]').addEventListener('click', clear);
  addBtn.addEventListener('click', async () => {
    if (!dirty) return;
    addBtn.disabled = true;
    const blob = await toBlob(cv);
    try { await onAdd(blob); } catch (e) { console.warn('draw add', e); }
    added++;
    if (single) return close();
    countEl.textContent = t('capAdded', { n: added });
    clear();
  });
  const close = () => ov.remove();
  ov.querySelector('.cap-x').addEventListener('click', close);
  ov.addEventListener('click', e => { if (e.target === ov) close(); });
  return { close };
}

// ── 📸 카메라 ──
export function openCamera({ t, title, onAdd, single = false, note = '' }) {
  const ov = shell(t, title || t('capCamera'));
  const body = ov.querySelector('.cap-body');
  body.innerHTML = `
    <video class="cap-vid" playsinline muted autoplay></video>
    <div class="cap-err" hidden></div>
    <div class="cap-row">
      <button type="button" class="cap-btn" data-a="flip">${t('capFlip')}</button>
      <span class="grow"></span>
      ${single ? '' : `<button type="button" class="cap-btn" data-a="burst" disabled>${t('capBurst', { n: BURST_N })}</button>`}
      <button type="button" class="cap-btn primary" data-a="shot" disabled>${t('capShot')}</button>
    </div>
    <div class="cap-count" aria-live="polite"></div>
    ${note ? `<div class="cap-msg">${note}</div>` : ''}`;
  const vid = body.querySelector('video');
  const err = body.querySelector('.cap-err');
  const shotBtn = body.querySelector('[data-a="shot"]');
  const burstBtn = body.querySelector('[data-a="burst"]');
  const countEl = body.querySelector('.cap-count');
  let stream = null, facing = 'user', added = 0, closed = false, busy = false;

  const stop = () => { if (stream) { stream.getTracks().forEach(tr => tr.stop()); stream = null; } };
  async function start() {
    stop();
    err.hidden = true;
    shotBtn.disabled = true; if (burstBtn) burstBtn.disabled = true;
    try {
      if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) throw new Error('nocam');
      stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: facing, width: { ideal: 1280 }, height: { ideal: 720 } }, audio: false });
      if (closed) return stop();
      vid.srcObject = stream;
      vid.classList.toggle('mirror', facing === 'user');   // 화면만 거울처럼 — 저장되는 사진은 그대로
      await vid.play().catch(() => {});
      shotBtn.disabled = false; if (burstBtn) burstBtn.disabled = false;
    } catch (e) {
      console.warn('camera', e);
      err.textContent = t('capNoCam');
      err.hidden = false;
    }
  }
  async function shoot() {
    const w = vid.videoWidth, h = vid.videoHeight;
    if (!w || !h) return;
    const s = Math.min(1, CAM_MAX / Math.max(w, h));
    const c = document.createElement('canvas');
    c.width = Math.round(w * s); c.height = Math.round(h * s);
    c.getContext('2d').drawImage(vid, 0, 0, c.width, c.height);
    vid.classList.remove('cap-flash'); void vid.offsetWidth; vid.classList.add('cap-flash');
    const blob = await toBlob(c);
    try { await onAdd(blob); } catch (e) { console.warn('camera add', e); }
    added++;
    countEl.textContent = t('capAdded', { n: added });
  }
  shotBtn.addEventListener('click', async () => {
    if (busy) return;
    busy = true;
    await shoot();
    busy = false;
    if (single) close();
  });
  if (burstBtn) burstBtn.addEventListener('click', async () => {
    if (busy) return;
    busy = true; burstBtn.disabled = true; shotBtn.disabled = true;
    for (let i = 0; i < BURST_N && !closed; i++) {
      await shoot();
      await new Promise(r => setTimeout(r, BURST_GAP));
    }
    busy = false;
    if (!closed) { burstBtn.disabled = false; shotBtn.disabled = false; }
  });
  body.querySelector('[data-a="flip"]').addEventListener('click', () => { facing = facing === 'user' ? 'environment' : 'user'; start(); });
  const close = () => { closed = true; stop(); ov.remove(); };
  ov.querySelector('.cap-x').addEventListener('click', close);
  ov.addEventListener('click', e => { if (e.target === ov) close(); });
  start();
  return { close };
}
