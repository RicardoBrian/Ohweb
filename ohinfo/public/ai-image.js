// AI 실험실 사진 처리(브라우저 전용).
// 넣는 순간 브라우저에서 줄여서 저장한다 — 티처블머신은 학습할 때 사진을
// 224×224로 줄여 쓰지만, 너무 작게 저장하면 그 224px에서도 화질이 떨어져서
// 768px·품질 90%를 쓴다(아래 TRAIN_MAX). webp·avif·투명 png도 여기서 전부
// JPG로 바뀌어서, 티처블머신에 안 올라가는 형식 문제도 사라진다.

import { extractImageUrl } from './ai-core.js';

// 화질과 용량의 중간: 768px·품질 90%(장당 약 85KB). 512px·80%보다 224px로 줄였을 때
// 원본에 더 가깝다(합성 사진 측정 PSNR 31→34dB). 한 반 전체 약 80MB.
export const TRAIN_MAX = 768;   // 학습용(드라이브): 긴 변 768px
export const TRAIN_Q = 0.9;
export const SMALL_SIDE = 224;  // 짧은 쪽이 이보다 작으면 "작은 사진"(썸네일) — 넣되 알려 준다
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
    const evalImg = squareCanvas(img, EVAL).toDataURL('image/jpeg', 0.9);
    if (img.close) img.close();
    return { kind, thumb, evalImg, fp, w, h, small: Math.min(w, h) < SMALL_SIDE };
  }
  const scale = Math.min(1, TRAIN_MAX / Math.max(w, h));
  const [c, g] = canvasOf(Math.round(w * scale), Math.round(h * scale));
  g.drawImage(img, 0, 0, c.width, c.height);
  if (img.close) img.close();
  const out = await toBlob(c, TRAIN_Q);
  return { kind, blob: out, thumb, fp, hash: await sha(out), w: c.width, h: c.height, small: Math.min(w, h) < SMALL_SIDE };
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

// 끌어놓기·붙여넣기에서 사진 꺼내기.
// 파일이 오면 파일을 쓰고, 구글 이미지처럼 주소만 오면 "사진 한 장"의 후보 주소들을
// 좋은 순서로 돌려준다(원본 → 큰 사진 → 썸네일 → 사진 데이터). 하나씩 시도해서
// 처음 성공한 것을 쓴다 — 원본 사이트가 막혀 있어도 썸네일로라도 들어가게.
const IMG_EXT = /\.(jpe?g|png|webp|gif|bmp|avif)(\?|#|$)/i;
const isThumb = u => /^https:\/\/encrypted-tbn\d*\.gstatic\.com\//i.test(u);
export function imageCandidates(dt) {
  const get = k => { try { return (dt.getData && dt.getData(k)) || ''; } catch { return ''; } };
  const html = get('text/html');
  const raw = [];
  if (html) {
    for (const m of html.matchAll(/<img[^>]+src="([^"]+)"/gi)) raw.push({ u: m[1].replace(/&amp;/g, '&'), from: 'img' });
    for (const m of html.matchAll(/<a[^>]+href="([^"]+)"/gi)) raw.push({ u: m[1].replace(/&amp;/g, '&'), from: 'a' });
  }
  for (const line of get('text/uri-list').split(/\r?\n/)) if (line && !line.startsWith('#')) raw.push({ u: line.trim(), from: 'uri' });
  const plain = get('text/plain').trim();
  if (plain && !/\s/.test(plain)) raw.push({ u: plain, from: 'uri' });

  const scored = [];
  const seen = new Set();
  const add = (u, score) => { if (u && !seen.has(u)) { seen.add(u); scored.push({ u, score }); } };
  for (const { u, from } of raw) {
    // google.com/imgres?imgurl=원본 → 원본이 가장 좋다
    try {
      const url = new URL(u, 'https://www.google.com');
      const inner = /(^|\.)google\./i.test(url.hostname) && url.searchParams.get('imgurl');
      if (inner) { add(extractImageUrl(inner), 0); continue; }
    } catch { /* 주소가 아니면 아래에서 거른다 */ }
    const clean = extractImageUrl(u);
    if (!clean) continue;
    if (clean.startsWith('data:image/')) add(clean, 4);
    else if (isThumb(clean)) add(clean, 3);
    else if (from === 'img') add(clean, 1);
    else if (IMG_EXT.test(clean)) add(clean, 2);
    else if (from === 'uri') add(clean, 5);        // 사진 주소인지 모르는 링크(마지막 수단)
  }
  return scored.sort((a, b) => a.score - b.score).map(x => x.u).slice(0, 5);
}

export function extractFromTransfer(dt) {
  const files = [];
  if (!dt) return { files, urls: [] };
  for (const f of Array.from(dt.files || [])) if (/^image\//.test(f.type)) files.push(f);
  if (!files.length && dt.items) {
    for (const it of Array.from(dt.items)) {
      if (it.kind === 'file') { const f = it.getAsFile(); if (f && /^image\//.test(f.type)) files.push(f); }
    }
  }
  return { files, urls: files.length ? [] : imageCandidates(dt) };
}

// 후보 주소를 차례로 시도해 사진 한 장을 받는다. 다 실패하면 마지막 오류를 던진다.
export async function fetchFirstImage(urls, check) {
  let last = new Error('fetchFail');
  for (const u of urls) {
    try {
      const blob = await fetchImageUrl(u);
      if (check) return await check(blob);
      return blob;
    } catch (e) { last = e; }
  }
  throw last;
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
let _strayDrop = null;
const keyOf = el => el.dataset.dropzone || el.dataset.zone || '';
export function bindDropZone(el, onBlobs) {
  const zone = { el, onBlobs };
  _zones.add(zone);
  const activate = () => {
    _activeZone = zone;
    _activeKey = keyOf(el);
    _zones.forEach(z => z.el.classList.toggle('active', z === zone));
  };
  if (_activeKey && keyOf(el) === _activeKey) { _activeZone = zone; el.classList.add('active'); }
  el.addEventListener('click', activate);
  el.addEventListener('focus', activate);
  el.addEventListener('dragover', e => { e.preventDefault(); e.dataTransfer.dropEffect = 'copy'; el.classList.add('drag'); });
  el.addEventListener('dragleave', e => { if (!el.contains(e.relatedTarget)) el.classList.remove('drag'); });
  el.addEventListener('drop', e => {
    e.preventDefault();
    e.stopPropagation();
    el.classList.remove('drag');
    activate();
    const { files, urls } = extractFromTransfer(e.dataTransfer);
    onBlobs(files, urls);
  });
  return () => { _zones.delete(zone); if (_activeZone === zone) _activeZone = null; };
}
export function clearZones() { _zones.clear(); _activeZone = null; }
export function forgetActiveZone() { _activeKey = ''; _activeZone = null; }
// 칸 밖에 떨어뜨리면 브라우저가 그 사진으로 페이지를 바꿔 버린다 — 막고 알려 준다.
export function onStrayDrop(fn) { _strayDrop = fn; }

if (globalThis.window) {
  window.addEventListener('dragover', e => { if (_zones.size) e.preventDefault(); });
  window.addEventListener('drop', e => {
    if (!_zones.size) return;
    e.preventDefault();
    if (_strayDrop) _strayDrop();
  });
  window.addEventListener('paste', e => {
    if (!_activeZone || !document.body.contains(_activeZone.el)) return;
    const t = e.target;
    if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA') && !_activeZone.el.contains(t)) return;
    const { files, urls } = extractFromTransfer(e.clipboardData);
    if (files.length || urls.length) { e.preventDefault(); _activeZone.onBlobs(files, urls); }
  });
}
