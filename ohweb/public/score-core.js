// 수행평가 점수 확인 — 화면·Firebase 없는 순수 함수 모음(score.html 이 쓴다).
// 테스트: ohweb-rules-test 에서 `npm run test:score`.

// ── 상태 ──
// 점수와 별개로 둔다. 파일에서는 한글로 쓰고, DB 에는 영문 코드로 저장한다.
export const STATUSES = [
  { id: 'normal',   label: '정상' },
  { id: 'missing',  label: '미제출' },
  { id: 'absent',   label: '결시' },
  { id: 'credited', label: '인정점' },
];
const STATUS_BY_LABEL = Object.fromEntries(STATUSES.map(s => [s.label, s.id]));
export function statusLabel(id) { return (STATUSES.find(s => s.id === id) || STATUSES[0]).label; }
export function parseStatus(v) {
  const s = String(v ?? '').trim();
  if (!s) return 'normal';
  if (STATUS_BY_LABEL[s]) return STATUS_BY_LABEL[s];
  if (STATUSES.some(x => x.id === s)) return s;
  return null; // 모르는 값
}

// ── 학생·반 키 ── (home.html·admin.html 의 appSettings 키와 같은 정규화)
export const nv = v => String(v ?? '').replace(/학년|년급|학|반|班|кл\./g, '').trim();
const num = v => { const n = parseInt(String(v ?? '').replace(/[^0-9]/g, ''), 10); return isNaN(n) ? '' : n; };
export function classKey(school, grade, cls) {
  return `${String(school ?? '').trim().replace(/\//g, '_')}__g${nv(grade)}__c${nv(cls)}`;
}
export function classLabel(school, grade, cls) {
  return `${String(school ?? '').trim()} ${nv(grade)}학년 ${nv(cls)}반`.trim();
}
export function studentKey(school, grade, cls, number) {
  return `${String(school ?? '').trim()}|${nv(grade)}|${nv(cls)}|${num(number)}`;
}
const gcnKey = (grade, cls, number) => `${num(grade)}|${num(cls)}|${num(number)}`;
export function resultId(assessmentId, studentId) { return `${assessmentId}_${studentId}`; }

// 학번 10101 → 1학년 1반 1번 (학년 1자리 + 반 2자리 + 번호 2자리)
export function parseHakbun(v) {
  const s = String(v ?? '').trim();
  if (!/^\d{5}$/.test(s)) return null;
  return { grade: +s[0], cls: +s.slice(1, 3), number: +s.slice(3) };
}
// 파일 이름 안의 학번: 20260930_10101_엔젤_2.png → 10101
export function hakbunInName(name) {
  const m = String(name ?? '').match(/(?:^|[_\-\s])(\d{5})(?=[_\-\s.]|$)/);
  return m ? m[1] : null;
}

// 학교 없이 학년·반·번호(학번)로 학생 찾기. 평가 대상 반(pool)을 먼저 보고, 없으면 전체에서
// 찾는다. 두 학교에 같은 학번이 있으면 null + ambiguous 를 돌려준다.
export function makeFinder(students, poolIds) {
  const pool = poolIds ? new Set(poolIds) : null;
  const bySchool = new Map(students.map(s => [studentKey(s.schoolName, s.grade, s.class, s.number), s]));
  const byGcn = new Map();
  students.forEach(s => { const k = gcnKey(s.grade, s.class, s.number); (byGcn.get(k) || byGcn.set(k, []).get(k)).push(s); });
  return (school, grade, cls, number) => {
    if (school) { const s = bySchool.get(studentKey(school, grade, cls, number)); return s ? { student: s } : {}; }
    const list = byGcn.get(gcnKey(grade, cls, number)) || [];
    const inPool = pool ? list.filter(s => pool.has(s.id)) : [];
    const pick = inPool.length ? inPool : list;
    if (pick.length === 1) return { student: pick[0] };
    return pick.length > 1 ? { ambiguous: true } : {};
  };
}

// ── 파일 읽기 ──
// 엑셀에서 "CSV 로 저장"하면 한국어 윈도우는 CP949(EUC-KR)로 저장한다. UTF-8 로
// 먼저 엄격하게 읽어 보고, 깨지면 EUC-KR 로 다시 읽는다.
export function decodeText(buf) {
  const bytes = buf instanceof Uint8Array ? buf : new Uint8Array(buf);
  try {
    return new TextDecoder('utf-8', { fatal: true }).decode(bytes).replace(/^﻿/, '');
  } catch {
    return new TextDecoder('euc-kr').decode(bytes);
  }
}

