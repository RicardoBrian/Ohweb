/**
 * 임시 페이지(ohweb/public/temp/{번호}) 참여 조사 → 구글 시트에 한 줄 추가
 *
 * 페이지가 업무용 DB(gwansan-work)에 제출한 뒤 같은 내용을 여기로 보낸다. 시트는 관리자 공유용 사본이고,
 * 원본은 DB다(페이지 오른쪽 위 로그인 → 결과).
 * 서비스 계정: FIREBASE_SERVICE_ACCOUNT_KEY(ohweb-93062). 시트를 이 계정(client_email)에 "편집자"로 공유해야 쓸 수 있다.
 *
 * 두 가지 요청:
 *  - 제출(누구나): { event, id, name, choice } → [응답] 탭 끝에 한 줄
 *  - 맞추기(관리자): { event, mode: 'sync', idToken, rows: [{id, name, choice, at}] }
 *    → [응답] 탭을 DB 내용 그대로 다시 쓴다. DB 가 기준이고 시트에서 고친 건 덮어써진다.
 *    관리자 확인: gwansan-work 로그인 토큰의 이메일이 SYNC_ADMINS 에 있어야 한다.
 */

// 행사 번호 → 시트 ID, 응답 값 → 시트에 적을 글
const SHEETS = {
  '261218': {
    id: '1_RLO0JiStT-sIJuwOeRsjP-bUoV8jsny-eBbQfrB1x8',
    labels: { stay: '숙박 희망', meal: '숙박 비희망 (식사 후 귀가)', no: '연수 참여 비희망' },
  },
};
const SYNC_ADMINS = ['qjatjr7575@gmail.com'];
const WORK_API_KEY = 'AIzaSyAP8AhRYa38nVzgU2C1xvA7OLKaSJo4daw'; // gwansan-work 웹 키(공개 값)
const ORIGINS = ['https://gwansan.com', 'https://admin.kakainfo.com'];

function cors(request) {
  const origin = request.headers.get('Origin') || '';
  return {
    'Access-Control-Allow-Origin': ORIGINS.includes(origin) ? origin : ORIGINS[0],
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
    'Vary': 'Origin',
  };
}
const json = (request, body, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json', ...cors(request) } });

export const onRequestOptions = ({ request }) => new Response(null, { status: 204, headers: cors(request) });

export async function onRequestPost({ request, env }) {
  let body;
  try { body = await request.json(); } catch { return json(request, { error: 'bad json' }, 400); }
  const sheet = SHEETS[String(body.event || '')];
  if (sheet && body.mode === 'sync') return sync(request, env, sheet, body);
  const name = String(body.name || '').trim().replace(/\s+/g, ' ');
  const label = sheet && sheet.labels[body.choice];
  const docId = String(body.id || '').slice(0, 40);
  if (!sheet || !label || !name || name.length > 30 || !/^[A-Za-z0-9]{0,40}$/.test(docId)) {
    return json(request, { error: 'invalid' }, 400);
  }

  let sa;
  try { sa = JSON.parse(env.FIREBASE_SERVICE_ACCOUNT_KEY); } catch { return json(request, { error: 'no service account' }, 500); }

  try {
    const token = await getAccessToken(sa);
    const now = kst(Date.now()); // 한국 시각
    const range = encodeURIComponent('응답!A:E');
    const res = await fetch(
      `https://sheets.googleapis.com/v4/spreadsheets/${sheet.id}/values/${range}:append?valueInputOption=USER_ENTERED&insertDataOption=INSERT_ROWS`,
      {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ values: [[now, safe(name), label, name.replace(/\s+/g, ''), docId]] }),
      },
    );
    if (!res.ok) return json(request, { error: 'sheets', status: res.status, detail: (await res.text()).slice(0, 300) }, 200);
    return json(request, { ok: true });
  } catch (e) {
    return json(request, { error: String(e.message || e).slice(0, 300) }, 200);
  }
}

const safe = (s) => (/^[=+\-@]/.test(s) ? "'" + s : s); // 수식으로 해석되지 않게
const kst = (ms) => new Date(ms + 9 * 3600 * 1000).toISOString().replace('T', ' ').slice(0, 19);

