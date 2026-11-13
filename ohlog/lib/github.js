// GitHub(이 레포)와 이야기하는 작은 도구 — 컴시간 시간표 자동 수집(comci-boot 워크플로)용.
// 워크플로가 데이터 전용 브랜치 comci-data 에 학교별 파일(<코드>_<학교이름>.json)을 커밋하고, 서버는 그것을 여기서 읽는다.
// Cloudflare 비밀값 GITHUB_TOKEN: 이 레포 Actions 읽기·쓰기 fine-grained 토큰(레포가 공개라 파일 읽기는 토큰만 있으면 된다).
const WF = 'comci-boot.yml';
export const DATA_REF = 'comci-data';
const ck = (k) => new Request('https://comci-cache.invalid/' + encodeURIComponent(k));
const cache = () => (typeof caches !== 'undefined' ? caches.default : null);
const LIST_TTL = 60; // 초 — 새 학교 등록이 1분 안에 보이게
const LASTGOOD_TTL = 86400 * 3; // GitHub 이 안 될 때 쓸 마지막 사본

export function gh(env, path, init = {}) {
  const repo = env.COMCI_REPO || 'RicardoBrian/Ohweb';
  return fetch(`https://api.github.com/repos/${repo}${path}`, {
    ...init,
    headers: {
      accept: 'application/vnd.github+json', 'user-agent': 'classnote-comci', 'x-github-api-version': '2022-11-28',
      ...(env.GITHUB_TOKEN ? { authorization: 'Bearer ' + env.GITHUB_TOKEN } : {}),
      ...(init.headers || {}),
    },
    signal: init.signal || AbortSignal.timeout(5000),
  });
}
export const wf = (env, path = '', init) => gh(env, `/actions/workflows/${WF}${path}`, init);

// 짧은 캐시(ttl) + 마지막 사본(며칠). GitHub 이 실패하면 마지막 사본을 stale 로 돌려준다.
async function cachedJson(key, ttl, fresh, make) {
  const c = cache();
  if (!fresh && c) { const hit = await c.match(ck(key)); if (hit) return { value: await hit.json() }; }
  try {
    const value = await make();
    if (c) {
      const body = JSON.stringify(value);
      await c.put(ck(key), new Response(body, { headers: { 'cache-control': `max-age=${ttl}` } }));
      await c.put(ck('lastgood:' + key), new Response(body, { headers: { 'cache-control': `max-age=${LASTGOOD_TTL}` } }));
    }
    return { value };
  } catch (e) {
    const old = c && (await c.match(ck('lastgood:' + key)));
    if (old) return { value: await old.json(), stale: true, error: e.message };
    throw e;
  }
}

// 등록된 학교 목록: [{ code, name, file }] — 파일 이름에서 읽는다(파일을 다 받지 않아도 이름으로 검색 가능)
export async function listSchools(env, fresh = false) {
  return cachedJson('schools', LIST_TTL, fresh, async () => {
    const r = await gh(env, `/contents/?ref=${DATA_REF}`);
    if (r.status === 404) return []; // 아직 데이터 브랜치가 없음
    if (!r.ok) throw new Error(`시간표 저장소(GitHub) ${r.status}`);
    return (await r.json())
      .map((f) => { const m = f.name.match(/^(\d{1,8})_(.+)\.json$/); return m && { code: Number(m[1]), name: m[2], file: f.name, sha: f.sha }; })
      .filter(Boolean);
  });
}

// 학교 하나의 저장된 시간표 { code, name, region, changedAt, weeks: [{ r, label, raw }] } 또는 { error }. 없으면 null.
export async function readSchool(env, code, fresh = false) {
  const list = await listSchools(env, fresh);
  const f = list.value.find((x) => x.code === Number(code));
  if (!f) return { value: null, stale: list.stale };
  // 파일 내용은 sha 가 같으면 그대로다 → sha 를 열쇠로 오래 보관
  const got = await cachedJson(`school:${f.sha}`, 86400, false, async () => {
    const r = await gh(env, `/contents/${encodeURIComponent(f.file)}?ref=${DATA_REF}`, { headers: { accept: 'application/vnd.github.raw' } });
    if (!r.ok) throw new Error(`시간표 저장소(GitHub) ${r.status}`);
    return r.json();
  });
  return { value: got.value, stale: list.stale || got.stale };
}

// 워크플로를 지금 한 번 실행(꺼져 있으면 다시 켜고). inputs 를 주면 그 학교만(새 학교 등록).
// 같은 요청은 3분에 한 번만 — 여러 선생님이 동시에 눌러도 한 번.
export async function kickCapture(env, inputs) {
  if (!env.GITHUB_TOKEN) return { error: 'Cloudflare 환경 변수 GITHUB_TOKEN 이 없어요' };
  const c = cache();
  const key = ck('sync:run:' + (inputs?.code || 'all'));
  if (c && (await c.match(key))) return { already: true };
  if (c) await c.put(key, new Response('1', { headers: { 'cache-control': 'max-age=180' } }));
  try {
    const w = await wf(env);
    if (!w.ok) return { error: `GitHub ${w.status} (GITHUB_TOKEN 권한 확인)` };
    const enabled = (await w.json()).state !== 'active';
    if (enabled) await wf(env, '/enable', { method: 'PUT' });
    const d = await wf(env, '/dispatches', { method: 'POST', body: JSON.stringify({ ref: 'main', ...(inputs ? { inputs } : {}) }) });
    if (!d.ok) return { error: `실행 요청 실패: GitHub ${d.status}` };
    if (c) await c.delete(ck('sync:status'));
    return { ok: true, enabled };
  } catch (e) { return { error: e.message }; }
}

// 마지막 전체 실행(예약·관리자 버튼·자동 요청). 학교 하나 등록 실행(제목에 '(코드)')은 뺀다.
export const lastFullRun = (runs) => runs.find((x) => x.event === 'schedule' || !/\(\d+\)/.test(x.display_title || '')) || runs[0];

// GitHub 은 30분 예약을 실제로는 4~8시간에 한 번만 돌린다(붐비면 늦추거나 건너뜀).
// 그래서 앱이 시간표를 볼 때 마지막 전체 수집이 1시간 넘게 지났으면 여기서 한 번 실행시킨다.
// 확인은 전체에서 20분에 한 번만(GitHub API·실행이 늘지 않게). 실패해도 시간표 응답에는 영향 없음.
const AUTO_EVERY = 20 * 60, AUTO_AFTER_H = 1;
export async function autoKick(env) {
  if (!env.GITHUB_TOKEN) return;
  const c = cache();
  const key = ck('sync:auto');
  if (!c || (await c.match(key))) return;
  await c.put(key, new Response('1', { headers: { 'cache-control': `max-age=${AUTO_EVERY}` } }));
  const r = await wf(env, '/runs?per_page=10');
  if (!r.ok) return;
  const run = lastFullRun((await r.json()).workflow_runs || []);
  if (run && (run.status !== 'completed' || Date.now() - Date.parse(run.run_started_at || run.created_at) < AUTO_AFTER_H * 3600e3)) return;
  return kickCapture(env);
}
