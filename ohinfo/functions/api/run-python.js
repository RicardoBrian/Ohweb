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
 * 무관해진다. 실제 실행은 Piston(https://github.com/engineer-man/piston)의
 * 공개 API(emkc.org)에 위임한다 — 별도 API 키가 필요 없는 무료 서비스라
 * /api/translate처럼 시크릿 설정 없이 바로 쓸 수 있다.
 */

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

const PISTON_EXECUTE_URL = 'https://emkc.org/api/v2/piston/execute';
const PISTON_RUNTIMES_URL = 'https://emkc.org/api/v2/piston/runtimes';
const FALLBACK_PYTHON_VERSION = '3.10.0';

const json = (body, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json', ...CORS },
  });

// setTimeout을 그냥 Promise.race에 걸면, 원래 promise가 먼저 끝나도 타이머는
// 계속 남아있다가 나중에 fire된다. Cloudflare Workers는 요청 처리가 끝난
// 뒤(응답을 이미 반환한 뒤)에 비동기 콜백이 실행되는 걸 허용하지 않아서 —
// 이 타이머가 늦게 fire되면 "asynchronous I/O ... can only be performed while
// handling a request" 같은 내부 오류로 이어지고, 이게 클라이언트한테는 우리
// JSON이 아니라 플랫폼이 만든 맨 502 Bad Gateway로 보인다(우리 쪽 try/catch를
// 아예 안 거치니 에러 메시지도 못 붙는다 — 신고된 "HTTP 502"만 뜨고 상세 이유가
// 안 보이던 이유). 어느 쪽이 이기든 반드시 타이머를 정리한다.
function withTimeout(promise, ms) {
  let timer;
  const timeout = new Promise((_, reject) => { timer = setTimeout(() => reject(new Error('timeout')), ms); });
  return Promise.race([promise, timeout]).finally(() => clearTimeout(timer));
}

// Piston은 language+정확한 version을 요구한다. 하드코딩한 버전이 나중에
// 서비스에서 내려가면(Piston이 오래된 버전을 목록에서 뺄 수 있다) 계속
// 실패하게 되므로, 매 실행마다 /runtimes를 조회해 현재 지원되는 python
// 버전을 그때그때 찾는다. 같은 Worker 인스턴스가 재사용되는 동안은
// 모듈 스코프 변수에 잠깐 캐시해서 매 요청마다 조회하지 않는다(콜드 스타트
// 시엔 다시 조회 — 캐시가 없어도 정확성엔 문제 없다).
let cachedVersion = null;
let cachedAt = 0;
const CACHE_MS = 30 * 60 * 1000;

async function resolvePythonVersion() {
  if (cachedVersion && Date.now() - cachedAt < CACHE_MS) return cachedVersion;
  try {
    const r = await withTimeout(fetch(PISTON_RUNTIMES_URL), 5000);
    if (r.ok) {
      const list = await r.json();
      const py = Array.isArray(list) ? list.find(x => x.language === 'python') : null;
      if (py?.version) { cachedVersion = py.version; cachedAt = Date.now(); return cachedVersion; }
    }
  } catch (e) { /* 조회 실패해도 폴백 버전으로 계속 진행 */ }
  return cachedVersion || FALLBACK_PYTHON_VERSION;
}

async function handle(request) {
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

  const version = await resolvePythonVersion();

  let res;
  const startedAt = Date.now();
  try {
    res = await withTimeout(fetch(PISTON_EXECUTE_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        language: 'python',
        version,
        files: [{ name: 'main.py', content: code }],
        stdin,
        compile_timeout: 10000,
        run_timeout: 8000,
      }),
    }), 15000);
  } catch (e) {
    // fetch 자체가 실패한 경우 — DNS/TLS/네트워크 문제인지, 우리 타임아웃(15초)에
    // 걸린 건지 구분되게 소요 시간과 에러 이름까지 그대로 노출한다.
    return json({
      error: '실행 서버에 연결할 수 없습니다.',
      detail: `${e.name || 'Error'}: ${e.message} (${Date.now() - startedAt}ms 경과, python version=${version})`,
    }, 502);
  }

  if (res.status === 429) return json({ error: '실행 요청이 몰려 있습니다. 잠시 후 다시 시도해주세요.' }, 429);
  if (!res.ok) {
    const t = await res.text().catch(() => '');
    return json({ error: `실행 서버 오류 (HTTP ${res.status})`, detail: `version=${version} · ${t.slice(0, 300)}` }, 502);
  }

  const rawText = await res.text();
  let data;
  try { data = JSON.parse(rawText); }
  catch { return json({ error: '실행 서버 응답을 해석할 수 없습니다.', detail: rawText.slice(0, 300) }, 502); }

  const run = data?.run || {};
  return json({
    stdout: run.stdout || '',
    stderr: run.stderr || '',
    exitCode: run.code ?? null,
    signal: run.signal ?? null,
    timedOut: run.signal === 'SIGKILL',
  });
}

// 응답에 CORS 헤더를 붙인다 — 핸들러 안의 json() 호출을 전부 고치지 않아도
// 되도록 여기서 한 번에 씌운다.
function withCors(res, request) {
  const out = new Response(res.body, res);
  for (const [k, v] of Object.entries(corsFor(request))) out.headers.set(k, v);
  return out;
}

export async function onRequest({ request }) {
  try {
    return withCors(await handle(request), request);
  } catch (e) {
    // 스택을 응답에 실어 보내면 내부 구조가 노출되고, 200으로 내보내면
    // 호출부가 실패를 성공으로 오해한다. 상세는 Cloudflare 로그에만 남긴다.
    console.error('run-python uncaught:', e);
    return withCors(json({ error: '코드 실행 서버에 문제가 발생했습니다.' }, 500), request);
  }
}
