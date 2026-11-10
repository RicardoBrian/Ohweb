// AI 코딩 — 무대(캐릭터 하나 + 배경)와 블록 실행기. aicode.html이 쓴다.
// 좌표는 가운데가 (0,0), 가로 -240~240, 세로 -180~180. 방향 90 = 오른쪽.
// 블록 프로그램(ai-blocks.js compile 결과)은 async 함수 묶음이고, 아래 api만 부를 수 있다.

const W = 480, H = 360;
export const STOP = Symbol('stop');
const sleep = ms => new Promise(r => setTimeout(r, ms));
const frame = () => new Promise(r => requestAnimationFrame(() => r()));

// ── 소리(파일 없이 소리 만들기) ──
let _ac = null;
const _playing = new Set();
export function stopSounds() { for (const o of _playing) { try { o.stop(); } catch { /* 이미 끝남 */ } } _playing.clear(); }
function tone(seq, vol = 100) {
  try {
    _ac = _ac || new (window.AudioContext || window.webkitAudioContext)();
    let t0 = _ac.currentTime;
    const v = 0.18 * Math.max(0, Math.min(100, vol)) / 100;
    for (const [f, d, type = 'sine'] of seq) {
      const o = _ac.createOscillator(), g = _ac.createGain();
      o.type = type; o.frequency.value = f;
      g.gain.setValueAtTime(Math.max(v, 0.0001), t0); g.gain.exponentialRampToValueAtTime(0.0001, t0 + d);
      o.connect(g); g.connect(_ac.destination); o.start(t0); o.stop(t0 + d);
      _playing.add(o); o.onended = () => _playing.delete(o);
      t0 += d * 0.9;
    }
    return (t0 - _ac.currentTime) * 1000;
  } catch { return 0; }
}
export const SOUNDS = {
  beep: [[880, 0.18]], ding: [[988, 0.25], [784, 0.35]], pop: [[300, 0.08, 'square'], [600, 0.08, 'square']],
  fanfare: [[523, 0.15], [659, 0.15], [784, 0.15], [1047, 0.4]], buzz: [[160, 0.4, 'sawtooth']],
};

