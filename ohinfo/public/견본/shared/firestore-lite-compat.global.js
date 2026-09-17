/**
 * firestore-lite-compat.global.js — firestore-lite-compat.js와 같은 동작을
 * "일반 스크립트"(모듈 아님)로 제공한다. 앱들이 원래 CDN에서 받던
 * `firebase-app-compat.js` + `firebase-firestore-compat.js` 두 개의 동기
 * <script> 태그를 이 파일 하나로 그대로 대체할 수 있도록, import/export 없이
 * 즉시 window.firebase를 채운다(뒤에 오는 앱의 인라인 <script>가 동기적으로
 * firebase.initializeApp()/firebase.firestore()를 호출해도 문제없이 동작).
 *
 * <script src="firestore-lite-compat.global.js" data-ns="앱이름-demo"></script>
 * 처럼 data-ns로 네임스페이스(=localStorage 키 접두사)를 지정한다.
 * 시딩은 window.FSLite.seedIfEmpty(fn)으로 뒤이은 스크립트에서 호출한다.
 */
(function () {
  const ns = (document.currentScript && document.currentScript.dataset.ns) || 'default';
  const PREFIX = 'fslitec:';

  function loadStore() { try { return JSON.parse(localStorage.getItem(PREFIX + ns) || '{}'); } catch { return {}; } }
  function saveStore(store) { localStorage.setItem(PREFIX + ns, JSON.stringify(store)); }
  function newId() { return 'id' + Date.now().toString(36) + Math.random().toString(36).slice(2, 9); }

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
  function sortKey(v) { return (v && typeof v === 'object' && typeof v.__ts === 'number') ? v.__ts : (v ?? ''); }
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

  const listeners = new Map(); // path -> Set({constraints, cb})
  function notify(path) {
    const set = listeners.get(path);
    if (!set) return;
    for (const l of set) l.cb(buildSnapshot(path, l.constraints));
  }
  function buildSnapshot(path, constraints) {
    const store = loadStore();
    const bucket = store[path] || {};
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
    const docs = entries.map((e) => makeDocSnap(path, e.id, e.raw));
    return { docs, empty: docs.length === 0, size: docs.length, forEach: (fn) => docs.forEach(fn) };
  }
  function makeDocSnap(path, id, raw) {
    return { id, exists: raw !== undefined, data: () => reviveTimestamps(raw), ref: makeDocRef(path, id) };
  }
  function writeRaw(path, id, raw) {
    const store = loadStore();
    const bucket = store[path] || (store[path] = {});
    bucket[id] = raw;
    saveStore(store);
    notify(path);
  }
  function deleteRaw(path, id) {
    const store = loadStore();
    const bucket = store[path];
    if (bucket && id in bucket) { delete bucket[id]; saveStore(store); notify(path); }
  }
  function makeDocRef(path, id) {
    return {
      id,
      async get() {
        const store = loadStore();
        const raw = (store[path] || {})[id];
        return { id, exists: raw !== undefined, data: () => (raw === undefined ? undefined : reviveTimestamps(raw)) };
      },
      async set(data, opts) {
        opts = opts || {};
        const store = loadStore();
        const bucket = store[path] || {};
        const resolved = resolveTimestamps(data);
        writeRaw(path, id, opts.merge ? Object.assign({}, bucket[id] || {}, resolved) : resolved);
      },
      async update(data) {
        const store = loadStore();
        const bucket = store[path] || {};
        if (!(id in bucket)) throw new Error('No document to update: ' + path + '/' + id);
        const current = Object.assign({}, bucket[id]);
        for (const k in data) {
          const v = data[k];
          if (v && v.__deleteFieldSentinel) delete current[k];
          else current[k] = resolveTimestamps(v);
        }
        writeRaw(path, id, current);
      },
      async delete() { deleteRaw(path, id); },
      collection(sub) { return makeCollectionRef(path + '/' + id + '/' + sub); },
    };
  }
  function makeCollectionRef(path, constraints) {
    constraints = constraints || [];
    return {
      doc(id) { return makeDocRef(path, id != null ? id : newId()); },
      async add(data) {
        const id = newId();
        writeRaw(path, id, resolveTimestamps(data));
        return makeDocRef(path, id);
      },
      async get() { return buildSnapshot(path, constraints); },
      where(field, op, value) { return makeCollectionRef(path, constraints.concat([{ type: 'where', field, op, value }])); },
      orderBy(field, dir) { return makeCollectionRef(path, constraints.concat([{ type: 'orderBy', field, dir: dir || 'asc' }])); },
      limit(n) { return makeCollectionRef(path, constraints.concat([{ type: 'limit', n }])); },
      onSnapshot(cb) {
        if (!listeners.has(path)) listeners.set(path, new Set());
        const l = { constraints, cb };
        listeners.get(path).add(l);
        cb(buildSnapshot(path, constraints));
        return function unsubscribe() { const s = listeners.get(path); if (s) s.delete(l); };
      },
    };
  }

  const firestoreInstance = {
    collection(path) { return makeCollectionRef(path); },
    batch() {
      const ops = [];
      return {
        set(ref, data, opts) { ops.push({ type: 'set', ref, data, opts }); return this; },
        update(ref, data) { ops.push({ type: 'update', ref, data }); return this; },
        delete(ref) { ops.push({ type: 'delete', ref }); return this; },
        async commit() {
          for (const op of ops) {
            if (op.type === 'set') await op.ref.set(op.data, op.opts);
            else if (op.type === 'update') await op.ref.update(op.data);
            else if (op.type === 'delete') await op.ref.delete();
          }
        },
      };
    },
  };

  function firestoreFn() { return firestoreInstance; }
  firestoreFn.FieldValue = {
    serverTimestamp: () => ({ __serverTimestampSentinel: true }),
    delete: () => ({ __deleteFieldSentinel: true }),
  };

  const fakeUser = { uid: 'demo-' + ns };
  function authFn() {
    return {
      currentUser: fakeUser,
      signInAnonymously: function () { return Promise.resolve({ user: fakeUser }); },
      onAuthStateChanged: function (cb) { cb(fakeUser); return function unsubscribe() {}; },
      signOut: function () { return Promise.resolve(); },
    };
  }

  window.firebase = {
    apps: [],
    initializeApp: function () { window.firebase.apps.push({}); },
    firestore: firestoreFn,
    auth: authFn,
  };

  window.FSLite = {
    seedIfEmpty: function (seedFn) {
      if (localStorage.getItem(PREFIX + ns)) return;
      const store = {};
      seedFn({ put: function (path, id, data) { (store[path] || (store[path] = {}))[id] = resolveTimestamps(data); } });
      saveStore(store);
    },
  };
})();
