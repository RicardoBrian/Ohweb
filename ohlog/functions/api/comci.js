// 컴시간 시간표 (비공식). 2026-11-07 부터 컴시간이 시간표를 암호화(enc5)해 서버에서는 직접 읽을 수 없다.
// 그래서 GitHub Actions(.github/workflows/comci-boot.yml)가 진짜 브라우저로 컴시간을 열어 해독된 시간표를
// 데이터 브랜치 comci-data 에 학교별로 저장하고(30분마다), 여기서는 그것을 읽어 해석만 한다(ohlog/lib/github.js).
//   GET /api/comci?q=학교명                      → 등록된 학교 중에서 이름으로 찾기
//   GET /api/comci?code=학교코드[&week=r]          → 교사 목록·주 목록·일과시간
//   GET /api/comci?code=학교코드&teacher=번호[&week=r] → 위 + 그 교사의 수업(lessons, 날짜 포함)
//   GET /api/comci?code=학교코드&grade=3&class=2[&week=r] → 위 + 그 학급의 시간표(classLessons, 교사 이름 포함)
//   GET /api/comci?diag=1                        → 저장소·컴시간 접속 진단
//   …&raw=1                                      → 저장된 원본(구조 확인용)
// 등록 안 된 학교는 424 + diag.unregistered → 앱이 POST /api/comci-sync {code,name} 으로 등록(그 학교만 1~3분 안에 받음).
import { listSchools, readSchool } from '../../lib/github.js';

const json = (body, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' },
  });
const norm = (s) => String(s || '').replace(/\s+/g, '').toLowerCase();

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
    // 저장소(GitHub)·컴시간 서버가 응답하는지
    const t = Date.now();
    const store = await listSchools(env, true).then((l) => ({ schools: l.value.length, stale: l.stale, error: l.error, ms: Date.now() - t })).catch((e) => ({ error: e.message }));
    const comci = await fetch('http://comci.net:4082/st', { signal: AbortSignal.timeout(5000) })
      .then((r) => ({ status: r.status })).catch((e) => ({ error: `${e.name}: ${e.message}` }));
    return json({ store, comci });
  }
  const q = url.searchParams.get('q');
  const code = url.searchParams.get('code');
  if (!q && !code) return json({ error: 'q(학교명) 또는 code(학교코드) 필요' }, 400);
  if (code && !/^\d{1,8}$/.test(code)) return json({ error: '학교코드 형식이 아님' }, 400);
  let week = url.searchParams.get('week');
  if (week && !/^\d{1,2}$/.test(week)) return json({ error: 'week 형식이 아님' }, 400);
  // fresh=1('다시 받기'): 1분 캐시를 건너뛰고 저장소에서 새로 읽는다
  const fresh = url.searchParams.get('fresh') === '1';

  try {
    if (q) {
      const { value } = await listSchools(env, fresh);
      const k = norm(q);
      return json({ schools: value.filter((s) => norm(s.name).includes(k)).slice(0, 30).map((s) => ({ region: '', name: s.name, sccode: s.code })) });
    }
    const { value: school, stale } = await readSchool(env, code, fresh);
    if (!school) return json({ error: '아직 등록되지 않은 학교예요', diag: { unregistered: true } }, 424);
    if (school.error) return json({ error: `학교를 찾지 못했어요: ${school.error}`, diag: { registerFailed: true, name: school.name, at: school.at } }, 424);
    const today = school.weeks[0]?.raw?.['오늘r'];
    week ||= String(school.weeks.some((w) => w.r === today) ? today : school.weeks[0]?.r || 1);
    const entry = school.weeks.find((w) => String(w.r) === week) || school.weeks[0];
    if (!entry) return json({ error: '저장된 시간표가 비어 있어요' }, 424);
    week = String(entry.r);
    const raw = entry.raw;
    if (url.searchParams.get('raw')) return json({ keys: Object.keys(raw), raw });

    const t = parseTimetable(raw);
    const weeks = readWeeks(raw).filter((w) => school.weeks.some((x) => x.r === w.r)); // 저장된 주만
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
      stale: stale || undefined, // 저장소(GitHub)가 응답하지 않아 마지막으로 읽어 둔 시간표를 내려주는 중
      school: { code: school.code, name: school.name, region: school.region || '' },
      changedAt: school.changedAt,
      week: Number(week),
      weeks,
      times: raw['일과시간'] || [], // 교시별 시간 표시(예: "1(09:00)")
      classCount: raw['학급수'],
      teachers: t.teachers.map((name, id) => ({ id, name, subjects: subjectsOf.get(id) || [] })).filter((x) => x.id > 0 && x.name),
      lessons,
      classLessons,
      homeroom: findHomeroom(raw, Number(teacher)),
      debug: { boot: 'stored', sep: t.sep, mode: t.mode, clashes: t.clashes, cells: t.cells.length, homeroom: JSON.stringify(raw['담임'] ?? null).slice(0, 80) },
    });
  } catch (e) {
    // 502 가 아니라 424: classnote.gwansan.com 은 5xx 응답을 Cloudflare "Host Error" 페이지로 바꿔 원인 문장을 가린다
    return json({ error: e.message, diag: e.diag }, 424);
  }
}
