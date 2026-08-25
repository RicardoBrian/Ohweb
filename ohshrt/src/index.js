import {
  clearSessionCookie,
  createSessionCookie,
  isAuthenticated,
  jsonResponse,
  passwordMatches,
} from "./utils.js";

// Letters of any script, so Korean codes like /수업 work, plus digits, - and _.
// The u flag makes the length a count of characters rather than UTF-16 units.
const CODE_RE = /^[\p{L}\p{N}_-]{2,32}$/u;
const RESERVED = new Set(["api", "admin", "login", "logout", "favicon.ico"]);

function randomCode(len = 6) {
  const chars = "abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789";
  const bytes = crypto.getRandomValues(new Uint8Array(len));
  return Array.from(bytes, (b) => chars[b % chars.length]).join("");
}

function isValidUrl(value) {
  try {
    const u = new URL(value);
    return u.protocol === "http:" || u.protocol === "https:";
  } catch {
    return false;
  }
}

async function handleLogin(request, env) {
  if (!env.ADMIN_PASSWORD || !env.SESSION_SECRET) {
    return jsonResponse(
      { error: "서버에 ADMIN_PASSWORD / SESSION_SECRET이 설정되지 않았습니다" },
      { status: 500 }
    );
  }

  let body;
  try {
    body = await request.json();
  } catch {
    return jsonResponse({ error: "잘못된 요청입니다" }, { status: 400 });
  }

  const { password } = body || {};
  if (!passwordMatches(password, env.ADMIN_PASSWORD)) {
    return jsonResponse({ error: "비밀번호가 올바르지 않습니다" }, { status: 401 });
  }

  const cookie = await createSessionCookie(env.SESSION_SECRET);
  return jsonResponse({ ok: true }, { headers: { "Set-Cookie": cookie } });
}

async function handleListLinks(env) {
  const list = await env.LINKS.list();
  const items = await Promise.all(
    list.keys.map(async (k) => {
      const raw = await env.LINKS.get(k.name);
      if (!raw) return null;
      const data = JSON.parse(raw);
      return { code: k.name, ...data };
    })
  );
  const links = items.filter(Boolean).sort((a, b) => b.createdAt - a.createdAt);
  return jsonResponse({ links });
}

async function handleCreateLink(request, env) {
  let body;
  try {
    body = await request.json();
  } catch {
    return jsonResponse({ error: "잘못된 요청입니다" }, { status: 400 });
  }

  const { url, alias } = body || {};
  if (typeof url !== "string" || !isValidUrl(url)) {
    return jsonResponse({ error: "유효한 URL을 입력하세요 (http:// 또는 https://)" }, { status: 400 });
  }

  let code = alias ? String(alias).trim() : "";
  if (code) {
    if (!CODE_RE.test(code) || RESERVED.has(code.toLowerCase())) {
      return jsonResponse(
        { error: "커스텀 코드는 한글/영문/숫자/-/_ 2~32자여야 하며 예약어는 사용할 수 없습니다" },
        { status: 400 }
      );
    }
    const existing = await env.LINKS.get(code);
    if (existing) {
      return jsonResponse({ error: "이미 사용 중인 코드입니다" }, { status: 409 });
    }
  } else {
    for (let i = 0; i < 5; i++) {
      const candidate = randomCode();
      const existing = await env.LINKS.get(candidate);
      if (!existing) {
        code = candidate;
        break;
      }
    }
    if (!code) {
      return jsonResponse({ error: "코드 생성에 실패했습니다. 다시 시도하세요" }, { status: 500 });
    }
  }

  const data = { url, createdAt: Date.now() };
  await env.LINKS.put(code, JSON.stringify(data));
  return jsonResponse({ code, ...data }, { status: 201 });
}

async function handleDeleteLink(env, code) {
  const existing = await env.LINKS.get(code);
  if (!existing) {
    return jsonResponse({ error: "찾을 수 없습니다" }, { status: 404 });
  }
  await env.LINKS.delete(code);
  return jsonResponse({ ok: true });
}

async function handleApi(request, env, path) {
  const method = request.method;

  if (path === "/api/login" && method === "POST") {
    return handleLogin(request, env);
  }

  if (path === "/api/logout" && method === "POST") {
    return jsonResponse({ ok: true }, { headers: { "Set-Cookie": clearSessionCookie() } });
  }

  if (path === "/api/session" && method === "GET") {
    const authenticated = await isAuthenticated(request, env.SESSION_SECRET);
    // The admin page is served from its own hostname, so tell it which origin
    // the links should be handed out under.
    const baseUrl = env.PUBLIC_BASE_URL || new URL(request.url).origin;
    return jsonResponse({ authenticated, baseUrl });
  }

  // Everything below requires a valid session.
  if (!(await isAuthenticated(request, env.SESSION_SECRET))) {
    return jsonResponse({ error: "Unauthorized" }, { status: 401 });
  }

  if (path === "/api/links") {
    if (method === "GET") return handleListLinks(env);
    if (method === "POST") return handleCreateLink(request, env);
    return jsonResponse({ error: "Method not allowed" }, { status: 405 });
  }

  if (path.startsWith("/api/links/")) {
    const code = decodeURIComponent(path.slice("/api/links/".length));
    if (method === "DELETE") return handleDeleteLink(env, code);
    return jsonResponse({ error: "Method not allowed" }, { status: 405 });
  }

  return jsonResponse({ error: "Not found" }, { status: 404 });
}

// A Korean code travels as percent-encoded UTF-8, so decode before the lookup.
// Malformed escapes throw rather than matching anything, so treat them as a miss.
function decodeCode(segment) {
  try {
    return decodeURIComponent(segment);
  } catch {
    return null;
  }
}

function notFound() {
  return new Response("404: 존재하지 않는 링크입니다.", {
    status: 404,
    headers: { "Content-Type": "text/plain; charset=utf-8" },
  });
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    const path = url.pathname;

    if (path.startsWith("/api/")) {
      return handleApi(request, env, path);
    }

    // Static assets (the admin SPA) are served before the Worker runs, so any
    // single-segment path reaching here is a short code lookup.
    const segment = path.slice(1);
    if (request.method === "GET" && segment && !segment.includes("/")) {
      const code = decodeCode(segment);
      const raw = code && (await env.LINKS.get(code));
      if (raw) {
        return Response.redirect(JSON.parse(raw).url, 302);
      }
    }

    return notFound();
  },
};