// RFC 4180 CSV(따옴표 안 쉼표·줄바꿈·"" 이스케이프). 빈 줄은 버린다.
export function parseCSV(text) {
  const rows = [];
  let row = [], cell = '', q = false;
  const s = String(text ?? '');
  for (let i = 0; i < s.length; i++) {
    const ch = s[i];
    if (q) {
      if (ch === '"') { if (s[i + 1] === '"') { cell += '"'; i++; } else q = false; }
      else cell += ch;
    } else if (ch === '"') q = true;
    else if (ch === ',') { row.push(cell); cell = ''; }
    else if (ch === '\n' || ch === '\r') {
      if (ch === '\r' && s[i + 1] === '\n') i++;
      row.push(cell); rows.push(row); row = []; cell = '';
    } else cell += ch;
  }
  if (cell !== '' || row.length) { row.push(cell); rows.push(row); }
  return rows.map(r => r.map(c => c.trim())).filter(r => r.some(c => c !== ''));
}

// CSV 로 내려받기(엑셀이 한글을 바로 읽도록 BOM 을 붙인다).
export function toCSV(rows) {
  const esc = v => { const s = String(v ?? ''); return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s; };
  return '﻿' + rows.map(r => r.map(esc).join(',')).join('\r\n') + '\r\n';
}

// 첫 줄(머리글)에서 열 위치 찾기. 공백은 무시한다. 없으면 -1.
function headerIndex(header, names) {
  const h = header.map(x => String(x ?? '').replace(/\s/g, ''));
  for (const n of names) { const i = h.indexOf(n); if (i >= 0) return i; }
  return -1;
}

// ── 평가 항목(루브릭) 머리글 ──
// "① 변수 사용(5)" → 1번 항목 점수 열(이름 "변수 사용", 배점 5)
// "① 감점 사유" / "①사유" → 1번 항목 사유 열.  "항목1", "1." 처럼 써도 된다.
const CIRCLED = '①②③④⑤⑥⑦⑧⑨⑩';
function criterionHeader(h) {
  const s = String(h ?? '').trim();
  let idx = 0, rest = '';
  const c = CIRCLED.indexOf(s[0]);
  if (c >= 0) { idx = c + 1; rest = s.slice(1); }
  else { const m = s.match(/^(?:항목\s*)?(\d{1,2})[.)]\s*(.*)$/) || s.match(/^항목\s*(\d{1,2})(.*)$/); if (!m) return null; idx = +m[1]; rest = m[2]; }
  rest = rest.trim();
  if (/사유|이유|근거/.test(rest)) return { idx, kind: 'reason' };
  const mm = rest.match(/^(.*?)[\s]*[(（]\s*(\d+(?:\.\d+)?)\s*점?\s*[)）]\s*$/);
  return { idx, kind: 'score', label: (mm ? mm[1] : rest).trim(), max: mm ? Number(mm[2]) : null };
}
const NO_DEDUCTION = /^(감점\s*없음|없음|-)$/;
export function cleanReason(v) { const s = String(v ?? '').trim(); return NO_DEDUCTION.test(s) ? '' : s; }

// 항목 합계(빈 칸만 있으면 null)
export function sumItems(items) {
  const vals = (items || []).map(i => i?.score).filter(v => v != null && v !== '' && Number.isFinite(Number(v)));
  return vals.length ? Math.round(vals.reduce((a, b) => a + Number(b), 0) * 100) / 100 : null;
}

// ── 감점사유 템플릿 파일: 과목, 코드, 사유 ──
export const TEMPLATE_HEADER = ['과목', '코드', '사유'];
export function parseTemplateRows(rows) {
  const errors = [];
  if (!rows.length) return { subjects: {}, errors: ['파일이 비어 있습니다.'] };
  const [header, ...body] = rows;
  const iS = headerIndex(header, ['과목']), iC = headerIndex(header, ['코드']), iL = headerIndex(header, ['사유', '감점사유']);
  if (iS < 0 || iC < 0 || iL < 0) return { subjects: {}, errors: ['첫 줄에 "과목, 코드, 사유" 머리글이 있어야 합니다.'] };
  const subjects = {};
  body.forEach((r, k) => {
    const line = k + 2;
    const subject = (r[iS] || '').trim(), code = (r[iC] || '').trim(), label = (r[iL] || '').trim();
    if (!subject || !code || !label) { errors.push(`${line}줄: 과목·코드·사유 중 빈 칸이 있습니다.`); return; }
    if (code.length > 20) { errors.push(`${line}줄: 코드는 20자 이하로 써 주세요.`); return; }
    if (label.length > 200) { errors.push(`${line}줄: 사유는 200자 이하로 써 주세요.`); return; }
    const list = subjects[subject] || (subjects[subject] = []);
    if (list.some(x => x.code === code)) { errors.push(`${line}줄: "${subject}" 과목에 코드 ${code} 가 두 번 나옵니다.`); return; }
    list.push({ code, label });
  });
  return { subjects, errors };
}

