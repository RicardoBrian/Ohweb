/*
 * 견본용 가짜 Firebase compat(예전 방식). gstatic의 firebase-*-compat.js 세 줄을
 *   <script src=".../fake-firebase/core.js"></script>
 *   <script src=".../fake-firebase/compat.js"></script>
 * 두 줄로 바꾸면 window.firebase가 바로 생긴다. core.js가 먼저 와야 한다.
 */
(function () {
  const F = globalThis.FakeFB;
  if (!F) throw new Error('fake-firebase/core.js를 먼저 불러와야 합니다');
  const later = (fn) => new Promise((res, rej) => setTimeout(() => { try { res(fn()); } catch (e) { rej(e); } }, 0));
  const join = (...s) => s.flat().filter((x) => x !== undefined).map(String).join('/');

  function Query(ns, path, constraints, group) {
    const q = { ns, path, constraints, group: !!group };
    const add = (c) => Query(ns, path, [...constraints, c], group);
    q.where = (field, op, value) => add({ t: 'where', field: field && field.__field ? field.__field : field, op, value });
    q.orderBy = (field, dir = 'asc') => add({ t: 'orderBy', field: field && field.__field ? field.__field : field, dir });
    q.limit = (n) => add({ t: 'limit', n });
    q.limitToLast = (n) => add({ t: 'limitToLast', n });
    q.startAt = (...values) => add({ t: 'startAt', values });
    q.startAfter = (...values) => add({ t: 'startAfter', values });
    q.endAt = (...values) => add({ t: 'endAt', values });
    q.endBefore = (...values) => add({ t: 'endBefore', values });
    q.get = () => later(() => wrapQS(F.querySnap(ns, F.runQuery(q), true)));
    q.onSnapshot = (...args) => {
      if (args[0] && typeof args[0] === 'object' && !('next' in args[0]) && typeof args[1] === 'function') args.shift();
      const next = typeof args[0] === 'function' ? args[0] : args[0] && args[0].next;
      return F.listenQuery(q, true, (qs) => next(wrapQS(qs)));
    };
    return q;
  }
  function Collection(ns, path) {
    const c = Query(ns, path, []);
    c.id = path.split('/').pop();
    c.path = path;
    c.doc = (id) => Doc(ns, join(path, id === undefined ? F.newId() : id));
    c.add = (data) => { const d = c.doc(); return d.set(data).then(() => d); };
    return c;
  }
  function Doc(ns, path) {
    const d = { ns, path, id: path.split('/').pop(), __docref: true, type: 'document' };
    d.collection = (sub) => Collection(ns, join(path, sub));
    Object.defineProperty(d, 'parent', { get: () => Collection(ns, path.split('/').slice(0, -1).join('/')) });
    d.get = () => later(() => wrapSnap(F.docSnap(ns, path, true)));
    d.set = (data, opts = {}) => later(() => F.write(ns, [{ kind: 'set', path, data, merge: !!(opts.merge || opts.mergeFields) }]));
    d.update = (...args) => later(() => F.write(ns, [{ kind: 'update', path, pairs: F.updatePairs(args) }]));
    d.delete = () => later(() => F.write(ns, [{ kind: 'delete', path }]));
    d.onSnapshot = (...args) => {
      if (args[0] && typeof args[0] === 'object' && !('next' in args[0]) && typeof args[1] === 'function') args.shift();
      const next = typeof args[0] === 'function' ? args[0] : args[0] && args[0].next;
      return F.listenDoc(ns, path, true, (s) => next(wrapSnap(s)));
    };
    d.isEqual = (o) => o && o.path === path;
    return d;
  }
  // compat 문서 스냅샷의 ref는 compat 문서 객체여야 한다 (.update 등을 바로 부름)
  function wrapSnap(s) { s.ref = Doc(s.ref.ns, s.ref.path); return s; }
  function wrapQS(qs) {
    qs.docs.forEach(wrapSnap);
    const ch = qs.docChanges();
    ch.forEach((c) => { if (!qs.docs.includes(c.doc)) wrapSnap(c.doc); });
    return qs;
  }

  function Firestore(ns) {
    const db = {
      __ns: ns,
      collection: (p) => Collection(ns, p),
      doc: (p) => Doc(ns, p),
      collectionGroup: (id) => Query(ns, id, [], true),
      batch() {
        const ops = [];
        const b = {
          set(ref, data, opts = {}) { ops.push({ kind: 'set', path: ref.path, data, merge: !!opts.merge }); return b; },
          update(ref, ...args) { ops.push({ kind: 'update', path: ref.path, pairs: F.updatePairs(args) }); return b; },
          delete(ref) { ops.push({ kind: 'delete', path: ref.path }); return b; },
          commit: () => later(() => F.write(ns, ops)),
        };
        return b;
      },
      async runTransaction(fn) {
        const ops = [];
        const t = {
          get: async (ref) => wrapSnap(F.docSnap(ns, ref.path, true)),
          set(ref, data, opts = {}) { ops.push({ kind: 'set', path: ref.path, data, merge: !!opts.merge }); return t; },
          update(ref, ...args) { ops.push({ kind: 'update', path: ref.path, pairs: F.updatePairs(args) }); return t; },
          delete(ref) { ops.push({ kind: 'delete', path: ref.path }); return t; },
        };
        const r = await fn(t);
        F.write(ns, ops);
        return r;
      },
      settings() {}, enablePersistence: async () => {}, useEmulator() {},
    };
    return db;
  }

  const apps = new Map();
  const dbs = new Map();
  function appNs(name) { const a = apps.get(name || '[DEFAULT]'); return a ? a.__ns : 'default'; }

  const firestore = function (app) {
    const ns = app ? app.__ns : appNs();
    if (!dbs.has(ns)) dbs.set(ns, Firestore(ns));
    return dbs.get(ns);
  };
  firestore.FieldValue = {
    serverTimestamp: F.sentinels.serverTimestamp,
    delete: F.sentinels.deleteField,
    increment: F.sentinels.increment,
    arrayUnion: F.sentinels.arrayUnion,
    arrayRemove: F.sentinels.arrayRemove,
  };
  firestore.Timestamp = F.Timestamp;
  firestore.FieldPath = { documentId: () => ({ __field: '__name__' }) };

  const auth = function (app) { return wrapAuth(F.getAuthFor(app ? app.__ns : appNs())); };
  function wrapAuth(a) {
    if (a.__compat) return a;
    a.__compat = true;
    a.signInWithPopup = () => a.signIn();
    a.signInWithRedirect = () => a.signIn();
    a.getRedirectResult = async () => ({ user: null });
    a.signInAnonymously = () => a.signIn({ ...F.DEMO_USER, isAnonymous: true });
    a.signInWithEmailAndPassword = () => a.signIn();
    a.signInWithCustomToken = () => a.signIn();
    a.setPersistence = async () => {};
    a.useEmulator = () => {};
    return a;
  }
  function GoogleAuthProvider() { this.providerId = 'google.com'; }
  GoogleAuthProvider.prototype.addScope = function () { return this; };
  GoogleAuthProvider.prototype.setCustomParameters = function () { return this; };
  auth.GoogleAuthProvider = GoogleAuthProvider;
  auth.Auth = { Persistence: { LOCAL: 'local', SESSION: 'session', NONE: 'none' } };

  globalThis.firebase = {
    SDK_VERSION: '9.22.2-demo',
    apps: [],
    initializeApp(options = {}, name = '[DEFAULT]') {
      const app = { name, options, __ns: options.projectId || name };
      app.firestore = () => firestore(app);
      app.auth = () => auth(app);
      apps.set(name, app);
      globalThis.firebase.apps = [...apps.values()];
      return app;
    },
    app(name) { return apps.get(name || '[DEFAULT]'); },
    firestore,
    auth,
  };
})();
