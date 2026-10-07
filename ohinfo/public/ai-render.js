// 공개 웹앱 화면 그리기 — aiapp.html(실제 웹앱)과 ailab.html ⑤ 배포 미리보기가 같이 쓴다.
// 디자인 5종은 화면 배치가 같고 색·질감만 다르다(ai-themes.css).

import { escHtml } from './escape.js';
import { labelName, phraseFor, UNSURE, UNSURE_THRESHOLD, LANGS } from './ai-core.js?v=202610070137';

export const THEMES = ['minimal', 'bw', 'glass', 'neon', 'warm'];
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

// state: { photo: 이미지 주소|null, probs: {labelId:p}|null, status: 'idle'|'loading'|'thinking'|'error'|'ready', msg }
export function appHtml(app, lang, t, state = {}) {
  const labels = app.labels || [];
  const hidden = app.hiddenPhrases || {};
  const theme = THEMES.includes(app.theme) ? app.theme : 'minimal';
  const emojis = labels.map(l => l.emoji).filter(Boolean).join(' ');
  const chips = labels.map(l => `<span class="aa-chip">${l.emoji ? escHtml(l.emoji) + ' ' : ''}${escHtml(labelName(l, lang))}</span>`).join('');

  let drop;
  if (state.photo) {
    drop = `<img class="aa-photo" src="${escHtml(state.photo)}" alt="">
      <button type="button" class="aa-btn aa-again" data-act="pick">${escHtml(t('again'))}</button>`;
  } else {
    drop = `<div class="aa-drop-icon" aria-hidden="true">＋</div>
      <button type="button" class="aa-btn" data-act="pick">${escHtml(t('choosePhoto'))}</button>
      <p class="aa-hint">${escHtml(t('dropPhoto'))}</p>`;
  }

  let result = '';
  if (state.status === 'loading' || state.status === 'thinking') {
    result = `<div class="aa-wait"><span class="aa-spin"></span>${escHtml(t(state.status === 'loading' ? 'appLoading' : 'thinking'))}</div>`;
  } else if (state.status === 'error') {
    result = `<div class="aa-wait aa-err">${escHtml(state.msg || t('modelFail'))}</div>`;
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
      <div class="aa-sub">${escHtml(t('probability'))}</div>
      <div class="aa-bars">${bars}</div>
      ${state.sample ? `<div class="aa-note">${escHtml(t('sampleNote'))}</div>` : ''}`;
  }

  const langs = LANGS.map(l => `<button type="button" class="aa-lang${l === lang ? ' on' : ''}" data-lang="${l}">${LANG_NAMES[l]}</button>`).join('');

  return `<div class="ai-app" data-theme="${theme}">
    <div class="aa-bg" aria-hidden="true"></div>
    <div class="aa-wrap">
      <header class="aa-head">
        ${emojis ? `<div class="aa-emojis">${escHtml(emojis)}</div>` : ''}
        <h1 class="aa-title">${escHtml(app.title || '')}</h1>
        <div class="aa-chips">${chips}</div>
      </header>
      <section class="aa-card aa-drop${state.photo ? ' has-photo' : ''}" tabindex="0" data-act="zone">${drop}</section>
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
