// /api/img-proxy 테스트 — `node ohinfo/tests/img-proxy.test.mjs`
import assert from 'node:assert/strict';
import { onRequest, isBlockedHost } from '../functions/api/img-proxy.js';

const realFetch = globalThis.fetch;
let n = 0;
const test = async (name, fn) => { await fn(); n++; console.log('✅', name); };
const req = (body, origin = 'https://kakainfo.com', method = 'POST') =>
  new Request('https://kakainfo.com/api/img-proxy', { method, headers: { Origin: origin, 'Content-Type': 'application/json' }, body: method === 'POST' ? JSON.stringify(body) : undefined });
const upstream = (status, type, bytes, extra = {}) => { globalThis.fetch = async () => new Response(bytes, { status, headers: { 'Content-Type': type, ...extra } }); };

await test('내부망 주소 막기', () => {
  for (const h of ['localhost', '127.0.0.1', '10.1.2.3', '192.168.0.1', '172.20.0.1', '169.254.169.254', '[::1]', 'x.internal']) assert.ok(isBlockedHost(h), h);
  for (const h of ['example.com', '8.8.8.8', '172.32.0.1']) assert.ok(!isBlockedHost(h), h);
});
await test('다른 사이트에서 부르면 거절', async () => {
  upstream(200, 'image/jpeg', new Uint8Array([1, 2, 3]));
  assert.equal((await onRequest({ request: req({ url: 'https://a.com/x.jpg' }, 'https://evil.com') })).status, 403);
});
await test('사진 받아 오기', async () => {
  upstream(200, 'image/jpeg', new Uint8Array([1, 2, 3]));
  const r = await onRequest({ request: req({ url: 'https://a.com/x.jpg' }) });
  assert.equal(r.status, 200);
  assert.equal(r.headers.get('Content-Type'), 'image/jpeg');
  assert.equal(r.headers.get('Access-Control-Allow-Origin'), 'https://kakainfo.com');
  assert.deepEqual([...new Uint8Array(await r.arrayBuffer())], [1, 2, 3]);
});
await test('사진이 아니면 거절(HTML, SVG)', async () => {
  upstream(200, 'text/html', 'hi');
  assert.equal((await onRequest({ request: req({ url: 'https://a.com/' }) })).status, 415);
  upstream(200, 'image/svg+xml', '<svg/>');
  assert.equal((await onRequest({ request: req({ url: 'https://a.com/x.svg' }) })).status, 415);
});
await test('8MB 넘으면 거절(길이 정보가 없어도)', async () => {
  upstream(200, 'image/png', new Uint8Array(9 * 1024 * 1024));
  assert.equal((await onRequest({ request: req({ url: 'https://a.com/big.png' }) })).status, 413);
});
await test('이상한 주소·프로토콜 거절', async () => {
  assert.equal((await onRequest({ request: req({ url: 'file:///etc/passwd' }) })).status, 400);
  assert.equal((await onRequest({ request: req({ url: 'http://127.0.0.1/x.png' }) })).status, 400);
  assert.equal((await onRequest({ request: req({ url: 'not a url' }) })).status, 400);
});
await test('GET 거절, OPTIONS 허용', async () => {
  assert.equal((await onRequest({ request: req(null, 'https://kakainfo.com', 'GET') })).status, 405);
  assert.equal((await onRequest({ request: req(null, 'https://kakainfo.com', 'OPTIONS') })).status, 204);
});
globalThis.fetch = realFetch;
console.log(`\n${n}개 통과`);
