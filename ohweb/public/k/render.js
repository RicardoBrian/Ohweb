// 차시 문서 그리기 — 미리 보기·발표(지금), 학생 화면(다음 단계)이 같이 쓴다.
// 문서: { blocks: [{id, type, data}], tr: { zh|ru|en: { [blockId]: { src, data } } } }
export const LANGS = [['ko', '한국어'], ['zh', '中文'], ['ru', 'Русский'], ['en', 'English']];
export const TOOLS = { scratch: '스크래치', python: '파이썬', quiz: '확인 문제', board: '게시판', colab: '코랩', ailab: 'AI 실험실', appinventor: '앱 인벤터 실행기', makecode: 'MakeCode' };

// Firestore는 undefined 값과 배열 안의 배열(표 칸)을 받지 않는다 → 저장할 때 {_a: [...]}로 감싸고, 읽을 때 푼다.
export function fsEncode(v, inArr = false) {
  if (Array.isArray(v)) { const a = v.map(x => fsEncode(x, true)); return inArr ? { _a: a } : a; }
  if (v && typeof v === 'object') return Object.fromEntries(Object.entries(v).filter(([, x]) => x !== undefined).map(([k, x]) => [k, fsEncode(x)]));
  return v;
}
export function fsDecode(v) {
  if (Array.isArray(v)) return v.map(fsDecode);
  if (v && typeof v === 'object') { if (Array.isArray(v._a) && Object.keys(v).length === 1) return v._a.map(fsDecode); return Object.fromEntries(Object.entries(v).map(([k, x]) => [k, fsDecode(x)])); }
  return v;
}

const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

// 구글 드라이브 공유 링크 → 바로 보이는 그림 주소
export function driveImg(url) {
  const m = String(url || '').match(/drive\.google\.com\/(?:file\/d\/|open\?id=|uc\?(?:export=\w+&)?id=)([\w-]{20,})/);
  return m ? `https://lh3.googleusercontent.com/d/${m[1]}` : url;
}

// 글 안 서식은 편집기가 만드는 몇 가지만 남긴다(굵게·기울임·밑줄·형광·코드·링크·줄바꿈).
const KEEP = new Set(['B', 'STRONG', 'I', 'EM', 'U', 'S', 'MARK', 'CODE', 'A', 'BR']);
export function clean(html) {
  const doc = new DOMParser().parseFromString(`<div>${html ?? ''}</div>`, 'text/html');
  const walk = node => {
    for (const c of [...node.childNodes]) {
      if (c.nodeType === 3) continue;
      if (c.nodeType !== 1 || !KEEP.has(c.tagName)) { if (c.nodeType === 1) { walk(c); c.replaceWith(...c.childNodes); } else c.remove(); continue; }
      const href = c.tagName === 'A' ? c.getAttribute('href') : null;
      for (const a of [...c.attributes]) c.removeAttribute(a.name);
      if (href && /^https?:\/\//.test(href)) { c.setAttribute('href', href); c.setAttribute('target', '_blank'); c.setAttribute('rel', 'noopener'); }
      walk(c);
    }
  };
  walk(doc.body.firstChild);
  return doc.body.firstChild.innerHTML;
}

// ── 번역할 글 꺼내기 / 번역 글 넣기 (블록 구조는 그대로) ──
const listTexts = items => items.flatMap(it => [it.content ?? '', ...listTexts(it.items || [])]);
const listPut = (items, q) => items.map(it => ({ ...it, content: q.shift() ?? '', items: listPut(it.items || [], q) }));
export function textsOf(b) {
  const d = b.data || {};
  switch (b.type) {
    case 'header': case 'paragraph': return [d.text ?? ''];
    case 'list': return listTexts(d.items || []);
    case 'callout': return [d.text ?? ''];
    case 'image': return [d.caption ?? ''];
    case 'table': return (d.content || []).flat();
    case 'tool': return [d.title ?? '', d.desc ?? ''];
    case 'timer': return [d.label ?? ''];
    default: return [];
  }
}
export function withTexts(b, texts) {
  const q = [...texts], d = b.data || {};
  switch (b.type) {
    case 'header': case 'paragraph': case 'callout': return { ...d, text: q[0] ?? '' };
    case 'list': return { ...d, items: listPut(d.items || [], q) };
    case 'image': return { ...d, caption: q[0] ?? '' };
    case 'table': return { ...d, content: (d.content || []).map(r => r.map(() => q.shift() ?? '')) };
    case 'tool': return { ...d, title: q[0] ?? '', desc: q[1] ?? '' };
    case 'timer': return { ...d, label: q[0] ?? '' };
    default: return d;
  }
}
export const needsTr = b => textsOf(b).some(t => String(t).replace(/<[^>]+>|&nbsp;/g, '').trim());
// 원문이 바뀌었는지 알아보는 표(짧은 해시)
export function srcKey(b) {
  const s = JSON.stringify(textsOf(b));
  let h = 0; for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) | 0;
  return (h >>> 0).toString(36);
}
// 언어에 맞는 블록: 번역이 있으면 번역, 없으면 한국어
export function localized(doc, lang) {
  const tr = (lang !== 'ko' && doc.tr?.[lang]) || {};
  return (doc.blocks || []).map(b => tr[b.id] ? { ...b, data: { ...b.data, ...tr[b.id].data }, stale: tr[b.id].src !== srcKey(b) } : { ...b, missing: lang !== 'ko' && needsTr(b) });
}

