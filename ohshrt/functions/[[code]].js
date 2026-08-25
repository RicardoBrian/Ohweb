/**
 * Cloudflare Pages Function — catch-all for short-code redirects.
 *
 * Static files in public/ (index.html, app.js, style.css, icons, etc.) are
 * matched and served before this ever runs, so anything reaching here is a
 * genuine "/{code}" lookup. Reads the target URL straight from Firestore's
 * REST API — no Admin SDK, no API key needed, since firestore rules allow
 * public `get` on individual short_links/{code} documents (see
 * ohweb-firestore.rules). This mirrors the plain-fetch style already used
 * by ohweb/ohinfo's functions/api/translate.js.
 */

const PROJECT_ID = 'ohweb-93062';

function notFound() {
  return new Response('404: 존재하지 않는 링크입니다.', {
    status: 404,
    headers: { 'Content-Type': 'text/plain; charset=utf-8' },
  });
}

export async function onRequestGet({ params }) {
  const segments = params.code;
  if (!segments || segments.length !== 1) return notFound();
  const code = segments[0];

  const url = `https://firestore.googleapis.com/v1/projects/${PROJECT_ID}/databases/(default)/documents/short_links/${encodeURIComponent(code)}`;
  let r;
  try {
    r = await fetch(url);
  } catch {
    return notFound();
  }
  if (!r.ok) return notFound();

  const data = await r.json().catch(() => null);
  const target = data?.fields?.url?.stringValue;
  if (!target) return notFound();

  return Response.redirect(target, 302);
}
