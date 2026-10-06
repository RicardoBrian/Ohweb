// AI 실험실 사진 저장 — "기기에 먼저, 드라이브는 뒤에서 한 장씩".
//
// 1) 사진을 넣는 순간 이 기기의 브라우저(IndexedDB)에 저장하고 화면에 바로 보여 준다.
// 2) 뒤에서 한 장씩 선생님 드라이브(Apps Script)로 올린다. 학습용(train)만 드라이브로
//    가고, 평가용(test)은 224px로 작게 만들어 Firestore 기록에 바로 넣는다.
// 3) 올라가면 Firestore에 사진 기록(미리보기 + 드라이브 파일 ID)을 남기고 기기 사본을 지운다.
//
// 실패하면 지우지 않고 간격을 늘려 가며 다시 시도한다. 학교 PC는 재부팅하면 브라우저
// 저장이 지워지는 경우가 많아서, "드라이브에 올라간 것"만 진짜 저장으로 친다.

import { AILAB_GAS_URL } from './ai-config.js?v=202610060716';
import { blobToBase64 } from './ai-image.js?v=202610060716';

export class DriveError extends Error {
  constructor(code, msg) { super(msg || code); this.code = code; }
}

export function driveConfigured() { return !!AILAB_GAS_URL; }

// Apps Script 호출. 요청 본문을 문자열로 보내야(text/plain) 브라우저가 사전 요청
// (preflight)을 보내지 않는다 — Apps Script 웹앱은 사전 요청에 응답하지 못한다.
export async function gasCall(getToken, action, payload = {}) {
  if (!AILAB_GAS_URL) throw new DriveError('notConfigured');
  const idToken = await getToken();
  let res;
  try {
    res = await fetch(AILAB_GAS_URL, { method: 'POST', body: JSON.stringify({ action, idToken, ...payload }) });
  } catch (e) { throw new DriveError('network', e.message); }
  const txt = await res.text();
  let data;
  try { data = JSON.parse(txt); } catch { throw new DriveError('badResponse', txt.slice(0, 120)); }
  if (data && data.error) throw new DriveError(data.code || 'server', data.error);
  return data;
}

// ── 기기 저장(IndexedDB) ──
const DB_NAME = 'ohinfo_ailab';
let _dbp = null;
function idb() {
  if (_dbp) return _dbp;
  _dbp = new Promise((res, rej) => {
    const r = indexedDB.open(DB_NAME, 2);
    r.onupgradeneeded = () => {
      const db = r.result;
      if (!db.objectStoreNames.contains('pending')) db.createObjectStore('pending', { keyPath: 'id' }).createIndex('pid', 'pid');
      // 2: 학습용 사진(드라이브 파일 ID → 사진)과 모델(프로젝트_번호 → 파일들)을 이 PC에 보관.
      //    한 번 받은 건 다시 받지 않는다 — 다시 학습할 때 새 사진만 받으면 된다.
      if (!db.objectStoreNames.contains('cache')) db.createObjectStore('cache');
    };
    r.onsuccess = () => res(r.result);
    r.onerror = () => rej(r.error);
  });
  return _dbp;
}
async function tx(mode, fn) {
  const db = await idb();
  return new Promise((res, rej) => {
    const t = db.transaction('pending', mode);
    const out = fn(t.objectStore('pending'));
    t.oncomplete = () => res(out && out.result !== undefined ? out.result : out);
    t.onerror = () => rej(t.error);
    t.onabort = () => rej(t.error);
  });
}
export const localStore = {
  put: item => tx('readwrite', s => s.put(item)),
  del: id => tx('readwrite', s => s.delete(id)),
  async list(pid) {
    const db = await idb();
    return new Promise((res, rej) => {
      const r = db.transaction('pending').objectStore('pending').index('pid').getAll(pid);
      r.onsuccess = () => res(r.result || []);
      r.onerror = () => rej(r.error);
    });
  },
};

// ── 올리기 대기열 ──
const PERMANENT = new Set(['badLabel', 'badRequest', 'tooBig', 'auth']);
// writeRecord(item): Firestore에 사진 기록을 남기는 함수(페이지가 넘겨준다).
export class Uploader {
  constructor({ getToken, writeRecord, onChange, onDrop }) {
    this.getToken = getToken;
    this.writeRecord = writeRecord;
    this.onChange = onChange || (() => {});
    this.onDrop = onDrop || (() => {});
    this.items = [];          // 이 기기에 남아 있는 사진(대기 중)
    this.pid = '';
    this.running = false;
    this.state = 'idle';      // idle | uploading | retrying | notConfigured
    this.lastError = '';
    this._wake = null;
  }

