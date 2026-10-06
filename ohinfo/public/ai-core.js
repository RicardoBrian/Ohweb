// AI 실험실 공용 로직 — DOM 없이 돌아가는 순수 함수만 둔다(Node에서 테스트).
// ailab.html(학생 실험실), aiapp.html(공개 웹앱), ohweb admin이 같이 쓴다.

export const LANGS = ['ko', 'en', 'zh', 'ru'];

// 학습 라이브러리 버전 고정 — 티처블머신 공식 예제와 같은 조합.
// @teachablemachine/image 0.8.5의 peerDependency가 tfjs 1.3.1이다.
// @latest로 두면 tfjs가 올라갈 때 모델이 안 열리는 일이 생긴다.
export const TFJS_URL = 'https://cdn.jsdelivr.net/npm/@tensorflow/tfjs@1.3.1/dist/tf.min.js';
export const TMIMAGE_URL = 'https://cdn.jsdelivr.net/npm/@teachablemachine/image@0.8.5/dist/teachablemachine-image.min.js';

export const STEPS = [1, 2, 3, 4, 5];
export const MAX_LABELS_HARD = 8;
export const DEFAULT_MIN_PER_LABEL = 15;
export const DEFAULT_MIN_TEST_PER_LABEL = 3;
export const DEFAULT_MAX_LABELS = 5;
export const UNSURE_THRESHOLD = 0.6;
export const CUSTOM_PHRASE_MAX = 20;
export const TITLE_MAX = 30;
export const LABEL_NAME_MAX = 20;

// ── 모델 링크 ──
// 학생은 주소 일부, 코드 전체, 공유 링크 등 무엇이든 붙여넣는다. 그 안에서
// teachablemachine.withgoogle.com/models/<ID> 만 찾아낸다.
export function parseModelUrl(text) {
  const s = String(text || '').trim();
  if (!s) return { error: 'empty' };
  const m = s.match(/teachablemachine\.withgoogle\.com\/models\/([A-Za-z0-9_-]{4,64})/);
  if (m) return { id: m[1], url: `https://teachablemachine.withgoogle.com/models/${m[1]}/` };
  // "다운로드"로 받은 파일 이름(converted_keras, tm-my-image-model)을 붙여넣은 경우
  if (/tm-my-image-model|converted_keras|\.zip\b/i.test(s)) return { error: 'downloaded' };
  return { error: 'notfound' };
}

// metadata.json으로 이미지 모델인지 확인 — 오디오·포즈 모델은 packageName이 다르다.
export function checkMetadata(meta) {
  if (!meta || typeof meta !== 'object') return { error: 'badmeta' };
  const pkg = String(meta.packageName || '');
  if (pkg && !/image/i.test(pkg)) return { error: 'notimage', packageName: pkg };
  const labels = Array.isArray(meta.labels) ? meta.labels.map(String) : [];
  if (labels.length < 2) return { error: 'fewclasses' };
  return { labels };
}

// ── 레이블 ──
const norm = s => String(s || '').normalize('NFC').toLowerCase().replace(/\s+/g, '').trim();

export function isDefaultClassName(name) {
  return /^(class|클래스|类别|класс)\s*\d+$/i.test(String(name || '').trim());
}

// 모델의 클래스 이름 ↔ 우리 레이블을 자동으로 잇는다. 이름(또는 번역)이
// 같으면 연결하고, 못 찾은 건 비워 둔다(화면에서 학생이 고른다).
export function autoMapClasses(modelClasses, labels) {
  const mapping = {};
  const used = new Set();
  for (const cls of modelClasses) {
    const n = norm(cls);
    const hit = labels.find(l => !used.has(l.id) && (
      norm(l.name) === n || Object.values(l.tr || {}).some(v => norm(v) === n)));
    if (hit) { mapping[cls] = hit.id; used.add(hit.id); }
    else mapping[cls] = '';
  }
  return mapping;
}

// 연결 상태 점검: 모든 클래스가 레이블을 골랐는지, 같은 레이블을 두 번 고르지
// 않았는지, 빠진 레이블이 있는지.
export function checkMapping(modelClasses, labels, mapping) {
  const missing = modelClasses.filter(c => !mapping[c]);
  const counts = {};
  modelClasses.forEach(c => { if (mapping[c]) counts[mapping[c]] = (counts[mapping[c]] || 0) + 1; });
  const dup = Object.keys(counts).filter(k => counts[k] > 1);
  const unusedLabels = labels.filter(l => !counts[l.id]).map(l => l.id);
  return { ok: !missing.length && !dup.length, missing, dup, unusedLabels };
}

