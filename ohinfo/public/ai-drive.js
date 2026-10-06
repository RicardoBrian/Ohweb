// AI 실험실 사진 저장 — "기기에 먼저, 드라이브는 뒤에서 한 장씩".
//
// 1) 사진을 넣는 순간 이 기기의 브라우저(IndexedDB)에 저장하고 화면에 바로 보여 준다.
// 2) 뒤에서 한 장씩 선생님 드라이브(Apps Script)로 올린다. 학습용(train)만 드라이브로
//    가고, 평가용(test)은 224px로 작게 만들어 Firestore 기록에 바로 넣는다.
// 3) 올라가면 Firestore에 사진 기록(미리보기 + 드라이브 파일 ID)을 남기고 기기 사본을 지운다.
//
// 실패하면 지우지 않고 간격을 늘려 가며 다시 시도한다. 학교 PC는 재부팅하면 브라우저
// 저장이 지워지는 경우가 많아서, "드라이브에 올라간 것"만 진짜 저장으로 친다.

import { AILAB_GAS_URL } from './ai-config.js';
import { blobToBase64 } from './ai-image.js';

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
    const r = indexedDB.open(DB_NAME, 1);
    r.onupgradeneeded = () => {
      const s = r.result.createObjectStore('pending', { keyPath: 'id' });
      s.createIndex('pid', 'pid');
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
// writeRecord(item): Firestore에 사진 기록을 남기는 함수(페이지가 넘겨준다).
export class Uploader {
  constructor({ getToken, writeRecord, onChange }) {
    this.getToken = getToken;
    this.writeRecord = writeRecord;
    this.onChange = onChange || (() => {});
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
