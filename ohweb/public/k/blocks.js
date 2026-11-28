// 차시 문서 편집기(Editor.js)에 얹는 우리 블록: 슬라이드 나눔, 안내 상자, 그림, 도구, 타이머, 발표자 메모.
// 저장 형식은 Editor.js 블록 {id, type, data}. 그리는 쪽은 render.js.
import { TOOLS, driveImg } from 'https://kakainfo.com/kaka/render.js?v=1128';
import { icon } from 'https://kakainfo.com/kaka/icons.js?v=1128';

const el = (tag, cls, html) => { const e = document.createElement(tag); if (cls) e.className = cls; if (html != null) e.innerHTML = html; return e; };
// 입력칸 값 변경은 DOM이 안 바뀌어 편집기가 모른다 → 직접 알려야 자동 저장된다.
const watch = (tool, root) => { const f = () => tool.block?.dispatchChange(); root.addEventListener('input', f); root.addEventListener('change', f); return root; };
const editable = (cls, html, placeholder) => {
  const e = el('div', cls, html || '');
  e.contentEditable = 'true'; e.dataset.placeholder = placeholder;
  return e;
};

export class Slide {
  static get toolbox() { return { title: '슬라이드 나눔', icon: icon('slide') }; }
  static get isReadOnlySupported() { return true; }
  render() { return el('div', 'kb-slide', '<span>슬라이드 나눔</span>'); }
  save() { return {}; }
}

export class Callout {
  static get toolbox() { return { title: '안내 상자', icon: icon('callout') }; }
  static get enableLineBreaks() { return true; }
  static get isReadOnlySupported() { return true; }
  constructor({ data, block }) { this.block = block; this.data = { tone: data.tone || '', text: data.text || '' }; }
  render() {
    this.wrap = el('div', 'kb-callout');
    this.text = editable('kb-callout__text', this.data.text, '안내할 내용');
    this.paint();
    this.wrap.append(this.text);
    return this.wrap;
  }
  paint() { this.wrap.className = 'kb-callout k-callout' + (this.data.tone ? ' k-callout--' + this.data.tone : ''); }
  renderSettings() {
    return [['', '회색'], ['tip', '초록'], ['warn', '겨자']].map(([tone, label]) => ({
      icon: '<span style="display:block;width:10px;height:10px;border-radius:50%;background:currentColor"></span>', label, isActive: this.data.tone === tone, closeOnActivate: true, toggle: 'tone',
      onActivate: () => { this.data.tone = tone; this.paint(); this.block?.dispatchChange(); },
    }));
  }
  save() { return { tone: this.data.tone, text: this.text.innerHTML }; }
}

export class Image {
  static get toolbox() { return { title: '그림', icon: icon('image') }; }
  static get isReadOnlySupported() { return true; }
  constructor({ data, block }) { this.block = block; this.data = { url: data.url || '', caption: data.caption || '' }; }
  render() {
    const w = el('div', 'kb-image');
    const url = el('input', 'k-input'); url.placeholder = '그림 주소(구글 드라이브 공유 링크도 됩니다)'; url.value = this.data.url;
    const img = el('img'); img.alt = '';
    const show = () => { img.src = driveImg(url.value.trim()); img.hidden = !url.value.trim(); };
    url.addEventListener('change', show); show();
    this.url = url;
    this.caption = editable('kb-image__cap', this.data.caption, '그림 설명(없어도 됩니다)');
    w.append(url, img, this.caption);
    return watch(this, w);
  }
  save() { return { url: this.url.value.trim(), caption: this.caption.innerHTML }; }
}