export function labelName(label, lang) {
  if (!label) return '';
  return (label.tr && label.tr[lang]) || label.name || '';
}

// 레이블을 모을 사람들 — 모둠이면 한 레이블을 여러 명이 함께 모을 수 있다(owners 배열).
// 예전 기록(owner 한 명)도 그대로 읽는다.
export function ownersOf(label) {
  if (!label) return [];
  if (Array.isArray(label.owners)) return label.owners;
  return label.owner ? [label.owner] : [];
}

// 레이블 검사(① 문제 정의 확정 시). 레이블마다 모으는 사람이 1명 이상, 모둠원은 누구나 1개 이상.
export function validateLabels(labels, memberIds, maxLabels = DEFAULT_MAX_LABELS) {
  const errs = [];
  if (labels.length < 2) errs.push('min2');
  if (labels.length > maxLabels) errs.push('tooMany');
  const names = labels.map(l => norm(l.name));
  if (names.some(n => !n)) errs.push('empty');
  if (new Set(names).size !== names.length) errs.push('duplicate');
  if (labels.some(l => String(l.name || '').trim().length > LABEL_NAME_MAX)) errs.push('tooLong');
  if (labels.some(l => !ownersOf(l).some(id => memberIds.includes(id)))) errs.push('noOwner');
  const covered = new Set(labels.flatMap(l => ownersOf(l)));
  if (memberIds.some(id => !covered.has(id))) errs.push('memberWithout');
  return errs;
}

// 번역할 때 분류 대상을 괄호로 붙여 문맥을 준다("배 (과일)" → pear).
// 결과에서 괄호 부분을 떼어 낸다. 괄호가 사라졌으면 그대로 쓴다.
export function withContext(label, topic) {
  const t = String(topic || '').trim();
  return t ? `${label} (${t})` : String(label);
}
export function stripContext(translated) {
  const s = String(translated || '').trim();
  const out = s.replace(/\s*[(（][^()（）]*[)）]\s*$/, '').trim();
  return out || s;
}

// ── 결과 문구 ──
// 레이블 이름이 원래 형태 그대로 들어가도 문법이 맞도록 고른 틀이다
// (러시아어 격변화, 영어 관사, 한국어 조사를 피한다).
export const PHRASES = [
  { ko: '결과는 {L}!',          en: 'The answer is: {L}!', zh: '答案是：{L}！',  ru: 'Ответ: {L}!' },
  { ko: '이건 바로 {L}!',        en: 'This is: {L}!',       zh: '这就是{L}！',   ru: 'Это {L}!' },
  { ko: 'AI가 찾았어요 → {L}',   en: 'AI found → {L}',      zh: 'AI找到了 → {L}', ru: 'ИИ нашёл → {L}' },
  { ko: '아마도 {L}일 거예요',    en: 'Maybe: {L}',          zh: '可能是{L}',     ru: 'Наверное, это {L}' },
];
export const CUSTOM_PHRASE = 4;
export const UNSURE = { ko: '잘 모르겠어요 🤔', en: "Hmm, I'm not sure 🤔", zh: '我不太确定 🤔', ru: 'Хм, не уверен 🤔' };

export function fillPhrase(tpl, name) {
  return String(tpl).split('{L}').join(name);
}

// 공개 웹앱에 뜨는 문구. 직접 쓴 문구는 "레이블 이름 + 뒷말"을 통째로 번역해
// customTr에 넣어 둔다. 교사가 숨긴 문구면 1번 틀로 바꿔 보여 준다.
export function phraseFor(label, lang, { hidden = false, srcLang = 'ko' } = {}) {
  const name = labelName(label, lang);
  const p = Number.isInteger(label.phrase) ? label.phrase : 0;
  if (p === CUSTOM_PHRASE && !hidden && label.custom) {
    // 뒷말은 쓴 사람의 언어(customLang)로 저장된다.
    if (label.customLang) srcLang = label.customLang;
    if (lang === srcLang) return `${label.name}${label.custom}`;
    return (label.customTr && label.customTr[lang]) || `${name}${label.custom}`;
  }
  const tpl = PHRASES[p === CUSTOM_PHRASE ? 0 : Math.min(Math.max(p, 0), PHRASES.length - 1)];
  return fillPhrase(tpl[lang] || tpl.ko, name);
}

