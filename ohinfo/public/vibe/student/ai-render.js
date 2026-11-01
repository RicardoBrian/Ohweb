// 공개 웹앱 화면 그리기 — aiapp.html(실제 웹앱)과 ailab.html ⑤ 배포 미리보기가 같이 쓴다.
// 디자인 5종은 화면 배치가 같고 색·질감만 다르다(ai-themes.css).

import { escHtml } from './escape.js';
import { labelName, phraseFor, UNSURE, UNSURE_THRESHOLD, LANGS } from './ai-core.js?v=202610220501';

export const THEMES = ['minimal', 'bw', 'glass', 'neon', 'warm', 'pastel', 'forest', 'ocean', 'space', 'retro', 'comic'];
// 강조색·글꼴은 디자인과 따로 고른다. 공개 웹앱에 그대로 쓰이므로 이 목록에 있는 값만 받는다.
export const ACCENTS = ['#e5484d', '#f76b15', '#ffb224', '#30a46c', '#12a594', '#0090ff', '#6e56cf', '#e93d82', '#1c1c1f'];
export const FONTS = ['round', 'cute', 'hand', 'bold'];
const FONT_CSS = { round: 'Gowun+Dodum', cute: 'Jua', hand: 'Nanum+Pen+Script', bold: 'Black+Han+Sans' };
// 고른 글꼴만 그때 받는다(기본 글꼴이면 아무것도 받지 않는다).
export function ensureFont(font) {
  if (!FONT_CSS[font] || typeof document === 'undefined') return;
  const id = 'aa-font-' + font;
  if (document.getElementById(id)) return;
  const l = document.createElement('link');
  l.id = id; l.rel = 'stylesheet';
  l.href = `https://fonts.googleapis.com/css2?family=${FONT_CSS[font]}&display=swap`;
  document.head.appendChild(l);
}
const LANG_NAMES = { ko: '한국어', en: 'English', zh: '中文', ru: 'Рус' };

// 모델 예측([{className, probability}]) → 레이블별 확률 { labelId: p }
export function probsByLabel(preds, mapping) {
  const out = {};
  for (const p of preds || []) {
    const id = mapping && mapping[p.className];
    if (id) out[id] = (out[id] || 0) + p.probability;
  }
  return out;
}

export function topLabel(app, probs) {
  let best = null, bp = -1;
  for (const l of app.labels || []) {
    const p = probs[l.id] || 0;
    if (p > bp) { bp = p; best = l; }
  }
  return { label: best, p: bp };
}

function nameHtml(l, lang) {
  const main = labelName(l, lang);
  const orig = l.name && l.name !== main ? `<small class="aa-orig">${escHtml(l.name)}</small>` : '';
  return `${escHtml(main)}${orig}`;
}

// 표 데이터 앱: 정보 칸마다 숫자(밀기 + 숫자 칸) 또는 고르기 버튼. state.tIn = 칸별 지금 값.
const trName = (o, lang) => (o && o.tr && o.tr[lang]) || (o && o.name) || '';
const fmtNum = v => String(Math.round(v * 100) / 100);
function tableForm(tb, lang, t, state) {
  const ins = state.tIn || tb.features.map(f => f.def);
  const fields = tb.features.map((f, i) => {
    const name = escHtml(trName(f, lang));
    if (f.type === 'num') {
      const v = ins[i] != null ? ins[i] : f.def;
      return `<div class="aa-f"><label class="aa-fl" for="aa-n${i}">${name}</label><div class="aa-frow">
        <input type="range" class="aa-range" min="${f.min}" max="${f.max}" step="${f.step}" value="${escHtml(v)}" data-ti="${i}" aria-label="${name}">
        <input type="number" class="aa-num" id="aa-n${i}" step="${f.step}" value="${escHtml(v)}" data-ti="${i}"></div>
        <small class="aa-range-hint">${escHtml(fmtNum(f.min))} ~ ${escHtml(fmtNum(f.max))}</small></div>`;
    }
    const opts = (f.opts || []).map((o, k) => `<button type="button" class="aa-opt${String(ins[i]) === o ? ' on' : ''}" data-act="topt" data-ti="${i}" data-v="${escHtml(o)}">${escHtml(((f.optTr || [])[k] || {})[lang] || o)}</button>`).join('');
    return `<div class="aa-f"><span class="aa-fl">${name}</span><div class="aa-opts">${opts}</div></div>`;
  }).join('');
  return `<section class="aa-card aa-form">${fields}<button type="button" class="aa-btn aa-ask" data-act="tpredict">${escHtml(t('tAsk'))}</button></section>`;
}