export class Tool {
  static get toolbox() { return { title: '도구', icon: icon('tool') }; }
  static get isReadOnlySupported() { return true; }
  static get enableLineBreaks() { return true; }
  constructor({ data, block }) { this.block = block; this.data = { tool: data.tool || 'scratch', title: data.title || '', desc: data.desc || '', starter: data.starter || '', starterFileId: data.starterFileId || '', starterName: data.starterName || '' }; }
  render() {
    const w = el('div', 'kb-tool k-tool');
    const head = el('div', 'k-tool__head');
    const sel = el('select', 'k-input kb-tool__sel');
    sel.innerHTML = Object.entries(TOOLS).map(([k, v]) => `<option value="${k}" ${k === this.data.tool ? 'selected' : ''}>${v}</option>`).join('');
    const title = el('input', 'k-input'); title.placeholder = '할 일 이름(예: 별 그리기)'; title.value = this.data.title;
    head.append(sel);
    this.desc = editable('k-tool__desc kb-tool__desc', this.data.desc, '학생에게 보일 설명');
    // 파이썬: 학생이 처음 열 때 들어 있을 코드. 학생 작업은 학생 계정에 저장되고 '학생 작업'에서 본다.
    const starter = el('textarea', 'k-textarea kb-tool__starter'); starter.placeholder = '처음 코드(비워도 됨)'; starter.value = this.data.starter; starter.spellcheck = false;
    starter.style.cssText = 'font:400 14px/22px var(--font-mono);min-height:88px';
    starter.addEventListener('keydown', e => { e.stopPropagation(); if (e.key === 'Tab') { e.preventDefault(); starter.setRangeText('    ', starter.selectionStart, starter.selectionEnd, 'end'); this.block?.dispatchChange(); } });
    // 스크래치: 시작 파일(.sb3)을 선생님 드라이브에 올려 두면 학생이 처음 열 때 그것으로 시작한다(없으면 기본 고양이).
    const sb = el('div', 'row kb-tool__sb3');
    const file = el('input'); file.type = 'file'; file.accept = '.sb3'; file.hidden = true;
    const btn = (text, fn) => { const b = el('button', 'k-btn k-btn--sm'); b.type = 'button'; b.textContent = text; b.addEventListener('click', fn); return b; };
    const paintSb = msg => {
      sb.replaceChildren();
      const lab = el('span', 'k-hint'); lab.style.margin = '0';
      if (msg) lab.textContent = msg;
      else if (this.data.starterFileId) lab.textContent = `시작 파일: ${this.data.starterName || '이름 없음'}`;
      if (this.data.starterFileId && !msg) sb.append(lab, btn('바꾸기', () => file.click()), btn('빼기', () => { this.data.starterFileId = this.data.starterName = ''; paintSb(); this.block?.dispatchChange(); }));
      else sb.append(btn('시작 파일 올리기 (.sb3)', () => file.click()), lab);
    };
    file.addEventListener('change', async () => {
      const f = file.files[0]; file.value = ''; if (!f) return;
      paintSb('올리는 중…');
      try {
        const { gas, fileToB64 } = await import('./scratch-drive.js?v=1128');
        const r = await gas('save', { folders: ['시작 파일'], name: f.name, b64: await fileToB64(f) });
        this.data.starterFileId = r.fileId; this.data.starterName = f.name; paintSb(); this.block?.dispatchChange();
      } catch (e) { paintSb('올리지 못했습니다: ' + e.message); }
    });
    paintSb();
    const hint = el('p', 'k-hint'); hint.style.margin = '0';
    const sync = () => {
      const py = sel.value === 'python', sc = sel.value === 'scratch';
      starter.hidden = !py; sb.hidden = !sc;
      hint.innerHTML = py ? '학생은 차시 화면에서 [열기] → 코드를 쓰고 실행합니다. 학생 계정에 자동 저장됩니다.'
        : sc ? '학생은 [열기] → 사이트 안 스크래치에서 만들고, 선생님 드라이브에 저장됩니다. <a href="settings.html" target="_blank">저장 설정</a>'
        : '이 도구 연결은 다음 단계에서 붙입니다.';
    };
    sel.addEventListener('change', sync); sync();
    w.append(head, title, this.desc, starter, sb, file, hint);
    Object.assign(this, { sel, title, starter });
    return watch(this, w);
  }
  save() {
    const py = this.sel.value === 'python', sc = this.sel.value === 'scratch';
    return { tool: this.sel.value, title: this.title.value.trim(), desc: this.desc.innerHTML, ...(py ? { starter: this.starter.value } : {}),
      ...(sc && this.data.starterFileId ? { starterFileId: this.data.starterFileId, starterName: this.data.starterName } : {}) };
  }
}

