// 티처블머신 모델 불러오기·예측 (브라우저 전용).
// 라이브러리는 필요할 때만 받는다 — tfjs가 커서(약 1MB) 실험실 첫 화면엔 싣지 않는다.

import { TFJS_URL, TMIMAGE_URL, checkMetadata } from './ai-core.js';

let _libs = null;
function loadScript(src) {
  return new Promise((res, rej) => {
    const s = document.createElement('script');
    s.src = src; s.async = false;
    s.onload = res;
    s.onerror = () => rej(new Error('script'));
    document.head.appendChild(s);
  });
}
export function loadLibs() {
  if (!_libs) {
    _libs = (async () => {
      if (!window.tf) await loadScript(TFJS_URL);
      if (!window.tmImage) await loadScript(TMIMAGE_URL);
    })().catch(e => { _libs = null; throw e; });
  }
  return _libs;
}

export class ModelError extends Error {
  constructor(code, msg) { super(msg || code); this.code = code; }
}

// 다시 학습해 같은 주소로 다시 올리면 파일만 바뀐다. 브라우저에 남은 옛 파일을
// 쓰지 않도록 매번 서버에 바뀌었는지 묻는다(no-cache).
export async function fetchMetadata(modelUrl) {
  let r;
  try { r = await fetch(modelUrl + 'metadata.json', { cache: 'no-cache' }); }
  catch { throw new ModelError('loadFail'); }
  if (!r.ok) throw new ModelError('loadFail');
  let meta;
  try { meta = await r.json(); } catch { throw new ModelError('badmeta'); }
  const chk = checkMetadata(meta);
  if (chk.error) throw new ModelError(chk.error);
  return { meta, labels: chk.labels };
}

const _cache = new Map();
export async function loadModel(modelUrl, { fresh = false } = {}) {
  if (!fresh && _cache.has(modelUrl)) return _cache.get(modelUrl);
  const p = (async () => {
    try { await loadLibs(); } catch { throw new ModelError('libFail'); }
    const { meta, labels } = await fetchMetadata(modelUrl);
    const http = window.tf.io.http || window.tf.io.browserHTTPRequest;
    try {
      const handler = http(modelUrl + 'model.json', { requestInit: { cache: 'no-cache' } });
      const model = await window.tmImage.load(handler, meta);
      return { model, labels };
    } catch { throw new ModelError('loadFail'); }
  })();
  _cache.set(modelUrl, p);
  p.catch(() => _cache.delete(modelUrl));
  return p;
}

export function imageFromSrc(src) {
  return new Promise((res, rej) => {
    const img = new Image();
    img.onload = () => res(img);
    img.onerror = rej;
    img.src = src;
  });
}

export async function imageFromBlob(blob) {
  const url = URL.createObjectURL(blob);
  try { return await imageFromSrc(url); }
  finally { setTimeout(() => URL.revokeObjectURL(url), 1000); }
}

// → [{ className, probability }] (모델 클래스 순서 그대로)
export async function predict(loaded, img) {
  return loaded.model.predict(img);
}