// ── 그리기 ──
const listHtml = (d, items) => {
  const tag = d.style === 'ordered' ? 'ol' : 'ul';
  return `<${tag} class="kd-list">${items.map(it => `<li>${d.style === 'checklist' ? `<span class="kd-check ${it.meta?.checked ? 'is-on' : ''}"></span>` : ''}${clean(it.content)}${it.items?.length ? listHtml(d, it.items) : ''}</li>`).join('')}</${tag}>`;
};
export function blockHtml(b, { mode = 'read' } = {}) {
  const d = b.data || {};
  switch (b.type) {
    case 'header': { const lv = Math.min(3, Math.max(1, d.level || 2)); return `<h${lv + 1} class="kd-h kd-h${lv}">${clean(d.text)}</h${lv + 1}>`; }
    case 'paragraph': return clean(d.text) ? `<p class="kd-p">${clean(d.text)}</p>` : '';
    case 'list': return listHtml(d, d.items || []);
    case 'callout': return `<div class="k-callout kd-callout ${d.tone ? 'k-callout--' + d.tone : ''}"><span>${clean(d.text)}</span></div>`;
    case 'image': return d.url ? `<figure class="kd-fig"><img src="${esc(driveImg(d.url))}" alt="${esc(String(d.caption || '').replace(/<[^>]+>/g, ''))}" loading="lazy">${d.caption ? `<figcaption>${clean(d.caption)}</figcaption>` : ''}</figure>` : '';
    case 'code': return `<div class="k-code kd-code"><pre>${esc(d.code)}</pre></div>`;
    case 'table': return `<div class="kd-table"><table class="k-table">${(d.content || []).map((r, i) => `<tr>${r.map(c => (i === 0 && d.withHeadings) ? `<th>${clean(c)}</th>` : `<td>${clean(c)}</td>`).join('')}</tr>`).join('')}</table></div>`;
    case 'tool': return `<div class="k-tool kd-tool"><div class="k-tool__head"><span class="k-tag">${esc(TOOLS[d.tool] || d.tool)}</span><span class="k-tool__name">${esc(d.title)}</span></div>${d.desc ? `<p class="k-tool__desc">${clean(d.desc)}</p>` : ''}</div>`;
    case 'timer': return mode === 'slide' ? `<div class="kd-timer" data-min="${Number(d.minutes) || 5}"><button class="k-btn kd-timer__btn">${Number(d.minutes) || 5}분 타이머 시작</button><span class="kd-timer__label">${esc(d.label)}</span></div>` : '';
    case 'note': case 'slide': return '';
    default: return '';
  }
}
export const renderBlocks = (blocks, opt) => blocks.map(b => {
  const h = blockHtml(b, opt);
  return h && (b.stale || b.missing) && opt?.marks ? `<div class="kd-mark" title="${b.stale ? '원문이 바뀌었습니다' : '번역이 없습니다'}">${h}</div>` : h;
}).join('');

// 발표: 슬라이드 나눔 블록과 제목1에서 장을 나눈다(지금 노션 발표와 같은 규칙). 빈 장은 버린다.
export function splitSlides(blocks) {
  const out = [[]];
  for (const b of blocks) {
    if (b.type === 'slide') { out.push([]); continue; }
    if (b.type === 'header' && (b.data?.level || 2) === 1 && out.at(-1).length) out.push([]);
    out.at(-1).push(b);
  }
  return out.filter(s => s.some(b => b.type !== 'note'));
}

export const DOC_CSS = `
.kd { max-width: var(--reading-w); font: 400 18px/30px var(--font-sans); color: var(--ink); }
.kd > * { margin: 0 0 16px; }
.kd-h { font-weight: 600; margin: 32px 0 12px; } .kd-h1 { font-size: 28px; line-height: 36px; } .kd-h2 { font-size: 22px; line-height: 30px; } .kd-h3 { font-size: 19px; line-height: 28px; }
.kd > .kd-h:first-child { margin-top: 0; }
.kd a { color: var(--accent-ink); }
.kd mark { background: var(--warn-soft); color: inherit; }
.kd code { font: 400 .88em var(--font-mono); background: var(--surface-2); padding: 1px 5px; border-radius: var(--radius-sm); }
.kd-list { padding-left: 1.4em; } .kd-list li { margin: 4px 0; }
.kd-check { display: inline-block; width: 14px; height: 14px; border: 1.5px solid var(--line-strong); border-radius: 3px; margin-right: 8px; vertical-align: -1px; }
.kd-check.is-on { background: var(--accent); border-color: var(--accent); }
.kd-fig img { max-width: 100%; border-radius: var(--radius-md); display: block; } .kd-fig figcaption { font-size: 14px; color: var(--ink-2); margin-top: 6px; }
.kd-code pre { margin: 0; padding: 12px 14px; overflow-x: auto; font: 400 15px/24px var(--font-mono); }
.kd-table { overflow-x: auto; }
.kd .k-table { font: inherit; } .kd .k-table th { font: 600 .85em/1.4 var(--font-sans); color: var(--ink-2); } .kd .k-table td, .kd .k-table th { padding: .45em .8em; }
.kd-mark { box-shadow: -10px 0 0 -7px var(--warn); }
`;
