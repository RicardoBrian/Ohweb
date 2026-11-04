// 학생 파이썬 코드 실행 — /api/run-python(실행 버튼)과 /api/exam(제출 채점)이 같이 쓴다.
//
// 원래는 Piston 공개 API(emkc.org)만 썼는데, 2026-02-15부터 허가받은 곳만 쓸 수 있게
// 바뀌어(토큰 필요) "실행 서버 권한 설정 필요"로 막혔다. 그래서 기본은 키 없이 쓰는
// Wandbox(wandbox.org)로 바꿨다. 토큰을 받았거나 직접 띄운 Piston이 있으면 Cloudflare
// 환경변수 PISTON_URL / PISTON_TOKEN 을 넣으면 그쪽을 쓴다(테스트도 PISTON_URL로 모의 서버를 붙인다).
//
// run(env, code, stdin) → { stdout, stderr, exitCode, signal, timedOut }
// 실행 서버 자체의 실패(연결·권한·형식)는 RunnerError 로 던진다. 학생 코드의 예외는
// 정상 결과(stderr)다.

export class RunnerError extends Error {
  constructor(message, { status = 0, detail = '' } = {}) { super(message); this.status = status; this.detail = detail; }
}

function withTimeout(promise, ms) {
  let timer;
  const timeout = new Promise((_, reject) => { timer = setTimeout(() => reject(new Error('timeout')), ms); });
  return Promise.race([promise, timeout]).finally(() => clearTimeout(timer));
}

async function post(url, headers, body, ms) {
  const startedAt = Date.now();
  let res;
  try {
    res = await withTimeout(fetch(url, { method: 'POST', headers, body: JSON.stringify(body) }), ms);
  } catch (e) {
    throw new RunnerError('실행 서버에 연결할 수 없습니다.', { detail: `${e.name || 'Error'}: ${e.message} (${Date.now() - startedAt}ms)` });
  }
  const text = await res.text().catch(() => '');
  if (res.status === 429) throw new RunnerError('실행 요청이 몰려 있습니다. 잠시 후 다시 시도해주세요.', { status: 429 });
  if (res.status === 401 || res.status === 403) throw new RunnerError('코드 실행 서버를 사용할 수 없습니다. 선생님께 알려 주세요. (실행 서버 권한 설정 필요)', { status: res.status, detail: text.slice(0, 300) });
  if (!res.ok) throw new RunnerError(`실행 서버 오류 (HTTP ${res.status})`, { status: res.status, detail: text.slice(0, 300) });
  try { return JSON.parse(text); }
  catch { throw new RunnerError('실행 서버 응답을 해석할 수 없습니다.', { detail: text.slice(0, 300) }); }
}

// ── Wandbox ──
const WANDBOX = 'https://wandbox.org/api';
const WANDBOX_FALLBACK = 'cpython-3.12.7';
let wbCompiler = null, wbAt = 0;

// 지원 컴파일러 목록에서 가장 새 CPython 3 정식 버전을 고른다(버전이 내려가도 안 깨지게).
async function wandboxCompiler() {
  if (wbCompiler && Date.now() - wbAt < 6 * 3600 * 1000) return wbCompiler;
  try {
    const r = await withTimeout(fetch(`${WANDBOX}/list.json`), 5000);
    if (r.ok) {
      const names = (await r.json()).map(x => x?.name).filter(n => /^cpython-3\.\d+\.\d+$/.test(n || ''));
      const ver = n => n.slice(8).split('.').map(Number);
      names.sort((a, b) => { const x = ver(a), y = ver(b); return (y[0] - x[0]) || (y[1] - x[1]) || (y[2] - x[2]); });
      if (names[0]) { wbCompiler = names[0]; wbAt = Date.now(); return wbCompiler; }
    }
  } catch (e) { /* 목록 조회 실패 → 폴백 */ }
  return wbCompiler || WANDBOX_FALLBACK;
}

async function runWandbox(code, stdin) {
  const compiler = await wandboxCompiler();
  const d = await post(`${WANDBOX}/compile.json`, { 'Content-Type': 'application/json' }, { compiler, code, stdin }, 20000);
  if (d == null || typeof d !== 'object' || !('status' in d || 'signal' in d)) {
    throw new RunnerError('실행 서버 응답 형식 오류', { detail: JSON.stringify(d).slice(0, 300) });
  }
  const signal = d.signal || null;
  const stderr = [d.compiler_error, d.program_error].filter(Boolean).join('');
  return {
    stdout: d.program_output || '',
    stderr: stderr || (signal ? String(d.program_message || signal) : ''),
    exitCode: d.status != null && d.status !== '' ? Number(d.status) : null,
    signal,
    timedOut: /kill/i.test(String(signal || '')),
  };
}

// ── Piston (PISTON_URL / PISTON_TOKEN 을 넣은 경우) ──
let pyVersion = null, pyAt = 0;
async function runPiston(env, code, stdin) {
  const base = String(env.PISTON_URL || 'https://emkc.org/api/v2/piston').replace(/\/+$/, '');
  const headers = { 'Content-Type': 'application/json' };
  if (env.PISTON_TOKEN) headers.Authorization = env.PISTON_TOKEN;
  if (!pyVersion || Date.now() - pyAt > 30 * 60 * 1000) {
    try {
      const r = await withTimeout(fetch(`${base}/runtimes`, { headers }), 5000);
      const py = r.ok ? (await r.json()).find?.(x => x.language === 'python') : null;
      if (py?.version) { pyVersion = py.version; pyAt = Date.now(); }
    } catch (e) { /* 폴백 버전으로 */ }
  }
  const d = await post(`${base}/execute`, headers, {
    language: 'python', version: pyVersion || '3.10.0',
    files: [{ name: 'main.py', content: code }], stdin,
    compile_timeout: 10000, run_timeout: 8000,
  }, 15000);
  if (!d?.run) throw new RunnerError('실행 서버 응답 형식 오류', { detail: JSON.stringify(d).slice(0, 300) });
  return {
    stdout: d.run.stdout || '', stderr: d.run.stderr || '',
    exitCode: d.run.code ?? null, signal: d.run.signal ?? null, timedOut: d.run.signal === 'SIGKILL',
  };
}

export const runnerName = env => (env?.PISTON_URL || env?.PISTON_TOKEN ? 'piston' : 'wandbox');

export async function runPython(env, code, stdin) {
  return runnerName(env) === 'piston' ? runPiston(env, code, stdin) : runWandbox(code, stdin);
}
