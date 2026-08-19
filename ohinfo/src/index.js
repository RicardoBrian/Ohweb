// Static files in ./public are served first; anything that does not match an
// asset falls through to this Worker. Only /api/translate is handled here.
//
// Port of the Vercel function in ../api/translate.js — same request and
// response shape, so the pages calling it need no changes.

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Content-Type": "application/json",
};

function json(body, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: CORS });
}

async function translateOne(text, sourceLang, targetLang) {
  if (!text || !text.trim()) return "";
  const url =
    "https://translate.googleapis.com/translate_a/single" +
    `?client=gtx&sl=${sourceLang.toLowerCase()}&tl=${targetLang.toLowerCase()}` +
    `&dt=t&q=${encodeURIComponent(text)}`;
  const r = await fetch(url);
  if (!r.ok) throw new Error(`translate HTTP ${r.status}`);
  const data = await r.json();
  return (data[0] || []).map((s) => s[0] || "").join("");
}

async function handleTranslate(request) {
  if (request.method === "OPTIONS") return new Response(null, { status: 200, headers: CORS });
  if (request.method !== "POST") return json({ error: "Method Not Allowed" }, 405);

  try {
    const body = await request.json().catch(() => ({}));
    const { texts, targetLang, sourceLang = "KO" } = body || {};
    if (!texts || !targetLang) return json({ error: "missing params" }, 400);

    const results = await Promise.all(
      texts.map((text) => translateOne(text, sourceLang, targetLang))
    );
    return json({ translations: results.map((text) => ({ text })) });
  } catch (e) {
    return json({ error: e.message }, 500);
  }
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    if (url.pathname === "/api/translate") return handleTranslate(request);

    // Nothing here matched a page, so try the shared short-link namespace:
    // kakainfo.com/gs resolves to whatever the shortener stored under "gs".
    const code = url.pathname.slice(1);
    if (request.method === "GET" && code && !code.includes("/") && env.LINKS) {
      const raw = await env.LINKS.get(code);
      if (raw) return Response.redirect(JSON.parse(raw).url, 302);
    }

    return new Response("Not Found", {
      status: 404,
      headers: { "Content-Type": "text/plain; charset=utf-8" },
    });
  },
};
