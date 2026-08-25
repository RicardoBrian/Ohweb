const encoder = new TextEncoder();

async function hmac(secret, message) {
  const key = await crypto.subtle.importKey(
    "raw",
    encoder.encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"]
  );
  const sig = await crypto.subtle.sign("HMAC", key, encoder.encode(message));
  return btoa(String.fromCharCode(...new Uint8Array(sig)))
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");
}

function timingSafeEqual(a, b) {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) {
    diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  }
  return diff === 0;
}

export function passwordMatches(candidate, expected) {
  if (typeof candidate !== "string" || typeof expected !== "string") return false;
  return timingSafeEqual(candidate, expected);
}

export async function createSessionCookie(secret, ttlSeconds = 60 * 60 * 24 * 7) {
  const expiry = Date.now() + ttlSeconds * 1000;
  const payload = `${expiry}`;
  const sig = await hmac(secret, payload);
  const value = `${payload}.${sig}`;
  return `session=${value}; Path=/; HttpOnly; Secure; SameSite=Strict; Max-Age=${ttlSeconds}`;
}

export function clearSessionCookie() {
  return `session=; Path=/; HttpOnly; Secure; SameSite=Strict; Max-Age=0`;
}

function parseCookies(header) {
  const cookies = {};
  if (!header) return cookies;
  header.split(";").forEach((pair) => {
    const idx = pair.indexOf("=");
    if (idx === -1) return;
    const key = pair.slice(0, idx).trim();
    const val = pair.slice(idx + 1).trim();
    cookies[key] = val;
  });
  return cookies;
}

export async function isAuthenticated(request, secret) {
  if (!secret) return false;
  const cookies = parseCookies(request.headers.get("Cookie"));
  const value = cookies["session"];
  if (!value) return false;
  const idx = value.indexOf(".");
  if (idx === -1) return false;
  const payload = value.slice(0, idx);
  const sig = value.slice(idx + 1);
  const expected = await hmac(secret, payload);
  if (!timingSafeEqual(expected, sig)) return false;
  const expiry = Number(payload);
  if (!Number.isFinite(expiry) || Date.now() > expiry) return false;
  return true;
}

export function jsonResponse(data, init = {}) {
  return new Response(JSON.stringify(data), {
    ...init,
    headers: { "Content-Type": "application/json", ...(init.headers || {}) },
  });
}
