// 채점 도구용 Firestore REST 클라이언트 (의존성 없음).
//  - 운영: 이 컴퓨터의 firebase CLI 로그인(선생님 계정)으로 토큰을 받아 쓴다. 규칙을 거치지 않는다.
//  - 시험: FIRESTORE_EMULATOR_HOST=127.0.0.1:8181 이 있으면 에뮬레이터에 붙는다(owner 토큰).
import { readFileSync } from 'node:fs';
import { execSync } from 'node:child_process';
import { createRequire } from 'node:module';
import os from 'node:os';
import path from 'node:path';

export const PROJECT = process.env.FIREBASE_PROJECT || 'ohweb-93062';
const EMU = process.env.FIRESTORE_EMULATOR_HOST;
const BASE = EMU
  ? `http://${EMU}/v1/projects/${PROJECT}/databases/(default)/documents`
  : `https://firestore.googleapis.com/v1/projects/${PROJECT}/databases/(default)/documents`;
export const isEmulator = !!EMU;

let tokenCache = null;
async function token() {
  if (EMU) return 'owner';
  if (tokenCache && tokenCache.exp > Date.now() + 60000) return tokenCache.value;
  const cfgPath = path.join(os.homedir(), '.config/configstore/firebase-tools.json');
  let cfg;
  try { cfg = JSON.parse(readFileSync(cfgPath, 'utf8')); } catch { throw new Error('firebase CLI 로그인 정보가 없습니다. 터미널에서 `firebase login` 을 먼저 하세요.'); }
  const refresh = cfg.tokens?.refresh_token;
  if (!refresh) throw new Error('firebase CLI 로그인이 끊겼습니다. `firebase login` 을 다시 하세요.');
  // firebase CLI 의 OAuth 클라이언트 정보(공개값)는 설치된 firebase-tools 에서 가져온다.
  const root = execSync('npm root -g', { encoding: 'utf8' }).trim();
  const api = createRequire(import.meta.url)(path.join(root, 'firebase-tools/lib/api.js'));
  const r = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ refresh_token: refresh, client_id: api.clientId(), client_secret: api.clientSecret(), grant_type: 'refresh_token' }),
  });
  const j = await r.json();
  if (!j.access_token) throw new Error('토큰을 받지 못했습니다. `firebase login --reauth` 를 해 보세요.');
  tokenCache = { value: j.access_token, exp: Date.now() + (j.expires_in || 3000) * 1000 };
  return tokenCache.value;
}
async function call(url, opts = {}) {
  const res = await fetch(url, { ...opts, headers: { authorization: 'Bearer ' + await token(), 'content-type': 'application/json', ...(opts.headers || {}) } });
  const text = await res.text();
  if (!res.ok) throw new Error(`Firestore ${res.status}: ${text.slice(0, 300)}`);
  return text ? JSON.parse(text) : {};
}

// ── 값 변환 ──
export function fromValue(v) {
  if (v == null) return null;
  if ('stringValue' in v) return v.stringValue;
  if ('integerValue' in v) return Number(v.integerValue);
  if ('doubleValue' in v) return v.doubleValue;
  if ('booleanValue' in v) return v.booleanValue;
  if ('nullValue' in v) return null;
  if ('timestampValue' in v) return v.timestampValue;
  if ('arrayValue' in v) return (v.arrayValue.values || []).map(fromValue);
  if ('mapValue' in v) return fromFields(v.mapValue.fields || {});
  return null;
}
export function fromFields(f) { const o = {}; for (const k in f) o[k] = fromValue(f[k]); return o; }
export function toValue(x) {
  if (x === null || x === undefined) return { nullValue: null };
  if (typeof x === 'boolean') return { booleanValue: x };
  if (typeof x === 'number') return Number.isInteger(x) ? { integerValue: String(x) } : { doubleValue: x };
  if (typeof x === 'string') return { stringValue: x };
  if (Array.isArray(x)) return { arrayValue: { values: x.map(toValue) } };
  return { mapValue: { fields: Object.fromEntries(Object.entries(x).map(([k, v]) => [k, toValue(v)])) } };
}
const docOf = d => ({ id: d.name.split('/').pop(), path: d.name.split('/documents/')[1], ...fromFields(d.fields || {}) });

// ── 읽기 ──
export async function getDoc(p) {
  try { return docOf(await call(`${BASE}/${p}`)); }
  catch (e) { if (/Firestore 404/.test(e.message)) return null; throw e; }
}
// where 같음(==) 조건만. 결과는 [{id, path, ...필드}]
export async function queryEq(collectionId, eq = {}) {
  const filters = Object.entries(eq).map(([field, value]) => ({ fieldFilter: { field: { fieldPath: field }, op: 'EQUAL', value: toValue(value) } }));
  const where = filters.length === 0 ? undefined : filters.length === 1 ? filters[0] : { compositeFilter: { op: 'AND', filters } };
  const rows = await call(`${BASE}:runQuery`, { method: 'POST', body: JSON.stringify({ structuredQuery: { from: [{ collectionId }], ...(where ? { where } : {}) } }) });
  return rows.filter(r => r.document).map(r => docOf(r.document));
}
export async function listAll(collectionId) { return queryEq(collectionId, {}); }

// ── 쓰기: 필드 일부만 바꾼다(update + updateMask). serverTime 에 적은 필드는 서버 시각. ──
export async function commitUpdates(updates) {
  const writes = updates.map(({ path: p, data, serverTime = [] }) => ({
    update: { name: `projects/${PROJECT}/databases/(default)/documents/${p}`, fields: Object.fromEntries(Object.entries(data).map(([k, v]) => [k, toValue(v)])) },
    updateMask: { fieldPaths: Object.keys(data) },
    currentDocument: { exists: true },
    ...(serverTime.length ? { updateTransforms: serverTime.map(f => ({ fieldPath: f, setToServerValue: 'REQUEST_TIME' })) } : {}),
  }));
  for (let i = 0; i < writes.length; i += 400) {
    await call(`${BASE}:commit`, { method: 'POST', body: JSON.stringify({ writes: writes.slice(i, i + 400) }) });
  }
}
