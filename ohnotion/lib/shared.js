/**
 * ohnotion Functions가 같이 쓰는 것들 — 페이지 조회, 주소 규칙, Firestore REST.
 *
 * functions/ 밖에 두는 이유: functions/ 안의 파일은 전부 라우트로 취급되므로
 * 공용 모듈은 바깥에 두고 상대 경로로 import 한다(Pages 빌드가 함께 묶는다).
 *
 * ⚠ SLUG_RE / RESERVED / isNotionUrl은 public/admin.js에도 같은 사본이 있다
 * (브라우저 코드라 이 모듈을 import 할 수 없다). 한쪽을 고치면 다른 쪽도 같이.
 * 규칙 쪽(ohweb-firestore.rules의 validNotionPage)도 같은 URL 조건을 건다.
 */

export const PROJECT_ID = 'ohweb-93062';
const DOCS = `https://firestore.googleapis.com/v1/projects/${PROJECT_ID}/databases/(default)/documents`;

// 한글/영문/숫자/-/_ 1~40자. 점(.)이 없으므로 정적 파일 요청과 절대 안 겹친다.
export const SLUG_RE = /^[\p{L}\p{N}_-]{1,40}$/u;
// 실제 경로(admin, api)와, 봇이 흔히 찔러보는 이름 — 이 이름으로는 페이지를
// 못 만들고, 요청이 와도 Firestore를 읽지 않는다(무료 읽기 한도 보호).
export const RESERVED = new Set([
  'admin', 'api', 'login', 'logout',
  'wp-admin', 'wp-login', 'wp-content', 'wp-includes', 'wp-json', 'xmlrpc', 'graphql', 'phpmyadmin',
  'config', 'backup', 'env', 'robots', 'sitemap', 'feed', 'rss', 'server-status', 'actuator', 'swagger',
]);

// 노션 "웹에 게시" 링크만 받는다. notion.so 링크는 노션 앱 모드로 열려서
// iframe 안에서 막히거나 로그인 화면이 뜬다 — 그게 애초에 이 사이트를 만든 이유다.
export function isNotionUrl(value) {
  try {
    const u = new URL(value);
    return u.protocol === 'https:' && (u.hostname === 'notion.site' || u.hostname.endsWith('.notion.site'));
  } catch {
    return false;
  }
}

/** URL 경로의 첫 세그먼트를 슬러그로. 슬러그일 수 없으면 null. */
export function slugFromPath(pathname) {
  const stripped = pathname.replace(/^\/+|\/+$/g, '');
  if (!stripped || stripped.includes('/')) return null;
  let slug;
  // pathname은 비-ASCII를 퍼센트 인코딩된 채로 준다 — 한 번 풀고 NFC로 맞춘다
  // (ohinfo/functions/[[code]].js 머리말 참고).
  try { slug = decodeURIComponent(stripped).normalize('NFC'); } catch { return null; }
  if (!SLUG_RE.test(slug) || RESERVED.has(slug.toLowerCase())) return null;
  return slug;
}

export function escapeHtml(str) {
  return String(str ?? '').replace(/[&<>"']/g, (c) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
  }[c]));
}

/** 한국 날짜 'YYYY-MM-DD' — 일별 통계 문서의 키. */
export function kstDay(date = new Date()) {
  return new Date(date.getTime() + 9 * 3600 * 1000).toISOString().slice(0, 10);
}

// ── Firestore REST 값 변환 ──
function fromFsValue(v) {
  if (v == null) return null;
  if ('stringValue' in v) return v.stringValue;
  if ('integerValue' in v) return Number(v.integerValue);
  if ('doubleValue' in v) return v.doubleValue;
  if ('booleanValue' in v) return v.booleanValue;
  if ('timestampValue' in v) return v.timestampValue;
  return null;
}
function fromFsDoc(d) {
  const out = { slug: decodeURIComponent(d.name.split('/').pop()) };
  for (const [k, v] of Object.entries(d.fields || {})) out[k] = fromFsValue(v);
  return out;
}

// ── 페이지 조회(공개 읽기) + Cache API ──
// 학생 접속마다 Firestore를 읽으면 무료 한도(하루 5만, ohinfo와 공유)를 금방
// 쓴다. 성공한 조회만 잠깐 캐싱하고, 실패/미존재는 캐싱하지 않는다(막 등록한
// 페이지가 "캐시된 404" 때문에 안 뜨는 걸 막기 위해). 관리 페이지에서 고친
// 내용은 그래서 최대 CACHE_TTL_SECONDS 뒤에 반영된다.
export const CACHE_TTL_SECONDS = 120;

