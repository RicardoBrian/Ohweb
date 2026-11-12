// 발표 필기 — 선생님 화면에서만 펜으로 쓰고, 따라가기 중인 학생 화면에 같이 보인다.
//
// 상태: appSettings/ohnotion_ink_{주소} = { path, slides: { 장번호: [획…] }, scroll: { s, b, f, r }, at }
//       (appSettings 규칙 그대로 — 공개 읽기·관리자 쓰기. 규칙 변경 없음.)
//   - 획 = { i: 아이디, c: 색 번호, b: 블록 번호, n: 그 장의 블록 수, p: "x,y x,y …" }
//     좌표는 화면이 아니라 **그 장의 몇 번째 블록(문단·그림·표…) 안의 위치**(블록 폭·높이를 1000으로 본 값)다.
//     그래서 필기 층이 슬라이드 내용 안에 있어 스크롤해도 내용과 같이 움직이고, 다국어 학생은 자기 언어
//     슬라이드의 같은 번째 블록 위에 그려진다(글 길이가 달라 블록 안의 정확한 자리는 어긋날 수 있음).
//     블록 수(n)가 다른 장은 그 학생에게 필기를 안 보인다(엉뚱한 블록에 붙지 않게).
//   - 획은 손을 뗄 때 한 번 저장한다(실시간으로 그리는 모습은 안 보냄 — 저장 횟수 때문).
//   - 장마다 남는다. 발표를 끝내면(Esc·✕) 다 지운다. 같은 탭에서 새로고침·하위 페이지로 옮기기는
//     페이지가 같을 때만 이어 간다(하위 페이지로 가면 새 페이지라 비움).
//   - scroll: 선생님이 긴 장을 스크롤하면 맨 위에 보이는 블록(b)과 그 안의 비율(f)을 보내, 학생 화면도
//     같은 부분으로 맞춘다. 학생도 스스로 스크롤할 수 있고, 선생님이 다시 스크롤하면 그 위치로 맞춰진다.
//
// 조작(선생님): 발표 화면 ✏️ 또는 D = 필기 켜기/끄기, 1~6 = 색, Z = 이 장 마지막 획 지우기,
//   🗑 = 이 장 필기 다 지우기, Esc = 필기 끄기. 필기 중에는 클릭·스와이프로 장이 넘어가지 않는다(키는 됨).
//   태블릿: 필기 중 펜·한 손가락은 쓰기, 두 손가락은 위아래 스크롤, 세 손가락은 옆으로 쓸면 장 넘기기.
import { db } from './firebase-config.js';
import { doc, onSnapshot, setDoc, arrayUnion, arrayRemove, serverTimestamp } from 'https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js';

export const COLORS = [
  { name: '검정', color: '#1f1f1f', width: 4 },
  { name: '빨강', color: '#e03131', width: 4 },
  { name: '파랑', color: '#1c6fd1', width: 4 },
  { name: '형광 노랑', color: '#ffe600', width: 24, alpha: 0.45 },
  { name: '형광 분홍', color: '#ff5fa2', width: 24, alpha: 0.4 },
  { name: '형광 하늘', color: '#4dabf7', width: 24, alpha: 0.4 },
];
const SVGNS = 'http://www.w3.org/2000/svg';
const P = window.KakaPresent;
const VERSION = new URL(import.meta.url).searchParams.get('v') || '';   // 도구 줄에 보여 줌(새 코드가 왔는지 확인용)

// ── 공통: 장·블록 ──
const slideEls = () => [...(P.deck()?.querySelectorAll('.deck-canvas > .slide') || [])];
const innerOf = (k) => slideEls()[k]?.querySelector(':scope > .slide-inner') || null;
const blocksOf = (inner) => [...inner.children].filter((el) => !el.classList.contains('ink-layer'));
function layerOf(inner) {
  let svg = inner.querySelector(':scope > svg.ink-layer');
  if (!svg) {
    svg = document.createElementNS(SVGNS, 'svg');
    svg.setAttribute('class', 'ink-layer');
    svg.setAttribute('aria-hidden', 'true');
    inner.appendChild(svg);
  }
  return svg;
}
function lineEl(c) {
  const col = COLORS[c] || COLORS[0];
  const el = document.createElementNS(SVGNS, 'polyline');
  el.setAttribute('fill', 'none');
  el.setAttribute('stroke', col.color);
  el.setAttribute('stroke-width', String(col.width));
  el.setAttribute('stroke-linecap', 'round');
  el.setAttribute('stroke-linejoin', 'round');
  if (col.alpha) el.setAttribute('stroke-opacity', String(col.alpha));
  return el;
}
// 블록 기준 좌표(0~1000) → 그 장 내용 좌표(px)
function toPx(bl, x, y) {
  return [bl.offsetLeft + (x / 1000) * Math.max(bl.offsetWidth, 1), bl.offsetTop + (y / 1000) * Math.max(bl.offsetHeight, 1)];
}
// 내용 좌표의 한 점이 들어 있는(없으면 가장 가까운) 블록 번호
function blockAt(blocks, y) {
  let best = 0;
  let dist = Infinity;
  blocks.forEach((bl, i) => {
    const top = bl.offsetTop;
    const d = y < top ? top - y : y > top + bl.offsetHeight ? y - top - bl.offsetHeight : 0;
    if (d < dist) { dist = d; best = i; }
  });
  return best;
}

