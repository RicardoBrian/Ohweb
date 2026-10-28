/**
 * Cloudflare Pages Function — /api/exam
 *
 * 학생 시험 화면(exam.html)은 시험 데이터를 Firestore에서 직접 읽지 않고
 * 전부 여기를 거친다. 요청 본문의 action으로 나뉜다.
 *   list   — 내게 배정된 시험 목록. 입장 코드는 내려보내지 않는다.
 *   start  — 입장. 열림(ON)·응시 대상·입장 코드·입장 마감을 여기서 확인하고,
 *            통과하면 시작 시각을 기록한 뒤 문항(정답 제외)을 내려준다.
 *   submit — 채점하고 결과를 기록한다.
 *   result — 내 결과. 시험이 열려(ON) 있는 동안은 오답의 정답을 가린다.
 *
 * 예전엔 exam_assignments·exam_questions·exam_results를 학생이 직접 읽었다.
 * 그래서 입장 코드는 목록을 받을 때 같이 내려와 콘솔에서 보였고, 문항은
 * 시험이 열리기 전에도 누구나 읽을 수 있었고, 먼저 낸 학생은 결과 화면의
 * "오답 (정답: ②)"로 아직 시험 중인 친구에게 정답을 넘길 수 있었다. 이제 그
 * 컬렉션들은 관리자만 읽고, 학생에게 무엇을 언제 보여줄지는 여기서 정한다.
 * 선생님이 할 일은 admin에서 배정을 ON/OFF하는 것뿐이다 — 입장 코드는
 * 넣으면 확인하고, 비워두면 코드 없이 들어온다.
 *
 * 채점 규칙은 예전 /api/grade-exam 그대로다. 결과도 여기서 기록한다
 * (exam_results / exam_progress) — 서비스 계정은 보안 규칙을 우회하므로
 * 규칙 쪽에서는 학생의 점수 쓰기를 막아둘 수 있다.
 *
 * 필요한 Cloudflare 환경변수 — Pages 프로젝트 `ohinfo`:
 *   FIREBASE_SERVICE_ACCOUNT_KEY (Secret) = 서비스 계정 JSON 전체.
 *   ※ ohweb에 넣은 것과 값은 같아도 되지만, Pages 프로젝트가 다르므로
 *     ohinfo에도 따로 등록해야 한다. 한쪽만 넣으면 그쪽 기능만 된다.
 *
 *   걸리기 쉬운 것: 이름 오타, Production/Preview 구분, 그리고 값을 넣은
 *   뒤 재배포해야 적용된다는 점(환경변수는 배포 시점에 묶인다).
 *   키가 없으면 여기서는 학생 화면에 안내만 띄우고 원인은 Cloudflare
 *   로그에 남긴다 — 학생에게 내부 설정을 알려도 소용없다.
 *
 * 테스트(ohweb-rules-test/exam.e2e.mjs)는 이 파일을 그대로 불러 에뮬레이터에
 * 붙인다 — FIRESTORE_EMULATOR_HOST / FIREBASE_AUTH_EMULATOR_HOST가 env에
 * 있을 때만 그렇게 동작하고, Cloudflare에는 이 변수를 넣지 않는다.
 *
 * ohweb/functions/api/reset-student-password.js와 JWT 서명·토큰 발급
 * 코드가 겹치는데, 둘은 서로 다른 Pages 프로젝트라 모듈을 공유할 수 없어
 * 부득이하게 중복이다 — 한쪽을 고치면 다른 쪽도 같이 봐야 한다.
 */

// 이 API들은 전부 같은 도메인의 페이지에서만 부른다. '*'로 열어두면
// 아무 사이트나 브라우저에서 호출할 수 있어서 우리 도메인으로 좁힌다.
// (curl 같은 직접 호출은 CORS로 못 막는다 — 그건 Cloudflare 대시보드의
// Rate Limiting 규칙으로 따로 걸어야 한다.)
const ALLOWED_ORIGINS = [
  'https://kakainfo.com',
  'https://www.kakainfo.com',
  'https://info.kakainfo.com',
  'https://admin.kakainfo.com',
  'https://short.kakainfo.com',
];
function corsFor(request) {
  const origin = request.headers.get('Origin') || '';
  // *.pages.dev은 커스텀 도메인을 붙이기 전 미리보기 배포에서 쓴다.
  const ok = ALLOWED_ORIGINS.includes(origin) || /^https:\/\/[a-z0-9-]+\.pages\.dev$/.test(origin);
  return {
    'Access-Control-Allow-Origin': ok ? origin : ALLOWED_ORIGINS[0],
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
    'Vary': 'Origin',
  };
}

const json = (body, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });

