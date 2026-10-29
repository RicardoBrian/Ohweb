// 컴시간 조회 프록시 (비공식). 브라우저는 CORS·평문 http 때문에 직접 못 부르므로 여기서 대신 호출한다.
//   GET /api/comci?q=학교명      → 학교 검색
//   GET /api/comci?code=학교코드 → 시간표 원본 요약(키 목록·학급수·샘플)
// 컴시간 주소는 가끔 바뀐다. 환경변수 COMCI_URL(예: http://comci.kr:4082)로 덮어쓸 수 있다.

// IP 직접 접속은 Cloudflare가 1003으로 막으므로 도메인만 쓴다.
const HOSTS = ['http://comci.net:4082']; // 컴시간학생.kr 웹이 실제로 부르는 주소(브라우저 Network 탭으로 확인)

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
      // 스크립트가 쓰는 자료 키 번호(갱신 때마다 바뀜). 못 찾으면 파서가 값의 모양으로 추측한다.
      const num = (re) => html.match(re)?.[1];
      const keys = {
        teachers: num(/Q성명\(\s*자료\.자료(\d+)\[/),
        subjects: num(/Q과목명\(\s*자료\.자료(\d+)\[/),
        original: num(/원자료\s*=\s*Q자료\(\s*자료\.자료(\d+)\[/),
        daily: num(/일일자료\s*=\s*Q자료\(\s*자료\.자료(\d+)\[/),
        room: num(/m3\s*=\s*자료\.자료(\d+)\[/),
      };
      return { host, base, search: base + route.slice(8), prefix, keys };
    } catch (e) {
      tried.push(`${host}: ${e.message}`);
    }
  }
  throw new Error('컴시간 접속 실패\n' + tried.join('\n'));
}


// 시간표 표: [학년수, [반수, [요일수, [교시수, 코드…], …], …], …]
//   코드 = 교사번호*1000 + 과목코드, 과목코드 = (hundreds*분리 + 과목번호) — 컴시간 스크립트와 같은 방식.
//   값 앞에 '>'가 붙으면 변경된 수업(일일자료에만 나옴).
// 자료 키 번호는 /st 스크립트에서 읽고(keys), 못 읽으면 값의 모양으로 추측한다.
const isLesson = (v) => (typeof v === 'number' && v > 0) || (typeof v === 'string' && v !== '');
function tableHasLessons(tbl) {
  return tbl.slice(1).some((g) => g.slice(1).some((c) => c.slice(1).some((d) => d.slice(1).some(isLesson))));
}
function parseTimetable(raw, keys = {}) {
  const grades = raw['학급수'].length - 1;
  const pick = (id) => (id ? raw['자료' + id] : undefined);
  let teachers = pick(keys.teachers);
  let subjects = pick(keys.subjects);
  let table = pick(keys.daily) || pick(keys.original);
  let roomTable = raw['강의실'] == 1 ? pick(keys.room) : undefined;
  const how = table && teachers && subjects ? 'script' : 'guess';
  if (how === 'guess') {
    const tables = [];
    for (const [k, v] of Object.entries(raw)) {
      if (!/^자료\d+$/.test(k) || !Array.isArray(v)) continue;
      const strings = v.slice(1).every((x) => typeof x === 'string');
      if (v[0] === '' && strings) teachers ??= v;
      else if (typeof v[0] === 'number' && v.length > 1 && strings) subjects ??= v;
      else if (v[0] === grades && Array.isArray(v[1]) && tableHasLessons(v)) tables.push(v);
    }
    table ??= tables.find((v) => JSON.stringify(v).includes('">')) || tables[0];
  }
  if (!teachers || !subjects || !table)
    throw new Error('응답 구조를 해석하지 못함(컴시간 형식 변경?): ' + Object.keys(raw).join(','));

  const sep = Number.isInteger(raw['분리']) && raw['분리'] > 1 ? raw['분리'] : 100;
  const cells = [];
  for (let g = 1; g < table.length; g++)
    for (let c = 1; c < table[g].length; c++)
      for (let d = 1; d < table[g][c].length; d++)
        for (let p = 1; p < table[g][c][d].length; p++) {
          const item = table[g][c][d][p];
          if (!isLesson(item)) continue;
          const changed = typeof item === 'string' && item.startsWith('>');
          const n = Number(changed ? item.slice(1) : item);
          if (!n) continue;
          const teacher = Math.floor(n / 1000);
          const sb = n % 1000;
          const subject = sb % sep;
          const room = roomTable?.[g]?.[c]?.[d]?.[p];
          cells.push({
            grade: g, class: c, day: d, period: p, changed, teacher, subject,
            subjectName: subjects[subject],
            room: typeof room === 'string' && room.includes('_') ? room.split('_')[1] : undefined,
          });
        }
  return { teachers, subjects, cells, sep, how };
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
  if (url.searchParams.get('st')) {
    // /st 스크립트에서 prefix·route·자료 번호가 들어 있는 부분만 잘라 보여준다(정규식 확정용)
    try {
      const host = env.COMCI_URL || HOSTS[0];
      const html = await getText(host + '/st', 'euc-kr');
      const around = (re, n = 160) =>
        [...html.matchAll(re)].slice(0, 6).map((m) => html.slice(Math.max(0, m.index - n), m.index + n));
      return json({
        len: html.length,
        sc_data: around(/sc_data/g),
        url: around(/url:\s*'/g, 80),
        일일자료: around(/일일자료/g),
        원자료: around(/원자료/g),
        성명: around(/성명/g),
      });
    } catch (e) {
      return json({ error: e.message }, 502);
    }
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

    const fetchWeek = async (w) => parse(await getText(c.base + btoa(`${c.prefix}${code}_0_${w}`), 'utf-8'));
    // week를 안 주면 1주차를 받아 보고, 컴시간이 말하는 '오늘이 속한 주(오늘r)'가 다르면 그 주로 다시 받는다.
    let week = url.searchParams.get('week');
    let raw = await fetchWeek(week || 1);
    if (!week) {
      week = String(raw['오늘r'] > 0 ? raw['오늘r'] : 1);
      if (week !== '1') raw = await fetchWeek(week);
    }
    if (url.searchParams.get('raw')) return json({ host: c.host, keys: Object.keys(raw), raw });

    const t = parseTimetable(raw, c.keys);
    const teacher = url.searchParams.get('teacher');
    return json({
      host: c.host,
      week,
      weeks: raw['일자자료'],
      시작일: raw['시작일'],
      times: raw['일과시간'], // 교시별 시간 표시(예: "1(09:00)")
      teachers: t.teachers.map((name, id) => ({ id, name })).filter((x) => x.id > 0 && x.name),
      subjects: t.subjects,
      lessons: teacher == null ? undefined : t.cells.filter((x) => x.teacher === Number(teacher)),
      debug: { sep: t.sep, keys: t.how, cells: t.cells.length },
    });
  } catch (e) {
    return json({ error: e.message }, 502);
  }
}
