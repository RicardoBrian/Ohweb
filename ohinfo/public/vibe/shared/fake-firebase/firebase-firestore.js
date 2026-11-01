// 견본용 가짜 firebase-firestore (모듈 방식). 실제 SDK와 같은 이름·사용법.
import './core.js';
import { getApp } from './firebase-app.js';

const F = globalThis.FakeFB;
export const Timestamp = F.Timestamp;

export function getFirestore(app) {
  const a = app || getApp();
  return { type: 'firestore', app: a, __ns: a.__ns };
}
export const initializeFirestore = (app) => getFirestore(app);
export function connectFirestoreEmulator() {}
export async function enableIndexedDbPersistence() {}
export async function enableMultiTabIndexedDbPersistence() {}
export const persistentLocalCache = () => ({});
export const persistentMultipleTabManager = () => ({});
export const memoryLocalCache = () => ({});
export async function terminate() {}
export async function waitForPendingWrites() {}
export async function clearIndexedDbPersistence() {}

const nsOf = (x) => x.__ns || x.ns;
const join = (...segs) => segs.flat().map(String).join('/');

export function collection(parent, ...segs) {
  if (parent.type === 'firestore') return F.colRef(nsOf(parent), join(segs));
  if (parent.type === 'document') return F.colRef(parent.ns, join(parent.path, segs));
  if (parent.type === 'collection') return F.colRef(parent.ns, join(parent.path, segs));
  throw new Error('collection(): 잘못된 위치');
}
export function collectionGroup(db, id) {
  return { type: 'query', ns: nsOf(db), path: id, group: true, constraints: [] };
}
export function doc(parent, ...segs) {
  if (parent.type === 'firestore') return F.docRef(nsOf(parent), join(segs));
  if (parent.type === 'collection') return F.docRef(parent.ns, join(parent.path, segs.length ? segs : [F.newId()]));
  if (parent.type === 'document') return F.docRef(parent.ns, join(parent.path, segs));
  throw new Error('doc(): 잘못된 위치');
}

export function query(base, ...cs) {
  return { type: 'query', ns: base.ns, path: base.path, group: !!base.group, constraints: [...(base.constraints || []), ...cs.flat()] };
}
export const where = (field, op, value) => ({ t: 'where', field: field && field.__field ? field.__field : field, op, value });
export const orderBy = (field, dir = 'asc') => ({ t: 'orderBy', field: field && field.__field ? field.__field : field, dir });
export const limit = (n) => ({ t: 'limit', n });
export const limitToLast = (n) => ({ t: 'limitToLast', n });
export const startAt = (...values) => ({ t: 'startAt', values });
export const startAfter = (...values) => ({ t: 'startAfter', values });
export const endAt = (...values) => ({ t: 'endAt', values });
export const endBefore = (...values) => ({ t: 'endBefore', values });
export const or = (...parts) => ({ t: 'or', parts });
export const and = (...parts) => parts;
export const documentId = () => ({ __field: '__name__' });
export class FieldPath { constructor(...f) { this.__field = f.join('.'); } }

export const serverTimestamp = F.sentinels.serverTimestamp;
export const deleteField = F.sentinels.deleteField;
export const increment = F.sentinels.increment;
export const arrayUnion = F.sentinels.arrayUnion;
export const arrayRemove = F.sentinels.arrayRemove;

const later = (fn) => new Promise((res, rej) => setTimeout(() => { try { res(fn()); } catch (e) { rej(e); } }, 0));

export const getDoc = (ref) => later(() => F.docSnap(ref.ns, ref.path, false));
export const getDocFromServer = getDoc;
export const getDocFromCache = getDoc;
export const getDocs = (q) => later(() => F.querySnap(q.ns, F.runQuery(q), false));
export const getDocsFromServer = getDocs;
export const getDocsFromCache = getDocs;
export const getCountFromServer = (q) => later(() => ({ data: () => ({ count: F.runQuery(q).length }) }));

export const setDoc = (ref, data, opts = {}) => later(() => F.write(ref.ns, [{ kind: 'set', path: ref.path, data, merge: !!(opts.merge || opts.mergeFields) }]));
export const updateDoc = (ref, ...args) => later(() => F.write(ref.ns, [{ kind: 'update', path: ref.path, pairs: F.updatePairs(args) }]));
export const deleteDoc = (ref) => later(() => F.write(ref.ns, [{ kind: 'delete', path: ref.path }]));
export function addDoc(col, data) {
  const ref = F.docRef(col.ns, join(col.path, F.newId()));
  return later(() => { F.write(col.ns, [{ kind: 'set', path: ref.path, data }]); return ref; });
}

export function writeBatch(db) {
  const ops = [];
  const ns = nsOf(db);
  const b = {
    set(ref, data, opts = {}) { ops.push({ kind: 'set', path: ref.path, data, merge: !!(opts.merge || opts.mergeFields) }); return b; },
    update(ref, ...args) { ops.push({ kind: 'update', path: ref.path, pairs: F.updatePairs(args) }); return b; },
    delete(ref) { ops.push({ kind: 'delete', path: ref.path }); return b; },
    commit: () => later(() => F.write(ns, ops)),
  };
  return b;
}
export async function runTransaction(db, fn) {
  const ops = [];
  const ns = nsOf(db);
  const t = {
    get: async (ref) => F.docSnap(ref.ns, ref.path, false),
    set(ref, data, opts = {}) { ops.push({ kind: 'set', path: ref.path, data, merge: !!opts.merge }); return t; },
    update(ref, ...args) { ops.push({ kind: 'update', path: ref.path, pairs: F.updatePairs(args) }); return t; },
    delete(ref) { ops.push({ kind: 'delete', path: ref.path }); return t; },
  };
  const result = await fn(t);
  F.write(ns, ops);
  return result;
}

export function onSnapshot(target, ...args) {
  if (args[0] && typeof args[0] === 'object' && !('next' in args[0]) && typeof args[1] === 'function') args.shift(); // options 자리
  const next = typeof args[0] === 'function' ? args[0] : args[0] && args[0].next;
  if (target.type === 'document') return F.listenDoc(target.ns, target.path, false, next);
  return F.listenQuery(target, false, next);
}

export function refEqual(a, b) { return a && b && a.ns === b.ns && a.path === b.path; }
export function queryEqual(a, b) { return JSON.stringify(a) === JSON.stringify(b); }