// ohinfo/public/firebase-config.js와 동일한 공개 웹 API 키 — 클라이언트에
// 이미 노출된 값이라 비밀이 아니다. 학생 idToken 검증에만 쓴다.
const WEB_API_KEY = 'AIzaSyB1SuaWwJgUY6SrCnmN8dmhG2cnVnGcl2s';
const EMAIL_SUFFIX = '@ohinfo.local';
const PISTON_PYTHON_VERSION = '3.10.0';
const SETUP_ERROR = { error: '시험 기능이 아직 준비되지 않았습니다. 선생님께 문의해 주세요.', detail: 'FIREBASE_SERVICE_ACCOUNT_KEY 설정 문제' };

// ── Google 서비스 계정 → OAuth 액세스 토큰 ──
function base64urlEncode(bytes) {
  let bin = '';
  for (const b of bytes) bin += String.fromCharCode(b);
  return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function pemToArrayBuffer(pem) {
  const b64 = pem.replace(/-----BEGIN PRIVATE KEY-----/, '')
                 .replace(/-----END PRIVATE KEY-----/, '')
                 .replace(/\s+/g, '');
  const bin = atob(b64);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return bytes.buffer;
}

// 토큰은 1시간짜리라 같은 워커 인스턴스 안에서는 재사용한다 — 요청마다 새로
// 받으면 외부 호출이 하나씩 늘고(무료 플랜은 요청당 50회 제한) 느려진다.
let _tokenCache = null; // { email, token, exp }
async function getAccessToken(sa) {
  const nowMs = Date.now();
  if (_tokenCache && _tokenCache.email === sa.client_email && _tokenCache.exp - 5 * 60000 > nowMs) {
    return _tokenCache.token;
  }
  const enc = new TextEncoder();
  const now = Math.floor(nowMs / 1000);
  const header = base64urlEncode(enc.encode(JSON.stringify({ alg: 'RS256', typ: 'JWT' })));
  const claims = base64urlEncode(enc.encode(JSON.stringify({
    iss: sa.client_email,
    scope: 'https://www.googleapis.com/auth/datastore',
    aud: 'https://oauth2.googleapis.com/token',
    exp: now + 3600,
    iat: now,
  })));
  const unsigned = `${header}.${claims}`;
  const key = await crypto.subtle.importKey(
    'pkcs8', pemToArrayBuffer(sa.private_key),
    { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' }, false, ['sign']
  );
  const sig = await crypto.subtle.sign('RSASSA-PKCS1-v1_5', key, enc.encode(unsigned));
  const jwt = `${unsigned}.${base64urlEncode(new Uint8Array(sig))}`;

  const res = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer',
      assertion: jwt,
    }),
  });
  const data = await res.json();
  if (!res.ok) throw new Error(`OAuth 토큰 발급 실패: ${JSON.stringify(data)}`);
  _tokenCache = { email: sa.client_email, token: data.access_token, exp: nowMs + (Number(data.expires_in) || 3600) * 1000 };
  return data.access_token;
}

// ── Firestore REST 값 변환 ──
function fromFsValue(v) {
  if (v == null) return null;
  if ('stringValue' in v) return v.stringValue;
  if ('integerValue' in v) return Number(v.integerValue);
  if ('doubleValue' in v) return v.doubleValue;
  if ('booleanValue' in v) return v.booleanValue;
  if ('nullValue' in v) return null;
  if ('timestampValue' in v) return v.timestampValue;
  if ('arrayValue' in v) return (v.arrayValue.values || []).map(fromFsValue);
  if ('mapValue' in v) return fromFsFields(v.mapValue.fields || {});
  return null;
}

function fromFsFields(fields) {
  const out = {};
  for (const [k, v] of Object.entries(fields || {})) out[k] = fromFsValue(v);
  return out;
}

function toFsValue(v) {
  if (v === null || v === undefined) return { nullValue: null };
  // Date는 Firestore 타임스탬프로 쓴다 — admin 화면이 startTime을 Timestamp로 읽는다.
  if (v instanceof Date) return { timestampValue: v.toISOString() };
  if (typeof v === 'string') return { stringValue: v };
  if (typeof v === 'boolean') return { booleanValue: v };
  if (typeof v === 'number') {
    return Number.isInteger(v) ? { integerValue: String(v) } : { doubleValue: v };
  }
  if (Array.isArray(v)) return { arrayValue: { values: v.map(toFsValue) } };
  if (typeof v === 'object') return { mapValue: { fields: toFsFields(v) } };
  return { nullValue: null };
}

function toFsFields(obj) {
  const out = {};
  for (const [k, v] of Object.entries(obj || {})) out[k] = toFsValue(v);
  return out;
}

// 클라이언트가 보낸 ID가 그대로 REST 경로에 들어가므로, 문서 ID로 쓸 수
// 있는 문자만 통과시킨다 — 안 막으면 asId에 '../'를 넣어 엉뚱한 컬렉션의
// 문서를 읽게 만들 수 있다.
const SAFE_ID = /^[A-Za-z0-9_-]{1,128}$/;
const isSafeId = s => typeof s === 'string' && SAFE_ID.test(s);

