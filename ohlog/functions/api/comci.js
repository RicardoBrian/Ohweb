// 컴시간 조회 프록시 (비공식). 브라우저는 CORS·평문 http 때문에 직접 못 부르므로 여기서 대신 호출한다.
//   GET /api/comci?q=학교명                      → 학교 검색
//   GET /api/comci?code=학교코드[&week=r]          → 교사 목록·주 목록·일과시간
//   GET /api/comci?code=학교코드&teacher=번호[&week=r] → 위 + 그 교사의 수업(lessons, 날짜 포함)
//   GET /api/comci?code=학교코드&grade=3&class=2[&week=r] → 위 + 그 학급의 시간표(classLessons, 교사 이름 포함)
//   GET /api/comci?diag=1                        → 컴시간 접속 진단
//   …&raw=1                                      → 컴시간 원본 응답(구조 확인용)
// 컴시간 주소는 가끔 바뀐다. 환경변수 COMCI_URL(예: http://comci.net:4082)로 덮어쓸 수 있다.

// IP 직접 접속은 Cloudflare가 1003으로 막으므로 도메인만 쓴다.
const HOSTS = ['http://comci.net:4082']; // 컴시간학생.kr 웹이 실제로 부르는 주소(브라우저 Network 탭으로 확인)
const TTL = { boot: 3600, week: 600 }; // 초 — 컴시간에 요청이 몰리지 않게 Cloudflare 캐시에 잠깐 둔다

const json = (body, status = 200) =>
  new Response(JSON.stringify(body), {
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
  const res = await fetch(url, { headers: { 'user-agent': 'Mozilla/5.0' }, signal: AbortSignal.timeout(6000) });
  if (!res.ok) throw new Error(`${url} → HTTP ${res.status}`);
  return new TextDecoder(charset).decode(await res.arrayBuffer());
}

// Cloudflare 캐시(데이터센터별)에 문자열을 잠깐 둔다. 캐시 키는 가짜 주소면 된다.
async function cached(key, ttl, make) {
  const cache = typeof caches !== 'undefined' ? caches.default : null;
  const req = new Request('https://comci-cache.invalid/' + encodeURIComponent(key));
  const hit = cache && (await cache.match(req));
  if (hit) return hit.text();
  const text = await make();
  if (cache) await cache.put(req, new Response(text, { headers: { 'cache-control': `max-age=${ttl}` } }));
  return text;
}

// /st 페이지 스크립트에서 동적 경로(route)·PREFIX·자료 키 번호를 뽑는다.
export function readBoot(host, html) {
  const route = html.match(/url:\s*'(\.[^']+)'/)?.[1]; // 예: ./36179?17384l
  const prefix = html.match(/sc_data\('([^']*)'/)?.[1]; // 예: 73629_
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
}
async function bootstrap(env) {
  const tried = [];
  for (const host of [env.COMCI_URL, ...HOSTS].filter(Boolean)) {
    try {
      const html = await cached('boot:' + host, TTL.boot, () => getText(host + '/st', 'euc-kr'));
      return readBoot(host, html);
    } catch (e) {
      tried.push(`${host}: ${e.message}`);
    }
  }
  throw new Error('컴시간 접속 실패\n' + tried.join('\n'));
}

