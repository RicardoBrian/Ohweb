// 티처블머신 모델 불러오기·예측 (브라우저 전용).
// 라이브러리는 필요할 때만 받는다 — tfjs가 커서(약 1MB) 실험실 첫 화면엔 싣지 않는다.

import { TFJS_URL, TMIMAGE_URL, checkMetadata } from './ai-core.js';
import { fetchModelFiles, b64ToBytes } from './ai-drive.js';

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

// ── 실험실 안에서 학습(티처블머신 라이브러리) ──
// 티처블머신 사이트와 같은 기본 모델(MobileNet v2, 0.35)과 같은 기본 설정을 쓴다.
// 학생에게는 바꾸지 못하게 보여 주기만 한다(ⓘ 도움말).
export const TRAIN_PARAMS = { epochs: 50, batchSize: 16, learningRate: 0.001, denseUnits: 100 };
// 시험(테스트)할 때만 window.__AILAB_BASE로 작은 가짜 기본 모델을 쓴다.
const baseOptions = () => (globalThis.window && window.__AILAB_BASE) || { version: 2, alpha: 0.35 };


// samples: [{ labelId, blob }] · 레이블 ID를 그대로 클래스 이름으로 쓴다(이름이 바뀌어도 연결이 안 깨지게).
// onPhase(단계, 지금, 전체): 'base'(기본 모델 받기) → 'extract'(사진 특징 뽑기) → 'train'(에포크)
export async function trainModel({ labelIds, samples, onPhase = () => {} }) {
  try { await loadLibs(); } catch { throw new ModelError('libFail'); }
  const tf = window.tf;
  onPhase('base', 0, 1);
  let tm;
  try {
    tm = await window.tmImage.createTeachable({ tfjsVersion: '1.3.1', tmVersion: 'ailab', labels: labelIds, imageSize: 224 }, baseOptions());
  } catch { throw new ModelError('baseFail'); }
  tm.setLabels(labelIds);
  let i = 0;
  for (const s of samples) {
    const img = await imageFromBlob(s.blob);
    // addExample은 예측(predict)과 달리 사진을 잘라 주지 않는다 — 224×224 입력만 받는다.
    // 예측할 때와 똑같이 가운데 정사각형을 224px로 줄여서 넘긴다(티처블머신 사이트도 이렇게 한다).
    await tm.addExample(labelIds.indexOf(s.labelId), cropSquare(img, 224));
    onPhase('extract', ++i, samples.length);
    if (i % 5 === 0) await tf.nextFrame();
  }
  let valAcc = null;
  await tm.train(TRAIN_PARAMS, {
    onEpochEnd: async (ep, logs) => {
      const v = logs.val_acc != null ? logs.val_acc : logs.val_accuracy;
      if (v != null) valAcc = v;
      onPhase('train', ep + 1, TRAIN_PARAMS.epochs);
      await tf.nextFrame();
    },
  });
  let art = null;
  await tm.save(tf.io.withSaveHandler(async a => { art = a; return { modelArtifactsInfo: { dateSaved: new Date(), modelTopologyType: 'JSON' } }; }));
  const modelJson = JSON.stringify({
    modelTopology: art.modelTopology, format: 'layers-model', generatedBy: 'ohinfo-ailab', convertedBy: null,
    weightsManifest: [{ paths: ['weights.bin'], weights: art.weightSpecs }],
  });
  const metadataJson = JSON.stringify({ ...tm.getMetadata(), labels: labelIds });
  return { loaded: { model: tm, labels: labelIds }, valAcc, files: { modelJson, metadataJson, weightData: art.weightData } };
}

function cropSquare(img, size) {
  const c = document.createElement('canvas');
  c.width = c.height = size;
  const w = img.width, h = img.height, m = Math.min(w, h);
  const g = c.getContext('2d');
  g.imageSmoothingQuality = 'high';
  g.drawImage(img, (w - m) / 2, (h - m) / 2, m, m, 0, 0, size, size);
  return c;
}

// 드라이브에 저장된 모델 불러오기. getToken이 없으면 공개 웹앱(배포된 번호만).
const _driveCache = new Map();
export function rememberModel(pid, version, loaded) { _driveCache.set(`${pid}:${version}`, Promise.resolve(loaded)); }
export function loadDriveModel(getToken, pid, version) {
  const key = `${pid}:${version}`;
  if (_driveCache.has(key)) return _driveCache.get(key);
  const p = (async () => {
    let files;
    try { files = await fetchModelFiles(getToken, pid, version); }
    catch (e) { throw new ModelError(e.code === 'auth' ? 'notPublished' : 'loadFail'); }
    try { await loadLibs(); } catch { throw new ModelError('libFail'); }
    try {
      const mj = JSON.parse(files.modelJson);
      const meta = JSON.parse(files.metadataJson);
      const handler = window.tf.io.fromMemory(mj.modelTopology, mj.weightsManifest[0].weights, b64ToBytes(files.weightsBase64).buffer);
      const model = await window.tmImage.load(handler, meta);
      return { model, labels: meta.labels };
    } catch { throw new ModelError('loadFail'); }
  })();
  _driveCache.set(key, p);
  p.catch(() => _driveCache.delete(key));
  return p;
}