// ── Firestore REST 클라이언트 ──
function makeDb(projectId, token, emulatorHost) {
  // commit의 Write.update.name은 URL이 아니라 리소스 이름이어야 한다
  // ("projects/…/databases/(default)/documents/…"). 예전엔 여기에 base(https://
  // 로 시작하는 전체 URL)를 그대로 붙여 넣어서 Firestore가 모든 쓰기를
  // INVALID_ARGUMENT로 거부했고, 학생 제출이 전부 "채점 중 오류"로 실패했다.
  const docRoot = `projects/${projectId}/databases/(default)/documents`;
  const base = emulatorHost ? `http://${emulatorHost}/v1/${docRoot}` : `https://firestore.googleapis.com/v1/${docRoot}`;
  const headers = { 'Content-Type': 'application/json', 'Authorization': `Bearer ${token}` };

  async function runQuery(structuredQuery, label) {
    const res = await fetch(`${base}:runQuery`, { method: 'POST', headers, body: JSON.stringify({ structuredQuery }) });
    if (!res.ok) throw new Error(`Firestore 쿼리 실패(${label}): ${(await res.text()).slice(0, 200)}`);
    const rows = await res.json();
    return rows
      .filter(r => r.document)
      .map(r => ({ id: r.document.name.split('/').pop(), ...fromFsFields(r.document.fields) }));
  }
  const eq = (field, value) => ({ fieldFilter: { field: { fieldPath: field }, op: 'EQUAL', value: toFsValue(value) } });

  return {
    async get(path) {
      const res = await fetch(`${base}/${path}`, { headers });
      if (res.status === 404) return null;
      if (!res.ok) throw new Error(`Firestore 읽기 실패(${path}): ${(await res.text()).slice(0, 200)}`);
      const doc = await res.json();
      return fromFsFields(doc.fields);
    },
    // 여러 문서를 한 번의 호출로 읽는다. 결과는 paths 순서, 없는 문서는 null.
    // 예전엔 문항마다 정답 문서를 따로 읽어서, 문항이 많으면 Cloudflare의
    // 요청당 외부 호출 한도(무료 플랜 50회)에 걸려 채점이 통째로 실패했다.
    async getMany(paths) {
      if (!paths.length) return [];
      const res = await fetch(`${base}:batchGet`, {
        method: 'POST', headers,
        body: JSON.stringify({ documents: paths.map(p => `${docRoot}/${p}`) }),
      });
      if (!res.ok) throw new Error(`Firestore 읽기 실패(batchGet): ${(await res.text()).slice(0, 200)}`);
      const byName = new Map();
      for (const r of await res.json()) if (r.found) byName.set(r.found.name, fromFsFields(r.found.fields));
      return paths.map(p => byName.get(`${docRoot}/${p}`) ?? null);
    },
    queryAll(collectionId) {
      return runQuery({ from: [{ collectionId }] }, collectionId);
    },
    // where(field == value) 조건들(AND)
    queryEq(collectionId, conds) {
      const filters = Object.entries(conds).map(([f, v]) => eq(f, v));
      const where = filters.length === 1 ? filters[0] : { compositeFilter: { op: 'AND', filters } };
      return runQuery({ from: [{ collectionId }], where }, collectionId);
    },
    // writes: [{ path, data, merge }]
    async commit(writes) {
      const res = await fetch(`${base}:commit`, {
        method: 'POST', headers,
        body: JSON.stringify({
          writes: writes.map(w => ({
            update: { name: `${docRoot}/${w.path}`, fields: toFsFields(w.data) },
            ...(w.merge ? { updateMask: { fieldPaths: Object.keys(w.data) } } : {}),
          })),
        }),
      });
      if (!res.ok) throw new Error(`Firestore 쓰기 실패: ${(await res.text()).slice(0, 300)}`);
    },
  };
}

// ── 학생 토큰 검증 ──
// Firebase Auth는 이메일을 소문자로 정규화해 저장하는데 Firestore 문서
// ID는 대소문자를 구분한다(예: 9USpRCZ… → 9usprcz…). 그래서 토큰에서
// 문서 ID를 역산할 수 없고, 클라이언트가 보낸 ID로 만든 이메일과
// 토큰의 이메일이 같은지 대조하는 방식으로 본인을 확인한다.
async function verifyStudent(idToken, studentDocId, env) {
  const host = env?.FIREBASE_AUTH_EMULATOR_HOST;
  const url = host
    ? `http://${host}/identitytoolkit.googleapis.com/v1/accounts:lookup?key=${WEB_API_KEY}`
    : `https://identitytoolkit.googleapis.com/v1/accounts:lookup?key=${WEB_API_KEY}`;
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ idToken }),
  });
  if (!res.ok) throw new Error('로그인이 만료되었습니다. 다시 로그인해 주세요.');
  const data = await res.json();
  const email = data.users?.[0]?.email || '';
  const expected = `${studentDocId}${EMAIL_SUFFIX}`.toLowerCase();
  if (email.toLowerCase() !== expected) throw new Error('본인 확인에 실패했습니다.');
}