  async open(pid) {
    this.pid = pid;
    try { this.items = (await localStore.list(pid)).sort((a, b) => a.at - b.at); }
    catch { this.items = []; }
    this.onChange();
    this.kick();
  }

  pendingFor(kind, labelId) { return this.items.filter(i => i.kind === kind && i.labelId === labelId); }
  get count() { return this.items.length; }

  async add(item) {
    item.at = Date.now();
    item.tries = 0;
    this.items.push(item);
    try { await localStore.put(item); } catch { /* 저장소를 못 쓰는 브라우저 — 메모리로만 진행 */ }
    this.onChange();
    this.kick();
  }

  async remove(id) {
    this.items = this.items.filter(i => i.id !== id);
    try { await localStore.del(id); } catch { /* 무시 */ }
    this.onChange();
  }

  kick() {
    if (this._wake) { const w = this._wake; this._wake = null; w(); }
    if (!this.running) this._loop();
  }

  async _loop() {
    this.running = true;
    for (;;) {
      this.items = this.items.filter(i => i.pid === this.pid);
      // 드라이브 주소가 아직 설정되지 않았으면 학습용 사진은 기기에 남겨 두고,
      // 평가용(test) 사진처럼 드라이브가 필요 없는 것만 먼저 저장한다.
      const idx = this.items.findIndex(i => i.kind !== 'train' || i.driveId || AILAB_GAS_URL);
      if (idx < 0) break;
      const item = this.items[idx];
      try {
        this.state = 'uploading'; this.onChange();
        if (item.kind === 'train' && !item.driveId) {
          const r = await gasCall(this.getToken, 'upload', {
            pid: item.pid, labelId: item.labelId, filename: `${item.id}.jpg`,
            base64: await blobToBase64(item.blob),
          });
          item.driveId = r.id;
          // 드라이브엔 올라갔는데 기록 쓰기에서 실패하면, 다시 시도할 때 드라이브에 또 올리지 않게.
          try { await localStore.put(item); } catch { /* 무시 */ }
        }
        await this.writeRecord(item);
        this.items = this.items.filter(i => i.id !== item.id);
        try { await localStore.del(item.id); } catch { /* 무시 */ }
        this.lastError = '';
      } catch (e) {
        if (e.code === 'notConfigured') break;
        // 다시 해도 안 되는 오류(지워진 레이블, 짝이 아님 등)는 붙잡고 있지 않고 알린다.
        // 'auth'는 일시적인 연결 문제일 수도 있어서 세 번까지는 다시 해 본다.
        if (PERMANENT.has(e.code) && (e.code !== 'auth' || (item.tries || 0) >= 3)) {
          this.items = this.items.filter(i => i.id !== item.id);
          try { await localStore.del(item.id); } catch { /* 무시 */ }
          this.onDrop(item, e.code);
          continue;
        }
        item.tries = (item.tries || 0) + 1;
        this.lastError = e.code || e.message;
        this.state = 'retrying'; this.onChange();
        const wait = Math.min(60000, 2000 * 2 ** Math.min(item.tries - 1, 5));
        await new Promise(r => { this._wake = r; setTimeout(r, wait); });
      }
    }
    this.state = this.items.some(i => i.kind === 'train' && !i.driveId) && !AILAB_GAS_URL ? 'notConfigured' : 'idle';
    this.running = false;
    this.onChange();
  }
}

// 학습용 사진 묶어 내려받기(zip). fileIds가 비어 있으면 내려받지 않는다.
export async function downloadZip(getToken, pid, fileIds, filename) {
  const r = await gasCall(getToken, 'zip', { pid, fileIds });
  const bin = atob(r.base64);
  const arr = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) arr[i] = bin.charCodeAt(i);
  const url = URL.createObjectURL(new Blob([arr], { type: 'application/zip' }));
  const a = document.createElement('a');
  a.href = url; a.download = filename || r.name || 'photos.zip';
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 10000);
  return r.count;
}

export async function trashFile(getToken, pid, fileId) {
  return gasCall(getToken, 'delete', { pid, fileId });
}

// ── 이 PC에 보관(사진·모델) ──
async function cacheGet(key) {
  try {
    const db = await idb();
    return await new Promise((res, rej) => { const r = db.transaction('cache').objectStore('cache').get(key); r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error); });
  } catch { return undefined; }
}
async function cachePut(key, val) {
  try {
    const db = await idb();
    await new Promise((res, rej) => { const t = db.transaction('cache', 'readwrite'); t.objectStore('cache').put(val, key); t.oncomplete = res; t.onerror = () => rej(t.error); });
  } catch { /* 보관 못 해도 다음에 다시 받으면 된다 */ }
}