function drawSlides(ink, show) {
  slideEls().forEach((s, k) => {
    const inner = s.querySelector(':scope > .slide-inner');
    if (!inner) return;   // 표지
    const strokes = show ? ink?.slides?.[k] || [] : [];
    const old = inner.querySelector(':scope > svg.ink-layer');
    if (!strokes.length && !old) return;
    const svg = layerOf(inner);
    svg.querySelectorAll('.ink-s').forEach((el) => el.remove());
    const blocks = blocksOf(inner);
    for (const st of strokes) {
      if (st.n !== blocks.length) continue;   // 블록 구성이 다른 장(다국어) — 안 보임
      const bl = blocks[st.b];
      if (!bl) continue;
      const el = lineEl(st.c);
      el.classList.add('ink-s');
      el.setAttribute('points', String(st.p || '').split(' ').map((xy) => {
        const [x, y] = xy.split(',').map(Number);
        return toPx(bl, x, y).map((v) => v.toFixed(1)).join(',');
      }).join(' '));
      svg.appendChild(el);
    }
  });
}

// 스크롤: 맨 위에 보이는 블록 + 그 안의 비율
function scrollAnchor(inner) {
  const blocks = blocksOf(inner);
  const y = inner.scrollTop;
  const b = blockAt(blocks, y);
  const bl = blocks[b];
  const f = bl ? Math.min(Math.max((y - bl.offsetTop) / Math.max(bl.offsetHeight, 1), 0), 1) : 0;
  const max = inner.scrollHeight - inner.clientHeight;
  return { b, n: blocks.length, f: Math.round(f * 1000) / 1000, r: max > 0 ? Math.round((y / max) * 1000) / 1000 : 0 };
}
function applyScroll(inner, sc) {
  const blocks = blocksOf(inner);
  const max = inner.scrollHeight - inner.clientHeight;
  if (max <= 0) return;
  const bl = sc.n === blocks.length ? blocks[sc.b] : null;
  inner.scrollTop = bl ? bl.offsetTop + sc.f * bl.offsetHeight : sc.r * max;
}

function onRelayout(fn) {
  let t = null;
  const later = () => { clearTimeout(t); t = setTimeout(fn, 80); };
  window.addEventListener('resize', later);
  document.addEventListener('present:open', () => {
    const deck = P.deck();
    deck?.addEventListener('toggle', later, true);   // 토글을 펴고 접으면 블록 높이가 바뀐다
    deck?.addEventListener('load', later, true);     // 그림이 늦게 오면
  });
  return later;
}

