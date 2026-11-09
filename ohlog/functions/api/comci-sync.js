// 컴시간 시간표 자동 수집(GitHub Actions comci-boot)의 상태 보기·다시 실행·새 학교 등록.
//   GET  /api/comci-sync → { state, lastRun, schools, warn }   (관리자 화면이 보고 꺼졌거나 오래 멈추면 경고)
//   POST /api/comci-sync → 꺼져 있으면 다시 켜고 등록된 학교 전부 지금 한 번 받기(관리자 "지금 다시 확인" 버튼)
//   POST /api/comci-sync {code, name} → 그 학교만 받기(새 학교 등록 — 가입 화면). 1~3분 뒤 /api/comci?code= 에 나온다.
// Cloudflare 환경 변수(비밀값) GITHUB_TOKEN 이 필요하다: 이 레포의 Actions 읽기·쓰기 권한만 준 fine-grained 토큰.
// 실행은 같은 요청마다 3분에 한 번만 받는다(누가 주소를 알아도 GitHub 실행만 가끔 더 생길 뿐, 데이터는 건드리지 못한다).
import { wf, listSchools, kickCapture } from '../../lib/github.js';

const STALE_H = 2; // 30분마다 도는데 2시간 넘게 안 돌았으면 경고
const json = (o, st = 200) => new Response(JSON.stringify(o), { status: st, headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' } });
const cacheKey = (k) => new Request('https://comci-cache.invalid/' + encodeURIComponent(k));

async function status(env) {
  const out = { state: null, lastRun: null, schools: null, warn: null, token: !!env.GITHUB_TOKEN };
  try {
    const [w, r, list] = await Promise.all([wf(env), wf(env, '/runs?per_page=10'), listSchools(env).catch(() => null)]);
    if (list) out.schools = list.value.length;
    if (!w.ok) throw new Error(`GitHub ${w.status}` + (w.status === 401 || w.status === 404 ? ' (GITHUB_TOKEN 확인)' : ''));
    out.state = (await w.json()).state; // active | disabled_inactivity | disabled_manually
    // 등록(학교 하나) 실행은 빼고, 전체 실행(schedule·관리자 버튼)만 본다
    const runs = r.ok ? (await r.json()).workflow_runs || [] : [];
    const run = runs.find((x) => x.event === 'schedule' || !/\(\d+\)/.test(x.display_title || '')) || runs[0];
    if (run) out.lastRun = { at: run.run_started_at || run.created_at, status: run.status, conclusion: run.conclusion, url: run.html_url };
  } catch (e) {
    out.warn = '자동 수집 상태를 못 읽음: ' + e.message;
    return out;
  }
  const hours = out.lastRun ? (Date.now() - Date.parse(out.lastRun.at)) / 3600e3 : Infinity;
  if (out.state !== 'active') out.warn = out.state === 'disabled_inactivity' ? '자동 수집이 꺼졌어요(GitHub: 60일간 레포 변경 없음)' : `자동 수집이 꺼져 있어요(${out.state})`;
  else if (out.lastRun?.conclusion === 'failure') out.warn = '마지막 자동 수집이 실패했어요(컴시간 화면이 바뀌었을 수 있음)';
  else if (hours > STALE_H) out.warn = out.lastRun ? `자동 수집이 ${Math.floor(hours)}시간째 안 돌았어요` : '자동 수집 기록이 없어요';
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

export async function onRequestPost({ request, env }) {
  const body = await request.json().catch(() => ({}));
  let inputs;
  if (body.code != null) {
    const code = String(body.code).trim(), name = String(body.name || '').trim();
    if (!/^\d{1,8}$/.test(code)) return json({ error: '학교 코드는 숫자예요' }, 400);
    if (name.length < 2 || name.length > 30) return json({ error: '학교 이름을 2~30자로 적어 주세요' }, 400);
    inputs = { code, name };
  }
  const r = await kickCapture(env, inputs);
  if (r.already) return json(inputs ? { ok: true, already: true } : { error: '방금 실행했어요. 3분 뒤에 다시 눌러 주세요' }, inputs ? 200 : 429);
  if (r.error) return json({ error: r.error }, 424);
  return json(r);
}
