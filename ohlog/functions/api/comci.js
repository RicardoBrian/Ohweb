// 컴시간 조회 프록시 (비공식). 브라우저는 CORS·평문 http 때문에 직접 못 부르므로 여기서 대신 호출한다.
//   GET /api/comci?q=학교명      → 학교 검색
//   GET /api/comci?code=학교코드 → 시간표 원본 요약(키 목록·학급수·샘플)
// 컴시간 주소는 가끔 바뀐다. 환경변수 COMCI_URL(예: http://comci.kr:4082)로 덮어쓸 수 있다.

const HOSTS = ['http://comci.kr:4082', 'http://112.186.146.81:4082', 'http://222.106.100.23:4082'];

const json = (body, status = 200) =>
  new Response(JSON.stringify(body, null, 2), {
    status,
    headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' },
  });

// Workers에는 EUC-KR 인코더가 없어서, 디코더로 한글 역매핑 표를 한 번 만들어 쓴다.
let krMap = null;
function buildKrMap() {
  const dec = new TextDecoder('euc-kr');
  const map = new Map();
  for (let hi = 0xb0; hi <= 0xc8; hi++) {
    for (let lo = 0xa1; lo <= 0xfe; lo++) {
      const ch = dec.decode(new Uint8Array([hi, lo]));
      if (ch.length === 1 && ch !== '�') map.set(ch, [hi, lo]);
    }
  }
  return map;
}
export function eucKrPercent(str) {
  krMap ??= buildKrMap();
  let out = '';
  for (const ch of str) {
    const b = krMap.get(ch);
    if (b) out += b.map((x) => '%' + x.toString(16).toUpperCase().padStart(2, '0')).join('');
    else if (ch.charCodeAt(0) < 0x80) out += encodeURIComponent(ch);
    else throw new Error(`EUC-KR로 바꿀 수 없는 글자: ${ch}`);
  }
  return out;
}

const parse = (text) => {
  const t = text.replace(/\0/g, '');
  return JSON.parse(t.slice(0, t.lastIndexOf('}') + 1));
};

async function getText(url, charset) {
  const res = await fetch(url, { headers: { 'user-agent': 'Mozilla/5.0' }, signal: AbortSignal.timeout(4000) });
  if (!res.ok) throw new Error(`${url} → HTTP ${res.status}`);
  return new TextDecoder(charset).decode(await res.arrayBuffer());
}

// /st 페이지 스크립트에서 동적 경로(route)와 PREFIX를 뽑는다.
async function bootstrap(env) {
  const tried = [];
  for (const host of [env.COMCI_URL, ...HOSTS].filter(Boolean)) {
    try {
      const html = await getText(host + '/st', 'euc-kr');
      const route = html.match(/url:\s*'(\.[^']+)'/)?.[1]; // 예: ./36179?36179l
      const prefix = html.match(/sc_data\('([^']*)'/)?.[1];
      if (!route || prefix == null) throw new Error('/st 스크립트에서 route/prefix를 못 찾음(사이트 구조 변경?)');
      const base = host + route.slice(1, 8); // "/36179?"
      return { host, base, search: base + route.slice(8), prefix };
    } catch (e) {
      tried.push(`${host}: ${e.message}`);
    }
  }
  throw new Error('컴시간 접속 실패\n' + tried.join('\n'));
}

export async function onRequestGet({ request, env }) {
  const url = new URL(request.url);
  if (url.searchParams.get('diag')) {
    // 후보 주소마다 /st 접속 결과를 그대로 보여준다(어디서 막히는지 확인용)
    const hosts = [env.COMCI_URL, ...HOSTS].filter(Boolean);
    const results = await Promise.all(
      hosts.map(async (h) => {
        const t = Date.now();
        try {
          const r = await fetch(h + '/st', { signal: AbortSignal.timeout(5000) });
          const body = new TextDecoder('euc-kr').decode(await r.arrayBuffer());
          return { host: h, status: r.status, ms: Date.now() - t, len: body.length, head: body.slice(0, 120) };
        } catch (e) {
          return { host: h, error: `${e.name}: ${e.message}`, ms: Date.now() - t };
        }
      }),
    );
    return json({ results });
  }
  const q = url.searchParams.get('q');
  const code = url.searchParams.get('code');
  if (!q && !code) return json({ error: 'q(학교명) 또는 code(학교코드) 필요' }, 400);

  try {
    const c = await bootstrap(env);

    if (q) {
      const raw = parse(await getText(c.search + eucKrPercent(q), 'utf-8'));
      const schools = (raw['학교검색'] || []).map(([, region, name, sccode]) => ({ region, name, sccode }));
      return json({ host: c.host, schools });
    }

    const token = btoa(`${c.prefix}${code}_0_1`);
    const raw = parse(await getText(c.base + token, 'utf-8'));
    const keys = Object.keys(raw);
    return json({
      host: c.host,
      keys, // 구조 파악용 — 다음 단계에서 이걸 보고 파서를 확정한다
      학교명: raw['학교명'],
      학급수: raw['학급수'],
      시작일: raw['시작일'],
      일자자료: raw['일자자료']?.slice?.(0, 3),
      sample: Object.fromEntries(
        keys.filter((k) => /^자료\d+$/.test(k)).map((k) => [k, JSON.stringify(raw[k]).slice(0, 300)]),
      ),
    });
  } catch (e) {
    return json({ error: e.message }, 502);
  }
}