// 직접 쓰는 뒷말 검사 — 20자, 링크·메일 금지, 기본 비속어 거르기.
const BAD_WORDS = [
  '시발', '씨발', 'ㅅㅂ', 'ㅆㅂ', '병신', 'ㅂㅅ', '개새', '새끼', '좆', '존나', 'ㅈㄴ', '지랄', '닥쳐', '미친놈', '미친년', '꺼져', '엠창', '느금', '니애미', '애미', '애비',
  'fuck', 'shit', 'bitch', 'damn', 'dick', 'asshole', 'bastard',
  '傻逼', '他妈', '操你', '妈的', '去死',
  'сука', 'блять', 'бля', 'хуй', 'пизд', 'ебат', 'нахуй', 'мудак',
];
export function hasBadWord(text) {
  const s = String(text || '').toLowerCase().replace(/[\s._\-*~!?]/g, '');
  return BAD_WORDS.some(w => s.includes(w));
}
export function validateCustomPhrase(text) {
  const s = String(text || '');
  if (!s.trim()) return 'empty';
  if ([...s].length > CUSTOM_PHRASE_MAX) return 'tooLong';
  if (/https?:|www\.|\.com\b|\.kr\b|@[a-z0-9-]+\./i.test(s)) return 'link';
  if (hasBadWord(s)) return 'bad';
  return '';
}

export const EMOJIS = ['🐱', '🐶', '🐰', '🐻', '🐟', '🐦', '🍎', '🍌', '🍇', '🍓', '🥕', '🌸', '🌳', '🚗', '🚲', '✈️', '⚽', '🏀', '✏️', '📚', '👕', '👟', '⭐', '❤️'];

// ── 사진 수 ──
export function labelCount(project, kind, labelId) {
  return (project && project.counts && project.counts[kind] && project.counts[kind][labelId]) || 0;
}

// 사진 수 균형: 가장 많은 레이블이 가장 적은 레이블의 2배를 넘으면 경고.
export function isUnbalanced(counts) {
  const v = counts.filter(n => n > 0);
  if (v.length < 2) return false;
  return Math.max(...v) > 2 * Math.min(...v) && Math.max(...v) - Math.min(...v) >= 5;
}

// ── 단계 열림 조건 ──
// project.step = 지금까지 열린 가장 먼 단계. 조건을 채우면 한 칸씩 연다.
export function nextUnlock(project, asg = {}) {
  const step = project.step || 1;
  const labels = project.labels || [];
  const minTrain = asg.minPerLabel || DEFAULT_MIN_PER_LABEL;
  if (step === 1) return project.defined ? 2 : 1;
  if (step === 2) return labels.length && labels.every(l => labelCount(project, 'train', l.id) >= minTrain) ? 3 : 2;
  if (step === 3) return hasModel(project) ? 4 : 3;
  if (step === 4) {
    const r = currentEval(project);
    return r && r.stars && Object.keys(r.stars).length ? 5 : 4;
  }
  return step;
}

// 모델이 있는지: 실험실에서 학습한 모델(modelVersion) — 예전 티처블머신 링크 방식도 인정.
export function hasModel(project) {
  return !!(project && ((project.modelVersion || 0) > 0 || (project.modelUrl && project.mappingOk)));
}
// 레이블 ID를 클래스 이름으로 학습하므로 연결은 그대로(ID → ID).
export function identityMapping(labels) {
  const m = {};
  (labels || []).forEach(l => { m[l.id] = l.id; });
  return m;
}
// 마지막 학습에 쓰지 않은 학습 사진 수(다시 학습하라고 알려 줄 때). 시계에 기대지 않고
// 마지막 학습에 쓴 사진 목록(trainedIds)과 비교한다. 아직 학습 전이면 0.
export function newSinceTraining(project, images) {
  const ids = project && project.trainedIds;
  if (!Array.isArray(ids)) return 0;
  const used = new Set(ids);
  return images.filter(i => i.kind === 'train' && i.driveId && !used.has(i.id)).length;
}

export function evalRounds(project) {
  const ev = (project && project.evals) || {};
  return Object.keys(ev).filter(k => /^r\d+$/.test(k))
    .map(k => ({ key: k, n: Number(k.slice(1)), ...ev[k] }))
    .sort((a, b) => a.n - b.n);
}
export function currentEval(project) {
  const rs = evalRounds(project);
  return rs.length ? rs[rs.length - 1] : null;
}

// 테스트 사진 채점 결과 요약.
export function scoreResults(results) {
  const total = results.length;
  const correct = results.filter(r => r.ok).length;
  const per = {};
  results.forEach(r => {
    per[r.labelId] = per[r.labelId] || { total: 0, correct: 0 };
    per[r.labelId].total++;
    if (r.ok) per[r.labelId].correct++;
  });
  return { total, correct, pct: total ? Math.round(correct * 100 / total) : 0, per };
}