// 문장 앱: 문장 칸 + [물어보기]. 결과에 단어마다 영향 준 레이블 색을 칠한다(state.words).
function textForm(lang, t, state) {
  return `<section class="aa-card aa-form"><textarea class="aa-text" maxlength="100" rows="3" placeholder="${escHtml(t('xAppPh'))}">${escHtml(state.text || '')}</textarea>
    <button type="button" class="aa-btn aa-ask" data-act="xpredict">${escHtml(t('tAsk'))}</button></section>`;
}
// 레이블 색(실험실 화면과 같은 순서)
export const WORD_COLORS = ['0,144,255', '229,72,77', '48,164,108', '247,107,21', '110,86,207', '233,61,130', '18,165,148', '255,178,36'];
function wordsHtml(app, words, t) {
  const idx = id => (app.labels || []).findIndex(l => l.id === id);
  return `<div class="aa-words">${words.map(x => (x.id && x.s > 0.05 && idx(x.id) >= 0
    ? `<span class="aa-w" style="background:rgba(${WORD_COLORS[idx(x.id) % 8]},${(0.15 + 0.45 * x.s).toFixed(2)});border-color:rgb(${WORD_COLORS[idx(x.id) % 8]})">${escHtml(x.w)}</span>`
    : `<span class="aa-w0">${escHtml(x.w)}</span>`)).join(' ')}</div><div class="aa-sub">${escHtml(t('xWordsApp'))}</div>`;
}

// 친구 피드백(로그인한 학생에게만, state.fbOn): 👍 맞아요 / 👎 틀렸어요 → 정답 고르기 → 보내기
function fbHtml(app, lang, t, state) {
  if (!state.fbOn || state.sample || state.status !== 'ready') return '';
  if (state.fb === 'sent') return `<div class="aa-fb aa-fb-done">${escHtml(t('fbThanks'))}</div>`;
  if (state.fb === 'wrong') {
    const opts = (app.labels || []).map(l => `<button type="button" class="aa-opt${state.fbWant === l.id ? ' on' : ''}" data-act="fbpick" data-v="${escHtml(l.id)}">${l.emoji ? escHtml(l.emoji) + ' ' : ''}${escHtml(labelName(l, lang))}</button>`).join('');
    return `<div class="aa-fb"><div class="aa-fbq">${escHtml(t('fbPick'))}</div><div class="aa-opts">${opts}</div>
      <input class="aa-fbnote" maxlength="60" placeholder="${escHtml(t('fbNotePh'))}" value="${escHtml(state.fbNote || '')}">
      <div class="aa-fbrow"><button type="button" class="aa-btn" data-act="fbsend" ${state.fbWant ? '' : 'disabled'}>${escHtml(t('fbSend'))}</button>
      <button type="button" class="aa-lang" data-act="fbcancel">${escHtml(t('fbCancel'))}</button></div>
      ${state.fb === 'wrong' && state.fbErr ? `<div class="aa-err">${escHtml(state.fbErr)}</div>` : ''}</div>`;
  }
  return `<div class="aa-fb"><span class="aa-fbq">${escHtml(t('fbAsk'))}<br><small>${escHtml(t('fbPrivacy'))}</small></span>
    <button type="button" class="aa-opt" data-act="fbok">👍 ${escHtml(t('fbRight'))}</button>
    <button type="button" class="aa-opt" data-act="fbwrong">👎 ${escHtml(t('fbWrong'))}</button></div>`;
}

