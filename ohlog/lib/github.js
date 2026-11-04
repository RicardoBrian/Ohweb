// GitHub(이 레포)와 이야기하는 작은 도구 — 컴시간 접속 정보 자동 확인(comci-boot 워크플로)용.
// Cloudflare 비밀값 GITHUB_TOKEN: 이 레포 Actions 읽기·쓰기 fine-grained 토큰(레포가 공개라 파일 읽기는 토큰만 있으면 된다).
const WF = 'comci-boot.yml';
const BOOT_PATH = 'ohlog/lib/comci-boot.js';
const ck = (k) => new Request('https://comci-cache.invalid/' + encodeURIComponent(k));
const cache = () => (typeof caches !== 'undefined' ? caches.default : null);

export function gh(env, path, init = {}) {
  const repo = env.COMCI_REPO || 'RicardoBrian/Ohweb';
  return fetch(`https://api.github.com/repos/${repo}${path}`, {
    ...init,
    headers: {
      accept: 'application/vnd.github+json', 'user-agent': 'classnote-comci', 'x-github-api-version': '2022-11-28',
      ...(env.GITHUB_TOKEN ? { authorization: 'Bearer ' + env.GITHUB_TOKEN } : {}),
      ...(init.headers || {}),
    },
    signal: init.signal || AbortSignal.timeout(4000),
  });
}
export const wf = (env, path = '', init) => gh(env, `/actions/workflows/${WF}${path}`, init);

// 워크플로가 main 에 커밋한 최신 접속 정보를 바로 읽는다(배포를 기다리지 않게). 1분 캐시. 실패하면 null.
export async function readCaptured(env, fresh = false) {
  if (!env.GITHUB_TOKEN) return null; // 토큰 없이는 GitHub 이 시간당 60번으로 막는다 → 배포에 든 값만 쓴다
  const c = cache();
  if (!fresh && c) { const hit = await c.match(ck('captured:gh')); if (hit) return hit.json(); }
  try {
    const r = await gh(env, `/contents/${BOOT_PATH}?ref=main`, { headers: { accept: 'application/vnd.github.raw' } });
    if (!r.ok) return null;
    const src = await r.text();
    const v = JSON.parse(src.slice(src.indexOf('{'), src.lastIndexOf('}') + 1));
    if (c) await c.put(ck('captured:gh'), new Response(JSON.stringify(v), { headers: { 'cache-control': 'max-age=60' } }));
    return v;
  } catch { return null; }
}

// 자동 확인을 지금 한 번 돌린다(꺼져 있으면 다시 켜고). 3분에 한 번만 — 여러 선생님이 동시에 실패해도 한 번.
export async function kickCapture(env) {
  if (!env.GITHUB_TOKEN) return { error: 'Cloudflare 환경 변수 GITHUB_TOKEN 이 없어요' };
  const c = cache();
  if (c && (await c.match(ck('sync:run')))) return { already: true };
  if (c) await c.put(ck('sync:run'), new Response('1', { headers: { 'cache-control': 'max-age=180' } }));
  try {
    const w = await wf(env);
    if (!w.ok) return { error: `GitHub ${w.status} (GITHUB_TOKEN 권한 확인)` };
    const enabled = (await w.json()).state !== 'active';
    if (enabled) await wf(env, '/enable', { method: 'PUT' });
    const d = await wf(env, '/dispatches', { method: 'POST', body: JSON.stringify({ ref: 'main' }) });
    if (!d.ok) return { error: `실행 요청 실패: GitHub ${d.status}` };
    if (c) await c.delete(ck('sync:status'));
    return { ok: true, enabled };
  } catch (e) { return { error: e.message }; }
}