// ── 맞추기: [응답] 탭 = DB ──
async function sync(request, env, sheet, body) {
  // 관리자 확인 (gwansan-work Google 로그인 토큰)
  const look = await fetch(`https://identitytoolkit.googleapis.com/v1/accounts:lookup?key=${WORK_API_KEY}`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ idToken: String(body.idToken || '') }),
  });
  const user = look.ok ? ((await look.json()).users || [])[0] : null;
  const email = user && user.emailVerified ? String(user.email || '').toLowerCase() : '';
  if (!SYNC_ADMINS.includes(email)) return json(request, { error: 'not admin' }, 403);

  const rows = Array.isArray(body.rows) ? body.rows.slice(0, 1000) : [];
  const values = [];
  for (const r of rows) {
    const name = String(r.name || '').trim().replace(/\s+/g, ' ').slice(0, 30);
    const label = sheet.labels[r.choice];
    const id = String(r.id || '');
    const at = Number(r.at);
    if (!name || !label || !/^[A-Za-z0-9]{1,40}$/.test(id) || !Number.isFinite(at)) continue;
    values.push([at, kst(at), safe(name), label, name.replace(/\s+/g, ''), id]);
  }
  values.sort((a, b) => a[0] - b[0]);

  let sa;
  try { sa = JSON.parse(env.FIREBASE_SERVICE_ACCOUNT_KEY); } catch { return json(request, { error: 'no service account' }, 500); }
  try {
    const token = await getAccessToken(sa);
    const base = `https://sheets.googleapis.com/v4/spreadsheets/${sheet.id}/values`;
    const auth = { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' };
    const clear = await fetch(`${base}/${encodeURIComponent('응답!A2:E')}:clear`, { method: 'POST', headers: auth });
    if (!clear.ok) return json(request, { error: 'sheets clear', status: clear.status, detail: (await clear.text()).slice(0, 300) }, 200);
    if (values.length) {
      const put = await fetch(`${base}/${encodeURIComponent('응답!A2:E' + (values.length + 1))}?valueInputOption=USER_ENTERED`, {
        method: 'PUT', headers: auth, body: JSON.stringify({ values: values.map((v) => v.slice(1)) }),
      });
      if (!put.ok) return json(request, { error: 'sheets write', status: put.status, detail: (await put.text()).slice(0, 300) }, 200);
    }
    return json(request, { ok: true, rows: values.length });
  } catch (e) {
    return json(request, { error: String(e.message || e).slice(0, 300) }, 200);
  }
}

// ── 서비스 계정 토큰 (reset-student-password.js 와 같은 방식, 범위만 시트) ──
function base64urlEncode(bytes) {
  let bin = '';
  for (const b of bytes) bin += String.fromCharCode(b);
  return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}
function pemToArrayBuffer(pem) {
  const b64 = pem.replace(/-----BEGIN PRIVATE KEY-----/, '').replace(/-----END PRIVATE KEY-----/, '').replace(/\s+/g, '');
  const bin = atob(b64);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return bytes.buffer;
}
async function getAccessToken(sa) {
  const enc = new TextEncoder();
  const now = Math.floor(Date.now() / 1000);
  const header = base64urlEncode(enc.encode(JSON.stringify({ alg: 'RS256', typ: 'JWT' })));
  const claims = base64urlEncode(enc.encode(JSON.stringify({
    iss: sa.client_email,
    scope: 'https://www.googleapis.com/auth/spreadsheets',
    aud: 'https://oauth2.googleapis.com/token',
    exp: now + 3600,
    iat: now,
  })));
  const unsigned = `${header}.${claims}`;
  const key = await crypto.subtle.importKey('pkcs8', pemToArrayBuffer(sa.private_key),
    { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' }, false, ['sign']);
  const sig = await crypto.subtle.sign('RSASSA-PKCS1-v1_5', key, enc.encode(unsigned));
  const res = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer', assertion: `${unsigned}.${base64urlEncode(new Uint8Array(sig))}` }),
  });
  const data = await res.json();
  if (!res.ok) throw new Error('token: ' + JSON.stringify(data));
  return data.access_token;
}