// ── 선생님 ──
export function teacherInk(slug) {
  const ref = doc(db, 'appSettings', `ohnotion_ink_${slug}`);
  const keepKey = `kakanotion-ink:${slug}`;   // 이 탭에서 발표 중이었음(새로고침에도 필기를 이어 감)
  let ink = null;
  let loaded = false;
  let firstLoad = null;
  const ready = new Promise((r) => { firstLoad = r; });
  let inking = false;
  let color = 0;
  let bar = null;
  let penBtn = null;
  let drawing = null;   // 그리는 중인 획 { id, pen, k, inner, pts, el }
  let pan = null;       // 여러 손가락 동작 { inner, x0, y0, x, y, top, scale, dx, maxN }
  const touches = new Map();   // 지금 화면에 닿은 손가락 pointerId → [x, y]
  let lastPenAt = 0;

  const save = (data, merge = true) => setDoc(ref, { ...data, at: serverTimestamp() }, { merge })
    .catch((e) => { console.error('필기 저장 실패', e); alert(`필기를 저장하지 못했어요: ${e.message}`); });
  const myPath = () => location.pathname;
  const mine = () => ink && ink.path === myPath();
  const render = () => drawSlides(ink, mine());
  const relayout = onRelayout(render);

  onSnapshot(ref, (snap) => {
    ink = snap.exists() ? snap.data() : null;
    if (!loaded) { loaded = true; firstLoad(); }
    render();
  }, (e) => { console.warn('필기 듣기 실패', e?.message || e); if (!loaded) { loaded = true; firstLoad(); } });

  // 발표를 열 때: 이 탭에서 이 페이지 발표를 이어 가는 게 아니면 남은 필기를 비운다.
  async function opened() {
    addUi();
    await ready;
    const keep = (() => { try { return sessionStorage.getItem(keepKey) === myPath(); } catch { return false; } })();
    if (!keep || !mine()) {
      if (!mine() || Object.keys(ink?.slides || {}).length || ink?.scroll) await save({ path: myPath(), slides: {}, scroll: null }, false);
    }
    try { sessionStorage.setItem(keepKey, myPath()); } catch { /* 무시 */ }
    relayout();
  }
  function closed() {
    setInking(false);
    bar = null;
    penBtn = null;
    try { sessionStorage.removeItem(keepKey); } catch { /* 무시 */ }
    if (ink && (ink.path || Object.keys(ink.slides || {}).length)) save({ path: '', slides: {}, scroll: null }, false);
  }
  document.addEventListener('present:open', opened);
  document.addEventListener('present:close', closed);
  if (P.isOpen()) opened();

  // ── 도구 ──
  function addUi() {
    const deck = P.deck();
    const ui = deck?.querySelector('.deck-ui');
    if (!ui || ui.querySelector('.deck-pen')) return;
    penBtn = document.createElement('button');
    penBtn.type = 'button';
    penBtn.className = 'deck-pen';
    penBtn.textContent = '✏️';
    penBtn.title = '필기 (D)';
    penBtn.addEventListener('click', () => setInking(!inking));
    ui.insertBefore(penBtn, ui.querySelector('[data-a="close"]'));

    bar = document.createElement('div');
    bar.className = 'ink-bar';
    bar.hidden = true;
    bar.innerHTML = `${COLORS.map((c, i) => `<button type="button" class="ink-color${c.alpha ? ' hl' : ''}" data-c="${i}" title="${c.name} (${i + 1})" style="--c:${c.color}"></button>`).join('')}
      <span class="ink-sep"></span>
      <button type="button" data-a="undo" title="이 장 마지막 획 지우기 (Z)">↶</button>
      <button type="button" data-a="clear" title="이 장 필기 다 지우기">🗑</button>
      <button type="button" data-a="done" title="필기 끝 (D·Esc)">✕</button>
      <span class="ink-ver">${VERSION ? `v${VERSION.slice(-4)}` : ''}</span>`;
    bar.addEventListener('click', (e) => {
      const b = e.target.closest('button');
      if (!b) return;
      if (b.dataset.c) setColor(Number(b.dataset.c));
      else if (b.dataset.a === 'undo') undo();
      else if (b.dataset.a === 'clear') clearSlide();
      else if (b.dataset.a === 'done') setInking(false);
    });
    deck.appendChild(bar);
    setColor(color);
  }
  function setColor(i) {
    color = i;
    bar?.querySelectorAll('.ink-color').forEach((b) => b.classList.toggle('on', Number(b.dataset.c) === i));
  }
  function setInking(v) {
    inking = !!v && P.isOpen();
    P.deck()?.classList.toggle('inking', inking);
    if (bar) bar.hidden = !inking;
    penBtn?.classList.toggle('on', inking);
    if (!inking) { cancelStroke(); pan = null; touches.clear(); }
  }
  const current = () => (mine() ? ink.slides?.[P.index()] || [] : []);
  function undo() {
    const list = current();
    if (list.length) save({ slides: { [P.index()]: arrayRemove(list[list.length - 1]) } });
  }
  function clearSlide() {
    if (current().length) save({ slides: { [P.index()]: [] } });
  }

  // ── 그리기 ──
  function contentPoint(inner, e) {
    const rect = inner.getBoundingClientRect();
    const scale = rect.width / Math.max(inner.offsetWidth, 1);
    return [(e.clientX - rect.left) / scale + inner.scrollLeft, (e.clientY - rect.top) / scale + inner.scrollTop];
  }
  function cancelStroke() {
    drawing?.el.remove();
    drawing = null;
  }
  // 태블릿: 펜·마우스·한 손가락은 쓰기, 두 손가락은 위아래로 끌면 스크롤, 세 손가락은 옆으로 쓸면 장 넘기기
  // (세 번째 손가락이 닿은 뒤로는 그 동작이 끝날 때까지 스크롤하지 않는다 — 넘기다 스크롤되지 않게).
  // 한 손가락으로 막 쓰기 시작했는데 두 번째 손가락이 닿으면 그 획은 버리고 스크롤로 바꾼다.
  // 펜으로 쓰는 중이거나 막 뗀 직후의 손가락(손바닥)은 무시한다.
  const avg = () => {
    const v = [...touches.values()];
    return [v.reduce((a, p) => a + p[0], 0) / v.length, v.reduce((a, p) => a + p[1], 0) / v.length];
  };
  function startPan(inner) {
    const [x, y] = avg();
    const rect = inner?.getBoundingClientRect();
    const dx = pan ? pan.dx + (pan.x - pan.x0) : 0;   // 손가락 수가 바뀌어도 옆 움직임은 이어서 잰다
    const maxN = Math.max(pan?.maxN || 0, touches.size);   // 이 동작에서 닿았던 가장 많은 손가락 수
    pan = { inner, x0: x, y0: y, x, y, dx, maxN, top: inner?.scrollTop || 0, scale: inner ? rect.width / Math.max(inner.offsetWidth, 1) : 1 };
  }
  document.addEventListener('pointerdown', (e) => {
    if (!inking || e.button !== 0 || !e.target.closest?.('.deck-stage')) return;
    const k = P.index();
    const inner = innerOf(k);
    if (e.pointerType === 'touch') {
      e.preventDefault();
      if (drawing?.pen || Date.now() - lastPenAt < 400) return;   // 펜 쓰는 중의 손바닥
      touches.set(e.pointerId, [e.clientX, e.clientY]);
      if (touches.size >= 2) {
        if (drawing) cancelStroke();   // 한 손가락 획 → 스크롤로
        startPan(inner);
        return;
      }
      if (pan) return;   // 스크롤하던 손가락이 아직 남아 있음
    }
    if (!inner || drawing) return;   // 표지에는 안 쓴다 · 한 번에 한 획
    e.preventDefault();
    const el = lineEl(color);
    layerOf(inner).appendChild(el);
    drawing = { id: e.pointerId, pen: e.pointerType === 'pen', k, inner, el, pts: [contentPoint(inner, e)] };
    el.setAttribute('points', drawing.pts.map((p) => p.join(',')).join(' '));
    try { e.target.setPointerCapture?.(e.pointerId); } catch { /* 무시 */ }
  }, true);
  document.addEventListener('pointermove', (e) => {
    if (e.pointerType === 'touch' && touches.has(e.pointerId)) {
      touches.set(e.pointerId, [e.clientX, e.clientY]);
      if (pan) {
        [pan.x, pan.y] = avg();
        if (pan.inner && pan.maxN < 3) pan.inner.scrollTop = pan.top - (pan.y - pan.y0) / pan.scale;   // 스크롤은 두 손가락만
        return;
      }
    }
    if (!drawing || e.pointerId !== drawing.id) return;
    const p = contentPoint(drawing.inner, e);
    const last = drawing.pts[drawing.pts.length - 1];
    if (Math.hypot(p[0] - last[0], p[1] - last[1]) < 2) return;
    drawing.pts.push(p);
    drawing.el.setAttribute('points', drawing.pts.map((q) => q.join(',')).join(' '));
  }, true);
  function liftTouch(e) {
    if (!touches.delete(e.pointerId) || !pan) return false;
    if (touches.size) { startPan(pan.inner); return true; }   // 남은 손가락으로 계속 스크롤
    const dx = pan.dx + (pan.x - pan.x0);
    const dy = pan.y - pan.y0;
    const pan0 = pan;
    pan = null;
    // 세 손가락으로 옆으로 쓸기 = 장 넘기기(위아래 움직임보다 확실히 클 때만)
    if (e.type === 'pointerup' && pan0.maxN >= 3 && Math.abs(dx) > 80 && Math.abs(dx) > Math.abs(dy) * 2) P.go(P.index() + (dx < 0 ? 1 : -1));
    return true;
  }
  const finish = (e) => {
    if (e.pointerType === 'touch' && liftTouch(e)) return;
    if (!drawing || e.pointerId !== drawing.id) return;
    const { k, inner, pts, el, pen } = drawing;
    drawing = null;
    if (pen) lastPenAt = Date.now();
    if (pts.length === 1) pts.push([pts[0][0] + 0.5, pts[0][1] + 0.5]);   // 점 하나
    const blocks = blocksOf(inner);
    if (!blocks.length) { el.remove(); return; }
    const b = blockAt(blocks, pts[0][1]);
    const bl = blocks[b];
    const w = Math.max(bl.offsetWidth, 1);
    const h = Math.max(bl.offsetHeight, 1);
    const p = pts.map(([x, y]) => `${Math.round(((x - bl.offsetLeft) / w) * 1000)},${Math.round(((y - bl.offsetTop) / h) * 1000)}`).join(' ');
    const st = { i: Math.random().toString(36).slice(2, 9), c: color, b, n: blocks.length, p };
    const write = save({ path: myPath(), slides: { [k]: arrayUnion(st) } });
    // 저장된 획이 그려지면 임시 선은 지운다(지금 바로 지우면 깜빡임).
    write.finally(() => setTimeout(() => el.remove(), 50));
  };
  document.addEventListener('pointerup', finish, true);
  document.addEventListener('pointercancel', finish, true);

  // 필기 중에는 클릭·스와이프로 장이 넘어가거나 링크가 열리지 않게 — 발표·따라가기보다 먼저 받는다.
  const swallow = (e) => {
    if (!inking || !e.target.closest?.('.deck-stage')) return;
    e.preventDefault();
    e.stopPropagation();
  };
  window.addEventListener('click', swallow, true);
  window.addEventListener('touchstart', (e) => { if (inking && e.target.closest?.('.deck-stage')) e.stopPropagation(); }, true);
  window.addEventListener('touchend', (e) => { if (inking && e.target.closest?.('.deck-stage')) e.stopPropagation(); }, true);

  window.addEventListener('keydown', (e) => {
    if (!P.isOpen() || e.ctrlKey || e.metaKey || e.altKey) return;
    if (e.target.closest?.('input, textarea, [contenteditable], .lang-pick')) return;
    const k = e.key;
    let used = true;
    if (k === 'd' || k === 'D') setInking(!inking);
    else if (inking && k === 'Escape') setInking(false);
    else if (inking && /^[1-6]$/.test(k)) setColor(Number(k) - 1);
    else if (inking && (k === 'z' || k === 'Z')) undo();
    else used = false;
    if (used) { e.preventDefault(); e.stopPropagation(); }
  }, true);

  // 스크롤 보내기(0.4초에 한 번까지)
  let scrollTimer = null;
  document.addEventListener('scroll', (e) => {
    const inner = e.target;
    if (!(inner instanceof Element) || !inner.matches('.deck .slide.active > .slide-inner')) return;
    clearTimeout(scrollTimer);
    scrollTimer = setTimeout(() => {
      if (!P.isOpen() || innerOf(P.index()) !== inner) return;
      save({ path: myPath(), scroll: { s: P.index(), ...scrollAnchor(inner) } });
    }, 400);
  }, true);
}

// ── 학생 ──
// show() = 지금 선생님을 따라가는 중이고 선생님이 이 페이지(teacherPath())에서 쓰는 필기인가
export function studentInk(slug, { following, teacherPath }) {
  const ref = doc(db, 'appSettings', `ohnotion_ink_${slug}`);
  let ink = null;
  let lastScroll = '';
  const show = () => following() && !!ink && ink.path === teacherPath();
  function update() {
    if (!P.isOpen()) return;
    const on = show();
    drawSlides(ink, on);
    const sc = on ? ink.scroll : null;
    const key = sc ? JSON.stringify(sc) : '';
    if (sc && sc.s === P.index() && key !== lastScroll) {
      const inner = innerOf(sc.s);
      if (inner) { applyScroll(inner, sc); lastScroll = key; }
    }
  }
  const relayout = onRelayout(update);
  document.addEventListener('present:slide', () => { lastScroll = ''; relayout(); });
  onSnapshot(ref, (snap) => {
    ink = snap.exists() ? snap.data() : null;
    update();
  }, (e) => console.warn('필기 듣기 실패', e?.message || e));
  return { update };
}
