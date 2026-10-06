// AI 실험실 사진 처리(브라우저 전용).
// 넣는 순간 브라우저에서 줄여서 저장한다 — 티처블머신은 학습할 때 사진을
// 224×224로 줄여 쓰므로 그보다 크게 둘 이유가 없다. webp·avif·투명 png도
// 여기서 전부 JPG로 바뀌어서, 티처블머신에 안 올라가는 형식 문제도 사라진다.

import { extractImageUrl } from './ai-core.js';

export const TRAIN_MAX = 512;   // 학습용(드라이브): 긴 변 512px
export const THUMB = 96;        // 미리보기(Firestore): 96px 정사각형
export const EVAL = 224;        // 평가용(Firestore): 티처블머신 입력과 같은 224px 정사각형
export const MIN_SIDE = 120;    // 이보다 작으면 검색 결과 썸네일을 복사한 것

async function decode(blob) {
  if (globalThis.createImageBitmap) {
    try { return await createImageBitmap(blob); } catch { /* 아래 방식으로 다시 */ }
  }
  const url = URL.createObjectURL(blob);
  try {
    const img = new Image();
    img.decoding = 'async';
    img.src = url;
    await img.decode();
    return img;
  } finally { URL.revokeObjectURL(url); }
}

function canvasOf(w, h) {
  const c = document.createElement('canvas');
  c.width = w; c.height = h;
  const g = c.getContext('2d');
  g.fillStyle = '#fff';           // 투명 png는 흰 배경으로
  g.fillRect(0, 0, w, h);
  g.imageSmoothingQuality = 'high';
  return [c, g];
}

const toBlob = (c, q) => new Promise((res, rej) => c.toBlob(b => (b ? res(b) : rej(new Error('encode'))), 'image/jpeg', q));

// 가운데 정사각형으로 잘라 size×size로 — 티처블머신(cropTo)과 같은 방식.
function squareCanvas(img, size) {
  const w = img.width, h = img.height, s = Math.min(w, h);
  const [c, g] = canvasOf(size, size);
  g.drawImage(img, (w - s) / 2, (h - s) / 2, s, s, 0, 0, size, size);
  return c;
}

async function sha(blob) {
  const buf = await blob.arrayBuffer();
  const d = await crypto.subtle.digest('SHA-256', buf);
  return Array.from(new Uint8Array(d).slice(0, 12), b => b.toString(16).padStart(2, '0')).join('');
}

// 같은 사진 판별용 지문: 16×16 흑백으로 줄인 픽셀값의 해시. 같은 사진을
// 다른 크기로 다시 복사해도 대부분 같은 지문이 나온다.
function fingerprint(img) {
  const [c, g] = canvasOf(16, 16);
  g.drawImage(img, 0, 0, 16, 16);
  const d = g.getImageData(0, 0, 16, 16).data;
  const gray = [];
  for (let i = 0; i < d.length; i += 4) gray.push((d[i] * 299 + d[i + 1] * 587 + d[i + 2] * 114) / 1000);
  const avg = gray.reduce((a, b) => a + b, 0) / gray.length;
  let bits = '';
  for (const v of gray) bits += v >= avg ? '1' : '0';
  let hex = '';
  for (let i = 0; i < bits.length; i += 4) hex += parseInt(bits.slice(i, i + 4), 2).toString(16);
  return hex;
}

// kind: 'train' → 512px JPG(드라이브용) + 96px 미리보기
//       'test'  → 224px 정사각형(평가용, Firestore) + 96px 미리보기
export async function prepareImage(blob, kind = 'train') {
  if (!blob || !/^image\//.test(blob.type || 'image/')) throw new Error('notImage');
  let img;
  try { img = await decode(blob); } catch { throw new Error('notImage'); }
  const w = img.width, h = img.height;
  if (!w || !h) throw new Error('notImage');
  if (Math.min(w, h) < MIN_SIDE) throw new Error('tooSmall');

  const thumb = squareCanvas(img, THUMB).toDataURL('image/jpeg', 0.6);
  const fp = fingerprint(img);
  if (kind === 'test') {
    const evalImg = squareCanvas(img, EVAL).toDataURL('image/jpeg', 0.8);
    if (img.close) img.close();
    return { kind, thumb, evalImg, fp, w, h };
  }
  const scale = Math.min(1, TRAIN_MAX / Math.max(w, h));
  const [c, g] = canvasOf(Math.round(w * scale), Math.round(h * scale));
  g.drawImage(img, 0, 0, c.width, c.height);
  if (img.close) img.close();
  const out = await toBlob(c, 0.8);
  return { kind, blob: out, thumb, fp, hash: await sha(out), w: c.width, h: c.height };
}

export function blobToBase64(blob) {
  return new Promise((res, rej) => {
    const r = new FileReader();
    r.onload = () => res(String(r.result).split(',')[1]);
    r.onerror = rej;
    r.readAsDataURL(blob);
  });
}

export function dataUrlToBlob(dataUrl) {
  const [head, b64] = String(dataUrl).split(',');
  const mime = (head.match(/data:([^;]+)/) || [])[1] || 'image/jpeg';
  const bin = atob(b64);
  const arr = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) arr[i] = bin.charCodeAt(i);
  return new Blob([arr], { type: mime });
}

