/**
 * Cloudflare Pages Function — /api/run-python
 *
 * 시험의 코드형 문제(exam.html)에서 학생이 "실행"을 누르거나 제출 시 테스트
 * 케이스를 채점할 때 쓴다. 원래는 Pyodide(브라우저 안에서 CPython 전체를
 * 웹어셈블리로 돌리는 방식)를 썼는데, "실행" 누르는 순간(=수십MB 웹어셈블리를
 * 내려받아 인스턴스화하는 시점)에 컴퓨터에서 탭이 통째로 죽는 사례가
 * 반복됐다 — cdn.jsdelivr.net에서 받아오다가 kakainfo.com 안(/vendor/pyodide)
 * 으로 자체 호스팅까지 해봤지만 재현됐다는 건 네트워크 문제가 아니라 그
 * 브라우저/기기가 WASM 인스턴스화 자체를 못 버틴다는 뜻이었다.
 *
 * 그래서 코드 실행을 서버(여기)로 옮겼다. 학생 브라우저는 코드 텍스트 하나를
 * POST로 보내고 실행 결과만 받으면 되니, 기기 성능·브라우저 종류와 완전히
 * 무관해진다. 실제 실행은 ohinfo/lib/python-runner.js 가 외부 실행 서버에
 * 위임한다(기본 Wandbox — 키 없음. Piston 공개 API는 2026-02부터 토큰이 필요해졌다).
 */
import { runPython, RunnerError, runnerName } from '../../lib/python-runner.js';

// 이 API들은 전부 같은 도메인의 페이지에서만 부른다. '*'로 열어두면
// 아무 사이트나 브라우저에서 호출해 번역 쿼터(유료)와 코드 실행 쿼터를
// 대신 태울 수 있어서, 우리 도메인으로 좁힌다. (curl 같은 직접 호출은
// CORS로 못 막는다 — 그건 Cloudflare 대시보드의 Rate Limiting 규칙으로
// 따로 걸어야 한다.)
const ALLOWED_ORIGINS = [
  'https://kakainfo.com',
  'https://www.kakainfo.com',
  'https://info.kakainfo.com',
  'https://admin.kakainfo.com',
  'https://short.kakainfo.com',
];
function corsFor(request) {
  const origin = request.headers.get('Origin') || '';
  // *.pages.dev은 커스텀 도메인을 붙이기 전 미리보기 배포에서 쓴다.
  const ok = ALLOWED_ORIGINS.includes(origin) || /^https:\/\/[a-z0-9-]+\.pages\.dev$/.test(origin);
  return {
    'Access-Control-Allow-Origin': ok ? origin : ALLOWED_ORIGINS[0],
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
    'Vary': 'Origin',
  };
}
const CORS = {
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
};

const json = (body, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json', ...CORS },
  });

async function handle(request, env) {
  if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers: CORS });
  if (request.method !== 'POST') return json({ error: 'Method Not Allowed' }, 405);

  let body;
  try { body = await request.json(); }
  catch { return json({ error: 'invalid JSON body' }, 400); }

  const code = String(body?.code ?? '');
  const stdin = String(body?.stdin ?? '');
  if (!code.trim()) return json({ error: '코드가 비어있습니다.' }, 400);
  if (code.length > 20000) return json({ error: '코드가 너무 깁니다 (20000자 제한).' }, 400);
  if (stdin.length > 20000) return json({ error: '입력값이 너무 깁니다.' }, 400);

  // 실제 실행은 ../../lib/python-runner.js(기본 Wandbox, PISTON_URL/TOKEN 있으면 Piston).
  // 서버 쪽 실패도 5xx가 아니라 200 + error로 돌려준다 — 5xx면 Cloudflare가 본문을
  // 자기 오류 페이지로 바꿔서 원인이 사라진다(exam.html은 data.error로 실패를 판단한다).
  try {
    return json(await runPython(env, code, stdin));
  } catch (e) {
    if (!(e instanceof RunnerError)) throw e;
    console.error(`run-python(${runnerName(env)}):`, e.message, e.detail);
    return json({ error: e.message, ...(e.detail ? { detail: `${runnerName(env)} · ${e.detail}` } : {}) }, e.status === 429 ? 429 : 200);
  }
}

// 응답에 CORS 헤더를 붙인다 — 핸들러 안의 json() 호출을 전부 고치지 않아도
// 되도록 여기서 한 번에 씌운다.
function withCors(res, request) {
  const out = new Response(res.body, res);
  for (const [k, v] of Object.entries(corsFor(request))) out.headers.set(k, v);
  return out;
}

export async function onRequest({ request, env }) {
  try {
    return withCors(await handle(request, env), request);
  } catch (e) {
    // 스택은 응답에 싣지 않는다. 상태코드는 200 — 5xx면 Cloudflare가 본문을
    // 바꿔치기해 오류 문구가 사라진다(호출부는 error 필드로 실패를 판단한다).
    console.error('run-python uncaught:', e);
    return withCors(json({ error: '코드 실행 서버에 문제가 발생했습니다.' }, 200), request);
  }
}