export class Stage {
  constructor(canvas) {
    this.cv = canvas; this.g = canvas.getContext('2d');
    canvas.width = W; canvas.height = H;
    this.reset();
    const loop = () => { this.draw(); this._raf = requestAnimationFrame(loop); };
    loop();
  }
  reset(emoji = this.emoji0 || '🐱') {
    this.emoji0 = emoji;
    this.sp = { x: 0, y: 0, dir: 90, size: 100, emoji, show: true, rot: 'all', fx: { color: 0, ghost: 0, brightness: 0 } };
    this.bubble = null; this.think = false; this.bg = '#ffffff';
    this.monitors = new Map();   // 변수 보이기: 이름 → () => 값
    if (!this.mouse) this.mouse = { x: 0, y: 0, down: false };
  }
  // 화면 좌표(캔버스 픽셀) → 무대 좌표
  toStage(px, py) {
    const r = this.cv.getBoundingClientRect();
    return { x: (px - r.left) / r.width * W - W / 2, y: H / 2 - (py - r.top) / r.height * H };
  }
  hit(px, py) {
    const p = this.toStage(px, py), s = this.sp;
    const rad = 34 * s.size / 100;
    return s.show && Math.abs(p.x - s.x) < rad && Math.abs(p.y - s.y) < rad;
  }
  draw() {
    const g = this.g, s = this.sp;
    g.fillStyle = this.bg; g.fillRect(0, 0, W, H);
    this.drawMonitors();
    if (!s.show) return;
    const cx = W / 2 + s.x, cy = H / 2 - s.y, fs = 64 * s.size / 100;
    g.save(); g.translate(cx, cy);
    if (s.rot === 'all') g.rotate((s.dir - 90) * Math.PI / 180);
    else if (s.rot === 'lr' && s.dir > 180) g.scale(-1, 1);
    g.globalAlpha = 1 - Math.max(0, Math.min(100, s.fx.ghost)) / 100;
    const fl = [];
    if (s.fx.color) fl.push(`hue-rotate(${Math.round(s.fx.color * 1.8)}deg)`);
    if (s.fx.brightness) fl.push(`brightness(${Math.max(0, 100 + Math.max(-100, Math.min(100, s.fx.brightness)))}%)`);
    if (fl.length) g.filter = fl.join(' ');
    g.font = `${fs}px "Apple Color Emoji","Segoe UI Emoji","Noto Color Emoji",sans-serif`;
    g.textAlign = 'center'; g.textBaseline = 'middle';
    g.fillText(s.emoji, 0, 0);
    g.restore();
    if (this.bubble) {
      const text = String(this.bubble).slice(0, 80);
      g.font = '600 17px "IBM Plex Sans KR",system-ui,sans-serif';
      const lines = wrap(g, text, 200);
      const bw = Math.max(...lines.map(l => g.measureText(l).width)) + 24, bh = lines.length * 22 + 16;
      let bx = Math.min(W - bw - 6, Math.max(6, cx + fs * 0.35)), by = Math.max(6, cy - fs * 0.6 - bh);
      g.fillStyle = '#fff'; g.strokeStyle = '#c9c9d1'; g.lineWidth = 2;
      roundRect(g, bx, by, bw, bh, this.think ? bh / 2 : 14); g.fill(); g.stroke();
      if (this.think) {   // 생각하기: 꼬리 대신 작은 동그라미
        for (const [k, r] of [[0.35, 6], [0.7, 4]]) { g.beginPath(); g.arc(bx + 18 + (cx - bx - 18) * k, by + bh + 4 + 14 * k, r, 0, Math.PI * 2); g.fill(); g.stroke(); }
      } else { g.beginPath(); g.moveTo(bx + 18, by + bh - 1); g.lineTo(Math.max(bx + 8, cx), Math.min(H, by + bh + 14)); g.lineTo(bx + 34, by + bh - 1); g.closePath(); g.fill(); }
      g.fillStyle = '#1c1c1f'; g.textAlign = 'left'; g.textBaseline = 'top';
      lines.forEach((l, i) => g.fillText(l, bx + 12, by + 9 + i * 22));
    }
  }
}
Stage.prototype.drawMonitors = function () {
  if (!this.monitors.size) return;
  const g = this.g; let y = 8;
  g.font = '600 13px "IBM Plex Sans KR",system-ui,sans-serif'; g.textBaseline = 'middle'; g.textAlign = 'left';
  for (const [name, get] of this.monitors) {
    let v; try { v = get(); } catch { v = ''; }
    if (Array.isArray(v)) v = v.join(' ');
    const val = String(v ?? '').slice(0, 30), nw = g.measureText(name).width, vw = Math.max(24, g.measureText(val).width);
    g.fillStyle = 'rgba(255,255,255,.92)'; g.strokeStyle = '#c9c9d1'; g.lineWidth = 1;
    roundRect(g, 8, y, nw + vw + 30, 24, 6); g.fill(); g.stroke();
    g.fillStyle = '#333'; g.fillText(name, 14, y + 12);
    g.fillStyle = '#FF8C1A'; roundRect(g, nw + 20, y + 3, vw + 12, 18, 9); g.fill();
    g.fillStyle = '#fff'; g.fillText(val, nw + 26, y + 12);
    y += 30;
  }
};
function roundRect(g, x, y, w, h, r) { g.beginPath(); g.moveTo(x + r, y); g.arcTo(x + w, y, x + w, y + h, r); g.arcTo(x + w, y + h, x, y + h, r); g.arcTo(x, y + h, x, y, r); g.arcTo(x, y, x + w, y, r); g.closePath(); }
function wrap(g, text, max) {
  const out = []; let line = '';
  for (const ch of [...text]) {
    if (g.measureText(line + ch).width > max && line) { out.push(line); line = ch.trim() ? ch : ''; } else line += ch;
  }
  if (line) out.push(line);
  return out.slice(0, 4);
}