// ── 응시 자격 ──
// 학년·반 값은 "1학년", "2반", "1" 등 섞여 들어와 있어서 숫자만 남겨 비교한다
// (exam.html이 예전에 쓰던 _nv와 같은 규칙).
const normGC = v => String(v ?? '').replace(/학년|년급|학|반|班|кл\./g, '').trim();
function isTarget(a, student) {
  if (student.isMaster) return true;
  const gradeOk = !a.grade || normGC(a.grade) === normGC(student.grade);
  const clsOk = !a.class || normGC(a.class) === normGC(student.class);
  const schoolOk = !a.schoolName || a.schoolName === (student.schoolName || '');
  return gradeOk && clsOk && schoolOk;
}
const isOpen = a => a.status === 'ON';
const normCode = v => String(v ?? '').trim().toUpperCase();

// 결과 문서에 문항 제목을 같이 남긴다 — 나중에 학생이 결과를 다시 볼 때는
// 문항을 안 불러오므로, 제목이 없으면 "Q1"처럼만 보인다.
// 제출 당시 언어로 고른다: exam.html의 getQTitle과 같은 규칙.
function pickTitle(q, lang) {
  if (lang === 'zh' && q.titleZh) return q.titleZh;
  if (lang === 'ru' && q.titleRu) return q.titleRu;
  if (lang === 'en' && q.titleEn) return q.titleEn;
  return q.title || '';
}

// 문항 순서: order 오름차순, 같으면 만든 순서. order가 빠진 문항도 버리지 않는다
// (예전 exam.html은 orderBy('order')로 읽어서 order 없는 문항을 빠뜨렸고, 서버는
// 안 빠뜨려서 학생 화면과 채점의 문항 번호가 어긋날 수 있었다).
function sortQuestions(qs) {
  return qs.sort((a, b) => (a.order || 0) - (b.order || 0)
    || String(a.createdAt || '').localeCompare(String(b.createdAt || ''))
    || a.id.localeCompare(b.id));
}
async function loadQuestions(db, examId) {
  return sortQuestions(await db.queryEq('exam_questions', { examId }));
}

// 학생에게 내려보내는 문항 필드 — 정답(answer)·테스트케이스(testCases)는
// exam_answers로 옮겼지만, admin의 "정답 분리"를 안 돌린 예전 문항에는 아직
// 문항 문서에 남아 있을 수 있어서 명시적으로 고른 필드만 보낸다.
const PUBLIC_Q_FIELDS = [
  'type', 'points', 'imageUrl', 'minLen', 'maxLen', 'boilerplate', 'inDesc', 'outDesc', 'inEx', 'outEx',
  'title', 'titleZh', 'titleRu', 'titleEn', 'content', 'contentZh', 'contentRu', 'contentEn',
  'options', 'optionsZh', 'optionsRu', 'optionsEn',
];
function publicQuestion(q) {
  const out = { id: q.id };
  for (const k of PUBLIC_Q_FIELDS) if (q[k] !== undefined && q[k] !== null) out[k] = q[k];
  return out;
}

// ── 코드형 문항 채점 ──
const normalizeOut = s => String(s ?? '').replace(/\r\n/g, '\n').trimEnd();

// 실행 서버 — 기본은 Piston 공개 API(emkc.org)인데, 이 공개 API는 2026-02-15부터
// 허가받은 곳만 쓸 수 있게 바뀌었다(토큰 필요). 토큰을 받았거나 직접 띄운
// Piston이 있으면 Cloudflare 환경변수 PISTON_URL / PISTON_TOKEN으로 지정한다.
function pistonConfig(env) {
  const base = String(env?.PISTON_URL || 'https://emkc.org/api/v2/piston').replace(/\/+$/, '');
  const headers = { 'Content-Type': 'application/json' };
  if (env?.PISTON_TOKEN) headers.Authorization = env.PISTON_TOKEN;
  return { url: `${base}/execute`, headers };
}

async function runPython(cfg, code, stdin) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 12000);
  try {
    const res = await fetch(cfg.url, {
      method: 'POST',
      headers: cfg.headers,
      signal: ctrl.signal,
      body: JSON.stringify({
        language: 'python',
        version: PISTON_PYTHON_VERSION,
        files: [{ name: 'main.py', content: code }],
        stdin,
        compile_timeout: 10000,
        run_timeout: 8000,
      }),
    });
    if (!res.ok) throw new Error(`실행 서버 오류 ${res.status}`);
    const data = await res.json();
    if (!data?.run) throw new Error('실행 서버 응답 형식 오류');
    return data.run.stdout || '';
  } finally {
    clearTimeout(timer);
  }
}

