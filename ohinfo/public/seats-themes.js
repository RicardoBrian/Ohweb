// 자리 배치(seats.html) 뽑기 테마 — 무대 그림과 "뽑는 연출"만 담당한다.
// 누가 뽑힐지는 seats.html 이 정해서 넘겨 주고(chosen), 테마는 연출을 마친 뒤
// 토큰(날아갈 번호표)이 출발할 화면 좌표 {x, y} 를 돌려준다. 자리로 날리기·기입은 seats.html 이 한다.
//
// 테마 모양: { id, name, verb(버튼 글자), token(날아가는 번호표 모양),
//              mount(box), update(items), play(ctx) → Promise<{x, y}> }
//   items = [{ id, label(번호), name }]   (남은 학생)
//   ctx   = { items, chosen(item), fast, reduce, target({x,y} 화면 좌표 또는 null) }

const NS = 'http://www.w3.org/2000/svg';

// ── 움직임 도구 ──
export const sleep = ms => new Promise(r => setTimeout(r, ms));
export function tween(ms, fn) {
  return new Promise(res => {
    if (ms <= 0) { fn(1); res(); return; }
    const t0 = performance.now();
    const step = now => { const t = Math.min(1, (now - t0) / ms); fn(t); t < 1 ? requestAnimationFrame(step) : res(); };
    requestAnimationFrame(step);
  });
}
export const E = {
  inOut: t => t < 0.5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2,
  out: t => 1 - Math.pow(1 - t, 3),
  outQuart: t => 1 - Math.pow(1 - t, 4),
  in: t => t * t,
  outBack: t => { const c1 = 1.70158, c3 = c1 + 1; return 1 + c3 * Math.pow(t - 1, 3) + c1 * Math.pow(t - 1, 2); },
  bounce: t => {
    const n1 = 7.5625, d1 = 2.75;
    if (t < 1 / d1) return n1 * t * t;
    if (t < 2 / d1) return n1 * (t -= 1.5 / d1) * t + 0.75;
    if (t < 2.5 / d1) return n1 * (t -= 2.25 / d1) * t + 0.9375;
    return n1 * (t -= 2.625 / d1) * t + 0.984375;
  },
};
const lerp = (a, b, t) => a + (b - a) * t;