// ── 실행기 ──
// opts: { stage, ask(q) → Promise<string>, classify(kind, arg) → Promise<result>, nameOf(id), camera(on), inputs: [], onResult(res), onState(running) }
// result: { probs: {id: p} } (분류) | { value: 숫자 } (예측)
export class Runtime {
  constructor(opts) {
    this.o = opts; this.stopped = true; this.running = new Set(); this.prog = null;
    this.res = null; this.answer = ''; this.inputs = (opts.inputs || []).slice();
    this.keys = new Set(); this.t0 = Date.now(); this.vol = 100;
  }
  api() {
    const R = this, S = () => R.o.stage.sp;
    const num = v => { const n = Number(v); return Number.isFinite(n) ? n : 0; };
    const clamp = () => { const s = S(); s.x = Math.max(-W / 2, Math.min(W / 2, s.x)); s.y = Math.max(-H / 2, Math.min(H / 2, s.y)); };
    return {
      check() { if (R.stopped) throw STOP; },
      async tick() { if (R.stopped) throw STOP; await frame(); if (R.stopped) throw STOP; },
      async wait(sec) {
        const end = Date.now() + Math.max(0, Math.min(60, num(sec))) * 1000;
        while (Date.now() < end) { if (R.stopped) throw STOP; await sleep(Math.min(50, end - Date.now())); }
        if (R.stopped) throw STOP;
      },
      say(text) { R.o.stage.think = false; R.o.stage.bubble = text === '' || text == null ? null : String(text); },
      async sayFor(text, sec, think = false) { const b = String(text); this.say(b); R.o.stage.think = !!think; await this.wait(sec); if (R.o.stage.bubble === b) R.o.stage.bubble = null; },
      move(n) { const s = S(), a = (90 - s.dir) * Math.PI / 180; s.x += num(n) * Math.cos(a); s.y += num(n) * Math.sin(a); clamp(); },
      turn(d) { const s = S(); s.dir = ((s.dir + num(d)) % 360 + 360) % 360; },
      goTo(x, y) { const s = S(); s.x = num(x); s.y = num(y); clamp(); },
      changeX(d) { S().x += num(d); clamp(); },
      changeY(d) { S().y += num(d); clamp(); },
      costume(e) { S().emoji = String(e || '🐱'); },
      size(p) { S().size = Math.max(10, Math.min(400, num(p))); },
      changeSize(d) { S().size = Math.max(10, Math.min(400, S().size + num(d))); },
      bg(c) { R.o.stage.bg = /^#[0-9a-f]{6}$/i.test(c) ? c : '#ffffff'; },
      show(on) { S().show = !!on; },
      async sound(name) { const ms = tone(SOUNDS[name] || SOUNDS.beep, R.vol); await sleep(Math.min(ms, 50)); },
      async ask(q) { R.o.stage.bubble = String(q || ''); const a = await R.o.ask(String(q || '')); R.o.stage.bubble = null; if (R.stopped) throw STOP; R.answer = a; },
      answer() { return R.answer; },
      camera(on) { if (R.o.camera) R.o.camera(!!on); },
      async askImage() { return R.classify('image'); },
      async askText(txt) { return R.classify('text', String(txt == null ? '' : txt)); },
      async askTable() { return R.classify('table', R.inputs.slice()); },
      setInput(i, v) { R.inputs[i] = v; R.o.onInputs && R.o.onInputs(R.inputs); },
      inputValue(i) { return R.inputs[i]; },
      result() {
        const r = R.res; if (!r) return '';
        if (r.value != null) return Math.round(r.value * 100) / 100;
        const id = topOf(r.probs); return id ? R.o.nameOf(id) : '';
      },
      isResult(id) { return !!(R.res && R.res.probs && topOf(R.res.probs) === id); },
      prob(id) { return R.res && R.res.probs ? Math.round((R.res.probs[id] || 0) * 100) : 0; },
      stopAll() { R.stop(); throw STOP; },
      // ── 스크래치 기본 블록 ──
      turnLeft(d) { this.turn(-num(d)); },
      goToTarget(t) { const p = R.target(t); this.goTo(p.x, p.y); },
      async glide(sec, x, y) {
        const s = S(), x0 = s.x, y0 = s.y, x1 = num(x), y1 = num(y), ms = Math.max(0, Math.min(60, num(sec))) * 1000, st = Date.now();
        while (true) {
          if (R.stopped) throw STOP;
          const k = ms ? Math.min(1, (Date.now() - st) / ms) : 1;
          s.x = x0 + (x1 - x0) * k; s.y = y0 + (y1 - y0) * k; clamp();
          if (k >= 1) break;
          await frame();
        }
      },
      async glideTarget(sec, t) { const p = R.target(t); await this.glide(sec, p.x, p.y); },
      pointDir(d) { const s = S(); s.dir = ((num(d) % 360) + 360) % 360; },
      pointMouse() { const s = S(), m = R.o.stage.mouse; s.dir = ((Math.atan2(m.x - s.x, m.y - s.y) * 180 / Math.PI) + 360) % 360; },
      setX(v) { S().x = num(v); clamp(); },
      setY(v) { S().y = num(v); clamp(); },
      bounce() {
        const s = S(), r = 30 * s.size / 100;
        if (s.x > W / 2 - r || s.x < -W / 2 + r) { s.dir = (360 - s.dir) % 360; s.x = Math.max(-W / 2 + r, Math.min(W / 2 - r, s.x)); }
        if (s.y > H / 2 - r || s.y < -H / 2 + r) { s.dir = (540 - s.dir) % 360; s.y = Math.max(-H / 2 + r, Math.min(H / 2 - r, s.y)); }
      },
      rotStyle(v) { S().rot = ['all', 'lr', 'none'].includes(v) ? v : 'all'; },
      xPos() { return Math.round(S().x); },
      yPos() { return Math.round(S().y); },
      direction() { return Math.round(S().dir); },
      think(text) { this.say(text); R.o.stage.think = true; },
      async thinkFor(text, sec) { await this.sayFor(text, sec, true); },
      nextCostume(list) { const s = S(), i = list.indexOf(s.emoji); s.emoji = list[(i + 1) % list.length]; },
      costumeNum(list) { return list.indexOf(S().emoji) + 1; },
      nextBg(list) { const st = R.o.stage, i = list.indexOf(st.bg); st.bg = list[(i + 1) % list.length]; },
      bgNum(list) { return list.indexOf(R.o.stage.bg) + 1; },
      changeFx(k, d) { const fx = S().fx; if (k in fx) fx[k] += num(d); },
      setFx(k, v) { const fx = S().fx; if (k in fx) fx[k] = num(v); },
      clearFx() { S().fx = { color: 0, ghost: 0, brightness: 0 }; },
      sizeVal() { return Math.round(S().size); },
      async soundWait(name) { const ms = tone(SOUNDS[name] || SOUNDS.beep, R.vol); await this.wait(ms / 1000); },
      stopSounds() { stopSounds(); },
      setVol(v) { R.vol = Math.max(0, Math.min(100, num(v))); },
      changeVol(d) { this.setVol(R.vol + num(d)); },
      volume() { return R.vol; },
      async waitUntil(cond) { while (!cond()) { if (R.stopped) throw STOP; await frame(); } if (R.stopped) throw STOP; },
      touching(what) {
        const s = S(), r = 30 * s.size / 100;
        if (!s.show) return false;
        if (what === 'edge') return s.x > W / 2 - r || s.x < -W / 2 + r || s.y > H / 2 - r || s.y < -H / 2 + r;
        const m = R.o.stage.mouse; return Math.abs(m.x - s.x) < r && Math.abs(m.y - s.y) < r;
      },
      distMouse() { const s = S(), m = R.o.stage.mouse; return Math.round(Math.hypot(m.x - s.x, m.y - s.y) * 100) / 100; },
      keyDown(k) { return k === 'any' ? R.keys.size > 0 : R.keys.has(k); },
      mouseDown() { return !!R.o.stage.mouse.down; },
      mouseX() { return Math.round(R.o.stage.mouse.x); },
      mouseY() { return Math.round(R.o.stage.mouse.y); },
      timer() { return Math.round((Date.now() - R.t0) / 100) / 10; },
      resetTimer() { R.t0 = Date.now(); },
      current(k) {
        const d = new Date();
        return { year: d.getFullYear(), month: d.getMonth() + 1, date: d.getDate(), day: d.getDay() + 1, hour: d.getHours(), minute: d.getMinutes(), second: d.getSeconds() }[k] ?? 0;
      },
      async broadcast(msg, wait) { const ps = R.fire('msg:' + String(msg)); if (wait) await Promise.all(ps); if (R.stopped) throw STOP; },
      cmp(a, op, b) {
        const isNum = x => typeof x === 'number' || (typeof x === 'string' && x.trim() !== '' && Number.isFinite(Number(x)));
        let d;
        if (isNum(a) && isNum(b)) d = Number(a) - Number(b);
        else { const x = String(a ?? '').toLowerCase(), y = String(b ?? '').toLowerCase(); d = x < y ? -1 : x > y ? 1 : 0; }
        return { '=': d === 0, '!=': d !== 0, '<': d < 0, '<=': d <= 0, '>': d > 0, '>=': d >= 0 }[op] ?? false;
      },
      letterOf(i, s) { return [...String(s ?? '')][Math.floor(num(i)) - 1] ?? ''; },
      lengthOf(s) { return [...String(s ?? '')].length; },
      contains(a, b) { return String(a ?? '').toLowerCase().includes(String(b ?? '').toLowerCase()); },
      showVar(name, get) { R.o.stage.monitors.set(String(name), get); },
      hideVar(name) { R.o.stage.monitors.delete(String(name)); },
    };
  }
  // AI에게 묻기: 결과를 저장하고 "AI 결과가 나왔을 때" 블록들을 깨운다.
  async classify(kind, arg) {
    if (this.stopped) throw STOP;
    const r = await this.o.classify(kind, arg);
    if (this.stopped) throw STOP;
    if (r) this.setResult(r);
    return r;
  }
  setResult(r) {
    this.res = r;
    this.o.onResult && this.o.onResult(r);
    if (!this.stopped) this.fire('result');
  }
  fire(ev) {
    if (!this.prog) return [];
    const set = this.running, api = this._api, out = [];
    for (const fn of this.prog[ev] || []) {
      if (set.has(fn)) continue;   // 이미 도는 중이면 겹쳐 돌리지 않는다
      set.add(fn);
      this.o.onState && this.o.onState(true);
      out.push(Promise.resolve().then(() => fn(api)).catch(e => { if (e !== STOP) { console.warn('[block]', e); this.o.onError && this.o.onError(e); } })
        .finally(() => { set.delete(fn); if (set === this.running) this.o.onState && this.o.onState(set.size > 0 && !this.stopped); }));
    }
    return out;
  }
  // 무대 좌표: 'random' 아무 곳, 'mouse' 마우스 위치
  target(t) {
    if (t === 'mouse') return { ...this.o.stage.mouse };
    return { x: Math.round(Math.random() * (W - 40) - W / 2 + 20), y: Math.round(Math.random() * (H - 40) - H / 2 + 20) };
  }
  // factory: ai-blocks.js build() 결과. 시작할 때마다 새 api로 프로그램을 만든다(변수도 처음부터).
  start(factory) {
    this.stop();
    this.stopped = false; this.answer = ''; this.running = new Set(); this.t0 = Date.now(); this.vol = 100;
    this.o.stage.reset();
    this._api = this.api();
    this.prog = factory(this._api);
    this.fire('start');
  }
  click() { if (!this.stopped) this.fire('click'); }
  stageClick() { if (!this.stopped) this.fire('stage'); }
  // 키: 'space' 'up' 'down' 'left' 'right' 'a'~'z' '0'~'9'
  key(k, down) {
    if (down) { const first = !this.keys.has(k); this.keys.add(k); if (first && !this.stopped) { this.fire('key:' + k); this.fire('key:any'); } }
    else this.keys.delete(k);
  }
  stop() { stopSounds(); this.stopped = true; this.o.stage.bubble = null; this.o.cancelAsk && this.o.cancelAsk(); this.o.onState && this.o.onState(false); }
}
function topOf(probs) {
  let best = '', bp = -1;
  for (const [id, p] of Object.entries(probs || {})) if (p > bp) { bp = p; best = id; }
  return best;
}