// 반환값: 통과한 케이스 수, 또는 null(= 채점 불가 → 선생님이 직접 채점).
// 예전엔 실행 서버 자체가 실패해도(권한 없음·타임아웃) 그 케이스를 "오답"으로
// 세서, 맞게 짠 코드도 0점이 됐다. 이제 서버 쪽 실패가 하나라도 있으면
// 점수를 매기지 않고 수동 채점으로 넘긴다. 학생 코드의 실행 오류(예외)는
// 서버가 정상 응답하므로 여기에 해당하지 않고 그대로 오답이다.
async function gradeCode(cfg, code, testCases) {
  if (!code.trim() || !testCases?.length) return null;
  // 테스트케이스를 순차로 돌리면 케이스 수만큼 지연이 쌓인다 — 병렬로 던진다.
  const results = await Promise.all(testCases.map(async tc => {
    try {
      const stdout = await runPython(cfg, code, String(tc.input || ''));
      return normalizeOut(stdout) === normalizeOut(tc.expected);
    } catch (e) {
      console.error('exam: 코드 실행 실패 —', e.message);
      return null;
    }
  }));
  if (results.some(r => r === null)) return null;
  return results.filter(Boolean).length;
}

// 시험이 열려 있는 동안은 오답의 정답을 감춘다 — "wrong:2" → "wrong".
// 선생님이 배정을 OFF로 내리면 그때부터 결과 화면에 정답이 보인다.
const redactFeedback = (fb, reveal) => (!reveal && typeof fb === 'string' && fb.startsWith('wrong:')) ? 'wrong' : fb;

// ── action: list ──
async function actionList(db, studentDocId, student) {
  const assignments = await db.queryAll('exam_assignments');
  const targeted = assignments.filter(a => isTarget(a, student));
  const progs = await db.getMany(targeted.map(a => `exam_progress/${a.id}_${studentDocId}`));
  // 열린 시험 + 이미 낸 시험(닫힌 뒤에도 결과를 다시 볼 수 있게). 마스터는 전부.
  const rows = targeted
    .map((a, i) => ({ a, p: progs[i] }))
    .filter(({ a, p }) => student.isMaster || isOpen(a) || p?.status === 'submitted');
  const examIds = [...new Set(rows.map(r => r.a.examId).filter(isSafeId))];
  const exams = await db.getMany(examIds.map(id => `exams/${id}`));
  const titleOf = new Map(examIds.map((id, i) => [id, exams[i]?.title || '']));
  // 최근 배정이 위로
  rows.sort((x, y) => String(y.a.createdAt || '').localeCompare(String(x.a.createdAt || '')));
  return json({
    ok: true,
    exams: rows.map(({ a, p }) => ({
      asId: a.id,
      title: titleOf.get(a.examId) || a.examId || '',
      duration: Number(a.duration) || 0,
      open: isOpen(a),
      needsCode: !student.isMaster && !!normCode(a.code),
      progress: p ? {
        status: p.status || '',
        totalScore: p.totalScore ?? null,
        totalPoints: p.totalPoints ?? null,
        needsManual: p.needsManual === true,
      } : null,
    })),
  });
}

// ── action: start ──
async function actionStart(db, studentDocId, student, asId, code) {
  const progPath = `exam_progress/${asId}_${studentDocId}`;
  const [assignment, progress] = await db.getMany([`exam_assignments/${asId}`, progPath]);
  if (!assignment || !isTarget(assignment, student)) return json({ error: '응시할 수 있는 시험이 아닙니다.' }, 404);
  if (!student.isMaster && !isOpen(assignment)) return json({ error: '현재 시험이 열려있지 않습니다.' }, 403);
  if (progress?.status === 'submitted') return json({ error: '이미 제출한 시험입니다.' }, 409);
  const want = normCode(assignment.code);
  if (!student.isMaster && want && normCode(code) !== want) return json({ error: '코드가 맞지 않습니다.', code: 'bad-code' }, 403);

  const now = new Date();
  const firstEntry = !progress?.startTime;
  // 입장 마감: 선생님이 배정에 "입장 허용 시간"을 넣었으면, ON으로 연 시각
  // (openedAt)부터 그 시간이 지난 뒤에는 새로 들어오지 못한다. 이미 시작한
  // 학생의 재입장(새로고침 등)은 막지 않는다.
  const entryMin = Number(assignment.entryMinutes) || 0;
  const openedMs = assignment.openedAt ? Date.parse(assignment.openedAt) : NaN;
  if (!student.isMaster && firstEntry && entryMin > 0 && !Number.isNaN(openedMs)
      && now.getTime() > openedMs + entryMin * 60000) {
    return json({ error: '입장 시간이 지났습니다. 선생님께 문의해 주세요.' }, 403);
  }

  const [exam, questions] = await Promise.all([
    isSafeId(assignment.examId) ? db.get(`exams/${assignment.examId}`) : null,
    loadQuestions(db, assignment.examId),
  ]);
  if (!questions.length) return json({ error: '시험 문제가 없습니다.' }, 404);

  await db.commit([{
    path: progPath,
    data: {
      examId: assignment.examId || '', asId, studentId: studentDocId,
      name: student.name || '', grade: normGC(student.grade), class: normGC(student.class), num: String(student.number ?? ''),
      status: 'started', lastEnterAt: now,
      ...(firstEntry ? { startTime: now } : {}),
    },
    merge: true,
  }]);

  return json({
    ok: true,
    asId,
    title: exam?.title || '',
    duration: Number(assignment.duration) || 0,
    startTime: firstEntry ? now.toISOString() : progress.startTime,
    serverNow: now.getTime(),
    alertCount: Number(progress?.alertCount) || 0,
    pasteBlockCount: Number(progress?.pasteBlockCount) || 0,
    questions: questions.map(publicQuestion),
  });
}

