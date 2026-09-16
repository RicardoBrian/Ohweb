/**
 * Cloudflare Pages Function — /api/reset-student-password
 *
 * admin.html의 "학생 편집 → 비밀번호"가 지금까지 Firestore의 레거시 평문
 * password 필드만 고쳐 쓰고 실제 Firebase Auth 계정 비밀번호는 안 바꿨다
 * (student-auth.js가 로그인을 Firebase Auth로 검증하므로, 그 필드는 이미
 * 마이그레이션된 학생에게는 아무 의미가 없었다 — 그래서 admin이 "재설정"
 * 해도 학생은 로그인이 안 됐고, 심지어 로그인 시도가
 * auth/email-already-in-use로 깨지기까지 했다).
 *
 * 클라이언트 SDK로는 "남의" Firebase Auth 계정 비밀번호를 바꿀 수 없다
 * (본인 재인증이 필요) — 그래서 서비스 계정으로 Identity Toolkit Admin
 * REST API를 직접 호출하는 이 엔드포인트가 필요하다. firebase-admin
 * 패키지는 Cloudflare Workers 런타임과 호환이 불확실해서 안 쓰고, REST +
 * Web Crypto(RS256 서명)만으로 구현했다 — 이렇게 하면 nodejs_compat 플래그
 * 없이도 그대로 동작한다.
 *
 * 필요한 Cloudflare 환경변수(Secret, Production/Preview 둘 다):
 *   FIREBASE_SERVICE_ACCOUNT_KEY — Firebase 콘솔 → 프로젝트 설정 →
 *     서비스 계정 → "새 비공개 키 생성"으로 받은 JSON 파일의 전체 내용을
 *     그대로 문자열 값으로 붙여넣는다. 이 키는 학생 Auth 계정을 마음대로
 *     만들고 비밀번호를 바꿀 수 있는 강력한 권한이므로 절대 이 레포에는
 *     커밋하지 않는다.
 *
 * 호출부는 admin.html의 saveStudentEdit()에서 붙인다.
 */

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
};

const json = (body, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json', ...CORS },
  });

// ohweb/public/firebase-config.js와 동일한 공개 웹 API 키 — 클라이언트
// 번들에 이미 노출돼 있는 값이라 비밀이 아니다. idToken 검증에만 쓴다.
const WEB_API_KEY = 'AIzaSyB1SuaWwJgUY6SrCnmN8dmhG2cnVnGcl2s';
const ADMIN_EMAIL = 'qjatjr7575@gmail.com'; // ohweb-firestore.rules의 isAdmin()과 동일
const EMAIL_SUFFIX = '@ohinfo.local';

// student-auth.js의 padPassword와 반드시 동일해야 한다 — 다르면 그
// 학생만 로그인이 안 됨.
const MIN_LEN = 6;
const PAD_CHAR = '0';
function padPassword(pw) {
  return pw.length >= MIN_LEN ? pw : pw.padEnd(MIN_LEN, PAD_CHAR);
}

function base64urlEncode(bytes) {
  let bin = '';
  for (const b of bytes) bin += String.fromCharCode(b);
  return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function pemToArrayBuffer(pem) {
  const b64 = pem
    .replace(/-----BEGIN PRIVATE KEY-----/, '')
    .replace(/-----END PRIVATE KEY-----/, '')
    .replace(/\s+/g, '');
  const bin = atob(b64);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return bytes.buffer;
}

async function getAccessToken(serviceAccount) {
  const enc = new TextEncoder();
  const now = Math.floor(Date.now() / 1000);
  const header = base64urlEncode(enc.encode(JSON.stringify({ alg: 'RS256', typ: 'JWT' })));
  const claims = base64urlEncode(enc.encode(JSON.stringify({
    iss: serviceAccount.client_email,
    scope: 'https://www.googleapis.com/auth/identitytoolkit',
    aud: 'https://oauth2.googleapis.com/token',
    exp: now + 3600,
    iat: now,
  })));
  const unsigned = `${header}.${claims}`;

  const key = await crypto.subtle.importKey(
    'pkcs8',
    pemToArrayBuffer(serviceAccount.private_key),
    { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' },
    false,
    ['sign']
  );
  const signature = await crypto.subtle.sign('RSASSA-PKCS1-v1_5', key, enc.encode(unsigned));
  const jwt = `${unsigned}.${base64urlEncode(new Uint8Array(signature))}`;

  const res = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer',
      assertion: jwt,
    }),
  });
  const data = await res.json();
  if (!res.ok) throw new Error(`OAuth 토큰 발급 실패: ${JSON.stringify(data)}`);
  return data.access_token;
}