function b64ToBytes(b64) {
  const bin = atob(b64);
  const arr = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) arr[i] = bin.charCodeAt(i);
  return arr;
}
function bytesToB64(buf) {
  const u = new Uint8Array(buf);
  let s = '';
  for (let i = 0; i < u.length; i += 0x8000) s += String.fromCharCode.apply(null, u.subarray(i, i + 0x8000));
  return btoa(s);
}

// 학습 사진 받기: 보관된 건 그대로, 없는 것만 드라이브에서 15장씩.
export async function fetchTrainPhotos(getToken, pid, driveIds, onProgress = () => {}) {
  const out = new Map();
  const need = [];
  for (const id of driveIds) {
    const hit = await cacheGet('img:' + id);
    if (hit) out.set(id, hit); else need.push(id);
  }
  onProgress(out.size, driveIds.length);
  for (let i = 0; i < need.length; i += 15) {
    const chunk = need.slice(i, i + 15);
    let r, tries = 0;
    for (;;) {
      try { r = await gasCall(getToken, 'fetch', { pid, fileIds: chunk }); break; }
      catch (e) { if (++tries >= 3 || e.code === 'auth' || e.code === 'notConfigured') throw e; await new Promise(z => setTimeout(z, 1500 * tries)); }
    }
    for (const f of r.files || []) {
      const blob = new Blob([b64ToBytes(f.base64)], { type: 'image/jpeg' });
      out.set(f.id, blob);
      await cachePut('img:' + f.id, blob);
    }
    onProgress(out.size, driveIds.length);
  }
  return out;
}

// 학습한 모델 저장(대표만 — Apps Script가 확인한다). 이 PC에도 보관해 둔다.
export async function saveModelToDrive(getToken, pid, version, artifacts) {
  const payload = { modelJson: artifacts.modelJson, metadataJson: artifacts.metadataJson, weightsBase64: bytesToB64(artifacts.weightData) };
  await gasCall(getToken, 'saveModel', { pid, version, ...payload });
  await cachePut(`model:${pid}:${version}`, payload);
}

// 모델 받기: 보관된 게 있으면 그걸로. getToken이 없으면(공개 웹앱) 배포된 번호만 받을 수 있다.
export async function fetchModelFiles(getToken, pid, version) {
  const key = `model:${pid}:${version}`;
  const hit = await cacheGet(key);
  if (hit && hit.modelJson) return hit;
  let r;
  if (getToken) r = await gasCall(getToken, 'getModel', { pid, version });
  else r = await fetchPublicModel(pid, version);
  const files = { modelJson: r.modelJson, metadataJson: r.metadataJson, weightsBase64: r.weightsBase64, weightsBytes: r.weightsBytes };
  await cachePut(key, files);
  return files;
}
export { b64ToBytes };

// /api/ai-model의 바이너리 응답 풀기('AIM1' · 머리 길이 · 머리 JSON · 가중치)
export function unpackModel(buf) {
  const u8 = new Uint8Array(buf);
  if (String.fromCharCode(...u8.subarray(0, 4)) !== 'AIM1') throw new DriveError('badResponse', 'model format');
  const n = new DataView(buf).getUint32(4);
  const head = JSON.parse(new TextDecoder().decode(u8.subarray(8, 8 + n)));
  return { modelJson: head.modelJson, metadataJson: head.metadataJson, weightsBytes: buf.slice(8 + n) };
}

// 공개 웹앱(로그인 없음): 우리 서버(/api/ai-model)가 대신 받아 준다 — 방문자 브라우저의
// 구글 로그인 상태와 상관없이 열리게. 서버 길이 없을 때(로컬 시험 등)만 Apps Script를 직접 부른다.
async function fetchPublicModel(pid, version) {
  let res = null;
  try { res = await fetch(`/api/ai-model?pid=${encodeURIComponent(pid)}&v=${encodeURIComponent(version)}`); } catch { res = null; }
  if (res && res.ok && /x-ailab-model/.test(res.headers.get('Content-Type') || '')) return unpackModel(await res.arrayBuffer());
  if (res && /json/.test(res.headers.get('Content-Type') || '')) {
    const r = await res.json();
    if (r.error) throw new DriveError(r.code || 'server', r.error);
    return r;
  }
  if (!AILAB_GAS_URL) throw new DriveError('notConfigured');
  let txt;
  try { txt = await (await fetch(AILAB_GAS_URL, { method: 'POST', body: JSON.stringify({ action: 'getModel', pid, version }) })).text(); }
  catch (e) { throw new DriveError('network', e.message); }
  let r;
  try { r = JSON.parse(txt); } catch { throw new DriveError('badResponse', txt.slice(0, 120)); }
  if (r.error) throw new DriveError(r.code || 'server', r.error);
  return r;
}
