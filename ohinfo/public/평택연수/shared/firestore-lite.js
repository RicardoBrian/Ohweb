/**
 * firestore-lite — Firestore(모듈 SDK)의 함수 시그니처를 흉내내는
 * localStorage 백엔드. 견본 사이트에서 `firebase-firestore.js`의 import를
 * 이 파일로만 바꾸면, 앱 코드(collection/doc/getDocs/addDoc/...)는 손대지
 * 않고도 그대로 동작한다 — 서버로는 아무것도 전송하지 않는다.
 *
 * 지원 범위는 "실제로 쓰는 만큼"만: where는 '==' 위주, orderBy는 단일 필드,
 * writeBatch는 set/update/delete, serverTimestamp/deleteField 정도.
 * 복합 쿼리나 트랜잭션처럼 견본 앱들이 안 쓰는 기능은 넣지 않았다.
 */

const PREFIX = 'fslite:';

function loadStore(ns) {
  try { return JSON.parse(localStorage.getItem(PREFIX + ns) || '{}'); } catch { return {}; }
}
function saveStore(ns, store) {
  localStorage.setItem(PREFIX + ns, JSON.stringify(store));
}
function newId() {
  return 'id' + Date.now().toString(36) + Math.random().toString(36).slice(2, 9);
}

export function getFirestoreLite(namespace = 'default') {
  return { __isDb: true, ns: namespace };
}

export function collection(parent, ...segs) {
  if (parent.__isDb) return { __col: true, ns: parent.ns, path: segs.join('/') };
  if (parent.__doc) return { __col: true, ns: parent.ns, path: `${parent.collectionPath}/${parent.id}/${segs.join('/')}` };
  throw new Error('collection(): invalid parent');
}

export function doc(parent, ...segs) {
  if (parent.__isDb) {
    const id = segs[segs.length - 1] ?? newId();
    const collectionPath = segs.slice(0, -1).join('/');
    return { __doc: true, ns: parent.ns, collectionPath, id };
  }
  if (parent.__col) {
    const id = segs[0] ?? newId();
    return { __doc: true, ns: parent.ns, collectionPath: parent.path, id };
  }
  throw new Error('doc(): invalid parent');
}

export function query(colRef, ...constraints) {
  return { __query: true, col: colRef, constraints };
}
export function where(field, op, value) { return { type: 'where', field, op, value }; }
export function orderBy(field, dir = 'asc') { return { type: 'orderBy', field, dir }; }
export function limit(n) { return { type: 'limit', n }; }

export function serverTimestamp() { return { __serverTimestampSentinel: true }; }
export function deleteField() { return { __deleteFieldSentinel: true }; }

function resolveTimestamps(v) {
  if (Array.isArray(v)) return v.map(resolveTimestamps);
  if (v && typeof v === 'object') {
    if (v.__serverTimestampSentinel) return { __ts: Date.now() };
    const out = {};
    for (const k in v) out[k] = resolveTimestamps(v[k]);
    return out;
  }
  return v;
}
function reviveTimestamps(v) {
  if (Array.isArray(v)) return v.map(reviveTimestamps);
  if (v && typeof v === 'object') {
    if (typeof v.__ts === 'number' && Object.keys(v).length === 1) {
      const ms = v.__ts;
      return { toDate: () => new Date(ms), toMillis: () => ms, seconds: Math.floor(ms / 1000), nanoseconds: 0 };
    }
    const out = {};
    for (const k in v) out[k] = reviveTimestamps(v[k]);
    return out;
  }
  return v;
}
function sortKey(v) {
  if (v && typeof v === 'object' && typeof v.__ts === 'number') return v.__ts;
  return v ?? '';
}
function compareOp(actual, op, expected) {
  switch (op) {
    case '==': return actual === expected;
    case '!=': return actual !== expected;
    case '<': return actual < expected;
    case '<=': return actual <= expected;
    case '>': return actual > expected;
    case '>=': return actual >= expected;
    case 'in': return Array.isArray(expected) && expected.includes(actual);
    case 'array-contains': return Array.isArray(actual) && actual.includes(expected);
    default: return true;
  }
}

function makeDocSnap(id, raw) {
  return { id, exists: () => true, data: () => reviveTimestamps(raw) };
}

const listeners = new Map(); // `${ns}::${path}` -> Set(callback)
function listenerKey(ns, path) { return `${ns}::${path}`; }
function notify(ns, path) {
  const set = listeners.get(listenerKey(ns, path));
  if (!set) return;
  for (const cb of set) cb(buildQuerySnap(ns, path, []));
}
function buildQuerySnap(ns, path, constraints) {
  const store = loadStore(ns);
  const bucket = store[path] || {};
  const docs = Object.entries(bucket).map(([id, raw]) => makeDocSnap(id, raw));
  return { docs, empty: docs.length === 0, size: docs.length, forEach: (fn) => docs.forEach(fn) };
}

