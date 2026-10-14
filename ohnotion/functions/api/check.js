/**
 * Cloudflare Pages Function — GET /api/check?url=https://xxx.notion.site/...
 *
 * 관리 페이지의 "서버 점검". Cloudflare 서버에서 노션 게시 링크를 직접 열어 보고
 *   - 응답 코드와 걸린 시간
 *   - 다른 사이트 안(iframe)에 넣는 걸 노션이 막는지(X-Frame-Options / CSP)
 * 를 돌려준다. 학생 PC가 아니라 서버에서 보는 것이라 "노션 자체가 살아 있는지,
 * 링크가 맞는지"를 확인하는 용도다. 학생 PC에서 실제로 열리는지는 뷰어가 보내는
 * 기록(/api/report)으로 따로 본다.
 *
 * 아무 주소나 대신 열어 주는 프록시가 되지 않게 *.notion.site만 받는다.
 * statsEnabled는 /api/report가 쓸 서비스 계정 키가 들어 있는지 — 관리 페이지가
 * "통계 꺼짐" 안내를 띄우는 데 쓴다(값은 절대 돌려주지 않는다).
 */
import { isNotionUrl } from '../../lib/shared.js';

const TIMEOUT_MS = 10000;

const json = (body, status = 200) => new Response(JSON.stringify(body), {
  status,
  headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' },
});

function embedBlocked(headers) {
  const xfo = (headers.get('x-frame-options') || '').toLowerCase();
  if (xfo.includes('deny') || xfo.includes('sameorigin')) return `X-Frame-Options: ${xfo}`;
  const csp = headers.get('content-security-policy') || '';
  const fa = csp.split(';').map((s) => s.trim()).find((s) => s.toLowerCase().startsWith('frame-ancestors'));
  if (fa) {
    const sources = fa.split(/\s+/).slice(1);
    if (!sources.some((s) => s === '*' || s.includes('kakainfo.com') || s === 'https:')) return `CSP ${fa}`;
  }
  return null;
}

export async function onRequestGet(context) {
  const { request, env } = context;
  const statsEnabled = !!env.FIREBASE_SERVICE_ACCOUNT_KEY;
  const target = new URL(request.url).searchParams.get('url') || '';
  if (!target) return json({ statsEnabled });
  if (!isNotionUrl(target)) {
    return json({ statsEnabled, ok: false, level: 'bad', message: '노션 "웹에 게시" 링크(https://….notion.site/…)가 아니에요' }, 400);
  }

  const t0 = Date.now();
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), TIMEOUT_MS);
  try {
    const r = await fetch(target, {
      redirect: 'follow',
      signal: ctrl.signal,
      headers: { 'User-Agent': 'Mozilla/5.0 (kakainfo notion monitor)', 'Accept': 'text/html' },
    });
    const ms = Date.now() - t0;
    // 본문은 필요 없다 — 연결만 정리한다.
    r.body?.cancel?.();
    const blocked = embedBlocked(r.headers);
    const finalUrl = r.url || target;
    const base = { statsEnabled, status: r.status, ms, finalUrl };

    if (blocked) return json({ ...base, ok: false, level: 'bad', message: `노션이 임베드를 막고 있어요 (${blocked})` });
    if (!isNotionUrl(finalUrl)) return json({ ...base, ok: false, level: 'bad', message: '게시 페이지가 아닌 곳으로 이동돼요 — "웹에 게시"가 꺼졌을 수 있어요' });
    if (r.status === 403 || r.status === 429) return json({ ...base, ok: true, level: 'unknown', message: '노션이 서버 점검을 막아 확인할 수 없어요(학생 기록으로 판단)' });
    if (r.status >= 400) return json({ ...base, ok: false, level: 'bad', message: `노션 응답 오류 (${r.status})` });
    if (ms > 5000) return json({ ...base, ok: true, level: 'slow', message: '열리지만 느려요' });
    return json({ ...base, ok: true, level: 'ok', message: '정상' });
  } catch (e) {
    const ms = Date.now() - t0;
    const timedOut = e?.name === 'AbortError';
    return json({ statsEnabled, ok: false, level: 'bad', ms, message: timedOut ? `${TIMEOUT_MS / 1000}초 안에 응답이 없어요` : `연결 실패: ${e?.message || e}` });
  } finally {
    clearTimeout(timer);
  }
}
