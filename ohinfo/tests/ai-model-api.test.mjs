// /api/ai-model 테스트 — `node ohinfo/tests/ai-model-api.test.mjs`
import assert from 'node:assert/strict';
import { onRequest } from '../functions/api/ai-model.js';

let n = 0;
const test = async (name, fn) => { await fn(); n++; console.log('✅', name); };
const req = q => ({ request: new Request('https://kakainfo.com/api/ai-model?' + q), waitUntil: () => {} });
const store = new Map();
globalThis.caches = { default: { match: async k => { const b = store.get(k.url); return b ? new Response(b) : undefined; }, put: async (k, r) => { store.set(k.url, await r.text()); } } };
let gasCalls = 0;
const mock = ({ published = true, mv = '2', status = 200, gas = { modelJson: '{}', metadataJson: '{}', weightsBase64: 'AA==' } } = {}) => {
  globalThis.fetch = async (url, init) => {
    if (String(url).includes('firestore')) return new Response(JSON.stringify({ fields: { published: { booleanValue: published }, modelVersion: { integerValue: mv } } }), { status });
    gasCalls++;
    assert.equal(init.method, 'POST');
    assert.equal(JSON.parse(init.body).action, 'getModel');
    return new Response(typeof gas === 'string' ? gas : JSON.stringify(gas));
  };
};

await test('잘못된 요청 거절', async () => {
  mock();
  assert.equal((await onRequest(req('pid=../x&v=1'))).status, 400);
  assert.equal((await onRequest(req('pid=abc_1&v=0'))).status, 400);
});
await test('공개 안 됐거나 번호가 다르면 403', async () => {
  mock({ published: false });
  assert.equal((await onRequest(req('pid=abc_1&v=2'))).status, 403);
  mock({ mv: '3' });
  assert.equal((await onRequest(req('pid=abc_1&v=2'))).status, 403);
  mock({ status: 404 });
  assert.equal((await onRequest(req('pid=abc_1&v=2'))).status, 404);
});
await test('공개된 모델을 받아 주고, 두 번째는 보관본', async () => {
  mock(); gasCalls = 0;
  const r = await onRequest(req('pid=abc_1&v=2'));
  assert.equal(r.status, 200);
  assert.equal((await r.json()).weightsBase64, 'AA==');
  const r2 = await onRequest(req('pid=abc_1&v=2'));
  assert.equal(r2.headers.get('X-Cache'), 'HIT');
  assert.equal(gasCalls, 1);
});
await test('공개를 끄면 보관본도 안 나감', async () => {
  mock({ published: false });
  assert.equal((await onRequest(req('pid=abc_1&v=2'))).status, 403);
});
await test('Apps Script 오류·로그인 화면(HTML)은 코드와 함께 502', async () => {
  mock({ gas: '<html>Sign in</html>' });
  const r = await onRequest(req('pid=zzz_1&v=2'));
  assert.equal(r.status, 502);
  assert.equal((await r.json()).code, 'badResponse');
  mock({ gas: { error: 'notFound: 모델이 없습니다', code: 'notFound' } });
  assert.equal((await (await onRequest(req('pid=zzz_1&v=2'))).json()).code, 'notFound');
});
console.log(`\n${n}개 통과`);