// ── action: result ──
async function actionResult(db, studentDocId, asId) {
  const [assignment, progress] = await db.getMany([`exam_assignments/${asId}`, `exam_progress/${asId}_${studentDocId}`]);
  if (progress?.status !== 'submitted') return json({ error: '결과를 찾을 수 없습니다.' }, 404);
  // 선생님이 직접 채점할 문항이 남아 있으면 점수를 아직 보여주지 않는다.
  if (progress.needsManual === true) return json({ ok: true, pending: true });
  const reveal = !assignment || !isOpen(assignment);
  const rows = (await db.queryEq('exam_results', { asId, studentId: studentDocId }))
    .sort((a, b) => (a.qIdx || 0) - (b.qIdx || 0));
  return json({
    ok: true,
    totalScore: progress.totalScore || 0,
    totalPoints: progress.totalPoints || 0,
    answersHidden: !reveal,
    items: rows.map(r => ({
      qIdx: r.qIdx || 0, type: r.type || '', title: r.title || '',
      value: r.value || '', score: r.score || 0, maxScore: r.maxScore || 0,
      feedback: redactFeedback(r.feedback, reveal),
    })),
  });
}

// ── action: submit ──
async function actionSubmit(db, env, studentDocId, student, asId, answers, lang) {
  if (!Array.isArray(answers)) return json({ error: '답안 형식이 올바르지 않습니다.' }, 400);
  const [assignment, progress] = await db.getMany([`exam_assignments/${asId}`, `exam_progress/${asId}_${studentDocId}`]);
  if (!assignment || !isTarget(assignment, student)) return json({ error: '시험 정보를 찾을 수 없습니다.' }, 404);

  // 이미 제출(채점)된 시험은 다시 받지 않는다 — 재제출을 받으면 결과 화면의
  // 정답을 보고 다시 내서 점수를 덮어쓸 수 있었다.
  // (선생님이 다시 보게 하려면 admin에서 진행 기록을 지우면 된다.)
  if (progress?.status === 'submitted') {
    return json({ error: '이미 제출한 시험입니다. 다시 보려면 선생님께 문의해 주세요.' }, 409);
  }
  // 입장(start)을 거친 학생만 받는다 — 입장이 열림·대상·코드를 확인하는 곳이다.
  // 배정이 그 사이 OFF로 바뀌었어도, 이미 입장해 풀던 학생의 제출은 받는다
  // (OFF는 "새로 못 들어옴"이지 "풀던 답안을 버림"이 아니다).
  if (!progress?.startTime) return json({ error: '시험에 입장한 기록이 없습니다. 목록에서 다시 입장해 주세요.' }, 403);

  const questions = await loadQuestions(db, assignment.examId);
  if (!questions.length) return json({ error: '시험 문제가 없습니다.' }, 404);

  // 정답은 문항과 같은 문서 ID로 exam_answers에 들어있다. 다만 admin의
  // "정답 분리"를 아직 안 돌린 예전 시험은 정답이 문항 문서(exam_questions)에
  // 그대로 남아있다 — 서버는 서비스 계정이라 그걸 읽을 수 있으니, 정답
  // 문서가 없으면 문항 문서의 값으로 채점한다.
  const answerDocs = (await db.getMany(questions.map(q => `exam_answers/${q.id}`)))
    .map((key, i) => key || { answer: questions[i].answer, testCases: questions[i].testCases });

  // 그래도 객관식 정답이 어디에도 없으면 그 문항만 수동 채점으로 넘긴다
  // (아래 채점 루프에서 처리) — 제출 자체는 막지 않는다.
  const noKey = questions
    .filter((q, i) => q.type === 'mc' && (answerDocs[i].answer === undefined || answerDocs[i].answer === null));
  if (noKey.length) console.error(`exam: 정답 없는 객관식 ${noKey.length}건 (examId=${assignment.examId}) — 수동 채점 필요`);

  // 답안은 문항 ID로 맞춘다. 번호(qIdx)로만 맞추면 학생이 푸는 사이 선생님이
  // 문항 순서를 바꾸거나 문항을 추가했을 때 답이 엉뚱한 문항에 채점된다.
  // qId가 없는 답안(예전 화면에서 낸 것)만 번호로 맞춘다.
  const byId = new Map(), byIdx = new Map();
  for (const a of answers) {
    if (a && typeof a.qId === 'string') byId.set(a.qId, a.value);
    else if (a) byIdx.set(Number(a.qIdx), a.value);
  }
  const resultItems = [];
  const writes = [];
  let totalScore = 0, totalPoints = 0;
  const pcfg = pistonConfig(env);

  for (let i = 0; i < questions.length; i++) {
    const q = questions[i];
    const key = answerDocs[i] || {};
    const points = q.points || 0;
    totalPoints += points;

    const raw = byId.has(q.id) ? byId.get(q.id) : byIdx.get(i);
    let value = raw == null ? '' : String(raw);
    let score = 0;
    let feedback = '';

    if (q.type === 'mc') {
      if (key.answer === undefined || key.answer === null) {
        feedback = 'manual'; // 정답이 등록 안 된 문항 — 선생님이 직접 채점
      } else {
        const correct = String(key.answer);
        if (value !== '' && value === correct) { score = points; feedback = 'correct'; }
        else { feedback = `wrong:${correct}`; }
      }

    } else if (q.type === 'sa' || q.type === 'essay') {
      // 서술형과 단답형은 자동 채점하지 않는다 — 선생님이 admin에서 직접
      // 채점한다. 단답형은 예전엔 정답과 문자열을 그대로 비교했는데,
      // "서울"과 "서울시"와 "서울 "을 전부 다른 답으로 처리해서 맞은
      // 답이 오답으로 찍히는 일이 잦았다. 사람이 보는 편이 맞다.
      value = value.trim();
      feedback = 'manual';

    } else if (q.type === 'code') {
      const cases = key.testCases || [];
      const passCount = await gradeCode(pcfg, value, cases);
      if (passCount === null) { feedback = 'manual'; }
      else {
        score = Math.round(points * (passCount / cases.length));
        feedback = `cases:${passCount}/${cases.length}`;
      }
    }

    totalScore += score;
    const title = pickTitle(q, lang || 'ko');
    resultItems.push({ qIdx: i, type: q.type || '', title, value, score, maxScore: points, feedback });

    // 결과 문서 ID를 고정해서, 재제출해도 중복 문서가 쌓이지 않게 한다.
    // questionId: 나중에 문항 순서를 바꿔도 admin 채점 화면이 문항을 찾을 수 있게.
    writes.push({
      path: `exam_results/${asId}_${studentDocId}_${i}`,
      data: {
        asId, examId: assignment.examId || '', questionId: q.id,
        studentId: studentDocId,
        name: student.name || '', grade: student.grade || '', class: student.class || '', num: student.number ?? '',
        lang: lang || 'ko', qIdx: i, type: q.type || '', title,
        value, score, maxScore: points, feedback,
        gradedAt: new Date().toISOString(),
      },
    });
  }

  // 제출 시각은 서버 시각으로 기록하고, 처음 시작한 시각과의 차이(소요 시간)와
  // 제한시간 초과 여부도 남긴다 — 선생님이 결과 화면에서 확인한다. 초과해도
  // 채점은 그대로 한다(네트워크 지연 등으로 몇 초 넘는 경우를 막지 않기 위해
  // 90초 여유를 두고, 판단은 선생님 몫).
  const submitIso = new Date().toISOString();
  const timing = {};
  const startedMs = Date.parse(progress.startTime);
  if (!Number.isNaN(startedMs)) {
    timing.elapsedSec = Math.max(0, Math.round((Date.parse(submitIso) - startedMs) / 1000));
    const limitSec = (Number(assignment.duration) || 0) * 60;
    timing.late = limitSec > 0 && timing.elapsedSec > limitSec + 90;
  }
  const needsManual = resultItems.some(r => r.feedback === 'manual');
  writes.push({
    path: `exam_progress/${asId}_${studentDocId}`,
    // needsManual: 선생님이 직접 채점할 문항(서술형·단답형·실행 실패한 코드형)이 있음 —
    // 학생 화면은 선생님이 채점을 저장할 때까지 점수를 보여주지 않는다.
    data: { status: 'submitted', totalScore, totalPoints, submitTime: submitIso, needsManual, ...timing },
    merge: true,
  });

  await db.commit(writes);

  const reveal = !isOpen(assignment);
  return json({
    ok: true, totalScore, totalPoints, needsManual, answersHidden: !reveal,
    items: resultItems.map(r => ({ ...r, feedback: redactFeedback(r.feedback, reveal) })),
  });
}

