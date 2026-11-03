// 컴시간 접속 정보 자동 확인(GitHub Actions comci-boot)의 상태 보기·다시 실행.
//   GET  /api/comci-sync → { state, lastRun, captured, warn }   (관리자 화면이 보고 꺼졌거나 오래 멈추면 경고)
//   POST /api/comci-sync → 꺼져 있으면 다시 켜고 지금 한 번 실행(관리자 "지금 다시 확인" 버튼)
// Cloudflare 환경 변수(비밀값) GITHUB_TOKEN 이 필요하다: 이 레포의 Actions 읽기·쓰기 권한만 준 fine-grained 토큰.
// 실행 버튼은 5분에 한 번만 받는다(누가 주소를 알아도 GitHub 실행만 가끔 더 생길 뿐, 데이터는 건드리지 못한다).
import CAPTURED from '../../lib/comci-boot.js';

const WF = 'comci-boot.yml';
const STALE_H = 3; // 1시간마다 도는데 3시간 넘게 안 돌았으면 경고
const json = (o, s = 200) => new Response(JSON.stringify(o), { status: s, headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' } });
const cacheKey = (k) => new Request('https://comci-cache.invalid/' + encodeURIComponent(k));

function gh(env, path, init = {}) {
  const repo = env.COMCI_REPO || 'RicardoBrian/Ohweb';
  return fetch(`https://api.github.com/repos/${repo}/actions/workflows/${WF}${path}`, {
    ...init,
    headers: {
      accept: 'application/vnd.github+json', 'user-agent': 'classnote-comci-sync', 'x-github-api-version': '2022-11-28',
      ...(env.GITHUB_TOKEN ? { authorization: 'Bearer ' + env.GITHUB_TOKEN } : {}),
    },
  });
}

async function status(env) {
  const captured = { route: CAPTURED?.route, capturedAt: CAPTURED?.capturedAt || null };
  const out = { state: null, lastRun: null, captured, warn: null, token: !!env.GITHUB_TOKEN };
  try {
    const [w, r] = await Promise.all([gh(env, ''), gh(env, '/runs?per_page=1')]);
    if (!w.ok) throw new Error(`GitHub ${w.status}` + (w.status === 401 || w.status === 404 ? ' (GITHUB_TOKEN 확인)' : ''));
    out.state = (await w.json()).state; // active | disabled_inactivity | disabled_manually
    const run = r.ok ? (await r.json()).workflow_runs?.[0] : null;
    if (run) out.lastRun = { at: run.run_started_at || run.created_at, status: run.status, conclusion: run.conclusion, url: run.html_url };
  } catch (e) {
    out.warn = '자동 확인 상태를 못 읽음: ' + e.message;
    return out;
  }
  const hours = out.lastRun ? (Date.now() - Date.parse(out.lastRun.at)) / 3600e3 : Infinity;
  if (out.state !== 'active') out.warn = out.state === 'disabled_inactivity' ? '자동 확인이 꺼졌어요(GitHub: 60일간 레포 변경 없음)' : `자동 확인이 꺼져 있어요(${out.state})`;
  else if (out.lastRun?.conclusion === 'failure') out.warn = '마지막 자동 확인이 실패했어요(컴시간 화면이 바뀌었을 수 있음)';
  else if (hours > STALE_H) out.warn = out.lastRun ? `자동 확인이 ${Math.floor(hours)}시간째 안 돌았어요` : '자동 확인 기록이 없어요';
  return out;
}

export async function onRequestGet({ env }) {
  const cache = caches.default;
  const hit = await cache.match(cacheKey('sync:status'));
  if (hit) return json(await hit.json());
  const s = await status(env);
  await cache.put(cacheKey('sync:status'), new Response(JSON.stringify(s), { headers: { 'cache-control': 'max-age=300' } }));
  return json(s);
}

export async function onRequestPost({ env }) {
  if (!env.GITHUB_TOKEN) return json({ error: 'Cloudflare 환경 변수 GITHUB_TOKEN 이 없어요' }, 424);
  const cache = caches.default;
  if (await cache.match(cacheKey('sync:run'))) return json({ error: '방금 실행했어요. 5분 뒤에 다시 눌러 주세요' }, 429);
  await cache.put(cacheKey('sync:run'), new Response('1', { headers: { 'cache-control': 'max-age=300' } }));
  const w = await gh(env, '');
  if (!w.ok) return json({ error: `GitHub ${w.status} (GITHUB_TOKEN 권한 확인)` }, 424);
  const enabled = (await w.json()).state !== 'active';
  if (enabled) await gh(env, '/enable', { method: 'PUT' }); // 꺼져 있으면 다시 켠다
  const d = await gh(env, '/dispatches', { method: 'POST', body: JSON.stringify({ ref: 'main' }) });
  if (!d.ok) return json({ error: `실행 요청 실패: GitHub ${d.status}` }, 424);
  await cache.delete(cacheKey('sync:status'));
  return json({ ok: true, enabled });
}