// 끌어놓기·붙여넣기에서 사진 꺼내기. 파일이 오면 파일을, 구글 이미지처럼
// 주소만 오면 주소를 돌려준다(주소는 서버를 거쳐 받아온다).
export function extractFromTransfer(dt) {
  const files = [];
  const urls = [];
  if (!dt) return { files, urls };
  for (const f of Array.from(dt.files || [])) if (/^image\//.test(f.type)) files.push(f);
  if (!files.length && dt.items) {
    for (const it of Array.from(dt.items)) {
      if (it.kind === 'file') { const f = it.getAsFile(); if (f && /^image\//.test(f.type)) files.push(f); }
    }
  }
  if (!files.length) {
    const html = dt.getData && dt.getData('text/html');
    let u = '';
    if (html) {
      const m = html.match(/<img[^>]+src="([^"]+)"/i);
      if (m) u = m[1].replace(/&amp;/g, '&');
    }
    if (!u && dt.getData) u = dt.getData('text/uri-list') || dt.getData('text/plain') || '';
    const clean = extractImageUrl(u);
    if (clean) urls.push(clean);
  }
  return { files, urls };
}

// 주소로 사진 가져오기 — data: 주소는 바로, 나머지는 우리 서버(/api/img-proxy)를
// 거친다(다른 사이트 사진은 브라우저가 직접 못 읽는다).
export async function fetchImageUrl(url) {
  if (/^data:image\//i.test(url)) return dataUrlToBlob(url);
  const r = await fetch('/api/img-proxy', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ url }),
  });
  const type = r.headers.get('Content-Type') || '';
  if (!r.ok || !type.startsWith('image/')) throw new Error('fetchFail');
  return await r.blob();
}

// 선택한 파일·붙여넣은 사진을 받아 처리 함수에 넘기는 입력칸을 만든다.
// 붙여넣기는 "마지막으로 누른 칸"으로 간다.
// 화면이 다시 그려져도(짝의 사진이 들어올 때마다 그린다) 고른 칸을 잃지 않도록
// 칸의 이름(data-zone)을 기억했다가 새로 그려진 같은 칸을 다시 고른다.
let _activeZone = null;
let _activeKey = '';
const _zones = new Set();
export function bindDropZone(el, onBlobs) {
  const zone = { el, onBlobs };
  _zones.add(zone);
  const activate = () => {
    _activeZone = zone;
    _activeKey = el.dataset.zone || '';
    _zones.forEach(z => z.el.classList.toggle('active', z === zone));
  };
  if (_activeKey && el.dataset.zone === _activeKey) { _activeZone = zone; el.classList.add('active'); }
  el.addEventListener('click', activate);
  el.addEventListener('focus', activate);
  el.addEventListener('dragover', e => { e.preventDefault(); el.classList.add('drag'); });
  el.addEventListener('dragleave', () => el.classList.remove('drag'));
  el.addEventListener('drop', e => {
    e.preventDefault();
    el.classList.remove('drag');
    activate();
    const { files, urls } = extractFromTransfer(e.dataTransfer);
    onBlobs(files, urls);
  });
  return () => { _zones.delete(zone); if (_activeZone === zone) _activeZone = null; };
}
export function clearZones() { _zones.clear(); _activeZone = null; }
export function forgetActiveZone() { _activeKey = ''; _activeZone = null; }

if (globalThis.window) {
  window.addEventListener('paste', e => {
    if (!_activeZone || !document.body.contains(_activeZone.el)) return;
    const t = e.target;
    if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA') && !_activeZone.el.contains(t)) return;
    const { files, urls } = extractFromTransfer(e.clipboardData);
    if (files.length || urls.length) { e.preventDefault(); _activeZone.onBlobs(files, urls); }
  });
}