// 시간표 표: [학년수, [반수, [요일수, [교시수, 코드…], …], …], …]
//   값 앞에 '>'가 붙으면 변경된 수업(일일자료에만 나옴).
// 코드 하나에 교사 번호와 과목 번호가 같이 들어 있다(분리값 단위). 어느 쪽이 교사인지는
// 학교·버전마다 달라 보여서, 가능한 해석 중 '한 교사가 같은 시간에 두 반에 겹치는' 경우가
// 가장 적은 해석을 고른다(실제 시간표에서는 거의 생기지 않으므로).
const isLesson = (v) => (typeof v === 'number' && v > 0) || (typeof v === 'string' && v !== '');
function tableHasLessons(tbl) {
  return tbl.slice(1).some((g) => g.slice(1).some((c) => c.slice(1).some((d) => d.slice(1).some(isLesson))));
}
const DECODERS = {
  // 교사 = 나머지, 과목 = 몫
  subjectHigh: (n, sep) => ({ teacher: n % sep, subject: Math.floor(n / sep) % sep }),
  // 교사 = 몫, 과목 = 나머지
  teacherHigh: (n, sep) => ({ teacher: Math.floor(n / sep), subject: n % sep % 100 }),
};
export function parseTimetable(raw, keys = {}) {
  const grades = raw['학급수'].length - 1;
  const pick = (id) => (id ? raw['자료' + id] : undefined);
  let teachers = pick(keys.teachers);
  let subjects = pick(keys.subjects);
  let table = pick(keys.daily) || pick(keys.original);
  const roomTable = raw['강의실'] == 1 ? pick(keys.room) : undefined;
  if (!(table && teachers && subjects)) {
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

  const flat = [];
  for (let g = 1; g < table.length; g++)
    for (let c = 1; c < table[g].length; c++)
      for (let d = 1; d < table[g][c].length; d++)
        for (let p = 1; p < table[g][c][d].length; p++) {
          const item = table[g][c][d][p];
          if (!isLesson(item)) continue;
          const changed = typeof item === 'string' && item.startsWith('>');
          const n = Number(changed ? item.slice(1) : item);
          if (!n) continue;
          const room = roomTable?.[g]?.[c]?.[d]?.[p];
          flat.push({
            grade: g, class: c, day: d, period: p, changed, n,
            room: typeof room === 'string' && room.includes('_') ? room.split('_')[1] : undefined,
          });
        }

  const seps = [...new Set([raw['분리'], 1000, 100].filter((s) => Number.isInteger(s) && s > 1))];
  let best = null;
  for (const sep of seps)
    for (const [mode, dec] of Object.entries(DECODERS)) {
      const cells = flat.map(({ n, ...x }) => ({ ...x, ...dec(n, sep) }));
      if (!cells.every((x) => x.teacher > 0 && x.teacher < teachers.length && x.subject > 0 && x.subject < subjects.length)) continue;
      const slot = new Map();
      for (const x of cells) {
        const k = `${x.teacher}|${x.day}|${x.period}`;
        slot.set(k, (slot.get(k) || 0) + 1);
      }
      const clashes = [...slot.values()].reduce((a, v) => a + v - 1, 0);
      if (!best || clashes < best.clashes) best = { sep, mode, cells, clashes };
    }
  if (!best) throw new Error('교사/과목 코드 해석 방식을 못 찾음');
  for (const x of best.cells) x.subjectName = subjects[x.subject];
  return { teachers, subjects, cells: best.cells, sep: best.sep, mode: best.mode, clashes: best.clashes };
}

// 일자자료 [[1, "26-10-26 ~ 26-10-31"], …] → [{ r, label, start: '2026-10-26' }]
function readWeeks(raw) {
  return (raw['일자자료'] || []).map(([r, label]) => {
    const m = String(label).match(/(\d{2})-(\d{2})-(\d{2})/);
    return { r: Number(r), label, start: m ? `20${m[1]}-${m[2]}-${m[3]}` : null };
  });
}
// 담임 표(자료의 '담임')에서 이 교사가 담임인 학급을 찾는다. 모양이 [학년][반] = 교사번호 라고 보고, 다르면 빈 목록.
function findHomeroom(raw, teacher) {
  const hr = raw['담임'];
  const out = [];
  if (!Array.isArray(hr) || !teacher) return out;
  hr.forEach((row, g) => { if (g > 0 && Array.isArray(row)) row.forEach((v, c) => { if (c > 0 && Number(v) === teacher) out.push({ grade: g, class: c }); }); });
  return out;
}
function addDays(iso, n) {
  const d = new Date(iso + 'T00:00:00Z');
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
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
  if (code && !/^\d{1,8}$/.test(code)) return json({ error: '학교코드 형식이 아님' }, 400);

  try {
    const c = await bootstrap(env);

    if (q) {
      const raw = parse(await getText(c.search + eucKrPercent(q.slice(0, 40)), 'utf-8'));
      const schools = (raw['학교검색'] || []).map(([, region, name, sccode]) => ({ region, name, sccode }));
      return json({ schools });
    }

    const fetchWeek = async (w) =>
      parse(await cached(`week:${code}:${w}`, TTL.week, () => getText(c.base + btoa(`${c.prefix}${code}_0_${w}`), 'utf-8')));
    // week를 안 주면 1주차를 받아 보고, 컴시간이 말하는 '오늘이 속한 주(오늘r)'가 다르면 그 주로 다시 받는다.
    let week = url.searchParams.get('week');
    if (week && !/^\d{1,2}$/.test(week)) return json({ error: 'week 형식이 아님' }, 400);
    let raw = await fetchWeek(week || 1);
    if (!week) {
      week = String(raw['오늘r'] > 0 ? raw['오늘r'] : 1);
      if (week !== '1') raw = await fetchWeek(week);
    }
    if (url.searchParams.get('raw')) return json({ keys: Object.keys(raw), raw });

    const t = parseTimetable(raw, c.keys);
    const weeks = readWeeks(raw);
    const start = weeks.find((w) => String(w.r) === week)?.start;
    // 이름 끝 글자가 가려져 같은 이름이 많으니, 담당 과목(많이 가르치는 순 2개)을 같이 내려 구분하게 한다
    const subjectsOf = new Map();
    {
      const cnt = new Map();
      for (const x of t.cells) { const m = cnt.get(x.teacher) || new Map(); m.set(x.subjectName, (m.get(x.subjectName) || 0) + 1); cnt.set(x.teacher, m); }
      for (const [id, m] of cnt) subjectsOf.set(id, [...m.entries()].sort((a, b) => b[1] - a[1]).slice(0, 2).map(([n]) => n));
    }
    const teacher = url.searchParams.get('teacher');
    const gParam = url.searchParams.get('grade'), cParam = url.searchParams.get('class');
    const classLessons = /^\d{1,2}$/.test(gParam || '') && /^\d{1,2}$/.test(cParam || '')
      ? t.cells
          .filter((x) => x.grade === Number(gParam) && x.class === Number(cParam))
          .map((x) => ({ ...x, teacherName: t.teachers[x.teacher] || '', date: start ? addDays(start, x.day - 1) : null }))
      : undefined;
    const lessons =
      teacher == null
        ? undefined
        : t.cells
            .filter((x) => x.teacher === Number(teacher))
            .map((x) => ({ ...x, date: start ? addDays(start, x.day - 1) : null }));
    return json({
      week: Number(week),
      weeks,
      times: raw['일과시간'] || [], // 교시별 시간 표시(예: "1(09:00)")
      classCount: raw['학급수'],
      teachers: t.teachers.map((name, id) => ({ id, name, subjects: subjectsOf.get(id) || [] })).filter((x) => x.id > 0 && x.name),
      lessons,
      classLessons,
      homeroom: findHomeroom(raw, Number(teacher)),
      debug: { sep: t.sep, mode: t.mode, clashes: t.clashes, cells: t.cells.length, homeroom: JSON.stringify(raw['담임'] ?? null).slice(0, 80) },
    });
  } catch (e) {
    return json({ error: e.message }, 502);
  }
}
