// 수업일지 서비스 워커 — 화면 파일(앱 틀)을 폰에 보관해 켤 때 인터넷을 기다리지 않고 바로 띄운다.
//   · 화면 파일: 보관본을 바로 주고, 뒤에서 새로 받아 비교 → 바뀌었으면 통째로 바꾸고 화면에 'updated' 를 알린다
//     (앱이 알림을 받으면 작성 중이 아닐 때 다시 열어 새 버전으로 바뀐다 — app.js 의 서비스 워커 부분).
//   · 그 밖의 것(/api/*, Firebase·구글 로그인, 아이콘 등)은 손대지 않는다(그대로 인터넷).
// 이 파일 자체는 _headers 에서 보관 금지라 브라우저가 늘 새로 받는다.
const CACHE = 'classlog-shell-v1';
const SHELL = ['/', '/app.js', '/firebase-config.js', '/theme.css', '/admin-sky.css', '/ohlog.css'];
const keyOf = (url) => { const u = new URL(url); return u.pathname === '/index.html' ? '/' : u.pathname; };

async function fetchAll() {
  const res = await Promise.all(SHELL.map((p) => fetch(p, { cache: 'no-store' })));
  if (res.some((r) => !r.ok)) throw new Error('shell fetch failed');
  return Promise.all(res.map(async (r, i) => [SHELL[i], await r.text(), r.headers.get('content-type') || '']));
}
async function store(files) {
  const c = await caches.open(CACHE);
  await Promise.all(files.map(([p, body, type]) => c.put(p, new Response(body, { headers: { 'content-type': type } }))));
}

self.addEventListener('install', (e) => {
  e.waitUntil(fetchAll().then(store).then(() => self.skipWaiting()));
});
self.addEventListener('activate', (e) => {
  e.waitUntil((async () => {
    for (const k of await caches.keys()) if (k !== CACHE) await caches.delete(k);
    await self.clients.claim();
  })());
});

// 뒤에서 새로 받아 비교. 한꺼번에 받아서 다 성공해야 바꾼다(옛 파일·새 파일이 섞이지 않게).
let running = null, lastAt = 0;
function refresh(force = false) {
  if (running) return running;
  if (!force && Date.now() - lastAt < 5000) return Promise.resolve(false);
  running = (async () => {
    try {
      const files = await fetchAll();
      const c = await caches.open(CACHE);
      let changed = false;
      for (const [p, body] of files) {
        const old = await c.match(p);
        if (!old || (await old.text()) !== body) { changed = true; break; }
      }
      if (changed) {
        await store(files);
        for (const cl of await self.clients.matchAll({ type: 'window' })) cl.postMessage({ type: 'updated' });
      }
      lastAt = Date.now(); // 성공했을 때만(끊겨서 실패한 직후 다시 열면 바로 다시 확인)
      return changed;
    } catch { return false; } finally { running = null; }
  })();
  return running;
}

self.addEventListener('fetch', (e) => {
  const req = e.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  if (url.origin !== location.origin) return;
  const key = req.mode === 'navigate' && (url.pathname === '/' || url.pathname === '/index.html') ? '/' : keyOf(req.url);
  if (!SHELL.includes(key)) return;
  e.respondWith((async () => {
    const hit = await caches.match(key);
    if (hit) {
      if (req.mode === 'navigate') e.waitUntil(refresh()); // 켤 때마다 뒤에서 새 버전 확인
      return hit;
    }
    return fetch(req);
  })());
});

// 앱이 새 버전을 알아챘을 때(/api/version) 보관본을 바로 새로 받게 한다 → 끝나면 답한다
self.addEventListener('message', (e) => {
  if (e.data?.type === 'check') { e.waitUntil(refresh()); return; } // 앱을 다시 볼 때(홈 화면 앱은 메모리에서 되살아나기만 함)
  if (e.data?.type !== 'refresh') return;
  e.waitUntil(refresh(true).then((changed) => e.ports[0]?.postMessage({ changed })));
});