export class Timer {
  static get toolbox() { return { title: '타이머', icon: icon('timer') }; }
  static get isReadOnlySupported() { return true; }
  constructor({ data, block }) { this.block = block; this.data = { minutes: data.minutes || 5, label: data.label || '' }; }
  render() {
    const w = el('div', 'kb-timer');
    w.append(el('span', 'k-label', '타이머'));
    const m = el('input', 'k-input'); m.type = 'number'; m.min = 1; m.max = 90; m.value = this.data.minutes; m.style.width = '80px';
    const l = el('input', 'k-input'); l.placeholder = '무엇을 하는 시간인지'; l.value = this.data.label;
    w.append(m, el('span', 'k-muted', '분'), l, el('span', 'k-hint', '발표 화면에만 보입니다.'));
    Object.assign(this, { m, l });
    return watch(this, w);
  }
  save() { return { minutes: Math.max(1, Math.min(90, Number(this.m.value) || 5)), label: this.l.value.trim() }; }
}

export class Note {
  static get toolbox() { return { title: '발표자 메모', icon: icon('note') }; }
  static get enableLineBreaks() { return true; }
  static get isReadOnlySupported() { return true; }
  constructor({ data }) { this.data = { text: data.text || '' }; }
  render() {
    const w = el('div', 'kb-note');
    w.append(el('span', 'k-label', '발표자 메모 · 학생에게 안 보임'));
    this.text = editable('kb-note__text', this.data.text, '말할 내용');
    w.append(this.text);
    return w;
  }
  save() { return { text: this.text.innerHTML }; }
}

// 편집기 안 모양(kaka.css 위에 얹음)
export const EDITOR_CSS = `
.codex-editor { font: 400 17px/28px var(--font-sans); color: var(--ink); }
#editor .ce-block__content, #editor .ce-toolbar__content { max-width: 720px; margin: 0; }
#editor .tc-wrap { max-width: 720px; }
.codex-editor--narrow .ce-toolbar__actions { right: auto; left: -60px; }
.ce-toolbar__actions { right: auto; left: -60px; }
.ce-header { font-weight: 600; } h1.ce-header { font-size: 28px; line-height: 36px; } h2.ce-header { font-size: 22px; line-height: 30px; } h3.ce-header { font-size: 18px; line-height: 26px; }
[contenteditable][data-placeholder]:empty::before { content: attr(data-placeholder); color: var(--ink-3); }
.kb-slide { display: flex; align-items: center; gap: 12px; color: var(--ink-3); font: 500 13px/1 var(--font-sans); padding: 14px 0; }
.kb-slide::before, .kb-slide::after { content: ""; flex: 1; border-top: 1px dashed var(--line-strong); }
.kb-callout { margin: 6px 0; max-width: 560px; width: auto; }
.kb-callout__text { outline: none; min-height: 24px; }
.kb-image { display: grid; gap: 8px; margin: 8px 0; max-width: 560px; }
.kb-image img { max-width: 100%; border-radius: var(--radius-md); }
.kb-image__cap { color: var(--ink-2); font-size: 14px; outline: none; }
.kb-tool { margin: 8px 0; }
.kb-tool__sel { width: auto; height: 30px; font-size: 14px; }
.kb-tool__desc { outline: none; min-height: 22px; }
.kb-timer { display: flex; flex-wrap: wrap; align-items: center; gap: 8px; padding: 8px 0; }
.kb-timer .k-input { width: 220px; }
.kb-note { display: grid; gap: 4px; padding: 8px 12px; border-left: 3px solid var(--warn); background: var(--warn-soft); max-width: 560px; border-radius: 0 var(--radius-sm) var(--radius-sm) 0; }
.kb-note__text { outline: none; font-size: 15px; }
.ce-code__textarea { font: 400 14px/22px var(--font-mono); background: var(--code-bg); color: var(--code-ink); border: 0; border-radius: var(--radius-md); max-width: 720px; }
.tc-wrap { --color-border: var(--line); }
.ce-popover, .ce-inline-toolbar, .ce-conversion-toolbar, .ce-settings { color: #1c1e1d; }
`;