// ── 점수 파일 ──
// 학생: 학번 또는 학교·학년·반·번호. 점수: "점수"(총점) 또는 항목 열(①…). 그 밖에 이름·상태·
// 감점코드·메모(학생에게 보임)·비고(선생님만). 채점 시트의 상세 탭을 CSV 로 받아 그대로 올릴 수 있다.
export const SCORE_HEADER = ['학교', '학년', '반', '번호', '이름', '점수', '상태', '감점코드', '메모', '비고'];
export function scoreHeader(criteria) {
  if (!criteria?.length) return SCORE_HEADER;
  return ['학교', '학년', '반', '번호', '이름',
    ...criteria.map((c, i) => `${CIRCLED[i]} ${c.label}(${c.max})`),
    ...criteria.map((c, i) => `${CIRCLED[i]} 감점 사유`),
    '상태', '감점코드', '메모', '비고'];
}

// students: [{id, schoolName, grade, class, number, name}], poolIds: 평가 대상 반 학생 ID
// items: 감점사유 템플릿 [{code,label}], criteria: 평가 항목 [{label,max}] (없으면 파일 머리글에서 제안)
// 돌려줌: rows [{line, studentId, score, status, deductions, memo, note, items?}],
//         fileCriteria(파일 머리글의 항목), errors, warnings
export function parseScoreRows(rows, { students, poolIds, items, maxScore, criteria }) {
  const errors = [], warnings = [], out = [];
  if (!rows.length) return { rows: out, errors: ['파일이 비어 있습니다.'], warnings, fileCriteria: [] };
  const [header, ...body] = rows;
  const col = {
    hakbun: headerIndex(header, ['학번']),
    school: headerIndex(header, ['학교', '학교명']), grade: headerIndex(header, ['학년']),
    cls: headerIndex(header, ['반']), number: headerIndex(header, ['번호']),
    name: headerIndex(header, ['이름', '성명']),
    status: headerIndex(header, ['상태']), codes: headerIndex(header, ['감점코드', '감점']),
    memo: headerIndex(header, ['메모']), note: headerIndex(header, ['비고']),
  };
  col.score = headerIndex(header, ['점수', '총점', '합계']);
  if (col.score < 0) col.score = header.findIndex(h => /합계|총점/.test(String(h)) && !criterionHeader(h));
  // 항목 열
  const crit = {};
  header.forEach((h, i) => {
    const c = criterionHeader(h); if (!c) return;
    const e = crit[c.idx] || (crit[c.idx] = { idx: c.idx });
    if (c.kind === 'score') Object.assign(e, { scoreCol: i, label: c.label, max: c.max });
    else e.reasonCol = i;
  });
  const fileCriteria = Object.values(crit).filter(c => c.scoreCol != null).sort((a, b) => a.idx - b.idx)
    .map(c => ({ idx: c.idx, label: c.label || `항목${c.idx}`, max: c.max }));
  const hasItems = fileCriteria.length > 0;
  const useCrit = criteria?.length ? criteria : (hasItems ? fileCriteria : null);

  const haveStudent = col.hakbun >= 0 || (col.grade >= 0 && col.cls >= 0 && col.number >= 0);
  if (!haveStudent) return { rows: out, errors: ['첫 줄에 "학번" 또는 "학년, 반, 번호" 머리글이 있어야 합니다.'], warnings, fileCriteria };
  if (col.score < 0 && !hasItems) return { rows: out, errors: ['첫 줄에 "점수" 또는 항목 점수(① …) 머리글이 있어야 합니다.'], warnings, fileCriteria };
  if (hasItems && criteria?.length) {
    if (fileCriteria.length !== criteria.length || fileCriteria.some((c, i) => c.idx !== i + 1))
      return { rows: out, errors: [`파일의 항목 수(${fileCriteria.length})가 평가 항목 수(${criteria.length})와 다릅니다.`], warnings, fileCriteria };
    fileCriteria.forEach((c, i) => { if (c.max != null && c.max !== criteria[i].max) warnings.push(`${c.idx}번 항목 배점이 파일(${c.max})과 평가(${criteria[i].max})가 다릅니다 — 평가 배점으로 확인합니다.`); });
  }

  const find = makeFinder(students, poolIds);
  const byCode = new Map((items || []).map(x => [x.code, x]));
  const seen = new Set();
  const get = (r, k) => (col[k] >= 0 ? String(r[col[k]] ?? '').trim() : '');
  const total = useCrit ? sumMax(useCrit) : maxScore;

  body.forEach((r, k) => {
    const line = k + 2;
    let school = get(r, 'school'), grade = get(r, 'grade'), cls = get(r, 'cls'), number = get(r, 'number');
    if (col.hakbun >= 0) {
      const hb = parseHakbun(get(r, 'hakbun'));
      if (!hb) { errors.push(`${line}줄: 학번 "${get(r, 'hakbun')}" 을 읽을 수 없습니다 (예: 10101).`); return; }
      ({ grade, cls, number } = hb);
    }
    const who = `${school ? school + ' ' : ''}${grade}-${cls}-${number}`;
    const f = find(school, grade, cls, number);
    if (f.ambiguous) { errors.push(`${line}줄: 같은 학번의 학생이 여러 학교에 있습니다 (${who}) — "학교" 열을 넣어 주세요.`); return; }
    const st = f.student;
    if (!st) { errors.push(`${line}줄: 학생을 찾을 수 없습니다 (${who}).`); return; }
    if (seen.has(st.id)) { errors.push(`${line}줄: 같은 학생이 두 번 나옵니다 (${who}).`); return; }
    const nm = get(r, 'name');
    if (nm && st.name && nm.replace(/\s/g, '') !== String(st.name).replace(/\s/g, '')) {
      warnings.push(`${line}줄: 이름이 명단과 다릅니다 (파일 "${nm}", 명단 "${st.name}") — 번호가 바뀐 학생인지 확인하세요.`);
    }
    const status = parseStatus(get(r, 'status'));
    if (!status) { errors.push(`${line}줄: 상태는 ${STATUSES.map(s => s.label).join('·')} 중 하나로 써 주세요.`); return; }

    // 항목 점수
    let itemVals = null;
    if (hasItems) {
      itemVals = [];
      for (const [i, fc] of fileCriteria.entries()) {
        const raw = String(r[crit[fc.idx].scoreCol] ?? '').trim();
        const max = useCrit[i]?.max;
        let v = null;
        if (raw !== '') {
          v = Number(raw);
          if (!Number.isFinite(v) || v < 0) { errors.push(`${line}줄: ${fc.idx}번 항목 점수 "${raw}" 가 올바르지 않습니다.`); return; }
          if (max != null && v > max) { errors.push(`${line}줄: ${fc.idx}번 항목 점수 ${v} 가 배점 ${max} 보다 큽니다.`); return; }
        }
        const reason = crit[fc.idx].reasonCol != null ? cleanReason(r[crit[fc.idx].reasonCol]) : '';
        if (reason.length > 500) { errors.push(`${line}줄: ${fc.idx}번 항목 사유는 500자 이하로 써 주세요.`); return; }
        itemVals.push({ score: v, reason });
      }
    }
    // 총점
    const rawScore = get(r, 'score');
    let score = null;
    if (itemVals) {
      score = sumItems(itemVals);
      if (rawScore !== '' && Number.isFinite(Number(rawScore)) && score != null && Number(rawScore) !== score)
        warnings.push(`${line}줄: 합계 칸(${rawScore})과 항목 점수 합(${score})이 다릅니다 — 항목 합으로 저장합니다.`);
    } else if (rawScore !== '') {
      score = Number(rawScore);
      if (!Number.isFinite(score)) { errors.push(`${line}줄: 점수 "${rawScore}" 는 숫자가 아닙니다.`); return; }
      if (score < 0) { errors.push(`${line}줄: 점수가 0보다 작습니다.`); return; }
    }
    if (score != null && Number.isFinite(total) && total > 0 && score > total) { errors.push(`${line}줄: 점수 ${score} 가 만점 ${total} 보다 큽니다.`); return; }
    if (score == null && status === 'normal') warnings.push(`${line}줄: 점수가 비어 있습니다 (${who}${st.name ? ' ' + st.name : ''}).`);

    const codes = get(r, 'codes').split(/[;,/\s]+/).map(c => c.trim()).filter(Boolean);
    const deductions = [];
    for (const c of codes) {
      const it = byCode.get(c);
      if (!it) { errors.push(`${line}줄: 감점코드 "${c}" 가 이 과목 템플릿에 없습니다.`); return; }
      if (!deductions.some(d => d.code === c)) deductions.push({ code: it.code, label: it.label });
    }
    const memo = get(r, 'memo'), note = get(r, 'note');
    if (memo.length > 500 || note.length > 500) { errors.push(`${line}줄: 메모·비고는 500자 이하로 써 주세요.`); return; }
    seen.add(st.id);
    const row = { line, studentId: st.id, score, status, deductions, memo, note };
    if (itemVals) row.items = itemVals.map((v, i) => ({ label: useCrit[i].label, max: useCrit[i].max, ...v }));
    out.push(row);
  });
  return { rows: out, errors, warnings, fileCriteria };
}
export function sumMax(criteria) { return (criteria || []).reduce((a, c) => a + (Number(c.max) || 0), 0); }