async function cached(context, key, load) {
  const cache = caches.default;
  const cacheKey = new Request(new URL(`/__notion-cache/${encodeURIComponent(key)}`, context.request.url));
  const hit = await cache.match(cacheKey);
  if (hit) return hit.json();
  const value = await load();
  if (value != null) {
    context.waitUntil(cache.put(cacheKey, new Response(JSON.stringify(value), {
      headers: { 'Cache-Control': `max-age=${CACHE_TTL_SECONDS}` },
    })));
  }
  return value;
}

export function getPage(context, slug) {
  return cached(context, `page:${slug}`, async () => {
    const r = await fetch(`${DOCS}/notion_pages/${encodeURIComponent(slug)}`);
    if (!r.ok) return null;
    const page = fromFsDoc(await r.json());
    return isNotionUrl(page.url) ? page : null;
  });
}

export function listPages(context) {
  return cached(context, 'list', async () => {
    const r = await fetch(`${DOCS}/notion_pages?pageSize=300`);
    if (!r.ok) return null;
    const data = await r.json();
    return (data.documents || [])
      .map(fromFsDoc)
      .filter((p) => isNotionUrl(p.url))
      .sort((a, b) => (a.order ?? 0) - (b.order ?? 0) || String(a.title).localeCompare(String(b.title), 'ko'));
  });
}

// ── 서비스 계정 → OAuth 토큰 (통계 쓰기 전용) ──
// ohinfo/functions/api/grade-exam.js와 같은 코드 — Pages 프로젝트가 달라
// 모듈을 공유할 수 없어서 중복이다. 한쪽을 고치면 다른 쪽도 같이 본다.
function base64urlEncode(bytes) {
  let bin = '';
  for (const b of bytes) bin += String.fromCharCode(b);
  return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}
function pemToArrayBuffer(pem) {
  const b64 = pem.replace(/-----BEGIN PRIVATE KEY-----/, '')
                 .replace(/-----END PRIVATE KEY-----/, '')
                 .replace(/\s+/g, '');
  const bin = atob(b64);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return bytes.buffer;
}
export async function getAccessToken(sa) {
  const enc = new TextEncoder();
  const now = Math.floor(Date.now() / 1000);
  const header = base64urlEncode(enc.encode(JSON.stringify({ alg: 'RS256', typ: 'JWT' })));
  const claims = base64urlEncode(enc.encode(JSON.stringify({
    iss: sa.client_email,
    scope: 'https://www.googleapis.com/auth/datastore',
    aud: 'https://oauth2.googleapis.com/token',
    exp: now + 3600,
    iat: now,
  })));
  const unsigned = `${header}.${claims}`;
  const key = await crypto.subtle.importKey(
    'pkcs8', pemToArrayBuffer(sa.private_key),
    { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' }, false, ['sign']
  );
  const sig = await crypto.subtle.sign('RSASSA-PKCS1-v1_5', key, enc.encode(unsigned));
  const jwt = `${unsigned}.${base64urlEncode(new Uint8Array(sig))}`;
  const res = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer', assertion: jwt }),
  });
  const data = await res.json();
  if (!res.ok) throw new Error(`OAuth 토큰 발급 실패: ${JSON.stringify(data)}`);
  return data.access_token;
}

/** notion_stats/{day}_{slug}의 카운터 하나를 원자적으로 +1. 문서가 없으면 만든다. */
export async function incrementStat(token, { slug, day, result }) {
  const docRoot = `projects/${PROJECT_ID}/databases/(default)/documents`;
  const name = `${docRoot}/notion_stats/${encodeURIComponent(`${day}_${slug}`)}`;
  const res = await fetch(`https://firestore.googleapis.com/v1/${docRoot}:commit`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${token}` },
    body: JSON.stringify({
      writes: [{
        update: {
          name,
          fields: { slug: { stringValue: slug }, day: { stringValue: day }, lastResult: { stringValue: result } },
        },
        updateMask: { fieldPaths: ['slug', 'day', 'lastResult'] },
        updateTransforms: [
          { fieldPath: result, increment: { integerValue: '1' } },
          { fieldPath: 'lastAt', setToServerValue: 'REQUEST_TIME' },
        ],
      }],
    }),
  });
  if (!res.ok) throw new Error(`통계 기록 실패: ${(await res.text()).slice(0, 200)}`);
}
