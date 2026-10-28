import { extractPageId } from './notion.js';
/**
 * ohnotion Functions가 같이 쓰는 것들 — 페이지 조회, 주소 규칙, Firestore REST.
 * (노션 내용 읽기·그리기는 lib/notion.js)
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

// 노션 링크(notion.so / *.notion.site)만 받는다. 내용은 Notion API로 읽으므로
// 링크는 "어느 페이지인지(ID)"를 알아내는 데만 쓴다.
export function isNotionUrl(value) {
  try {
    const u = new URL(value);
    const h = u.hostname;
    return u.protocol === 'https:' && (h === 'notion.site' || h.endsWith('.notion.site') || h === 'notion.so' || h.endsWith('.notion.so'));
  } catch {
    return false;
  }
}

/**
 * URL 경로 → { slug, sub }. /공지 → { slug:'공지', sub:null },
 * /공지/{32자리 ID} → 그 페이지의 하위 페이지. 우리 주소일 수 없으면 null.
 */
export function parsePath(pathname) {
  const parts = pathname.replace(/^\/+|\/+$/g, '').split('/');
  if (!parts[0] || parts.length > 2) return null;
  let slug;
  // pathname은 비-ASCII를 퍼센트 인코딩된 채로 준다 — 한 번 풀고 NFC로 맞춘다
  // (ohinfo/functions/[[code]].js 머리말 참고).
  try { slug = decodeURIComponent(parts[0]).normalize('NFC'); } catch { return null; }
  if (!SLUG_RE.test(slug) || RESERVED.has(slug.toLowerCase())) return null;
  let sub = null;
  if (parts.length === 2) {
    if (!/^[0-9a-f]{32}$/i.test(parts[1])) return null;
    sub = parts[1].toLowerCase();
  }
  return { slug, sub };
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

// 예전에 등록한 문서엔 pageId가 없을 수 있어 url에서 다시 꺼낸다. 둘 다 없으면 못 쓴다.
function withPageId(page) {
  const pageId = /^[0-9a-f]{32}$/.test(page.pageId || '') ? page.pageId : extractPageId(page.url);
  return pageId ? { ...page, pageId } : null;
}

// ── 페이지 조회(공개 읽기) + Cache API ──
// 학생 접속마다 Firestore를 읽으면 무료 한도(하루 5만, ohinfo와 공유)를 금방
// 쓴다. 성공한 조회만 잠깐 캐싱하고, 실패/미존재는 캐싱하지 않는다(막 등록한
// 페이지가 "캐시된 404" 때문에 안 뜨는 걸 막기 위해). 관리 페이지에서 고친
// 내용은 그래서 최대 CACHE_TTL_SECONDS 뒤에 반영된다.
export const CACHE_TTL_SECONDS = 120;

export async function cacheGet(context, key) {
  const hit = await caches.default.match(cacheKeyFor(context, key));
  return hit ? hit.json() : null;
}
export function cachePut(context, key, value, ttlSeconds) {
  return caches.default.put(cacheKeyFor(context, key), new Response(JSON.stringify(value), {
    headers: { 'Cache-Control': `max-age=${ttlSeconds}` },
  }));
}
function cacheKeyFor(context, key) {
  return new Request(new URL(`/__notion-cache/${encodeURIComponent(key)}`, context.request.url));
}

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
    return withPageId(fromFsDoc(await r.json()));
  });
}

export function listPages(context) {
  return cached(context, 'list', async () => {
    const r = await fetch(`${DOCS}/notion_pages?pageSize=300`);
    if (!r.ok) return null;
    const data = await r.json();
    return (data.documents || [])
      .map(fromFsDoc)
      .map(withPageId)
      .filter(Boolean)
      .sort((a, b) => (a.order ?? 0) - (b.order ?? 0) || String(a.title).localeCompare(String(b.title), 'ko'));
  });
}

// ── 서비스 계정 → OAuth 토큰 (통계 쓰기 전용) ──
// ohinfo/functions/api/exam.js와 같은 코드 — Pages 프로젝트가 달라
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

// 서비스 계정 토큰은 1시간짜리라 isolate가 살아 있는 동안 재사용한다.
let tokenCache = { token: null, exp: 0 };
async function statsToken(env) {
  if (tokenCache.token && Date.now() < tokenCache.exp) return tokenCache.token;
  const t = await getAccessToken(JSON.parse(env.FIREBASE_SERVICE_ACCOUNT_KEY));
  tokenCache = { token: t, exp: Date.now() + 50 * 60 * 1000 };
  return t;
}

/** 오늘 통계에 +1. 키가 없거나 실패해도 조용히 넘어간다(통계 때문에 화면이 깨지면 안 됨). */
export async function recordStat(env, slug, result) {
  if (!env.FIREBASE_SERVICE_ACCOUNT_KEY) return false;
  try {
    await incrementStat(await statsToken(env), { slug, day: kstDay(), result });
    return true;
  } catch (e) {
    console.error('notion 통계 기록 실패:', e?.message || e);
    return false;
  }
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