// ── 제출물 파일 ↔ 학생 ──
const baseName = n => String(n ?? '').replace(/\.[^.]+$/, '');
// files: [{id, name, ...}] (드라이브 폴더를 훑은 결과). 파일 이름의 학번으로 찾는다.
export function matchFiles(files, students, poolIds) {
  const find = makeFinder(students, poolIds);
  const byStudent = {}, unmatched = [];
  for (const f of files) {
    const hb = parseHakbun(hakbunInName(f.name));
    const r = hb ? find('', hb.grade, hb.cls, hb.number) : {};
    if (r.student) (byStudent[r.student.id] ||= []).push(f);
    else unmatched.push({ ...f, why: !hb ? '이름에 학번이 없음' : r.ambiguous ? '같은 학번이 여러 학교에 있음' : '명단에 없는 학번' });
  }
  Object.values(byStudent).forEach(list => list.sort((a, b) => baseName(a.name).localeCompare(baseName(b.name), 'ko', { numeric: true })));
  return { byStudent, unmatched };
}

// ── 결과 비교(수정 이력용) ──
// 학생에게 보이는 값만 비교한다(비고·제출물·공개 여부는 빼고). 같으면 true.
export function pickResult(r) {
  const o = {
    score: r?.score ?? null,
    status: r?.status || 'normal',
    deductions: (r?.deductions || []).map(d => ({ code: d.code, label: d.label })),
    memo: r?.memo || '',
  };
  if (r?.items?.length) o.items = r.items.map(i => ({ label: i.label, max: i.max ?? null, score: i.score ?? null, reason: i.reason || '' }));
  return o;
}
export function sameResult(a, b) {
  return JSON.stringify(pickResult(a)) === JSON.stringify(pickResult(b));
}
// 사람이 읽는 변경 요약 (예: "점수 15 → 17, ② 3 → 5, 감점 +A1")
export function describeChange(before, after) {
  const a = pickResult(before), b = pickResult(after), parts = [];
  if (a.score !== b.score) parts.push(`점수 ${a.score ?? '없음'} → ${b.score ?? '없음'}`);
  const n = Math.max(a.items?.length || 0, b.items?.length || 0);
  for (let i = 0; i < n; i++) {
    const x = a.items?.[i], y = b.items?.[i], tag = CIRCLED[i] || `${i + 1}.`;
    if ((x?.score ?? null) !== (y?.score ?? null)) parts.push(`${tag} ${x?.score ?? '없음'} → ${y?.score ?? '없음'}`);
    if ((x?.reason || '') !== (y?.reason || '')) parts.push(`${tag} 사유 수정`);
  }
  if (a.status !== b.status) parts.push(`상태 ${statusLabel(a.status)} → ${statusLabel(b.status)}`);
  const ac = new Set(a.deductions.map(d => d.code)), bc = new Set(b.deductions.map(d => d.code));
  const add = [...bc].filter(c => !ac.has(c)), del = [...ac].filter(c => !bc.has(c));
  if (add.length || del.length) parts.push(`감점 ${[...add.map(c => '+' + c), ...del.map(c => '−' + c)].join(' ')}`);
  if (a.memo !== b.memo) parts.push('메모 수정');
  return parts.join(', ');
}
export const circled = i => CIRCLED[i] || `${i + 1}.`;
