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

const CORS = {
  'Access-Control-Allow-Origin': '*',
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

function withTimeout(promise, ms) {
  return Promise.race([
    promise,
    new Promise((_, reject) => setTimeout(() => reject(new Error('timeout')), ms)),
  ]);
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
    return json({ error: '실행 서버에 연결할 수 없습니다: ' + e.message }, 502);
  }

  if (res.status === 429) return json({ error: '실행 요청이 몰려 있습니다. 잠시 후 다시 시도해주세요.' }, 429);
  if (!res.ok) {
    const t = await res.text().catch(() => '');
    return json({ error: `실행 서버 오류 (HTTP ${res.status})`, detail: t.slice(0, 300) }, 502);
  }

  let data;
  try { data = await res.json(); }
  catch { return json({ error: '실행 서버 응답을 해석할 수 없습니다.' }, 502); }

  const run = data?.run || {};
  return json({
    stdout: run.stdout || '',
    stderr: run.stderr || '',
    exitCode: run.code ?? null,
    signal: run.signal ?? null,
    timedOut: run.signal === 'SIGKILL',
  });
}

export async function onRequest({ request }) {
  try {
    return await handle(request);
  } catch (e) {
    return json({ error: 'UNCAUGHT', message: e && e.message, stack: String(e && e.stack).slice(0, 1000) }, 200);
  }
}
