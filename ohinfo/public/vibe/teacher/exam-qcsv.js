// 시험 문항 CSV 받기/올리기 — 순수 함수만 둔다(Firebase 없음, node로 테스트 가능).
// admin.html의 '문제 관리' 탭이 쓴다. 한 행 = 문항 하나, 행 순서 = 문항 순서.
//
// 올리기 규칙: 문항ID가 이 시험의 문항이면 수정, 비었거나 이 시험에 없는 ID면 새 문항,
// CSV에 없는 이 시험의 문항은 삭제. 오류가 한 행이라도 있으면 아무것도 반영하지 않는다.
//
// 엑셀은 =,+,-,@로 시작하는 칸을 수식으로 실행하므로 받을 때 앞에 '를 붙이고,
// 올릴 때 그 '를 뗀다(코드나 -1 같은 정답이 바뀌지 않게).

export const QCSV_TYPE_LABEL = { mc: '객관식', sa: '단답형', essay: '서술형', code: '코딩' };
const TYPE_ALIASES = {
  mc: ['객관식', '객관', 'mc'],
  sa: ['단답형', '단답', 'sa'],
  essay: ['서술형', '서술', '논술형', 'essay'],
  code: ['코딩', '코드', '프로그래밍', 'code'],
};
export function parseType(v) {
  const s = String(v ?? '').trim().toLowerCase();
  if (!s) return null;
  return Object.keys(TYPE_ALIASES).find(k => TYPE_ALIASES[k].includes(s)) || null;
}

const BASE_COLS = ['문항ID', '유형', '배점', '시험지유형', '제목', '내용', '이미지URL'];
const MID_COLS = ['정답', '최소글자', '최대글자', '입력설명', '출력설명', '예시입력', '예시출력', '기본코드'];

// 문항 → 비교·내보내기용 표준형. 저장된 문항과 CSV에서 읽은 문항을 같은 모양으로 맞춘다.
export function canon(q) {
  const type = q.type;
  const c = {
    type,
    points: Number(q.points) || 0,
    form: q.form || '',
    title: String(q.title ?? ''),
    content: String(q.content ?? ''),
    imageUrl: String(q.imageUrl ?? ''),
  };
  if (type === 'mc') {
    c.options = (q.options || []).map(String);
    c.answer = String(parseInt(q.answer, 10) || 0);
  } else if (type === 'sa') {
    c.answer = String(q.answer ?? '');
  } else if (type === 'essay') {
    c.minLen = Number(q.minLen) > 0 ? Number(q.minLen) : 0;
    c.maxLen = Number(q.maxLen) > 0 ? Number(q.maxLen) : 0;
  } else if (type === 'code') {
    for (const k of ['inDesc', 'outDesc', 'inEx', 'outEx', 'boilerplate']) c[k] = String(q[k] ?? '');
    c.testCases = (q.testCases || []).map(t => ({ input: String(t.input ?? ''), expected: String(t.expected ?? '') }));
  }
  return c;
}