/** onSnapshot(collectionRef, cb) — 이 견본이 쓰는 만큼만: 쿼리 조건 없이 컬렉션 전체를 구독. */
export function onSnapshot(colRef, cb) {
  const key = listenerKey(colRef.ns, colRef.path);
  if (!listeners.has(key)) listeners.set(key, new Set());
  listeners.get(key).add(cb);
  cb(buildQuerySnap(colRef.ns, colRef.path, []));
  return () => listeners.get(key)?.delete(cb);
}

export async function getDocs(target) {
  const isQuery = !!target.__query;
  const col = isQuery ? target.col : target;
  const constraints = isQuery ? target.constraints : [];
  const store = loadStore(col.ns);
  const bucket = store[col.path] || {};
  let entries = Object.entries(bucket).map(([id, raw]) => ({ id, raw }));

  for (const c of constraints) {
    if (c.type === 'where') entries = entries.filter((e) => compareOp(e.raw[c.field], c.op, c.value));
  }
  const orderC = constraints.find((c) => c.type === 'orderBy');
  if (orderC) {
    entries.sort((a, b) => {
      const av = sortKey(a.raw[orderC.field]), bv = sortKey(b.raw[orderC.field]);
      const cmp = av < bv ? -1 : av > bv ? 1 : 0;
      return orderC.dir === 'desc' ? -cmp : cmp;
    });
  }
  const limitC = constraints.find((c) => c.type === 'limit');
  if (limitC) entries = entries.slice(0, limitC.n);

  const docs = entries.map((e) => makeDocSnap(e.id, e.raw));
  return { docs, empty: docs.length === 0, size: docs.length, forEach: (fn) => docs.forEach(fn) };
}

export async function getDoc(ref) {
  const store = loadStore(ref.ns);
  const raw = (store[ref.collectionPath] || {})[ref.id];
  return { id: ref.id, exists: () => raw !== undefined, data: () => (raw === undefined ? undefined : reviveTimestamps(raw)) };
}

export async function addDoc(colRef, data) {
  const store = loadStore(colRef.ns);
  const bucket = store[colRef.path] || (store[colRef.path] = {});
  const id = newId();
  bucket[id] = resolveTimestamps(data);
  saveStore(colRef.ns, store);
  notify(colRef.ns, colRef.path);
  return { __doc: true, ns: colRef.ns, collectionPath: colRef.path, id };
}

export async function setDoc(ref, data, opts = {}) {
  const store = loadStore(ref.ns);
  const bucket = store[ref.collectionPath] || (store[ref.collectionPath] = {});
  const resolved = resolveTimestamps(data);
  bucket[ref.id] = opts.merge ? { ...(bucket[ref.id] || {}), ...resolved } : resolved;
  saveStore(ref.ns, store);
  notify(ref.ns, ref.collectionPath);
}

export async function updateDoc(ref, data) {
  const store = loadStore(ref.ns);
  const bucket = store[ref.collectionPath] || (store[ref.collectionPath] = {});
  if (!(ref.id in bucket)) throw new Error(`No document to update: ${ref.collectionPath}/${ref.id}`);
  const current = { ...bucket[ref.id] };
  for (const k in data) {
    const v = data[k];
    if (v && v.__deleteFieldSentinel) delete current[k];
    else current[k] = resolveTimestamps(v);
  }
  bucket[ref.id] = current;
  saveStore(ref.ns, store);
  notify(ref.ns, ref.collectionPath);
}

export async function deleteDoc(ref) {
  const store = loadStore(ref.ns);
  const bucket = store[ref.collectionPath];
  if (bucket && ref.id in bucket) { delete bucket[ref.id]; saveStore(ref.ns, store); notify(ref.ns, ref.collectionPath); }
}

export function writeBatch(db) {
  const ops = [];
  return {
    set(ref, data, opts) { ops.push({ type: 'set', ref, data, opts }); return this; },
    update(ref, data) { ops.push({ type: 'update', ref, data }); return this; },
    delete(ref) { ops.push({ type: 'delete', ref }); return this; },
    async commit() {
      for (const op of ops) {
        if (op.type === 'set') await setDoc(op.ref, op.data, op.opts);
        else if (op.type === 'update') await updateDoc(op.ref, op.data);
        else if (op.type === 'delete') await deleteDoc(op.ref);
      }
    },
  };
}

/** 이 네임스페이스에 아직 아무 데이터도 없을 때만 seedFn()으로 초기 견본 데이터를 채운다. */
export function seedIfEmpty(namespace, seedFn) {
  const key = PREFIX + namespace;
  if (localStorage.getItem(key)) return;
  const store = {};
  seedFn({
    put(path, id, data) { (store[path] || (store[path] = {}))[id] = resolveTimestamps(data); },
  });
  saveStore(namespace, store);
}