export function hash(s) { let h = 2166136261; for (const ch of String(s)) { h ^= ch.codePointAt(0); h = Math.imul(h, 16777619); } return h >>> 0; }
function rng(seed) { let a = (seed >>> 0) || 1; return () => { a = (a + 0x6D2B79F5) | 0; let t = Math.imul(a ^ (a >>> 15), 1 | a); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; }
const PALETTE = ['#ff6b6b', '#ffa94d', '#fcc419', '#51cf66', '#339af0', '#845ef7', '#f06595', '#20c997', '#5c7cfa', '#ff922b'];
export const colorOf = id => PALETTE[hash(id) % PALETTE.length];
const pick = arr => arr[Math.floor(Math.random() * arr.length)];

function el(tag, attrs, parent) {
  const e = document.createElementNS(NS, tag);
  for (const k in attrs || {}) e.setAttribute(k, attrs[k]);
  if (parent) parent.appendChild(e);
  return e;
}
function txt(parent, x, y, s, attrs) {
  const t = el('text', { x, y, 'text-anchor': 'middle', 'dominant-baseline': 'central', 'font-weight': 900, ...attrs }, parent);
  t.textContent = s; return t;
}
function toScreen(svg, x, y) { const p = svg.createSVGPoint(); p.x = x; p.y = y; const r = p.matrixTransform(svg.getScreenCTM()); return { x: r.x, y: r.y }; }
function toSvg(svg, x, y) { const p = svg.createSVGPoint(); p.x = x; p.y = y; const r = p.matrixTransform(svg.getScreenCTM().inverse()); return { x: r.x, y: r.y }; }
const esc = s => String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

// ── 소리 (Web Audio 로 직접 만든다 — 파일 없음) ──
let soundOn = true, actx = null;
export function setSound(v) { soundOn = !!v; }
function ac() { if (!soundOn) return null; try { actx ||= new (window.AudioContext || window.webkitAudioContext)(); if (actx.state === 'suspended') actx.resume(); return actx; } catch { return null; } }
function noiseSrc(a, dur, curve = 2) {
  const len = Math.max(1, Math.floor(a.sampleRate * dur)), buf = a.createBuffer(1, len, a.sampleRate), d = buf.getChannelData(0);
  for (let i = 0; i < len; i++) d[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / len, curve);
  const s = a.createBufferSource(); s.buffer = buf; return s;
}
function tone(freq, dur, vol, type = 'square', when = 0, toFreq) {
  const a = ac(); if (!a) return; const t = a.currentTime + when;
  const o = a.createOscillator(), g = a.createGain(); o.type = type; o.frequency.setValueAtTime(freq, t);
  if (toFreq) o.frequency.exponentialRampToValueAtTime(toFreq, t + dur);
  g.gain.setValueAtTime(vol, t); g.gain.exponentialRampToValueAtTime(0.001, t + dur);
  o.connect(g).connect(a.destination); o.start(t); o.stop(t + dur + 0.02);
}
export const sfx = {
  tick(f = 600) { tone(f + Math.random() * 300, 0.03, 0.06); },
  boom(vol = 1) {
    const a = ac(); if (!a) return; const t = a.currentTime;
    const src = noiseSrc(a, 0.6, 2.5), f = a.createBiquadFilter(), g = a.createGain();
    f.type = 'lowpass'; f.frequency.setValueAtTime(1400, t); f.frequency.exponentialRampToValueAtTime(120, t + 0.5);
    g.gain.setValueAtTime(0.9 * vol, t); g.gain.exponentialRampToValueAtTime(0.001, t + 0.6);
    src.connect(f).connect(g).connect(a.destination); src.start(t);
    tone(110, 0.4, 0.8 * vol, 'sine', 0, 38);
  },
  pop() {
    const a = ac(); if (!a) return; const t = a.currentTime;
    const src = noiseSrc(a, 0.14, 3), f = a.createBiquadFilter(), g = a.createGain();
    f.type = 'highpass'; f.frequency.value = 900; g.gain.setValueAtTime(0.8, t);
    src.connect(f).connect(g).connect(a.destination); src.start(t);
    tone(1300, 0.06, 0.1, 'triangle');
  },
  swish() {
    const a = ac(); if (!a) return; const t = a.currentTime;
    const src = noiseSrc(a, 0.25, 1), f = a.createBiquadFilter(), g = a.createGain();
    f.type = 'bandpass'; f.Q.value = 1.2; f.frequency.setValueAtTime(700, t); f.frequency.exponentialRampToValueAtTime(3200, t + 0.22);
    g.gain.setValueAtTime(0.35, t);
    src.connect(f).connect(g).connect(a.destination); src.start(t);
  },
  clack() { tone(170, 0.07, 0.18, 'square'); tone(120, 0.08, 0.12, 'square', 0.05); },
  hum(ms) {
    const a = ac(); if (!a) return; const t = a.currentTime, d = ms / 1000;
    const o = a.createOscillator(), f = a.createBiquadFilter(), g = a.createGain();
    o.type = 'sawtooth'; o.frequency.value = 62; f.type = 'lowpass'; f.frequency.value = 320;
    g.gain.setValueAtTime(0.0001, t); g.gain.linearRampToValueAtTime(0.07, t + 0.05); g.gain.setValueAtTime(0.07, t + Math.max(0.06, d - 0.06)); g.gain.linearRampToValueAtTime(0.0001, t + d);
    o.connect(f).connect(g).connect(a.destination); o.start(t); o.stop(t + d + 0.05);
  },
  chime() { tone(880, 0.18, 0.12, 'triangle'); tone(1320, 0.25, 0.12, 'triangle', 0.09); tone(1760, 0.3, 0.08, 'triangle', 0.18); },
  land() { tone(660, 0.09, 0.15, 'triangle'); tone(990, 0.14, 0.13, 'triangle', 0.07); },
};

// 남은 학생들을 차례로 반짝이다가 뽑힌 학생에서 멈추는 연출(공통)
async function hopper(items, chosen, ms, onHop) {
  if (ms <= 0 || items.length < 2) { onHop(chosen); return; }
  const t0 = performance.now(); let gap = 50;
  while (performance.now() - t0 < ms) { onHop(pick(items)); sfx.tick(); await sleep(gap); gap *= 1.09; }
  onHop(chosen);
}

// ════════════════════════════════════════
// 💥 대포
// ════════════════════════════════════════
function cannon() {
  let svg, mag, angle = -25;
  const PIVOT = { x: 100, y: 140 }, MUZZLE = 150;
  const setBarrel = a => { angle = a; svg.querySelector('#barrel').setAttribute('transform', `rotate(${a.toFixed(2)} ${PIVOT.x} ${PIVOT.y})`); };
  const muzzle = () => { const r = angle * Math.PI / 180; return { x: PIVOT.x + Math.cos(r) * MUZZLE, y: PIVOT.y + Math.sin(r) * MUZZLE }; };
  function smoke() {
    const g = svg.querySelector('#smoke'), m = muzzle();
    for (let i = 0; i < 5; i++) {
      const c = el('circle', { cx: m.x, cy: m.y, r: 6, fill: '#9ca3af', opacity: 0.6 }, g);
      const dx = (Math.random() - 0.3) * 50, dy = -10 - Math.random() * 35, rr = 10 + Math.random() * 12;
      tween(700 + i * 80, t => { c.setAttribute('cx', m.x + dx * t); c.setAttribute('cy', m.y + dy * t); c.setAttribute('r', 6 + rr * t); c.setAttribute('opacity', (0.55 * (1 - t)).toFixed(3)); }).then(() => c.remove());
    }
  }
  async function recoil() {
    const inner = svg.querySelector('#barrelInner'), flash = svg.querySelector('#flash');
    flash.setAttribute('opacity', '1'); smoke();
    await tween(90, t => inner.setAttribute('transform', `translate(${-14 * t} 0)`));
    flash.setAttribute('opacity', '0');
    await tween(220, t => inner.setAttribute('transform', `translate(${-14 * (1 - t)} 0)`));
  }
  return {
    id: 'cannon', name: '💥 대포', verb: '대포 발사', token: 'cannon',
    mount(box) {
      box.innerHTML = `<svg class="th-svg" viewBox="0 0 300 200">
        <defs>
          <linearGradient id="gBarrel" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#6b7280"/><stop offset="0.35" stop-color="#9ca3af"/><stop offset="1" stop-color="#374151"/></linearGradient>
          <radialGradient id="gWheel" cx="0.4" cy="0.35" r="0.7"><stop offset="0" stop-color="#b9824f"/><stop offset="1" stop-color="#6b3f1d"/></radialGradient>
          <radialGradient id="gFlash" cx="0.5" cy="0.5" r="0.5"><stop offset="0" stop-color="#fff8c2"/><stop offset="0.45" stop-color="#ffb13b"/><stop offset="1" stop-color="#ff5a1f" stop-opacity="0"/></radialGradient>
        </defs>
        <ellipse cx="105" cy="182" rx="95" ry="8" fill="currentColor" opacity="0.08"/>
        <g id="barrel" transform="rotate(-25 100 140)"><g id="barrelInner">
          <rect x="78" y="124" width="150" height="32" rx="12" fill="url(#gBarrel)"/>
          <rect x="214" y="119" width="20" height="42" rx="6" fill="#4b5563"/>
          <rect x="120" y="122" width="8" height="36" rx="3" fill="#4b5563"/>
          <rect x="160" y="123" width="8" height="34" rx="3" fill="#4b5563"/>
          <circle cx="80" cy="140" r="17" fill="#4b5563"/><circle cx="66" cy="140" r="7" fill="#374151"/>
          <g id="flash" opacity="0"><circle cx="252" cy="140" r="34" fill="url(#gFlash)"/><path d="M236 140l40-16-12 16 12 16Z" fill="#fff3b0" opacity="0.9"/></g>
        </g></g>
        <path d="M58 178 L92 128 L130 128 L150 178 Z" fill="#8b5a2b"/><path d="M58 178 L92 128 L100 128 L70 178 Z" fill="#a8723f"/>
        <circle cx="100" cy="140" r="7" fill="#d1d5db" stroke="#4b5563" stroke-width="2"/>
        <circle cx="112" cy="166" r="22" fill="url(#gWheel)" stroke="#4a2a12" stroke-width="3"/>
        <g stroke="#4a2a12" stroke-width="3" stroke-linecap="round"><path d="M112 146v40M92 166h40M98 152l28 28M126 152l-28 28"/></g>
        <circle cx="112" cy="166" r="5" fill="#d1d5db"/>
        <g id="smoke"></g>
      </svg><div class="mag"></div>`;
      svg = box.querySelector('svg'); mag = box.querySelector('.mag'); angle = -25;
    },
    update(items) {
      mag.innerHTML = items.map(s => `<span class="b" data-sid="${esc(s.id)}" title="${esc(s.name)}">${esc(s.label)}</span>`).join('');
    },
    async play({ items, chosen, fast, reduce, target }) {
      const balls = [...mag.querySelectorAll('.b')]; let last = null;
      const ball = id => mag.querySelector(`.b[data-sid="${CSS.escape(id)}"]`);
      await hopper(items, chosen, fast || reduce ? 0 : 900, s => { last?.classList.remove('hot'); last = ball(s.id); last?.classList.add('hot'); });
      if (!fast && balls.length) await sleep(250);
      if (target) {
        const p = toScreen(svg, PIVOT.x, PIVOT.y);
        const to = Math.max(-80, Math.min(80, Math.atan2(target.y - p.y, target.x - p.x) * 180 / Math.PI - 22)), from = angle;
        await tween(fast ? 90 : 320, t => setBarrel(from + (to - from) * E.inOut(t)));
      }
      ball(chosen.id)?.remove();
      sfx.boom(fast ? 0.45 : 1); recoil();
      const m = muzzle(); return toScreen(svg, m.x, m.y);
    },
  };
}

// ════════════════════════════════════════
// 🎰 캡슐 뽑기 기계
// ════════════════════════════════════════
function gacha() {
  let svg, layer, out, knob, pos = new Map();
  const C = { x: 150, y: 108, r: 80 };
  function layout(n) {
    for (let r = 16; r >= 6; r--) {
      const pts = [];
      for (let row = 0, y = C.y + C.r - r - 2; y > C.y - C.r + r; row++, y -= r * 1.72) {
        for (let x = C.x - C.r + r + (row % 2 ? r : 0); x < C.x + C.r - r; x += r * 2) if (Math.hypot(x - C.x, y - C.y) <= C.r - r - 1) pts.push({ x, y });
      }
      if (pts.length >= n) return { r, pts: pts.slice(0, n) };
    }
    return { r: 6, pts: Array.from({ length: n }, () => ({ x: C.x + (Math.random() - 0.5) * 100, y: C.y + Math.random() * 60 })) };
  }
  function capsule(parent, x, y, r, color, label) {
    const g = el('g', { transform: `translate(${x} ${y})` }, parent);
    el('circle', { r, fill: color, stroke: 'rgba(0,0,0,0.28)', 'stroke-width': 1.2 }, g);
    el('path', { d: `M ${-r} 0 A ${r} ${r} 0 0 0 ${r} 0 Z`, fill: '#fff' }, g);
    el('line', { x1: -r, y1: 0, x2: r, y2: 0, stroke: 'rgba(0,0,0,0.3)', 'stroke-width': 1 }, g);
    el('ellipse', { cx: -r * 0.35, cy: -r * 0.45, rx: r * 0.22, ry: r * 0.14, fill: '#fff', opacity: 0.6 }, g);
    txt(g, 0, r * 0.05, label, { 'font-size': r * 0.9, fill: '#222', stroke: '#fff', 'stroke-width': r * 0.18, 'paint-order': 'stroke' });
    return g;
  }
  return {
    id: 'gacha', name: '🎰 캡슐 뽑기', verb: '레버 돌리기', token: 'capsule',
    mount(box) {
      box.innerHTML = `<svg class="th-svg" viewBox="0 0 300 300">
        <defs>
          <radialGradient id="gDome" cx="0.35" cy="0.3" r="0.8"><stop offset="0" stop-color="#ffffff" stop-opacity="0.85"/><stop offset="0.55" stop-color="#d0ebff" stop-opacity="0.35"/><stop offset="1" stop-color="#74c0fc" stop-opacity="0.45"/></radialGradient>
          <clipPath id="cDome"><circle cx="150" cy="108" r="80"/></clipPath>
        </defs>
        <ellipse cx="150" cy="290" rx="105" ry="7" fill="currentColor" opacity="0.08"/>
        <rect x="126" y="14" width="48" height="16" rx="6" fill="#c92a2a"/>
        <circle cx="150" cy="108" r="85" fill="#c92a2a"/>
        <circle cx="150" cy="108" r="80" fill="#e7f5ff"/>
        <g id="caps" clip-path="url(#cDome)"></g>
        <circle cx="150" cy="108" r="80" fill="url(#gDome)"/>
        <path d="M92 66 A 72 72 0 0 1 140 38" stroke="#fff" stroke-width="7" fill="none" opacity="0.75" stroke-linecap="round"/>
        <path d="M68 180 H232 L246 286 H54 Z" fill="#e8432d"/>
        <path d="M68 180 H96 L84 286 H54 Z" fill="#ff6b4a" opacity="0.6"/>
        <rect x="60" y="174" width="180" height="14" rx="7" fill="#c92a2a"/>
        <rect x="88" y="198" width="66" height="28" rx="8" fill="#fff" opacity="0.94"/>
        <text x="121" y="213" text-anchor="middle" dominant-baseline="central" font-size="13" font-weight="900" fill="#e8432d">뽑기</text>
        <rect x="140" y="204" width="5" height="16" rx="2" fill="#adb5bd"/>
        <g id="knob"><circle cx="121" cy="256" r="20" fill="#ffd43b" stroke="#e0a800" stroke-width="3"/><rect x="105" y="252" width="32" height="8" rx="4" fill="#e0a800"/></g>
        <rect x="170" y="230" width="54" height="44" rx="10" fill="#2b2b2b"/><rect x="170" y="230" width="54" height="10" rx="5" fill="#495057"/>
        <g id="out"></g>
      </svg>`;
      svg = box.querySelector('svg'); layer = svg.querySelector('#caps'); out = svg.querySelector('#out'); knob = svg.querySelector('#knob');
    },
    update(items) {
      layer.innerHTML = ''; out.innerHTML = ''; pos = new Map();
      const order = [...items].sort((a, b) => hash(a.id) - hash(b.id));
      const { r, pts } = layout(order.length);
      order.forEach((s, i) => {
        const R = rng(hash(s.id)), p = { x: pts[i].x + (R() - 0.5) * r * 0.3, y: pts[i].y + (R() - 0.5) * r * 0.2 };
        pos.set(s.id, { ...p, r, g: capsule(layer, p.x, p.y, r, colorOf(s.id), s.label) });
      });
    },
    async play({ chosen, fast, reduce }) {
      const D = fast ? 0.25 : reduce ? 0.5 : 1, all = [...pos.values()], me = pos.get(chosen.id);
      let clicks = 0;
      await tween(1100 * D, t => {
        knob.setAttribute('transform', `rotate(${(E.inOut(t) * 720).toFixed(1)} 121 256)`);
        const amp = Math.sin(t * Math.PI) * (me.r * 0.35);
        all.forEach(p => p.g.setAttribute('transform', `translate(${p.x + (Math.random() - 0.5) * amp} ${p.y + (Math.random() - 0.5) * amp})`));
        const c = Math.floor(t * 8); if (c > clicks) { clicks = c; sfx.tick(260); }
      });
      all.forEach(p => p.g.setAttribute('transform', `translate(${p.x} ${p.y})`));
      layer.appendChild(me.g);
      await tween(420 * D, t => { const e = E.in(t); me.g.setAttribute('transform', `translate(${lerp(me.x, 150, e)} ${lerp(me.y, 186, e)}) scale(${1 - 0.4 * e})`); });
      me.g.remove();
      const big = capsule(out, 197, 226, 15, colorOf(chosen.id), chosen.label);
      await tween(450 * D, t => big.setAttribute('transform', `translate(197 ${lerp(226, 258, E.bounce(t))})`));
      sfx.clack();
      if (!fast) { await tween(260, t => big.setAttribute('transform', `translate(197 258) scale(${1 + 0.5 * E.outBack(t)})`)); await sleep(220); }
      const p = toScreen(svg, 197, 258); big.remove(); return p;
    },
  };
}

// ════════════════════════════════════════
// 🧸 인형뽑기 크레인
// ════════════════════════════════════════
function crane() {
  let svg, dolls, cable, head, pos = new Map(), clawX = 240, clawY = 64;
  const FLOOR = 236, LEFT = 38, RIGHT = 206, CHUTE = 240;
  function setClaw(x, y, open) {
    clawX = x; clawY = y;
    cable.setAttribute('x1', x); cable.setAttribute('x2', x); cable.setAttribute('y2', y);
    head.setAttribute('transform', `translate(${x} ${y})`);
    const a = open ? 28 : -4;
    head.querySelector('.pl').setAttribute('transform', `rotate(${a} -6 8)`);
    head.querySelector('.pr').setAttribute('transform', `rotate(${-a} 6 8)`);
  }
  function doll(parent, x, y, R, color, label) {
    const g = el('g', { transform: `translate(${x} ${y})` }, parent);
    for (const sx of [-1, 1]) { el('circle', { cx: sx * R * 0.64, cy: -R * 0.72, r: R * 0.4, fill: color }, g); el('circle', { cx: sx * R * 0.64, cy: -R * 0.72, r: R * 0.2, fill: '#fff', opacity: 0.45 }, g); }
    el('circle', { r: R, fill: color, stroke: 'rgba(0,0,0,0.18)', 'stroke-width': 1 }, g);
    el('ellipse', { cx: 0, cy: R * 0.3, rx: R * 0.55, ry: R * 0.38, fill: '#fff', opacity: 0.9 }, g);
    for (const sx of [-1, 1]) el('circle', { cx: sx * R * 0.34, cy: -R * 0.2, r: R * 0.11, fill: '#222' }, g);
    txt(g, 0, R * 0.32, label, { 'font-size': R * 0.6, fill: '#222' });
    return g;
  }
  function layout(n) {
    for (let R = 18; R >= 7; R--) {
      const per = Math.floor((RIGHT - LEFT) / (R * 2)), rows = Math.ceil(n / per);
      if (rows * R * 1.6 + R <= 125) return { R, per };
    }
    return { R: 7, per: Math.floor((RIGHT - LEFT) / 14) };
  }
  return {
    id: 'crane', name: '🧸 인형뽑기', verb: '인형 뽑기', token: 'plush',
    mount(box) {
      box.innerHTML = `<svg class="th-svg" viewBox="0 0 300 300">
        <ellipse cx="150" cy="294" rx="125" ry="5" fill="currentColor" opacity="0.08"/>
        <rect x="14" y="6" width="272" height="284" rx="18" fill="#f783ac"/>
        <rect x="14" y="6" width="272" height="284" rx="18" fill="none" stroke="#e64980" stroke-width="3"/>
        <rect x="84" y="13" width="132" height="22" rx="11" fill="#fff"/>
        <text x="150" y="24" text-anchor="middle" dominant-baseline="central" font-size="13" font-weight="900" fill="#d6336c">인형뽑기</text>
        <rect x="28" y="42" width="244" height="200" rx="10" fill="#f1f8ff" stroke="#fff" stroke-width="3"/>
        <line x1="36" y1="54" x2="264" y2="54" stroke="#868e96" stroke-width="4" stroke-linecap="round"/>
        <rect x="214" y="172" width="52" height="66" rx="6" fill="rgba(0,0,0,0.16)"/>
        <text x="240" y="186" text-anchor="middle" dominant-baseline="central" font-size="10" font-weight="800" fill="#495057">출구</text>
        <g id="dolls"></g>
        <rect x="28" y="42" width="244" height="200" rx="10" fill="#fff" opacity="0.12"/>
        <path d="M40 60 L80 60 L46 120 Z" fill="#fff" opacity="0.25"/>
        <line id="cable" x1="240" y1="54" x2="240" y2="64" stroke="#495057" stroke-width="2"/>
        <g id="head">
          <rect x="-11" y="-2" width="22" height="12" rx="3" fill="#495057"/>
          <path class="pl" d="M-6 8 Q-17 19 -9 31" stroke="#495057" stroke-width="4" fill="none" stroke-linecap="round"/>
          <path class="pr" d="M6 8 Q17 19 9 31" stroke="#495057" stroke-width="4" fill="none" stroke-linecap="round"/>
        </g>
        <rect x="28" y="250" width="244" height="32" rx="10" fill="#d6336c"/>
        <rect x="74" y="262" width="12" height="8" rx="3" fill="#868e96"/><line x1="80" y1="264" x2="80" y2="250" stroke="#495057" stroke-width="4" stroke-linecap="round"/><circle cx="80" cy="249" r="7" fill="#ff6b6b"/>
        <circle cx="222" cy="266" r="10" fill="#ffd43b" stroke="#e0a800" stroke-width="2"/>
      </svg>`;
      svg = box.querySelector('svg'); dolls = svg.querySelector('#dolls'); cable = svg.querySelector('#cable'); head = svg.querySelector('#head');
      setClaw(CHUTE, 64, false);
    },
    update(items) {
      dolls.innerHTML = ''; pos = new Map();
      const order = [...items].sort((a, b) => hash(a.id) - hash(b.id)), { R, per } = layout(order.length);
      order.forEach((s, i) => {
        const row = Math.floor(i / per), col = i % per, Rn = rng(hash(s.id));
        const x = Math.min(RIGHT - R, LEFT + R + col * R * 2 + (row % 2 ? R : 0) + (Rn() - 0.5) * R * 0.3), y = FLOOR - R - row * R * 1.6 + (Rn() - 0.5) * R * 0.2;
        pos.set(s.id, { x, y, R, g: doll(dolls, x, y, R, colorOf(s.id), s.label) });
      });
    },
    async play({ chosen, fast, reduce }) {
      const D = fast ? 0.25 : reduce ? 0.5 : 1, me = pos.get(chosen.id);
      const move = async (x, ms, open = false) => { const x0 = clawX; sfx.hum(ms); await tween(ms, t => setClaw(lerp(x0, x, E.inOut(t)), clawY, open)); };
      if (!fast) await move(LEFT + 20 + Math.random() * (RIGHT - LEFT - 40), 550);
      await move(me.x, 650 * D);
      setClaw(clawX, clawY, true); await sleep(120 * D);
      const downY = me.y - me.R - 22, y0 = clawY;
      sfx.hum(500 * D); await tween(500 * D, t => setClaw(clawX, lerp(y0, downY, E.inOut(t)), true));
      setClaw(clawX, downY, false); sfx.clack(); await sleep(180 * D);
      dolls.appendChild(me.g);
      const hold = (x, y, rot = 0) => me.g.setAttribute('transform', `translate(${x} ${y + me.R + 22}) rotate(${rot})`);
      sfx.hum(600 * D); await tween(600 * D, t => { const y = lerp(downY, 64, E.inOut(t)); setClaw(clawX, y, false); hold(clawX, y); });
      if (!fast) await tween(520, t => hold(clawX, 64, Math.sin(t * Math.PI * 4) * 14 * (1 - t)));
      const x0 = clawX; sfx.hum(600 * D);
      await tween(600 * D, t => { const x = lerp(x0, CHUTE, E.inOut(t)); setClaw(x, 64, false); hold(x, 64, Math.sin(t * Math.PI * 2) * 6); });
      setClaw(CHUTE, 64, true);
      await tween(300 * D, t => me.g.setAttribute('transform', `translate(${CHUTE} ${lerp(64 + me.R + 22, 222, E.in(t))})`));
      me.g.remove(); sfx.clack(); setClaw(CHUTE, 64, false);
      return toScreen(svg, CHUTE, 222);
    },
  };
}

// ════════════════════════════════════════
// 💳 포토카드 언박싱
// ════════════════════════════════════════
function photocard() {
  let svg, pack, stage, countText;
  return {
    id: 'card', name: '💳 포토카드', verb: '카드 뜯기', token: 'card',
    mount(box) {
      box.innerHTML = `<svg class="th-svg" viewBox="0 0 300 300">
        <defs>
          <linearGradient id="gPack" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#7950f2"/><stop offset="0.55" stop-color="#cc5de8"/><stop offset="1" stop-color="#f06595"/></linearGradient>
          <linearGradient id="gHolo" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#ff8787"/><stop offset="0.25" stop-color="#ffd43b"/><stop offset="0.5" stop-color="#69db7c"/><stop offset="0.75" stop-color="#4dabf7"/><stop offset="1" stop-color="#da77f2"/></linearGradient>
          <linearGradient id="gGold" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#fff3bf"/><stop offset="0.45" stop-color="#fab005"/><stop offset="1" stop-color="#e67700"/></linearGradient>
          <linearGradient id="gSheen" x1="0" y1="0" x2="1" y2="0"><stop offset="0" stop-color="#fff" stop-opacity="0"/><stop offset="0.5" stop-color="#fff" stop-opacity="0.7"/><stop offset="1" stop-color="#fff" stop-opacity="0"/></linearGradient>
          <clipPath id="cCard"><rect x="-50" y="-70" width="100" height="140" rx="9"/></clipPath>
        </defs>
        <ellipse cx="150" cy="268" rx="70" ry="7" fill="currentColor" opacity="0.08"/>
        <g id="pack">
          <rect x="104" y="72" width="110" height="170" rx="10" fill="#5f3dc4" opacity="0.35" transform="rotate(6 159 157)"/>
          <rect x="92" y="70" width="116" height="176" rx="10" fill="url(#gPack)"/>
          <path d="M92 150 L208 96 L208 120 L92 174 Z" fill="#fff" opacity="0.18"/>
          <g id="tear"><rect x="92" y="70" width="116" height="24" rx="10" fill="#fff" opacity="0.28"/><path d="M92 94 l8 -5 8 5 8 -5 8 5 8 -5 8 5 8 -5 8 5 8 -5 8 5 8 -5 8 5 8 -5 8 5" stroke="#fff" stroke-width="1.5" fill="none" opacity="0.8"/></g>
          <text x="150" y="146" text-anchor="middle" dominant-baseline="central" font-size="17" font-weight="900" fill="#fff" letter-spacing="1">SEAT</text>
          <text x="150" y="166" text-anchor="middle" dominant-baseline="central" font-size="17" font-weight="900" fill="#fff" letter-spacing="1">CARD</text>
          <text id="count" x="150" y="220" text-anchor="middle" dominant-baseline="central" font-size="11" font-weight="700" fill="#fff" opacity="0.9"></text>
        </g>
        <g id="stage"></g>
      </svg>`;
      svg = box.querySelector('svg'); pack = svg.querySelector('#pack'); stage = svg.querySelector('#stage'); countText = svg.querySelector('#count');
    },
    update(items) {
      stage.innerHTML = ''; pack.removeAttribute('transform'); pack.setAttribute('opacity', 1);
      svg.querySelector('#tear').removeAttribute('transform'); svg.querySelector('#tear').setAttribute('opacity', 1);
      countText.textContent = `남은 카드 ${items.length}장`;
    },
    async play({ chosen, fast, reduce }) {
      const D = fast ? 0.25 : reduce ? 0.5 : 1, tear = svg.querySelector('#tear');
      const rare = !fast && Math.random() < 1 / 6;
      await tween(320 * D, t => pack.setAttribute('transform', `rotate(${Math.sin(t * Math.PI * 4) * 4 * (1 - t)} 150 158)`));
      sfx.swish();
      await tween(380 * D, t => { tear.setAttribute('transform', `translate(${20 * t} ${-50 * t}) rotate(${-25 * t} 150 82)`); tear.setAttribute('opacity', 1 - t); });
      // 카드: 뒷면·앞면
      const card = el('g', {}, stage);
      const back = el('g', {}, card);
      el('rect', { x: -50, y: -70, width: 100, height: 140, rx: 9, fill: '#343a40', stroke: '#fff', 'stroke-width': 3 }, back);
      for (let i = 0; i < 5; i++) el('circle', { cx: 0, cy: 0, r: 10 + i * 11, fill: 'none', stroke: '#fff', opacity: 0.12, 'stroke-width': 2 }, back);
      txt(back, 0, 0, '?', { 'font-size': 40, fill: '#fff', opacity: 0.85 });
      const front = el('g', { display: 'none' }, card);
      el('rect', { x: -50, y: -70, width: 100, height: 140, rx: 9, fill: rare ? 'url(#gGold)' : 'url(#gHolo)' }, front);
      el('rect', { x: -44, y: -64, width: 88, height: 128, rx: 6, fill: '#fff' }, front);
      el('rect', { x: -44, y: -64, width: 88, height: 74, rx: 6, fill: colorOf(chosen.id), opacity: 0.22 }, front);
      txt(front, 0, -24, chosen.label, { 'font-size': 46, fill: colorOf(chosen.id), stroke: '#fff', 'stroke-width': 3, 'paint-order': 'stroke' });
      txt(front, 0, 30, chosen.name, { 'font-size': 15, fill: '#222' });
      txt(front, 0, 52, rare ? '★ RARE ★' : 'SEAT CARD', { 'font-size': 8, fill: rare ? '#e67700' : '#868e96', 'letter-spacing': 1 });
      const sheen = el('rect', { x: -120, y: -90, width: 50, height: 180, fill: 'url(#gSheen)', 'clip-path': 'url(#cCard)', transform: 'skewX(-18)' }, card);
      const put = (x, y, sx, sy = Math.abs(sx)) => card.setAttribute('transform', `translate(${x} ${y}) scale(${sx} ${sy})`);
      put(150, 160, 0.9);
      await tween(420 * D, t => { put(150, lerp(160, 92, E.out(t)), 0.9); pack.setAttribute('transform', `translate(0 ${90 * E.in(t)})`); pack.setAttribute('opacity', 1 - t); });
      await tween(300 * D, t => put(150, lerp(92, 140, E.inOut(t)), lerp(0.9, 1.3, E.inOut(t))));
      sfx.swish();
      await tween(170 * D, t => put(150, 140, 1.3 * (1 - t), 1.3));
      back.setAttribute('display', 'none'); front.removeAttribute('display');
      await tween(170 * D, t => put(150, 140, 1.3 * t, 1.3));
      if (rare) {
        sfx.chime();
        for (let i = 0; i < 10; i++) {
          const a = (i / 10) * Math.PI * 2, s = el('path', { d: 'M0 -6 L1.6 -1.6 L6 0 L1.6 1.6 L0 6 L-1.6 1.6 L-6 0 L-1.6 -1.6 Z', fill: '#fab005' }, stage);
          tween(700, t => { const d = 60 + 40 * E.out(t); s.setAttribute('transform', `translate(${150 + Math.cos(a) * d} ${140 + Math.sin(a) * d * 1.2}) scale(${1 - t * 0.6})`); s.setAttribute('opacity', 1 - t); }).then(() => s.remove());
        }
      }
      if (!fast) await tween(550, t => sheen.setAttribute('x', lerp(-120, 110, t)));
      if (!fast) await sleep(rare ? 650 : 380);
      const p = toScreen(svg, 150, 140); card.remove(); return p;
    },
  };
}

// ════════════════════════════════════════
// 📱 숏폼 스와이프
// ════════════════════════════════════════
function swipe() {
  let svg, strip, fx, H = 258, TOP = 22;
  function card(i, s, idle = false) {
    const g = el('g', { transform: `translate(0 ${TOP + i * H})` }, strip);
    const c = idle ? '#495057' : colorOf(s.id);
    el('rect', { x: 98, y: 0, width: 104, height: H, fill: c }, g);
    el('rect', { x: 98, y: H * 0.55, width: 104, height: H * 0.45, fill: '#000', opacity: 0.18 }, g);
    if (idle) {
      txt(g, 150, 108, '▶', { 'font-size': 30, fill: '#fff' });
      txt(g, 150, 146, s.label, { 'font-size': 12, fill: '#fff' });
      return;
    }
    txt(g, 150, 110, s.label, { 'font-size': 56, fill: '#fff', stroke: 'rgba(0,0,0,0.18)', 'stroke-width': 3, 'paint-order': 'stroke' });
    txt(g, 150, 158, s.name, { 'font-size': 15, fill: '#fff' });
    txt(g, 140, 232, '#자리배치 #오늘의자리', { 'font-size': 7, fill: '#fff', opacity: 0.85, 'font-weight': 700 });
  }
  return {
    id: 'swipe', name: '📱 숏폼 스와이프', verb: '스와이프', token: 'swipe',
    mount(box) {
      box.innerHTML = `<svg class="th-svg" viewBox="0 0 300 300">
        <defs><clipPath id="cScreen"><rect x="98" y="22" width="104" height="258" rx="14"/></clipPath></defs>
        <ellipse cx="150" cy="295" rx="70" ry="4" fill="currentColor" opacity="0.1"/>
        <rect x="91" y="8" width="118" height="286" rx="22" fill="#111"/>
        <rect x="98" y="22" width="104" height="258" rx="14" fill="#222"/>
        <g clip-path="url(#cScreen)">
          <g id="strip"></g>
          <text x="150" y="36" text-anchor="middle" dominant-baseline="central" font-size="8" font-weight="800" fill="#fff" opacity="0.85">팔로잉 · 추천</text>
          <g fill="#fff" opacity="0.92">
            <path d="M188 160 c-3 -4 -9 -2 -8 3 c1 3 5 6 8 8 c3 -2 7 -5 8 -8 c1 -5 -5 -7 -8 -3 Z"/>
            <circle cx="188" cy="186" r="6"/><path d="M182 210 l12 -5 -3 12 -3 -4 Z"/>
          </g>
        </g>
        <rect x="132" y="13" width="36" height="5" rx="2.5" fill="#333"/>
        <g id="fx"></g>
      </svg>`;
      svg = box.querySelector('svg'); strip = svg.querySelector('#strip'); fx = svg.querySelector('#fx');
    },
    update(items) {
      strip.innerHTML = ''; fx.innerHTML = ''; strip.removeAttribute('transform');
      card(0, { label: `남은 ${items.length}명` }, true);
    },
    async play({ items, chosen, fast, reduce }) {
      const seq = [];
      if (!fast && items.length > 1) for (let i = 0; i < (reduce ? 5 : 16); i++) seq.push(pick(items));
      seq.push(chosen);
      seq.forEach((s, i) => card(i + 1, s));
      const target = seq.length * H; let last = 0;
      await tween(fast ? 260 : reduce ? 900 : 2300, t => {
        const o = E.outQuart(t) * target; strip.setAttribute('transform', `translate(0 ${-o})`);
        const idx = Math.round(o / H); if (idx !== last) { last = idx; sfx.tick(800); }
      });
      if (!fast) {
        sfx.chime();
        for (let i = 0; i < 8; i++) {
          const h = el('path', { d: 'M0 3 C-6 -3 -12 4 0 12 C12 4 6 -3 0 3 Z', fill: pick(['#ff6b6b', '#f06595', '#ff8787', '#fff']) }, fx);
          const dx = (Math.random() - 0.5) * 60, dy = 90 + Math.random() * 70, s = 0.8 + Math.random() * 0.8;
          tween(900, t => { h.setAttribute('transform', `translate(${186 + dx * t} ${165 - dy * t}) scale(${s * (0.6 + t * 0.6)})`); h.setAttribute('opacity', 1 - t); }).then(() => h.remove());
        }
        const badge = el('g', {}, fx);
        el('rect', { x: -30, y: -12, width: 60, height: 24, rx: 12, fill: '#ff4d6d' }, badge);
        txt(badge, 0, 0, '확정!', { 'font-size': 12, fill: '#fff' });
        await tween(260, t => badge.setAttribute('transform', `translate(150 62) scale(${E.outBack(t)})`));
        await sleep(520);
      }
      return toScreen(svg, 150, 140);
    },
  };
}

// ════════════════════════════════════════
// 🎈 풍선 터뜨리기
// ════════════════════════════════════════
function balloons() {
  let svg, layer, aim, dart, fx, pos = new Map();
  function balloon(parent, x, y, R, color, label, delay) {
    const g = el('g', { transform: `translate(${x} ${y})` }, parent);
    const b = el('g', { class: 'bob', style: `animation-delay:${delay}s` }, g);
    el('path', { d: `M0 ${R} q ${R * 0.3} ${R * 0.45} 0 ${R * 0.9} t 0 ${R * 0.7}`, stroke: '#868e96', 'stroke-width': 1.2, fill: 'none' }, b);
    el('path', { d: `M${-R * 0.12} ${R * 1.05} L${R * 0.12} ${R * 1.05} L0 ${R * 0.92} Z`, fill: color }, b);
    el('ellipse', { rx: R * 0.86, ry: R, fill: color }, b);
    el('ellipse', { cx: -R * 0.32, cy: -R * 0.42, rx: R * 0.18, ry: R * 0.3, fill: '#fff', opacity: 0.5 }, b);
    txt(b, 0, R * 0.05, label, { 'font-size': R * 0.78, fill: '#fff', stroke: 'rgba(0,0,0,0.25)', 'stroke-width': R * 0.1, 'paint-order': 'stroke' });
    return g;
  }
  return {
    id: 'balloon', name: '🎈 풍선 터뜨리기', verb: '다트 던지기', token: 'balloon',
    mount(box) {
      box.innerHTML = `<svg class="th-svg" viewBox="0 0 300 300">
        <defs><linearGradient id="gSky" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#d0ebff"/><stop offset="1" stop-color="#fff4e6"/></linearGradient></defs>
        <rect x="6" y="6" width="288" height="288" rx="18" fill="url(#gSky)"/>
        <g fill="#fff" opacity="0.85"><ellipse cx="60" cy="40" rx="26" ry="9"/><ellipse cx="78" cy="34" rx="16" ry="9"/><ellipse cx="236" cy="268" rx="30" ry="9"/><ellipse cx="256" cy="262" rx="16" ry="8"/></g>
        <g id="balloons"></g>
        <g id="aim" display="none"><circle r="16" fill="none" stroke="#e8432d" stroke-width="2.5"/><path d="M0 -22 V-12 M0 12 V22 M-22 0 H-12 M12 0 H22" stroke="#e8432d" stroke-width="2.5" stroke-linecap="round"/></g>
        <g id="dart" display="none"><line x1="-28" y1="0" x2="0" y2="0" stroke="#495057" stroke-width="3" stroke-linecap="round"/><path d="M0 -4 L11 0 L0 4 Z" fill="#adb5bd"/><path d="M-28 0 L-36 -7 L-24 0 L-36 7 Z" fill="#e8432d"/></g>
        <g id="fx"></g>
      </svg>`;
      svg = box.querySelector('svg'); layer = svg.querySelector('#balloons'); aim = svg.querySelector('#aim'); dart = svg.querySelector('#dart'); fx = svg.querySelector('#fx');
    },
    update(items) {
      layer.innerHTML = ''; fx.innerHTML = ''; pos = new Map(); aim.setAttribute('display', 'none'); dart.setAttribute('display', 'none');
      const n = items.length; if (!n) return;
      const order = [...items].sort((a, b) => hash(a.id) - hash(b.id));
      const cols = Math.max(1, Math.ceil(Math.sqrt(n * 1.5))), rows = Math.ceil(n / cols);
      const cw = 264 / cols, ch = 222 / rows, R = Math.min(cw * 0.42, ch * 0.34, 30);
      order.forEach((s, i) => {
        const r = Math.floor(i / cols), c = i % cols, Rn = rng(hash(s.id));
        const x = Math.max(18 + R, Math.min(282 - R, 18 + cw * (c + 0.5) + (r % 2 ? cw * 0.22 : -cw * 0.1) + (Rn() - 0.5) * cw * 0.2));
        const y = 20 + R + ch * r + (Rn() - 0.5) * ch * 0.18;
        pos.set(s.id, { x, y, R, g: balloon(layer, x, y, R, colorOf(s.id), s.label, -(Rn() * 3).toFixed(2)) });
      });
    },
    async play({ items, chosen, fast, reduce }) {
      const me = pos.get(chosen.id), D = fast ? 0.35 : 1;
      if (!fast && !reduce) {
        aim.removeAttribute('display');
        await hopper(items, chosen, 1000, s => { const p = pos.get(s.id); if (p) aim.setAttribute('transform', `translate(${p.x} ${p.y}) scale(${p.R / 16 + 0.2})`); });
        await sleep(250);
      }
      // 풍선은 둥실 움직이므로 지금 실제 위치(화면)를 재서 다트를 보낸다
      const b = me.g.querySelector('ellipse').getBoundingClientRect(), at = toSvg(svg, b.left + b.width / 2, b.top + b.height / 2);
      const from = { x: 150, y: 300 }, ang = Math.atan2(at.y - from.y, at.x - from.x) * 180 / Math.PI;
      dart.removeAttribute('display'); sfx.swish();
      await tween(260 * D, t => dart.setAttribute('transform', `translate(${lerp(from.x, at.x, t)} ${lerp(from.y, at.y, t)}) rotate(${ang})`));
      me.g.setAttribute('display', 'none'); aim.setAttribute('display', 'none'); dart.setAttribute('display', 'none'); sfx.pop();
      const color = colorOf(chosen.id);
      for (let i = 0; i < 12; i++) {
        const a = Math.random() * Math.PI * 2, d = me.R * (1.2 + Math.random() * 1.6), sh = el('path', { d: 'M-3 -2 L3 -3 L2 3 Z', fill: i % 3 ? color : '#ffd43b' }, fx);
        tween(480, t => { const e = E.out(t); sh.setAttribute('transform', `translate(${at.x + Math.cos(a) * d * e} ${at.y + Math.sin(a) * d * e + 20 * t * t}) rotate(${t * 400})`); sh.setAttribute('opacity', 1 - t); }).then(() => sh.remove());
      }
      if (!fast) await sleep(180);
      return toScreen(svg, at.x, at.y);
    },
  };
}

export const THEMES = [cannon(), gacha(), crane(), photocard(), swipe(), balloons()];