const escCell = v => {
  let s = String(v ?? '');
  if (/^[=+\-@]/.test(s)) s = "'" + s;
  return `"${s.replace(/"/g, '""')}"`;
};
const unescCell = s => (/^'[=+\-@]/.test(s) ? s.slice(1) : s);

const EXAMPLES = [
  { type: 'mc', points: 10, title: '(예시) 1+1은?', content: '', options: ['1', '2', '3', '4'], answer: '1' },
  { type: 'sa', points: 10, title: '(예시) 대한민국의 수도는?', answer: '서울' },
  { type: 'essay', points: 20, title: '(예시) 자신의 꿈을 써 보세요.', minLen: 50 },
  { type: 'code', points: 20, title: '(예시) 두 수의 합', inDesc: '정수 a b', outDesc: 'a+b', inEx: '1 2', outEx: '3',
    boilerplate: 'a, b = map(int, input().split())\n', testCases: [{ input: '1 2', expected: '3' }, { input: '10 20', expected: '30' }] },
];

// questions: 순서대로, 정답(answer/testCases)이 합쳐진 문항들. 비면 예시 행으로 양식을 만든다.
export function buildCsv(questions) {
  const list = questions.length ? questions : EXAMPLES;
  const cs = list.map(q => ({ id: questions.length ? q.id : '', c: canon(q) }));
  const nOpt = Math.max(5, ...cs.map(x => (x.c.options || []).length));
  const nTc = Math.max(2, ...cs.map(x => (x.c.testCases || []).length));
  const header = [...BASE_COLS];
  for (let i = 1; i <= nOpt; i++) header.push('보기' + i);
  header.push(...MID_COLS);
  for (let i = 1; i <= nTc; i++) header.push(`테케${i}_입력`, `테케${i}_출력`);
  const rows = [header];
  for (const { id, c } of cs) {
    const r = [id, QCSV_TYPE_LABEL[c.type] || c.type, c.points, c.form, c.title, c.content, c.imageUrl];
    for (let i = 0; i < nOpt; i++) r.push((c.options || [])[i] ?? '');
    r.push(
      c.type === 'mc' ? (parseInt(c.answer, 10) || 0) + 1 : c.type === 'sa' ? c.answer : '',
      c.minLen || '', c.maxLen || '',
      c.inDesc ?? '', c.outDesc ?? '', c.inEx ?? '', c.outEx ?? '', c.boilerplate ?? '',
    );
    for (let i = 0; i < nTc; i++) { const t = (c.testCases || [])[i]; r.push(t?.input ?? '', t?.expected ?? ''); }
    rows.push(r);
  }
  return '﻿' + rows.map(r => r.map(escCell).join(',')).join('\r\n') + '\r\n';
}

// CSV/TSV 글자 → 2차원 배열. 따옴표 안의 줄바꿈·쉼표·따옴표("")를 지원한다.
export function parseRows(raw) {
  const text = String(raw ?? '').replace(/^﻿/, '').replace(/\r\n?/g, '\n');
  if (!text.trim()) return [];
  const firstLine = text.split('\n', 1)[0];
  const delim = firstLine.includes('\t') && !firstLine.includes(',') ? '\t' : ',';
  const rows = []; let row = []; let cur = ''; let inQ = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (inQ) {
      if (ch === '"') { if (text[i + 1] === '"') { cur += '"'; i++; } else inQ = false; }
      else cur += ch;
    } else if (ch === '"' && cur === '') inQ = true;
    else if (ch === delim) { row.push(cur); cur = ''; }
    else if (ch === '\n') { row.push(cur); rows.push(row); row = []; cur = ''; }
    else cur += ch;
  }
  row.push(cur); rows.push(row);
  return rows.filter(r => r.some(c => c.trim() !== ''));
}

// 한 행 → 저장할 문항 데이터(정답 포함, examId·order 제외)와 오류 목록
function rowToQuestion(get, opts, tcs, forms) {
  const errors = [];
  const typeRaw = get('유형');
  const type = parseType(typeRaw);
  if (!type) errors.push(typeRaw.trim() ? `유형 '${typeRaw.trim()}'을 알 수 없음(객관식/단답형/서술형/코딩)` : '유형이 비어 있음');
  const title = get('제목').trim();
  if (!title) errors.push('제목이 비어 있음');
  const pRaw = get('배점').trim();
  let points = 10;
  if (pRaw !== '') {
    points = Number(pRaw);
    if (!Number.isInteger(points) || points < 1) { errors.push(`배점 '${pRaw}'은 1 이상의 정수여야 함`); points = 10; }
  }
  const formRaw = get('시험지유형').trim().toUpperCase().replace(/형$/, '');
  let form = '';
  if (formRaw && formRaw !== '공통') {
    if (forms.includes(formRaw)) form = formRaw;
    else errors.push(forms.length ? `시험지유형 '${formRaw}'은 이 시험에 없음(${forms.join('/')} 또는 빈칸)` : '이 시험은 시험지유형을 쓰지 않으니 시험지유형 칸을 비워야 함');
  }
  const q = { type, points, form, title, content: get('내용').trim(), imageUrl: get('이미지URL').trim() };
  if (type === 'mc') {
    q.options = opts.map(s => s.trim()).filter(Boolean);
    if (q.options.length < 2) errors.push('객관식은 보기가 2개 이상 필요');
    const aRaw = get('정답').trim();
    const n = Number(aRaw);
    if (!aRaw) errors.push('객관식 정답(보기 번호)이 비어 있음');
    else if (!Number.isInteger(n) || n < 1 || n > q.options.length) errors.push(`객관식 정답 '${aRaw}'은 1~${q.options.length} 사이 번호여야 함`);
    q.answer = String(Number.isInteger(n) && n >= 1 ? n - 1 : 0);
  } else if (type === 'sa') {
    q.answer = get('정답').trim();
    if (!q.answer) errors.push('단답형 정답이 비어 있음');
  } else if (type === 'essay') {
    for (const [col, key] of [['최소글자', 'minLen'], ['최대글자', 'maxLen']]) {
      const raw = get(col).trim();
      if (!raw) continue;
      const n = Number(raw);
      if (!Number.isInteger(n) || n < 0) errors.push(`${col} '${raw}'은 0 이상의 정수여야 함`);
      else if (n > 0) q[key] = n;
    }
    if (q.minLen && q.maxLen && q.minLen > q.maxLen) errors.push('최소글자가 최대글자보다 큼');
  } else if (type === 'code') {
    q.inDesc = get('입력설명').trim(); q.outDesc = get('출력설명').trim();
    q.inEx = get('예시입력').trim(); q.outEx = get('예시출력').trim();
    q.boilerplate = get('기본코드');
    q.testCases = [];
    tcs.forEach(([input, expected], i) => {
      if (expected === '' && input === '') return;
      if (expected === '') { errors.push(`테케${i + 1}_출력이 비어 있음`); return; }
      q.testCases.push({ input, expected });
    });
  }
  return { q, errors };
}

