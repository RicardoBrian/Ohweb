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
export function classKey(school, grade, cls) {
  return `${String(school ?? '').trim().replace(/\//g, '_')}__g${nv(grade)}__c${nv(cls)}`;
}
export function classLabel(school, grade, cls) {
  return `${String(school ?? '').trim()} ${nv(grade)}학년 ${nv(cls)}반`.trim();
}
export function studentKey(school, grade, cls, number) {
  const n = parseInt(String(number ?? '').replace(/[^0-9]/g, ''), 10);
  return `${String(school ?? '').trim()}|${nv(grade)}|${nv(cls)}|${isNaN(n) ? '' : n}`;
}
export function resultId(assessmentId, studentId) { return `${assessmentId}_${studentId}`; }

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

// ── 점수 파일: 학교, 학년, 반, 번호, 이름(선택), 점수, 상태, 감점코드, 메모 ──
export const SCORE_HEADER = ['학교', '학년', '반', '번호', '이름', '점수', '상태', '감점코드', '메모'];

// students: [{id, schoolName, grade, class, number, name}]
// items: 그 평가 과목의 감점사유 [{code, label}]
// 돌려주는 rows: [{line, studentId, score, status, deductions:[{code,label}], memo}]
export function parseScoreRows(rows, { students, items, maxScore }) {
  const errors = [], warnings = [], out = [];
  if (!rows.length) return { rows: out, errors: ['파일이 비어 있습니다.'], warnings };
  const [header, ...body] = rows;
  const col = {
    school: headerIndex(header, ['학교', '학교명']), grade: headerIndex(header, ['학년']),
    cls: headerIndex(header, ['반']), number: headerIndex(header, ['번호']),
    name: headerIndex(header, ['이름', '성명']), score: headerIndex(header, ['점수']),
    status: headerIndex(header, ['상태']), codes: headerIndex(header, ['감점코드', '감점사유', '감점']),
    memo: headerIndex(header, ['메모', '비고']),
  };
  const need = ['school', 'grade', 'cls', 'number', 'score'].filter(k => col[k] < 0);
  if (need.length) return { rows: out, errors: ['첫 줄에 "학교, 학년, 반, 번호, 점수" 머리글이 있어야 합니다.'], warnings };

  const byKey = new Map(students.map(s => [studentKey(s.schoolName, s.grade, s.class, s.number), s]));
  const byCode = new Map((items || []).map(x => [x.code, x]));
  const seen = new Set();
  const get = (r, k) => (col[k] >= 0 ? String(r[col[k]] ?? '').trim() : '');

  body.forEach((r, k) => {
    const line = k + 2;
    const key = studentKey(get(r, 'school'), get(r, 'grade'), get(r, 'cls'), get(r, 'number'));
    const st = byKey.get(key);
    const who = `${get(r, 'school')} ${get(r, 'grade')}-${get(r, 'cls')}-${get(r, 'number')}`.trim();
    if (!st) { errors.push(`${line}줄: 학생을 찾을 수 없습니다 (${who}).`); return; }
    if (seen.has(st.id)) { errors.push(`${line}줄: 같은 학생이 두 번 나옵니다 (${who}).`); return; }
    const nm = get(r, 'name');
    if (nm && st.name && nm.replace(/\s/g, '') !== String(st.name).replace(/\s/g, '')) {
      warnings.push(`${line}줄: 이름이 명단과 다릅니다 (파일 "${nm}", 명단 "${st.name}") — 번호가 바뀐 학생인지 확인하세요.`);
    }
    const status = parseStatus(get(r, 'status'));
    if (!status) { errors.push(`${line}줄: 상태는 ${STATUSES.map(s => s.label).join('·')} 중 하나로 써 주세요.`); return; }
    const rawScore = get(r, 'score');
    let score = null;
    if (rawScore !== '') {
      score = Number(rawScore);
      if (!Number.isFinite(score)) { errors.push(`${line}줄: 점수 "${rawScore}" 는 숫자가 아닙니다.`); return; }
      if (score < 0) { errors.push(`${line}줄: 점수가 0보다 작습니다.`); return; }
      if (Number.isFinite(maxScore) && maxScore > 0 && score > maxScore) { errors.push(`${line}줄: 점수 ${score} 가 만점 ${maxScore} 보다 큽니다.`); return; }
    } else if (status === 'normal') {
      warnings.push(`${line}줄: 점수가 비어 있습니다 (${who}).`);
    }
    const codes = get(r, 'codes').split(/[;,/\s]+/).map(c => c.trim()).filter(Boolean);
    const deductions = [];
    for (const c of codes) {
      const it = byCode.get(c);
      if (!it) { errors.push(`${line}줄: 감점코드 "${c}" 가 이 과목 템플릿에 없습니다.`); return; }
      if (!deductions.some(d => d.code === c)) deductions.push({ code: it.code, label: it.label });
    }
    const memo = get(r, 'memo');
    if (memo.length > 500) { errors.push(`${line}줄: 메모는 500자 이하로 써 주세요.`); return; }
    seen.add(st.id);
    out.push({ line, studentId: st.id, score, status, deductions, memo });
  });
  return { rows: out, errors, warnings };
}

// ── 결과 비교(수정 이력용) ──
// 학생에게 보이는 값만 비교한다. 같으면 null.
export function pickResult(r) {
  return {
    score: r?.score ?? null,
    status: r?.status || 'normal',
    deductions: (r?.deductions || []).map(d => ({ code: d.code, label: d.label })),
    memo: r?.memo || '',
  };
}
export function sameResult(a, b) {
  return JSON.stringify(pickResult(a)) === JSON.stringify(pickResult(b));
}
// 사람이 읽는 변경 요약 (예: "점수 15 → 17, 감점 +A1")
export function describeChange(before, after) {
  const a = pickResult(before), b = pickResult(after), parts = [];
  if (a.score !== b.score) parts.push(`점수 ${a.score ?? '없음'} → ${b.score ?? '없음'}`);
  if (a.status !== b.status) parts.push(`상태 ${statusLabel(a.status)} → ${statusLabel(b.status)}`);
  const ac = new Set(a.deductions.map(d => d.code)), bc = new Set(b.deductions.map(d => d.code));
  const add = [...bc].filter(c => !ac.has(c)), del = [...ac].filter(c => !bc.has(c));
  if (add.length || del.length) parts.push(`감점 ${[...add.map(c => '+' + c), ...del.map(c => '−' + c)].join(' ')}`);
  if (a.memo !== b.memo) parts.push('메모 수정');
  return parts.join(', ');
}
