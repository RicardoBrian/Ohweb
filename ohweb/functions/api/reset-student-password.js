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
 * 필요한 Cloudflare 환경변수 — Pages 프로젝트 `ohweb`:
 *   FIREBASE_SERVICE_ACCOUNT_KEY (Secret) = 서비스 계정 JSON 전체.
 *     Firebase 콘솔 → 프로젝트 설정 → 서비스 계정 → "새 비공개 키 생성".
 *     이 키는 학생 Auth 계정을 마음대로 만들고 비밀번호를 바꿀 수 있으므로
 *     절대 이 레포에 커밋하지 않는다.
 *
 *   걸리기 쉬운 것 세 가지:
 *   1) 이름이 한 글자라도 다르면 안 붙는다(대소문자·앞뒤 공백 포함).
 *   2) Production과 Preview가 따로다. admin.kakainfo.com은 Production이다.
 *   3) 값을 넣은 뒤 반드시 재배포해야 적용된다 — 환경변수는 배포 시점에
 *      묶이므로 이미 떠 있는 배포에는 소급되지 않는다. Deployments 탭에서
 *      Retry deployment를 누르거나 새 커밋을 푸시한다.
 *
 *   키가 없으면 이 엔드포인트는 관리자에게 현재 배포에 들어와 있는
 *   환경변수 "이름" 목록을 돌려준다(값은 안 준다) — 위 셋 중 뭐가
 *   틀렸는지 바로 보라고 넣어둔 진단이다.
 *
 * 호출부는 admin.html의 saveStudentEdit()에서 붙인다.
 */

// 이 API들은 전부 같은 도메인의 페이지에서만 부른다. '*'로 열어두면
// 아무 사이트나 브라우저에서 호출해 번역 쿼터(유료)와 코드 실행 쿼터를
// 대신 태울 수 있어서, 우리 도메인으로 좁힌다. (curl 같은 직접 호출은
// CORS로 못 막는다 — 그건 Cloudflare 대시보드의 Rate Limiting 규칙으로
// 따로 걸어야 한다.)
const ALLOWED_ORIGINS = [
  'https://kakainfo.com',
  'https://www.kakainfo.com',
  'https://info.kakainfo.com',
  'https://admin.kakainfo.com',
  'https://short.kakainfo.com',
];
function corsFor(request) {
  const origin = request.headers.get('Origin') || '';
  // *.pages.dev은 커스텀 도메인을 붙이기 전 미리보기 배포에서 쓴다.
  const ok = ALLOWED_ORIGINS.includes(origin) || /^https:\/\/[a-z0-9-]+\.pages\.dev$/.test(origin);
  return {
    'Access-Control-Allow-Origin': ok ? origin : ALLOWED_ORIGINS[0],
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
    'Vary': 'Origin',
  };
}
const CORS = {
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

  // 키 확인은 관리자 인증 뒤에 한다 — 그래야 "이름을 잘못 적었는지"를
  // 관리자에게만 보여주고 진단할 수 있다. 값은 절대 내보내지 않고, 이
  // 배포에 들어와 있는 환경변수 "이름"만 알려준다.
  const saJson = env.FIREBASE_SERVICE_ACCOUNT_KEY;
  if (!saJson) {
    const names = Object.keys(env || {}).filter(k => typeof env[k] === 'string').sort();
    return json({
      error: 'FIREBASE_SERVICE_ACCOUNT_KEY가 이 배포에 없습니다.',
      detail: names.length
        ? `현재 이 배포에 들어와 있는 환경변수: ${names.join(', ')} — 이름이 정확히 FIREBASE_SERVICE_ACCOUNT_KEY인지, Production 환경에 넣었는지, 넣은 뒤 재배포했는지 확인해 주세요.`
        : '이 배포에는 환경변수가 하나도 없습니다. Cloudflare Pages의 ohweb 프로젝트 → Settings → Environment variables에서 Production으로 추가한 뒤 재배포해야 합니다.',
    }, 500);
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

// 응답에 CORS 헤더를 붙인다 — 핸들러 안의 json() 호출을 전부 고치지 않아도
// 되도록 여기서 한 번에 씌운다.
function withCors(res, request) {
  const out = new Response(res.body, res);
  for (const [k, v] of Object.entries(corsFor(request))) out.headers.set(k, v);
  return out;
}

export async function onRequest({ request, env }) {
  try {
    return withCors(await handle(request, env), request);
  } catch (e) {
    // 스택을 응답에 실어 보내면 내부 구조가 노출되고, 200으로 내보내면
    // 호출부가 실패를 성공으로 오해한다. 상세는 Cloudflare 로그에만 남긴다.
    console.error('reset-student-password uncaught:', e);
    return json({ error: '비밀번호 재설정 중 서버 오류가 발생했습니다.' }, 500);
  }
}