async function verifyAdminIdToken(idToken) {
  const res = await fetch(`https://identitytoolkit.googleapis.com/v1/accounts:lookup?key=${WEB_API_KEY}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ idToken }),
  });
  const data = await res.json();
  if (!res.ok) throw new Error('idToken이 유효하지 않습니다.');
  const email = data.users?.[0]?.email;
  if (email !== ADMIN_EMAIL) throw new Error('관리자 계정이 아닙니다.');
}

async function handle(request, env) {
  if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers: CORS });
  if (request.method !== 'POST') return json({ error: 'Method Not Allowed' }, 405);

  const saJson = env.FIREBASE_SERVICE_ACCOUNT_KEY;
  if (!saJson) return json({ error: 'FIREBASE_SERVICE_ACCOUNT_KEY not configured' }, 500);

  let body;
  try {
    body = await request.json();
  } catch {
    return json({ error: 'invalid JSON body' }, 400);
  }

  const { studentDocId, newPassword, idToken } = body || {};
  if (!studentDocId || typeof studentDocId !== 'string') return json({ error: 'studentDocId가 필요합니다.' }, 400);
  if (!newPassword || typeof newPassword !== 'string' || newPassword.length < 4) {
    return json({ error: '비밀번호는 4자리 이상이어야 합니다.' }, 400);
  }
  if (!idToken || typeof idToken !== 'string') return json({ error: 'idToken이 필요합니다.' }, 401);

  try {
    await verifyAdminIdToken(idToken);
  } catch (e) {
    return json({ error: e.message }, 403);
  }

  let serviceAccount;
  try {
    serviceAccount = JSON.parse(saJson);
  } catch {
    return json({ error: 'FIREBASE_SERVICE_ACCOUNT_KEY가 올바른 JSON이 아닙니다.' }, 500);
  }

  const email = `${studentDocId}${EMAIL_SUFFIX}`;
  const password = padPassword(newPassword);

  try {
    const accessToken = await getAccessToken(serviceAccount);
    const base = `https://identitytoolkit.googleapis.com/v1/projects/${serviceAccount.project_id}`;
    const authHeaders = { 'Content-Type': 'application/json', 'Authorization': `Bearer ${accessToken}` };

    const lookupRes = await fetch(`${base}/accounts:lookup`, {
      method: 'POST', headers: authHeaders, body: JSON.stringify({ email: [email] }),
    });
    const lookupData = await lookupRes.json();
    if (!lookupRes.ok) throw new Error(`계정 조회 실패: ${JSON.stringify(lookupData)}`);
    const existing = lookupData.users?.[0];

    if (existing) {
      const updRes = await fetch(`${base}/accounts:update`, {
        method: 'POST', headers: authHeaders, body: JSON.stringify({ localId: existing.localId, password }),
      });
      if (!updRes.ok) throw new Error(`비밀번호 갱신 실패: ${JSON.stringify(await updRes.json())}`);
    } else {
      const createRes = await fetch(`${base}/accounts`, {
        method: 'POST', headers: authHeaders, body: JSON.stringify({ email, password, emailVerified: true }),
      });
      if (!createRes.ok) throw new Error(`계정 생성 실패: ${JSON.stringify(await createRes.json())}`);
    }

    return json({ ok: true, created: !existing });
  } catch (e) {
    return json({ error: e.message }, 502);
  }
}

export async function onRequest({ request, env }) {
  try {
    return await handle(request, env);
  } catch (e) {
    return json({ error: 'UNCAUGHT', name: e && e.name, message: e && e.message, stack: String(e && e.stack).slice(0, 1000) }, 200);
  }
}