// 현황판(짝 요약) — 반 전체가 이것만 읽는다. 사진 목록·기록은 넣지 않는다.
export function buildSummary(project, asg = {}) {
  const labels = project.labels || [];
  const ev = currentEval(project);
  return {
    step: project.step || 1,
    topic: String(project.topic || '').slice(0, 40),
    labels: labels.map(l => ({ id: l.id, name: l.name, emoji: l.emoji || '', c: labelCount(project, 'train', l.id), t: labelCount(project, 'test', l.id) })),
    minPerLabel: asg.minPerLabel || DEFAULT_MIN_PER_LABEL,
    model: hasModel(project),
    modelVersion: project.modelVersion || 0,
    acc: ev && ev.total ? ev.pct : null,
    published: !!project.published,
    title: project.published ? String((project.app && project.app.title) || '').slice(0, 40) : '',
    round: project.round || 1,
  };
}
// 키 순서와 상관없이 같은 값인지 — Firestore가 돌려주는 객체는 키가 정렬돼 있어서
// 그냥 JSON.stringify로 비교하면 같은 값도 다르다고 나와 쓸데없이 다시 저장하게 된다.
export function stableJson(v) {
  if (Array.isArray(v)) return '[' + v.map(stableJson).join(',') + ']';
  if (v && typeof v === 'object') return '{' + Object.keys(v).sort().map(k => JSON.stringify(k) + ':' + stableJson(v[k])).join(',') + '}';
  return JSON.stringify(v === undefined ? null : v);
}
export function sameSummary(a, b) {
  return stableJson(a || null) === stableJson(b || null);
}

// ── ohdlet 게시 키 ──
// ohdlet.html의 classBoardKey()와 같은 규칙이어야 게시판에 글이 보인다.
export function classBoardKey(c) {
  const g = c.grade || '', grp = c.group || '';
  return `${c.name || ''}__${c.schoolName || ''}${g ? ('__g' + g) : ''}${grp ? ('__c' + grp) : ''}`;
}

// 학년·반 정규화 — home.html/admin.html과 같은 규칙.
export const nv = v => String(v || '').replace(/학년|년급|학|반|班|кл\./g, '').trim();

export function newId(prefix = '') {
  const a = new Uint8Array(6);
  globalThis.crypto.getRandomValues(a);
  return prefix + Array.from(a, b => b.toString(36).padStart(2, '0')).join('').slice(0, 10);
}

// 구글 이미지 검색 결과를 끌어놓으면 원본 대신 google.com/imgres?imgurl=...
// 같은 중간 주소가 오는 경우가 있다. 그 안의 실제 이미지 주소를 꺼낸다.
export function extractImageUrl(raw) {
  const s = String(raw || '').trim().split(/\r?\n/).find(x => x && !x.startsWith('#')) || '';
  if (!s) return '';
  if (/^data:image\//i.test(s)) return s;
  try {
    const u = new URL(s);
    if (/(^|\.)google\.[a-z.]+$/i.test(u.hostname) && u.pathname.startsWith('/imgres')) {
      const inner = u.searchParams.get('imgurl');
      if (inner) return inner;
    }
    if (u.protocol === 'http:' || u.protocol === 'https:') return u.href;
  } catch { /* 주소가 아니면 버린다 */ }
  return '';
}

// 사진 지문(ai-image.js fingerprint) 사이의 다른 비트 수. 작으면 같은 사진.
export function fpDistance(a, b) {
  if (!a || !b || a.length !== b.length) return Infinity;
  let d = 0;
  for (let i = 0; i < a.length; i++) {
    let x = parseInt(a[i], 16) ^ parseInt(b[i], 16);
    while (x) { d += x & 1; x >>= 1; }
  }
  return d;
}
export const DUP_DISTANCE = 6;
export function isDuplicate(fp, fps) {
  return fps.some(o => fpDistance(fp, o) <= DUP_DISTANCE);
}

// 사진 기록 목록 → 레이블별 장수. 장수는 늘리고 줄이는 카운터 대신 이렇게
// 목록에서 다시 세서 통째로 저장한다 — 재시도로 같은 쓰기가 두 번 가도 숫자가 틀어지지 않는다.
export function countImages(images) {
  const counts = { train: {}, test: {} };
  for (const im of images) {
    const k = im.kind === 'test' ? 'test' : 'train';
    counts[k][im.labelId] = (counts[k][im.labelId] || 0) + 1;
  }
  return counts;
}
