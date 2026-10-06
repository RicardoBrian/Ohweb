/**
 * Cloudflare Pages Function — /api/ai-model?pid=…&v=…
 *
 * 공개 웹앱(aiapp.html)이 학생 모델을 받아 오는 길. 예전에는 방문자 브라우저가
 * Apps Script(script.google.com)를 직접 불렀는데, 방문자 브라우저에 로그인된 구글
 * 계정(학교 계정 정책, 여러 계정 동시 로그인 등)에 따라 구글이 요청을 로그인 화면으로
 * 돌려보내 모델을 못 받는 일이 있었다. 만든 학생은 자기 PC에 모델이 저장돼 있어서
 * 문제가 안 보이고 "다른 사람만 안 열리는" 증상이 됐다.
 * 그래서 이 서버가 대신 받는다(구글 쿠키와 무관) — 받은 모델은 엣지에 하루 보관해서
 * 같은 반 30명이 열어도 Apps Script는 한 번만 부른다.
 *
 * 공개 여부는 매번 ai_apps 문서(누구나 읽기)로 확인한다: 공개 중이고 그 번호가
 * 배포 번호일 때만 준다(공개를 끄면 보관본도 바로 안 나간다).
 */
import { AILAB_GAS_URL } from '../../public/ai-config.js';

const PROJECT_ID = 'ohweb-93062';
const ID_RE = /^[A-Za-z0-9_-]{1,128}$/;
const TTL = 86400;

const json = (obj, status = 200, extra = {}) =>
  new Response(JSON.stringify(obj), { status, headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store', ...extra } });
const fail = (status, code, msg) => json({ error: msg || code, code }, status);

export async function onRequest({ request, waitUntil }) {
  if (request.method !== 'GET') return fail(405, 'badRequest');
  const u = new URL(request.url);
  const pid = u.searchParams.get('pid') || '';
  const v = Number(u.searchParams.get('v'));
  if (!ID_RE.test(pid) || !Number.isInteger(v) || v < 1) return fail(400, 'badRequest');
  if (!AILAB_GAS_URL) return fail(503, 'notConfigured');

  try {
    const r = await fetch(`https://firestore.googleapis.com/v1/projects/${PROJECT_ID}/databases/(default)/documents/ai_apps/${pid}`, { cache: 'no-store' });
    if (r.status === 404) return fail(404, 'notFound');
    if (!r.ok) return fail(502, 'firestore', 'firestore ' + r.status);
    const f = (await r.json()).fields || {};
    const published = !!(f.published && f.published.booleanValue);
    const mv = Number((f.modelVersion && (f.modelVersion.integerValue ?? f.modelVersion.doubleValue)) || 0);
    if (!published || mv !== v) return fail(403, 'auth', 'not published');
  } catch (e) { return fail(502, 'firestore', String(e && e.message || e)); }

  const cache = globalThis.caches && caches.default;
  const key = new Request(`https://kakainfo.com/__ai-model-cache/${pid}/${v}`);
  if (cache) {
    const hit = await cache.match(key);
    if (hit) return new Response(hit.body, { headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store', 'X-Cache': 'HIT' } });
  }

  let txt;
  try {
    const g = await fetch(AILAB_GAS_URL, { method: 'POST', redirect: 'follow', headers: { 'Content-Type': 'text/plain' }, body: JSON.stringify({ action: 'getModel', pid, version: v }) });
    txt = await g.text();
  } catch (e) { return fail(502, 'network', String(e && e.message || e)); }
  let data;
  try { data = JSON.parse(txt); } catch { return fail(502, 'badResponse', txt.slice(0, 120)); }
  if (data.error) return fail(502, data.code || 'server', data.error);
  if (!data.modelJson || !data.weightsBase64) return fail(502, 'badResponse', 'no model');

  const body = JSON.stringify({ modelJson: data.modelJson, metadataJson: data.metadataJson, weightsBase64: data.weightsBase64 });
  if (cache) {
    const put = cache.put(key, new Response(body, { headers: { 'Content-Type': 'application/json', 'Cache-Control': `max-age=${TTL}` } }));
    if (waitUntil) waitUntil(put); else await put;
  }
  return new Response(body, { headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' } });
}