// state: { photo: 이미지 주소|null, probs: {labelId:p}|null, status: 'idle'|'loading'|'thinking'|'error'|'ready', msg }
export function appHtml(app, lang, t, state = {}) {
  const labels = app.labels || [];
  const tb = app.table && Array.isArray(app.table.features) ? app.table : null;
  const tx = !tb && app.text && app.text.model ? app.text : null;
  const hidden = app.hiddenPhrases || {};
  const theme = THEMES.includes(app.theme) ? app.theme : 'minimal';
  const accent = ACCENTS.includes(app.accent) ? app.accent : '';
  const font = FONTS.includes(app.font) ? app.font : '';
  ensureFont(font);
  const emojis = labels.map(l => l.emoji).filter(Boolean).join(' ');
  const txChip = (l, i) => (app.text && app.text.model ? ` style="box-shadow:inset 0 -3px 0 rgb(${WORD_COLORS[i % 8]})"` : '');
  const chips = tb && tb.prob === 'reg' ? `<span class="aa-chip">🎯 ${escHtml(trName(tb.target, lang))}</span>` : labels.map((l, i) => `<span class="aa-chip"${txChip(l, i)}>${l.emoji ? escHtml(l.emoji) + ' ' : ''}${escHtml(labelName(l, lang))}</span>`).join('');

  // 학생이 그리기·카메라로 만든 모델이면 웹앱에서도 그렇게 넣어 볼 수 있다.
  const ins = Array.isArray(app.inputs) ? app.inputs : [];
  const caps = [ins.includes('draw') ? `<button type="button" class="aa-btn aa-cap" data-act="cap" data-v="draw">✍️ ${escHtml(t('capDraw'))}</button>` : '',
    ins.includes('camera') ? `<button type="button" class="aa-btn aa-cap" data-act="cap" data-v="camera">📸 ${escHtml(t('capCamera'))}</button>` : ''].join('');
  const capRow = caps ? `<div class="aa-caps">${caps}</div>` : '';
  let drop;
  if (state.photo) {
    drop = `<img class="aa-photo" src="${escHtml(state.photo)}" alt="">
      <button type="button" class="aa-btn aa-again" data-act="pick">${escHtml(t('again'))}</button>${capRow}`;
  } else {
    drop = `<div class="aa-drop-icon" aria-hidden="true">＋</div>
      <button type="button" class="aa-btn" data-act="pick">${escHtml(t('choosePhoto'))}</button>
      <p class="aa-hint">${escHtml(t('dropPhoto'))}</p>${capRow}`;
  }

  let result = '';
  if (state.status === 'loading' || state.status === 'thinking') {
    result = `<div class="aa-wait"><span class="aa-spin"></span>${escHtml(t(state.status === 'loading' ? 'appLoading' : 'thinking'))}</div>`;
  } else if (state.status === 'error') {
    result = `<div class="aa-wait aa-err">${escHtml(state.msg || t('modelFail'))}</div>`;
  } else if (tb && tb.prob === 'reg' && state.tv != null) {
    result = `<div class="aa-verdict"><span class="aa-phrase">${escHtml(trName(tb.target, lang))}: <b class="aa-val">${escHtml(fmtNum(state.tv))}${tb.unit ? ' ' + escHtml(tb.unit) : ''}</b></span></div>
      <div class="aa-sub">${escHtml(t('tAiGuess'))}</div>${state.sample ? `<div class="aa-note">${escHtml(t('sampleNote'))}</div>` : ''}`;
  } else if (state.probs) {
    const { label, p } = topLabel(app, state.probs);
    const unsure = !label || p < UNSURE_THRESHOLD;
    const phrase = unsure ? (UNSURE[lang] || UNSURE.ko)
      : phraseFor(label, lang, { hidden: !!hidden[label.id], srcLang: app.srcLang || 'ko' });
    const bars = labels.map((l, i) => {
      const pct = Math.round((state.probs[l.id] || 0) * 100);
      const top = !unsure && label && l.id === label.id;
      return `<div class="aa-row${top ? ' aa-top' : ''}">
        <span class="aa-bl">${l.emoji ? `<span class="aa-be">${escHtml(l.emoji)}</span>` : ''}<span>${nameHtml(l, lang)}</span></span>
        <span class="aa-track"><span class="aa-fill" style="width:${pct}%;--bar:var(--c${(i % 8) + 1})"></span></span>
        <span class="aa-pct">${pct}%</span></div>`;
    }).join('');
    result = `<div class="aa-verdict${unsure ? ' aa-unsure' : ''}">
        ${!unsure && label.emoji ? `<span class="aa-vemoji">${escHtml(label.emoji)}</span>` : ''}
        <span class="aa-phrase">${escHtml(phrase)}</span></div>
      ${tx && Array.isArray(state.words) ? wordsHtml(app, state.words, t) : ''}
      <div class="aa-sub">${escHtml(t('probability'))}</div>
      <div class="aa-bars">${bars}</div>
      ${state.sample ? `<div class="aa-note">${escHtml(t('sampleNote'))}</div>` : ''}
      ${fbHtml(app, lang, t, state)}`;
  }

  // 대문: 학생이 올린 사진과 설명(선생님이 숨기면 안 보인다)
  const cover = app.cover && !hidden._cover && /^data:image\/(jpeg|png|webp);base64,/.test(app.cover) ? app.cover : '';
  const descRaw = hidden._desc ? '' : String(app.desc || '');
  const desc = descRaw && lang !== (app.descLang || app.srcLang || 'ko') && app.descTr && app.descTr[lang] ? app.descTr[lang] : descRaw;

  const langs = LANGS.map(l => `<button type="button" class="aa-lang${l === lang ? ' on' : ''}" data-lang="${l}">${LANG_NAMES[l]}</button>`).join('');

  return `<div class="ai-app" data-theme="${theme}"${font ? ` data-font="${font}"` : ''}${accent ? ` data-accent style="--aa-accent:${accent}"` : ''}>
    <div class="aa-bg" aria-hidden="true"></div>
    <div class="aa-wrap">
      <header class="aa-head${cover ? ' has-cover' : ''}">
        ${cover ? `<img class="aa-cover" src="${escHtml(cover)}" alt="">` : (emojis ? `<div class="aa-emojis">${escHtml(emojis)}</div>` : '')}
        <h1 class="aa-title">${escHtml(app.title || '')}</h1>
        ${desc ? `<p class="aa-desc">${escHtml(desc)}</p>` : ''}
        <div class="aa-chips">${chips}</div>
      </header>
      ${tb ? tableForm(tb, lang, t, state) : tx ? textForm(lang, t, state) : `<section class="aa-card aa-drop${state.photo ? ' has-photo' : ''}" tabindex="0" data-act="zone">${drop}</section>`}
      ${result ? `<section class="aa-card aa-result" aria-live="polite">${result}</section>` : ''}
      <footer class="aa-foot"><span>${escHtml(t('madeWith'))}</span><div class="aa-langs">${langs}</div></footer>
    </div>
  </div>`;
}

// 미리보기용 예시 확률: 첫 레이블 87%, 나머지가 나눠 갖는다.
export function sampleProbs(app) {
  const ls = app.labels || [];
  const out = {};
  ls.forEach((l, i) => { out[l.id] = i === 0 ? 0.87 : 0.13 / Math.max(1, ls.length - 1); });
  return out;
}
