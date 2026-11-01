/**
 * 페이지별 비밀번호(잠금).
 *
 * notion_pages/{주소}에는 locked: true 표시만 둔다(그 컬렉션은 공개 읽기라 비밀번호를
 * 넣으면 누구나 볼 수 있다). 비밀번호 자체는 notion_secrets/{주소}에 있고, 규칙상
 * 관리자만 읽고 쓴다. 여기서는 서비스 계정(FIREBASE_SERVICE_ACCOUNT_KEY)으로 읽는다.
 *
 * 맞게 입력하면 그 주소(하위 페이지 포함) 경로에만 12시간짜리 쿠키를 준다. 쿠키 값은
 * HMAC(키, 주소 + 비밀번호)라서 비밀번호를 바꾸면 이전 쿠키는 저절로 무효가 된다.
 * HMAC 키는 서비스 계정 키에서 만든다(환경변수를 하나 더 늘리지 않으려고).
 *
 * 서비스 계정 키가 없거나 비밀번호를 못 읽으면 잠긴 페이지는 "열지 않는다"(fail closed).
 */
import { PROJECT_ID, statsToken } from './shared.js';

const DOCS = `https://firestore.googleapis.com/v1/projects/${PROJECT_ID}/databases/(default)/documents`;
const COOKIE_MAX_AGE = 12 * 3600;
const SECRET_TTL_MS = 60 * 1000;
const secretCache = new Map();   // 주소 → { password, at }

const enc = new TextEncoder();
const b64url = (buf) => btoa(String.fromCharCode(...new Uint8Array(buf))).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');

async function sha256(text) {
  return crypto.subtle.digest('SHA-256', enc.encode(text));
}

/** notion_secrets/{주소}.password — 없으면 null. 1분 캐시. */
export async function getPassword(env, slug) {
  const hit = secretCache.get(slug);
  if (hit && Date.now() - hit.at < SECRET_TTL_MS) return hit.password;
  const token = await statsToken(env);
  const r = await fetch(`${DOCS}/notion_secrets/${encodeURIComponent(slug)}`, { headers: { Authorization: `Bearer ${token}` } });
  let password = null;
  if (r.ok) password = (await r.json()).fields?.password?.stringValue || null;
  else if (r.status !== 404) throw new Error(`비밀번호 읽기 실패 (${r.status})`);
  secretCache.set(slug, { password, at: Date.now() });
  return password;
}

async function cookieName(slug) {
  return `nl_${b64url(await sha256(slug)).slice(0, 16)}`;
}

async function tokenFor(env, slug, password) {
  const keyBytes = await sha256(`kakanotion-lock:${env.FIREBASE_SERVICE_ACCOUNT_KEY}`);
  const key = await crypto.subtle.importKey('raw', keyBytes, { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  return b64url(await crypto.subtle.sign('HMAC', key, enc.encode(`${slug}\n${password}`)));
}

function readCookie(request, name) {
  const all = request.headers.get('Cookie') || '';
  for (const part of all.split(/;\s*/)) {
    const i = part.indexOf('=');
    if (i > 0 && part.slice(0, i) === name) return part.slice(i + 1);
  }
  return '';
}

// 길이가 같은 문자열을 시간 차이 없이 비교
function safeEqual(a, b) {
  if (typeof a !== 'string' || typeof b !== 'string' || a.length !== b.length) return false;
  let x = 0;
  for (let i = 0; i < a.length; i++) x |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return x === 0;
}

export async function isUnlocked(request, env, slug, password) {
  const got = readCookie(request, await cookieName(slug));
  return !!got && safeEqual(got, await tokenFor(env, slug, password));
}

/** 비밀번호를 맞혔을 때 줄 쿠키(그 주소와 하위 경로에만). */
export async function unlockCookie(env, slug, password) {
  const path = `/${encodeURIComponent(slug)}`;
  return `${await cookieName(slug)}=${await tokenFor(env, slug, password)}; Path=${path}; Max-Age=${COOKIE_MAX_AGE}; HttpOnly; Secure; SameSite=Lax`;
}

export const passwordMatches = (input, password) => safeEqual(String(input || ''), password);