async function handle(request, env) {
  if (request.method === 'OPTIONS') return new Response(null, { status: 204 });
  if (request.method !== 'POST') return json({ error: 'Method Not Allowed' }, 405);

  const emulatorHost = env?.FIRESTORE_EMULATOR_HOST;
  let sa = null;
  if (!emulatorHost) {
    // 학생에게 내부 설정 얘기를 해도 소용없으니 화면엔 행동 안내만 띄우고,
    // 원인은 Cloudflare 로그에 남긴다. "변수가 없다"와 "변수는 있는데 값이
    // 비었다"는 반드시 구분한다 — Cloudflare의 Secret은 저장 후 값이 가려져서
    // 편집하면 값이 빈 채로 저장되기 쉽고, 그러면 변수 목록에는 멀쩡히
    // 보이면서 함수에서는 빈 문자열로 들어온다.
    const saJson = env.FIREBASE_SERVICE_ACCOUNT_KEY;
    if (!saJson || !String(saJson).trim()) {
      const declared = Object.prototype.hasOwnProperty.call(env || {}, 'FIREBASE_SERVICE_ACCOUNT_KEY');
      console.error('exam:', declared
        ? 'FIREBASE_SERVICE_ACCOUNT_KEY는 ohinfo 배포에 등록돼 있는데 값이 비어 있습니다. 변수를 지우고 새로 추가하면서 서비스 계정 JSON 전체를 다시 붙여넣은 뒤 재배포해 주세요.'
        : `FIREBASE_SERVICE_ACCOUNT_KEY가 ohinfo 배포에 없습니다. 현재 환경변수: ${Object.keys(env || {}).join(', ') || '(없음)'}`);
      return json(SETUP_ERROR, 200);
    }
    try { sa = JSON.parse(saJson); }
    catch {
      console.error('exam: FIREBASE_SERVICE_ACCOUNT_KEY가 올바른 JSON이 아닙니다.',
        `값의 길이 ${String(saJson).length}자 — 붙여넣다가 잘렸을 수 있습니다.`);
      return json(SETUP_ERROR, 200);
    }
    const missingKeyFields = ['private_key', 'client_email', 'project_id'].filter(k => !sa[k]);
    if (missingKeyFields.length) {
      console.error('exam: 서비스 계정 키에 필요한 항목이 없습니다 —', missingKeyFields.join(', '));
      return json(SETUP_ERROR, 200);
    }
  }

  let body;
  try { body = await request.json(); }
  catch { return json({ error: 'invalid JSON body' }, 400); }

  const { action, idToken, studentDocId, asId, answers, lang, code } = body || {};
  if (!idToken || !studentDocId) return json({ error: '요청 정보가 부족합니다.' }, 400);
  if (!isSafeId(studentDocId)) return json({ error: '요청 정보가 올바르지 않습니다.' }, 400);
  if (action !== 'list' && !isSafeId(asId)) return json({ error: '요청 정보가 올바르지 않습니다.' }, 400);
  if (!['list', 'start', 'submit', 'result'].includes(action)) return json({ error: '알 수 없는 요청입니다.' }, 400);

  try {
    await verifyStudent(idToken, studentDocId, env);
  } catch (e) {
    return json({ error: e.message }, 403);
  }

  try {
    const db = emulatorHost
      ? makeDb(env.FIREBASE_PROJECT_ID, 'owner', emulatorHost)
      : makeDb(sa.project_id, await getAccessToken(sa));
    const student = await db.get(`students/${studentDocId}`);
    if (!student) return json({ error: '학생 정보를 찾을 수 없습니다.' }, 404);

    if (action === 'list') return await actionList(db, studentDocId, student);
    if (action === 'start') return await actionStart(db, studentDocId, student, asId, code);
    if (action === 'result') return await actionResult(db, studentDocId, asId);
    return await actionSubmit(db, env, studentDocId, student, asId, answers, lang);
  } catch (e) {
    // 502로 돌려주면 Cloudflare가 응답 본문을 자기 오류 페이지로 바꿔버려서
    // 학생 화면엔 "HTTP 502"만 뜨고 실제 원인(detail)이 사라졌다. 본문이
    // 반드시 전달되도록 200 + error로 돌려준다(exam.html은 error가 있으면 실패로 처리).
    console.error('exam:', action, e);
    return json({ error: action === 'submit' ? '채점 중 오류가 발생했습니다.' : '시험 서버 오류가 발생했습니다.', detail: String(e.message || e).slice(0, 400) }, 200);
  }
}

// 응답에 CORS 헤더를 붙인다 — 핸들러 안의 json() 호출을 전부 고치지 않아도
// 되도록 여기서 한 번에 씌운다.
function withCors(res, request) {
  const out = new Response(res.body, res);
  for (const [k, v] of Object.entries(corsFor(request))) out.headers.set(k, v);
  return out;
}

export async function onRequest({ request, env }) {
  try {
    return withCors(await handle(request, env), request);
  } catch (e) {
    console.error('exam uncaught:', e);
    return withCors(json({ error: '시험 서버 오류가 발생했습니다.', detail: String(e?.message || e).slice(0, 400) }, 200), request);
  }
}
