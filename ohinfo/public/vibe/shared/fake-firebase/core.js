/*
 * 견본(kakainfo.com/vibe)용 가짜 Firebase 핵심부.
 *
 * 실제 앱 코드는 거의 그대로 두고 gstatic의 Firebase 주소만 이 폴더의 파일로
 * 바꿔서 쓴다. 데이터는 전부 이 브라우저의 localStorage에만 저장되고, 서버로는
 * 아무것도 보내지 않는다. 로그인은 "견본 선생님" 계정으로 바로 된다.
 *
 * import/export가 없는 일반 스크립트라서 두 가지로 쓸 수 있다.
 *   - <script src=".../core.js">  : 예전 방식(compat) 앱. 뒤이어 compat.js를 불러온다.
 *   - import './core.js'          : 모듈 방식. firebase-*.js가 불러온다.
 * 어느 쪽이든 globalThis.FakeFB 하나만 만든다.
 */
(function () {
  if (globalThis.FakeFB) return;

  const KEY = (ns) => 'vibe:' + ns;
  const AUTH_KEY = (ns) => 'vibe-auth:' + ns;

  /* ───── 저장소: 문서 전체 경로("col/id/sub/id2") → 데이터 ───── */
  const cache = new Map();
  function load(ns) {
    if (cache.has(ns)) return cache.get(ns);
    let s;
    try { s = JSON.parse(localStorage.getItem(KEY(ns)) || '{}'); } catch { s = {}; }
    cache.set(ns, s);
    return s;
  }
  function save(ns) {
    try { localStorage.setItem(KEY(ns), JSON.stringify(load(ns))); } catch (e) { console.warn('[견본] 저장 공간이 부족합니다', e); }
    scheduleNotify(ns);
  }
  function newId() {
    const c = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
    let s = '';
    for (let i = 0; i < 20; i++) s += c[Math.floor(Math.random() * c.length)];
    return s;
  }
  const clone = (v) => (v === undefined ? undefined : JSON.parse(JSON.stringify(v)));

  /* ───── 시각 ───── */
  class Timestamp {
    constructor(seconds, nanoseconds) { this.seconds = seconds; this.nanoseconds = nanoseconds || 0; }
    static now() { return Timestamp.fromMillis(Date.now()); }
    static fromDate(d) { return Timestamp.fromMillis(d.getTime()); }
    static fromMillis(ms) { return new Timestamp(Math.floor(ms / 1000), Math.round((ms % 1000) * 1e6)); }
    toMillis() { return this.seconds * 1000 + Math.floor(this.nanoseconds / 1e6); }
    toDate() { return new Date(this.toMillis()); }
    isEqual(o) { return o instanceof Timestamp && o.toMillis() === this.toMillis(); }
    valueOf() { return String(this.toMillis()).padStart(16, '0'); }
    toJSON() { return { __ts: this.toMillis() }; }
  }

  /* ───── 쓰기용 특수값 ───── */
  const S = (type, extra) => Object.assign({ __fake: type }, extra);
  const sentinels = {
    serverTimestamp: () => S('ts'),
    deleteField: () => S('del'),
    increment: (n) => S('inc', { n }),
    arrayUnion: (...items) => S('union', { items }),
    arrayRemove: (...items) => S('remove', { items }),
  };

  function encode(v) {
    if (v instanceof Timestamp) return { __ts: v.toMillis() };
    if (v instanceof Date) return { __ts: v.getTime() };
    if (Array.isArray(v)) return v.map(encode);
    if (v && typeof v === 'object') {
      if (v.__fake) return v;
      if (v.__docref) return { __ref: v.path };
      const o = {};
      for (const k in v) if (v[k] !== undefined) o[k] = encode(v[k]);
      return o;
    }
    return v;
  }
  function decode(v, ns) {
    if (Array.isArray(v)) return v.map((x) => decode(x, ns));
    if (v && typeof v === 'object') {
      if (typeof v.__ts === 'number' && Object.keys(v).length === 1) return Timestamp.fromMillis(v.__ts);
      if (typeof v.__ref === 'string' && Object.keys(v).length === 1) return docRef(ns, v.__ref);
      const o = {};
      for (const k in v) o[k] = decode(v[k], ns);
      return o;
    }
    return v;
  }
  const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);
  function applySentinel(cur, s) {
    switch (s.__fake) {
      case 'ts': return { __ts: Date.now() };
      case 'inc': return (typeof cur === 'number' ? cur : 0) + s.n;
      case 'union': { const a = Array.isArray(cur) ? cur.slice() : []; for (const it of s.items.map(encode)) if (!a.some((x) => same(x, it))) a.push(it); return a; }
      case 'remove': { const rm = s.items.map(encode); return (Array.isArray(cur) ? cur : []).filter((x) => !rm.some((r) => same(x, r))); }
      default: return cur;
    }
  }
  // 특수값(serverTimestamp 등)을 실제 값으로 바꾼다. cur는 같은 자리의 기존 값.
  function resolve(v, cur) {
    if (v && typeof v === 'object' && v.__fake) return applySentinel(cur, v);
    if (Array.isArray(v)) return v.map((x) => resolve(x, undefined));
    if (v && typeof v === 'object' && !('__ts' in v && Object.keys(v).length === 1)) {
      const o = {};
      for (const k in v) {
        if (v[k] && v[k].__fake === 'del') continue;
        o[k] = resolve(v[k], cur && typeof cur === 'object' ? cur[k] : undefined);
      }
      return o;
    }
    return v;
  }
  const isMap = (v) => v && typeof v === 'object' && !Array.isArray(v) && !('__ts' in v && Object.keys(v).length === 1) && !('__ref' in v);
  function deepMerge(base, add) {
    const out = isMap(base) ? { ...base } : {};
    for (const k in add) {
      const v = add[k];
      if (v && v.__fake === 'del') { delete out[k]; continue; }
      if (isMap(v) && !v.__fake) out[k] = deepMerge(out[k], v);
      else out[k] = resolve(v, out[k]);
    }
    return out;
  }
  function getPath(obj, field) {
    if (field === '__name__') return obj && obj.__id;
    return String(field).split('.').reduce((o, k) => (o == null ? undefined : o[k]), obj);
  }
  function setPath(obj, field, v) {
    const ks = String(field).split('.');
    let o = obj;
    for (let i = 0; i < ks.length - 1; i++) { if (!isMap(o[ks[i]])) o[ks[i]] = {}; o = o[ks[i]]; }
    const last = ks[ks.length - 1];
    if (v && v.__fake === 'del') delete o[last];
    else o[last] = resolve(v, o[last]);
  }

  /* ───── 참조 ───── */
  const norm = (p) => String(p).split('/').filter(Boolean).join('/');
  function docRef(ns, path) {
    path = norm(path);
    const parts = path.split('/');
    const ref = {
      __docref: true, type: 'document', ns, path, id: parts[parts.length - 1],
      get parent() { return colRef(ns, parts.slice(0, -1).join('/')); },
    };
    return ref;
  }
  function colRef(ns, path) {
    path = norm(path);
    const parts = path.split('/');
    return {
      __colref: true, type: 'collection', ns, path, id: parts[parts.length - 1], constraints: [],
      get parent() { return parts.length > 1 ? docRef(ns, parts.slice(0, -1).join('/')) : null; },
    };
  }

  /* ───── 읽기 ───── */
  function rawDoc(ns, path) { return load(ns)[norm(path)]; }
  function listCollection(ns, colPath, group) {
    const store = load(ns);
    const out = [];
    const depth = colPath.split('/').length;
    for (const p in store) {
      const parts = p.split('/');
      if (group) {
        if (parts.length % 2 === 0 && parts[parts.length - 2] === colPath) out.push(p);
      } else if (parts.length === depth + 1 && p.startsWith(colPath + '/')) out.push(p);
    }
    return out;
  }
  function cmp(a, b) {
    const ka = a instanceof Timestamp ? a.toMillis() : a && a.__ts !== undefined ? a.__ts : a;
    const kb = b instanceof Timestamp ? b.toMillis() : b && b.__ts !== undefined ? b.__ts : b;
    if (ka === kb) return 0;
    if (ka === undefined || ka === null) return -1;
    if (kb === undefined || kb === null) return 1;
    return ka < kb ? -1 : 1;
  }
  function test(v, op, x) {
    const e = encode(x);
    const val = v && v.__ts !== undefined ? v.__ts : v;
    const ex = e && e.__ts !== undefined ? e.__ts : e;
    switch (op) {
      case '==': return same(v, e);
      case '!=': return v !== undefined && !same(v, e);
      case '<': return val !== undefined && val < ex;
      case '<=': return val !== undefined && val <= ex;
      case '>': return val !== undefined && val > ex;
      case '>=': return val !== undefined && val >= ex;
      case 'in': return Array.isArray(e) && e.some((y) => same(v, y));
      case 'not-in': return v !== undefined && Array.isArray(e) && !e.some((y) => same(v, y));
      case 'array-contains': return Array.isArray(v) && v.some((y) => same(y, e));
      case 'array-contains-any': return Array.isArray(v) && Array.isArray(e) && v.some((y) => e.some((z) => same(y, z)));
      default: return true;
    }
  }
  function runQuery(q) {
    const ns = q.ns;
    const store = load(ns);
    let rows = listCollection(ns, q.path, q.group).map((p) => ({ path: p, data: { ...store[p], __id: p.split('/').pop() } }));
    const cs = q.constraints || [];
    for (const c of cs) if (c.t === 'where') rows = rows.filter((r) => test(getPath(r.data, c.field), c.op, c.value));
    for (const c of cs) if (c.t === 'or') rows = rows.filter((r) => c.parts.some((w) => test(getPath(r.data, w.field), w.op, w.value)));
    const orders = cs.filter((c) => c.t === 'orderBy');
    // Firestore는 orderBy 필드가 없는 문서를 결과에서 뺀다
    for (const o of orders) if (o.field !== '__name__') rows = rows.filter((r) => getPath(r.data, o.field) !== undefined);
    rows.sort((a, b) => {
      for (const o of orders) {
        const c = cmp(getPath(a.data, o.field), getPath(b.data, o.field));
        if (c) return o.dir === 'desc' ? -c : c;
      }
      return cmp(a.path, b.path);
    });
    for (const c of cs) {
      if (!['startAt', 'startAfter', 'endAt', 'endBefore'].includes(c.t) || !orders.length) continue;
      const o = orders[0];
      const key = c.values[0] && c.values[0].__docsnap ? getPath({ ...c.values[0].__raw, __id: c.values[0].id }, o.field) : encode(c.values[0]);
      const d = o.dir === 'desc' ? -1 : 1;
      rows = rows.filter((r) => {
        const k = cmp(getPath(r.data, o.field), key) * d;
        return c.t === 'startAt' ? k >= 0 : c.t === 'startAfter' ? k > 0 : c.t === 'endAt' ? k <= 0 : k < 0;
      });
    }
    const lim = cs.find((c) => c.t === 'limit');
    if (lim) rows = rows.slice(0, lim.n);
    const limL = cs.find((c) => c.t === 'limitToLast');
    if (limL) rows = rows.slice(-limL.n);
    return rows.map((r) => r.path);
  }

  /* ───── 스냅샷 (modular / compat 공용, compat는 exists가 속성) ───── */
  function docSnap(ns, path, compat) {
    const raw = rawDoc(ns, path);
    const ref = docRef(ns, path);
    const data = () => (raw === undefined ? undefined : decode(clone(raw), ns));
    const s = {
      __docsnap: true, __raw: raw, id: ref.id, ref,
      data, get: (f) => getPath(data(), f),
      metadata: { hasPendingWrites: false, fromCache: false },
    };
    if (compat) s.exists = raw !== undefined; else s.exists = () => raw !== undefined;
    return s;
  }
  function querySnap(ns, paths, compat, prev) {
    const docs = paths.map((p) => docSnap(ns, p, compat));
    const changes = [];
    const now = new Map(paths.map((p, i) => [p, { i, j: JSON.stringify(rawDoc(ns, p)) }]));
    if (prev) {
      prev.forEach((v, p) => { if (!now.has(p)) changes.push({ type: 'removed', doc: docSnap(ns, p, compat), oldIndex: v.i, newIndex: -1 }); });
      now.forEach((v, p) => {
        const o = prev.get(p);
        if (!o) changes.push({ type: 'added', doc: docs[v.i], oldIndex: -1, newIndex: v.i });
        else if (o.j !== v.j) changes.push({ type: 'modified', doc: docs[v.i], oldIndex: o.i, newIndex: v.i });
      });
    } else docs.forEach((d, i) => changes.push({ type: 'added', doc: d, oldIndex: -1, newIndex: i }));
    // 삭제된 문서는 data()를 부를 수 없으니 removed 변화의 doc은 마지막 값을 기억해 둔다
    return {
      docs, size: docs.length, empty: docs.length === 0,
      forEach: (fn) => docs.forEach(fn),
      docChanges: () => changes,
      metadata: { hasPendingWrites: false, fromCache: false },
      __state: now,
    };
  }

  /* ───── 쓰기 ───── */
  function write(ns, ops) {
    const store = load(ns);
    for (const op of ops) {
      const p = norm(op.path);
      if (op.kind === 'set') {
        const data = encode(op.data);
        store[p] = op.merge ? deepMerge(store[p], data) : resolve(data, undefined);
      } else if (op.kind === 'update') {
        if (store[p] === undefined) {
          const e = new Error('No document to update: ' + p);
          e.code = 'not-found';
          throw e;
        }
        const cur = clone(store[p]);
        for (const [f, v] of op.pairs) setPath(cur, f, encode(v));
        store[p] = cur;
      } else if (op.kind === 'delete') {
        delete store[p];
      }
    }
    save(ns);
  }
  function updatePairs(args) {
    if (args.length === 1 && args[0] && typeof args[0] === 'object') return Object.entries(args[0]);
    const pairs = [];
    for (let i = 0; i < args.length; i += 2) pairs.push([typeof args[i] === 'string' ? args[i] : args[i].__field, args[i + 1]]);
    return pairs;
  }

  /* ───── 실시간 구독 ───── */
  const subs = new Set();
  const pending = new Set();
  function scheduleNotify(ns) {
    if (pending.has(ns)) return;
    pending.add(ns);
    setTimeout(() => { pending.delete(ns); for (const s of [...subs]) if (s.ns === ns) s.run(); }, 0);
  }
  window.addEventListener('storage', (e) => {
    if (!e.key || !e.key.startsWith('vibe:')) return;
    const ns = e.key.slice(5);
    cache.delete(ns);
    scheduleNotify(ns);
  });
  function subscribe(ns, run) {
    const s = { ns, run };
    subs.add(s);
    setTimeout(() => subs.has(s) && run(), 0);
    return () => subs.delete(s);
  }
  function listenDoc(ns, path, compat, next) {
    let last;
    return subscribe(ns, () => {
      const j = JSON.stringify(rawDoc(ns, path));
      if (j === last) return;
      last = j;
      next(docSnap(ns, path, compat));
    });
  }
  function listenQuery(q, compat, next) {
    let prev = null;
    let lastKey;
    return subscribe(q.ns, () => {
      const paths = runQuery(q);
      const key = JSON.stringify(paths.map((p) => [p, rawDoc(q.ns, p)]));
      if (key === lastKey) return;
      lastKey = key;
      const snap = querySnap(q.ns, paths, compat, prev);
      prev = snap.__state;
      next(snap);
    });
  }

  /* ───── 로그인 ───── */
  const DEMO_USER = {
    uid: 'demo-teacher', email: 'teacher@example.com', displayName: '견본 선생님',
    photoURL: null, emailVerified: true, isAnonymous: false, phoneNumber: null,
    providerId: 'firebase', providerData: [{ providerId: 'google.com', uid: 'demo-teacher', email: 'teacher@example.com', displayName: '견본 선생님' }],
    metadata: { creationTime: new Date(0).toUTCString(), lastSignInTime: new Date().toUTCString() },
  };
  function makeUser(u) {
    if (!u) return null;
    return Object.assign({}, u, {
      getIdToken: async () => 'demo-token',
      getIdTokenResult: async () => ({ token: 'demo-token', claims: {} }),
      reload: async () => {},
      toJSON: () => u,
    });
  }
  const auths = new Map();
  function getAuthFor(ns) {
    if (auths.has(ns)) return auths.get(ns);
    let stored;
    try { stored = localStorage.getItem(AUTH_KEY(ns)); } catch { stored = null; }
    const startUser = stored === null ? (FakeFB.autoLogin ? DEMO_USER : null) : JSON.parse(stored);
    const a = {
      ns, currentUser: makeUser(startUser), languageCode: 'ko', settings: {}, __listeners: new Set(),
      _set(u) {
        a.currentUser = makeUser(u);
        try { localStorage.setItem(AUTH_KEY(ns), JSON.stringify(u)); } catch { /* 무시 */ }
        for (const cb of [...a.__listeners]) setTimeout(() => cb(a.currentUser), 0);
      },
      onAuthStateChanged(cb) {
        const fn = typeof cb === 'function' ? cb : cb && cb.next;
        a.__listeners.add(fn);
        setTimeout(() => a.__listeners.has(fn) && fn(a.currentUser), 0);
        return () => a.__listeners.delete(fn);
      },
      async signIn(user) { a._set(user || DEMO_USER); return { user: a.currentUser, credential: null, additionalUserInfo: { isNewUser: false } }; },
      async signOut() { a._set(null); },
      useDeviceLanguage() {},
    };
    a.onIdTokenChanged = a.onAuthStateChanged;
    auths.set(ns, a);
    return a;
  }

  const FakeFB = {
    autoLogin: true,
    DEMO_USER, Timestamp, sentinels, newId,
    docRef, colRef, docSnap, querySnap, runQuery, rawDoc, write, updatePairs,
    listenDoc, listenQuery, getAuthFor, load, save,
    /** 이 앱 저장소가 비어 있을 때만 견본 데이터를 채운다. put(경로, 데이터) */
    seed(ns, fn) {
      let has;
      try { has = localStorage.getItem(KEY(ns)) !== null; } catch { has = true; }
      if (has) return false;
      const store = load(ns);
      fn((path, data) => { store[norm(path)] = resolve(encode(data), undefined); });
      save(ns);
      return true;
    },
    /** 견본 데이터를 처음 상태로 되돌린다 (페이지의 "처음으로" 버튼용) */
    reset(ns) {
      try {
        localStorage.removeItem(KEY(ns));
        for (let i = localStorage.length - 1; i >= 0; i--) { const k = localStorage.key(i); if (k && k.startsWith(AUTH_KEY(ns))) localStorage.removeItem(k); }
      } catch { /* 무시 */ }
      cache.delete(ns);
    },
  };
  globalThis.FakeFB = FakeFB;
})();
