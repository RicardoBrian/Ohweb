// 새 플랫폼 학생 서버 함수(/api/lesson …)가 같이 쓰는 것: CORS, 서비스 계정 토큰, Firestore REST, 학생 본인 확인.
// functions/api/exam.js 에 같은 코드가 있다(시험은 학기 중이라 건드리지 않고 복사해 왔다). 한쪽을 고치면 다른 쪽도 본다.
// 테스트는 FIRESTORE_EMULATOR_HOST / FIREBASE_AUTH_EMULATOR_HOST 가 env 에 있을 때만 에뮬레이터에 붙는다.

const ALLOWED_ORIGINS = ['https://kakainfo.com', 'https://www.kakainfo.com', 'https://info.kakainfo.com', 'https://admin.kakainfo.com'];
export function withCors(res, request) {
  const origin = request.headers.get('Origin') || '';
  const ok = ALLOWED_ORIGINS.includes(origin) || /^https:\/\/[a-z0-9-]+\.pages\.dev$/.test(origin);
  const out = new Response(res.body, res);
  out.headers.set('Access-Control-Allow-Origin', ok ? origin : ALLOWED_ORIGINS[0]);
  out.headers.set('Access-Control-Allow-Methods', 'POST, OPTIONS');
  out.headers.set('Access-Control-Allow-Headers', 'Content-Type');
  out.headers.set('Vary', 'Origin');
  return out;
}
// 5xx 는 Cloudflare 가 본문을 자기 오류 페이지로 바꿔서 원인이 사라진다 → 서버 쪽 실패도 200 + { error }.
export const json = (body, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' } });

const WEB_API_KEY = 'AIzaSyB1SuaWwJgUY6SrCnmN8dmhG2cnVnGcl2s'; // 클라이언트에 이미 공개된 웹 키. 토큰 확인에만 쓴다.
const SAFE_ID = /^[A-Za-z0-9_-]{1,128}$/;
export const isSafeId = s => typeof s === 'string' && SAFE_ID.test(s);
export const normGC = v => String(v ?? '').replace(/학년|년급|학|반|班|кл\./g, '').trim();

// ── 서비스 계정 → 액세스 토큰 ──
const b64u = bytes => { let s = ''; for (const b of bytes) s += String.fromCharCode(b); return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, ''); };
function pemToBuf(pem) {
  const bin = atob(pem.replace(/-----(BEGIN|END) PRIVATE KEY-----/g, '').replace(/\s+/g, ''));
  const out = new Uint8Array(bin.length); for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out.buffer;
}
let _tok = null;
async function accessToken(sa) {
  const nowMs = Date.now();
  if (_tok && _tok.email === sa.client_email && _tok.exp - 300000 > nowMs) return _tok.token;
  const enc = new TextEncoder(), now = Math.floor(nowMs / 1000);
  const unsigned = `${b64u(enc.encode(JSON.stringify({ alg: 'RS256', typ: 'JWT' })))}.${b64u(enc.encode(JSON.stringify({ iss: sa.client_email, scope: 'https://www.googleapis.com/auth/datastore', aud: 'https://oauth2.googleapis.com/token', exp: now + 3600, iat: now })))}`;
  const key = await crypto.subtle.importKey('pkcs8', pemToBuf(sa.private_key), { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' }, false, ['sign']);
  const sig = await crypto.subtle.sign('RSASSA-PKCS1-v1_5', key, enc.encode(unsigned));
  const res = await fetch('https://oauth2.googleapis.com/token', { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer', assertion: `${unsigned}.${b64u(new Uint8Array(sig))}` }) });
  const d = await res.json();
  if (!res.ok) throw new Error('OAuth 토큰 발급 실패: ' + JSON.stringify(d));
  _tok = { email: sa.client_email, token: d.access_token, exp: nowMs + (Number(d.expires_in) || 3600) * 1000 };
  return d.access_token;
}

// ── Firestore REST ──
function fromV(v) {
  if (v == null) return null;
  if ('stringValue' in v) return v.stringValue;
  if ('integerValue' in v) return Number(v.integerValue);
  if ('doubleValue' in v) return v.doubleValue;
  if ('booleanValue' in v) return v.booleanValue;
  if ('nullValue' in v) return null;
  if ('timestampValue' in v) return v.timestampValue;
  if ('arrayValue' in v) return (v.arrayValue.values || []).map(fromV);
  if ('mapValue' in v) return fromF(v.mapValue.fields);
  return null;
}
const fromF = f => Object.fromEntries(Object.entries(f || {}).map(([k, v]) => [k, fromV(v)]));
const toV = v => typeof v === 'string' ? { stringValue: v } : typeof v === 'boolean' ? { booleanValue: v } : typeof v === 'number' ? (Number.isInteger(v) ? { integerValue: String(v) } : { doubleValue: v }) : { nullValue: null };

function makeDb(projectId, token, emulatorHost) {
  const root = `projects/${projectId}/databases/(default)/documents`;
  const base = emulatorHost ? `http://${emulatorHost}/v1/${root}` : `https://firestore.googleapis.com/v1/${root}`;
  const headers = { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` };
  return {
    async get(path) {
      const r = await fetch(`${base}/${path}`, { headers });
      if (r.status === 404) return null;
      if (!r.ok) throw new Error(`Firestore 읽기 실패(${path}): ${(await r.text()).slice(0, 200)}`);
      return fromF((await r.json()).fields);
    },
    async queryEq(collectionId, conds) {
      const fs = Object.entries(conds).map(([f, v]) => ({ fieldFilter: { field: { fieldPath: f }, op: 'EQUAL', value: toV(v) } }));
      const where = fs.length === 1 ? fs[0] : { compositeFilter: { op: 'AND', filters: fs } };
      const r = await fetch(`${base}:runQuery`, { method: 'POST', headers, body: JSON.stringify({ structuredQuery: { from: [{ collectionId }], where } }) });
      if (!r.ok) throw new Error(`Firestore 쿼리 실패(${collectionId}): ${(await r.text()).slice(0, 200)}`);
      return (await r.json()).filter(x => x.document).map(x => ({ id: x.document.name.split('/').pop(), ...fromF(x.document.fields) }));
    },
  };
}

// 서비스 계정을 읽어 DB 클라이언트를 만든다. 설정이 잘못되면 null(원인은 Cloudflare 로그).
export async function openDb(env, tag) {
  if (env?.FIRESTORE_EMULATOR_HOST) return makeDb(env.FIREBASE_PROJECT_ID, 'owner', env.FIRESTORE_EMULATOR_HOST);
  let sa;
  try { sa = JSON.parse(env.FIREBASE_SERVICE_ACCOUNT_KEY || ''); } catch { sa = null; }
  if (!sa?.private_key || !sa?.client_email || !sa?.project_id) { console.error(tag + ': FIREBASE_SERVICE_ACCOUNT_KEY 가 없거나 올바르지 않습니다.'); return null; }
  return makeDb(sa.project_id, await accessToken(sa));
}

// 학생 본인 확인: Auth 이메일은 소문자라 문서 ID를 역산할 수 없다 → 보낸 ID로 만든 이메일과 토큰 이메일을 대조.
export async function verifyStudent(idToken, studentDocId, env) {
  const host = env?.FIREBASE_AUTH_EMULATOR_HOST;
  const url = `${host ? `http://${host}` : 'https://identitytoolkit.googleapis.com'}${host ? '/identitytoolkit.googleapis.com' : ''}/v1/accounts:lookup?key=${WEB_API_KEY}`;
  const r = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ idToken }) });
  if (!r.ok) throw new Error('로그인이 만료되었습니다. 다시 로그인해 주세요.');
  const email = (await r.json()).users?.[0]?.email || '';
  if (email.toLowerCase() !== `${studentDocId}@ohinfo.local`.toLowerCase()) throw new Error('본인 확인에 실패했습니다.');
}
