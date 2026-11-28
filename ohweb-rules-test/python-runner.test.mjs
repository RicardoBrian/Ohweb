// 실행기(ohinfo/lib/python-runner.js) — 실행 서버 일시 오류는 다시 돌리고, 끝내 안 되면 오답이 아니라 오류(busy)로.
// 제출 채점(exam.js gradeCode)은 오류를 수동 채점(null)으로 넘기므로, 붐빔 때문에 오답 처리되는 일이 없다.
import { runPython, RunnerError } from '../ohinfo/lib/python-runner.js';
let fails = 0;
const ok = (label, cond, extra = '') => { if (cond) console.log('✅ ' + label); else { fails++; console.log('❌ ' + label + (extra ? ' — ' + extra : '')); } };
const BUSY_ERR = 'Error: OCI runtime error: crun: clone: Resource temporarily unavailable';
let script = [], calls = 0;
globalThis.fetch = async url => {
  if (String(url).endsWith('/list.json')) return new Response(JSON.stringify([{ name: 'cpython-3.12.7' }]), { status: 200 });
  calls++; const next = script.shift() || { program_output: 'ok\n', status: '0' };
  return new Response(JSON.stringify(next), { status: 200 });
};
const opts = { retryWaits: [1, 1] };
const busy = { program_error: BUSY_ERR, status: '1' };

script = [busy, { program_output: '55\n', status: '0' }]; calls = 0;
let r = await runPython({}, 'print(55)', '', opts);
ok('일시 오류 한 번 → 다시 돌려서 정상 결과', r.stdout === '55\n' && calls === 2);

script = [busy, busy, busy]; calls = 0;
let err = null; try { await runPython({}, 'print(1)', '', opts); } catch (e) { err = e; }
ok('세 번 다 일시 오류 → 오답 결과가 아니라 RunnerError(busy)', err instanceof RunnerError && err.busy === true && calls === 3, String(err));

script = [{ program_error: 'NameError: name x is not defined', status: '1' }]; calls = 0;
r = await runPython({}, 'print(x)', '', opts);
ok('학생 코드 오류는 다시 돌리지 않고 그대로', r.stderr.includes('NameError') && calls === 1);

script = [{ program_output: 'part\n', program_error: BUSY_ERR, status: '1' }]; calls = 0;
r = await runPython({}, 'print(1)', '', opts);
ok('출력이 있으면 일시 오류 글자가 있어도 다시 안 돌림', r.stdout === 'part\n' && calls === 1);

console.log(fails ? `\n실패 ${fails}건` : '\n전부 통과'); process.exit(fails ? 1 : 0);
