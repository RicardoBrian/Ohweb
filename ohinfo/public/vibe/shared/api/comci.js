/*
 * 견본용 컴시간 응답 — ohlog/functions/api/comci.js와 같은 모양으로, 가상의 학교
 * (견본중학교) 시간표를 브라우저 안에서 만들어 돌려준다. 실제 컴시간에는 접속하지 않는다.
 * 견본 선생님(교사 1번, 정보)은 1학년 여러 반에 정해진 시간에 들어간다.
 */
export const SCHOOL = { region: '경기', name: '견본중학교', sccode: '99999' };
const TEACHERS = ['', '견본*', '김*연', '이*수', '박*희', '최*호', '정*민', '한*결', '오*은', '윤*아'];
const SUBJECTS = ['', '정보', '국어', '수학', '영어', '과학', '사회', '체육', '음악', '미술'];
const TIMES = ['1(09:00)', '2(09:55)', '3(10:50)', '4(11:45)', '5(13:30)', '6(14:25)'];
const CLASSES = [0, 4, 4, 4];
// 견본 선생님 정보 수업: [학년, 반, 요일(1=월), 교시]
export const MY_SLOTS = [[1, 1, 1, 1], [1, 2, 1, 3], [1, 3, 2, 2], [1, 1, 3, 4], [1, 4, 4, 1], [1, 2, 4, 5], [1, 3, 5, 3], [1, 4, 5, 6]];

const iso = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
function mondayOf(d) { const m = new Date(d); m.setHours(0, 0, 0, 0); m.setDate(m.getDate() - ((m.getDay() + 6) % 7)); return m; }
function addDays(isoStr, n) { const [y, m, dd] = isoStr.split('-').map(Number); return iso(new Date(y, m - 1, dd + n)); }
// 주차: 지난주(1) · 이번 주(2) · 다음 주(3) · 그다음 주(4)
export function weeks() {
  const mon = mondayOf(new Date());
  return [1, 2, 3, 4].map((r) => {
    const s = new Date(mon); s.setDate(s.getDate() + (r - 2) * 7);
    const e = new Date(s); e.setDate(e.getDate() + 5);
    const yy = (d) => iso(d).slice(2);
    return { r, label: `${yy(s)} ~ ${yy(e)}`, start: iso(s) };
  });
}

function cells() {
  const out = [];
  for (let g = 1; g <= 3; g++)
    for (let c = 1; c <= CLASSES[g]; c++)
      for (let d = 1; d <= 5; d++)
        for (let p = 1; p <= TIMES.length; p++) {
          const mine = MY_SLOTS.some(([G, C, D, P]) => G === g && C === c && D === d && P === p);
          const s = mine ? 1 : ((g * 7 + c * 3 + d * 5 + p) % 8) + 2;
          out.push({ grade: g, class: c, day: d, period: p, changed: false, teacher: s, subject: s, subjectName: SUBJECTS[s] });
        }
  return out;
}

export async function handle(request) {
  const url = new URL(request.url);
  const json = (body, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json; charset=utf-8' } });
  const q = url.searchParams.get('q');
  const code = url.searchParams.get('code');
  if (!q && !code) return json({ error: 'q(학교명) 또는 code(학교코드) 필요' }, 400);
  if (q) return json({ schools: '견본중학교'.includes(q.trim()) || q.includes('견본') ? [SCHOOL] : [] });
  if (code !== SCHOOL.sccode) return json({ error: '견본에서는 견본중학교만 볼 수 있습니다.' }, 404);

  const ws = weeks();
  const week = Number(url.searchParams.get('week') || 2);
  const start = (ws.find((w) => w.r === week) || ws[1]).start;
  const all = cells();
  const teacher = url.searchParams.get('teacher');
  const g = url.searchParams.get('grade'), c = url.searchParams.get('class');
  const withDate = (x) => ({ ...x, date: addDays(start, x.day - 1) });
  const subjectsOf = (id) => (id === 1 ? ['정보'] : [SUBJECTS[id]]);
  return json({
    week, weeks: ws, times: TIMES, classCount: CLASSES,
    teachers: TEACHERS.map((name, id) => ({ id, name, subjects: subjectsOf(id) })).filter((x) => x.id > 0),
    lessons: teacher == null ? undefined : all.filter((x) => x.teacher === Number(teacher)).map(withDate),
    classLessons: g && c ? all.filter((x) => x.grade === Number(g) && x.class === Number(c)).map((x) => ({ ...withDate(x), teacherName: TEACHERS[x.teacher] })) : undefined,
    homeroom: Number(teacher) === 1 ? [{ grade: 1, class: 1 }] : [],
    debug: { demo: true },
  });
}