const textSig = c => JSON.stringify([c.title, c.content, c.options || []]);

// existing: 이 시험의 지금 문항들(순서대로, 정답 합쳐짐). forms: 이 시험의 시험지 유형(['A','B'] 등).
// 반환: { error } (양식 자체가 틀림) 또는 { items, deletions, errorCount }
//   item: { line, status: 'add'|'update'|'same'|'error', id, data, errors, textChanged, order, orderChanged }
export function planImport(text, existing, forms = []) {
  const rows = parseRows(text);
  if (!rows.length) return { error: '빈 파일입니다.' };
  const header = rows[0].map(h => h.replace(/^﻿/, '').trim());
  const col = name => header.indexOf(name);
  for (const need of ['유형', '제목']) {
    if (col(need) < 0) return { error: `첫 줄(제목줄)에 '${need}' 칸이 없습니다. [CSV 받기]로 받은 양식을 쓰세요.` };
  }
  const optCols = header.map((h, i) => [h.match(/^보기(\d+)$/), i]).filter(([m]) => m).sort((a, b) => a[0][1] - b[0][1]).map(([, i]) => i);
  const tcCols = [];
  header.forEach((h, i) => {
    const m = h.match(/^테케(\d+)_(입력|출력)$/);
    if (!m) return;
    const k = Number(m[1]);
    (tcCols[k] ||= [-1, -1])[m[2] === '입력' ? 0 : 1] = i;
  });
  const tcPairs = tcCols.filter(Boolean);

  const byId = new Map(existing.map((q, i) => [q.id, { q, order: i + 1 }]));
  const seen = new Set();
  const items = [];
  rows.slice(1).forEach((r, ri) => {
    const cell = i => (i >= 0 && i < r.length ? unescCell(r[i]) : '');
    const get = name => cell(col(name));
    const { q, errors } = rowToQuestion(get, optCols.map(cell), tcPairs.map(([a, b]) => [cell(a), cell(b)]), forms);
    const rawId = get('문항ID').trim();
    let id = '';
    if (rawId && byId.has(rawId)) {
      if (seen.has(rawId)) errors.push(`문항ID ${rawId}가 위에 이미 있음(복사한 줄이면 문항ID 칸을 비우세요)`);
      else { seen.add(rawId); id = rawId; }
    }
    const order = items.length + 1;
    const item = { line: ri + 2, id, data: q, errors, order };
    if (errors.length) item.status = 'error';
    else if (!id) { item.status = 'add'; item.textChanged = true; item.fromOtherId = rawId || ''; }
    else {
      const old = byId.get(id);
      const a = canon(old.q), b = canon(q);
      item.textChanged = textSig(a) !== textSig(b);
      item.orderChanged = Number(old.q.order) !== order;
      item.status = JSON.stringify(a) !== JSON.stringify(b) ? 'update' : 'same';
    }
    items.push(item);
  });
  const deletions = existing.filter(q => !seen.has(q.id));
  return { items, deletions, errorCount: items.filter(x => x.status === 'error').length };
}
