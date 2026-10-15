/**
 * Notion API로 페이지를 읽어 HTML로 그린다.
 *
 * 왜 iframe이 아니라 이 방식인가: 학교는 학생 PC 전체가 공인 IP 하나를 같이
 * 쓴다. 반 전체가 노션(notion.site)을 직접 열면 노션이 그 IP를 "요청 과다"로
 * 보고 CSS/JS를 429로 거절해서 화면이 깨지거나 무한 새로고침에 빠졌다(실제
 * 콘솔에서 확인: _assets/*.js 429). 여기서는 학생 브라우저가 노션에 아예 접속하지
 * 않는다 — Cloudflare가 공식 API로 가끔 읽어 와 캐싱한 HTML만 받는다.
 *
 * 필요한 환경변수: NOTION_TOKEN (노션 내부 통합 시크릿, ntn_… / secret_…).
 * 그 통합을 "연결"한 페이지와 그 하위 페이지만 읽을 수 있다 — 연결한 페이지는
 * 이 사이트를 통해 누구나 볼 수 있게 된다는 뜻이기도 하다.
 *
 * Notion-Version은 2022-06-28로 고정한다(databases/{id}/query가 그대로 동작).
 */
import { escapeHtml } from './shared.js';

const API = 'https://api.notion.com/v1';
const NOTION_VERSION = '2022-06-28';
const MAX_DEPTH = 8;        // 중첩 블록을 이 깊이까지만 펼친다
const MAX_BLOCKS = 2000;    // 한 페이지에서 읽는 블록 수 상한(요청 수 폭주 방지)
const CONCURRENCY = 3;      // Notion API 권장: 초당 평균 3건

// ── 페이지 ID ──
const UUID_RE = /([0-9a-f]{8})-([0-9a-f]{4})-([0-9a-f]{4})-([0-9a-f]{4})-([0-9a-f]{12})/i;
/** 노션 링크·임베드 주소·iframe 코드·ID 자체에서 32자리 페이지 ID를 꺼낸다. 없으면 null. */
export function extractPageId(input) {
  if (!input) return null;
  let s = String(input).trim();
  const src = s.match(/\bsrc\s*=\s*["']?([^"'\s>]+)/i);
  if (/<iframe/i.test(s) && src) s = src[1];
  const uuid = s.match(UUID_RE);
  if (uuid) return uuid.slice(1).join('').toLowerCase();
  if (/^[0-9a-f]{32}$/i.test(s)) return s.toLowerCase();
  let path = s;
  try { path = new URL(s).pathname; } catch { /* 주소가 아니면 문자열 그대로 */ }
  for (const seg of path.split('/').reverse()) {
    const m = seg.match(/([0-9a-f]{32})$/i);
    if (m) return m[1].toLowerCase();
  }
  return null;
}
export const dashed = (id) => id.replace(/^(.{8})(.{4})(.{4})(.{4})(.{12})$/, '$1-$2-$3-$4-$5');
const plainId = (id) => String(id || '').replace(/-/g, '').toLowerCase();

// ── API 호출 (동시 3건, 429면 잠깐 쉬고 재시도) ──
export class NotionError extends Error {
  constructor(status, code, message) {
    super(message);
    this.status = status;
    this.code = code;
  }
}

export function makeClient(token) {
  let active = 0;
  const waiting = [];
  const acquire = () => new Promise((res) => {
    if (active < CONCURRENCY) { active++; res(); } else waiting.push(res);
  });
  const release = () => {
    const next = waiting.shift();
    if (next) next(); else active--;
  };

  async function call(path, { method = 'GET', body } = {}) {
    await acquire();
    try {
      for (let attempt = 0; ; attempt++) {
        const res = await fetch(API + path, {
          method,
          headers: {
            Authorization: `Bearer ${token}`,
            'Notion-Version': NOTION_VERSION,
            ...(body ? { 'Content-Type': 'application/json' } : {}),
          },
          body: body ? JSON.stringify(body) : undefined,
        });
        if (res.status === 429 && attempt < 2) {
          const wait = Math.min(Number(res.headers.get('retry-after')) || 1, 3);
          await new Promise((r) => setTimeout(r, wait * 1000));
          continue;
        }
        const data = await res.json().catch(() => ({}));
        if (!res.ok) throw new NotionError(res.status, data.code, data.message || `Notion API ${res.status}`);
        return data;
      }
    } finally {
      release();
    }
  }

  return {
    page: (id) => call(`/pages/${dashed(id)}`),
    block: (id) => call(`/blocks/${dashed(id)}`),
    async children(id) {
      const out = [];
      let cursor;
      do {
        const q = `?page_size=100${cursor ? `&start_cursor=${cursor}` : ''}`;
        const r = await call(`/blocks/${dashed(id)}/children${q}`);
        out.push(...r.results);
        cursor = r.has_more ? r.next_cursor : null;
      } while (cursor);
      return out;
    },
    async queryDatabase(id) {
      const r = await call(`/databases/${dashed(id)}/query`, { method: 'POST', body: { page_size: 100 } });
      return r.results;
    },
  };
}

/** NotionError를 관리자·학생이 알아들을 말로. */
export function explainError(e) {
  if (e instanceof NotionError) {
    if (e.status === 401) return 'NOTION_TOKEN이 틀렸어요(통합 시크릿을 다시 확인)';
    if (e.status === 404 || e.code === 'object_not_found') return '페이지를 찾을 수 없어요 — 노션에서 이 페이지에 통합(연결)을 추가했는지 확인';
    if (e.status === 429) return '노션 API 요청이 많아요 — 잠시 후 자동으로 다시 시도해요';
    return `노션 API 오류 (${e.status} ${e.code || ''})`.trim();
  }
  return `오류: ${e?.message || e}`;
}

// ── 블록 트리 읽기 ──
async function loadTree(client, rootId) {
  let count = 0;
  async function expand(blocks, depth) {
    count += blocks.length;
    await Promise.all(blocks.map(async (b) => {
      // 하위 페이지/DB는 링크만 그린다 — 그 안까지 읽지 않는다.
      if (!b.has_children || b.type === 'child_page' || b.type === 'child_database') return;
      if (depth >= MAX_DEPTH || count >= MAX_BLOCKS) return;
      // 동기화 블록 사본은 원본의 내용을 읽는다.
      const sourceId = b.type === 'synced_block' && b.synced_block?.synced_from?.block_id
        ? b.synced_block.synced_from.block_id : b.id;
      b.children = await client.children(sourceId).catch(() => []);
      await expand(b.children, depth + 1);
    }));
    return blocks;
  }
  const top = await client.children(rootId);
  await expand(top, 0);
  // 하위 DB는 항목 목록을 같이 읽어 둔다(제목 링크용).
  const dbs = [];
  (function walk(list) {
    for (const b of list || []) {
      if (b.type === 'child_database') dbs.push(b);
      walk(b.children);
    }
  })(top);
  await Promise.all(dbs.map(async (b) => {
    b.rows = await client.queryDatabase(b.id).catch(() => null);
  }));

  // "페이지 링크" 블록은 대상 페이지의 제목·아이콘을, 북마크는 웹페이지 미리보기
  // (제목·설명·대표 이미지)를 미리 읽어 둔다. 노션 화면처럼 카드로 그리기 위해.
  const links = [];
  const bookmarks = [];
  (function walk(list) {
    for (const b of list || []) {
      if (b.type === 'link_to_page' && b.link_to_page?.page_id) links.push(b);
      if (b.type === 'bookmark' || b.type === 'link_preview') bookmarks.push(b);
      walk(b.children);
    }
  })(top);
  await Promise.all([
    ...links.slice(0, 30).map(async (b) => {
      b.target = await client.page(b.link_to_page.page_id).catch(() => null);
    }),
    ...bookmarks.slice(0, 15).map(async (b) => {
      b.meta = await fetchLinkMeta(b[b.type]?.url);
    }),
  ]);
  return { blocks: top, count };
}

// 북마크 카드용 미리보기 — <title>, og:title/description/image, 파비콘. 3초 안에 못 받으면 주소만.
async function fetchLinkMeta(url) {
  if (!/^https?:\/\//i.test(url || '')) return null;
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 3000);
  try {
    const res = await fetch(url, { signal: ctrl.signal, redirect: 'follow', headers: { 'User-Agent': 'Mozilla/5.0 (compatible; kakainfo-note)', Accept: 'text/html' } });
    if (!res.ok || !/text\/html/i.test(res.headers.get('content-type') || '')) { res.body?.cancel?.(); return null; }
    const html = (await res.text()).slice(0, 200000);
    const attr = (re) => { const m = html.match(re); return m ? decodeEntities(m[1].trim()) : ''; };
    const meta = (name) => attr(new RegExp(`<meta[^>]+(?:property|name)=["']${name}["'][^>]*content=["']([^"']*)["']`, 'i'))
      || attr(new RegExp(`<meta[^>]+content=["']([^"']*)["'][^>]*(?:property|name)=["']${name}["']`, 'i'));
    const abs = (u) => { try { return u ? new URL(u, res.url || url).href : ''; } catch { return ''; } };
    return {
      title: meta('og:title') || attr(/<title[^>]*>([^<]*)<\/title>/i),
      description: meta('og:description') || meta('description'),
      image: abs(meta('og:image')),
      icon: abs(attr(/<link[^>]+rel=["'][^"']*icon[^"']*["'][^>]*href=["']([^"']+)["']/i)) || abs('/favicon.ico'),
    };
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}
function decodeEntities(s) {
  return s.replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#39;|&#x27;/g, "'");
}

// 노션 코드 블록 언어 → (Prism 이름, 화면에 보일 이름)
const CODE_LANGS = {
  'plain text': ['none', 'Plain Text'], python: ['python', 'Python'], javascript: ['javascript', 'JavaScript'],
  typescript: ['typescript', 'TypeScript'], java: ['java', 'Java'], c: ['c', 'C'], 'c++': ['cpp', 'C++'],
  'c#': ['csharp', 'C#'], html: ['markup', 'HTML'], xml: ['markup', 'XML'], css: ['css', 'CSS'],
  json: ['json', 'JSON'], bash: ['bash', 'Bash'], shell: ['bash', 'Shell'], powershell: ['powershell', 'PowerShell'],
  sql: ['sql', 'SQL'], markdown: ['markdown', 'Markdown'], kotlin: ['kotlin', 'Kotlin'], swift: ['swift', 'Swift'],
  go: ['go', 'Go'], rust: ['rust', 'Rust'], ruby: ['ruby', 'Ruby'], php: ['php', 'PHP'], r: ['r', 'R'],
  matlab: ['matlab', 'MATLAB'], 'arduino': ['arduino', 'Arduino'], yaml: ['yaml', 'YAML'], mermaid: ['none', 'Mermaid'],
  latex: ['latex', 'LaTeX'], scheme: ['scheme', 'Scheme'], lua: ['lua', 'Lua'], dart: ['dart', 'Dart'],
};
function codeLang(lang) {
  const key = String(lang || 'plain text').toLowerCase();
  if (CODE_LANGS[key]) return CODE_LANGS[key];
  const safe = key.replace(/[^a-z0-9+#-]/g, '');
  return [safe || 'none', lang || 'Plain Text'];
}

// 노션 데이터베이스 속성 값 → HTML (표 칸)
function propHtml(p, linkFor) {
  if (!p) return '';
  const pill = (o) => `<span class="pill c-${escapeHtml((o.color || 'default').replace(/[^a-z_]/g, ''))}_background">${escapeHtml(o.name)}</span>`;
  const text = (rt) => escapeHtml((rt || []).map((t) => t.plain_text).join(''));
  switch (p.type) {
    case 'title': return text(p.title);
    case 'rich_text': return text(p.rich_text);
    case 'number': return p.number ?? '';
    case 'select': return p.select ? pill(p.select) : '';
    case 'status': return p.status ? pill(p.status) : '';
    case 'multi_select': return (p.multi_select || []).map(pill).join(' ');
    case 'date': return p.date ? escapeHtml(p.date.start + (p.date.end ? ` → ${p.date.end}` : '')) : '';
    case 'checkbox': return p.checkbox ? '☑' : '☐';
    case 'url': return p.url ? `<a href="${escapeHtml(p.url)}" target="_blank" rel="noopener">${escapeHtml(p.url)}</a>` : '';
    case 'email': return escapeHtml(p.email || '');
    case 'phone_number': return escapeHtml(p.phone_number || '');
    case 'people': return escapeHtml((p.people || []).map((u) => u.name || '').join(', '));
    case 'created_time': return escapeHtml((p.created_time || '').slice(0, 10));
    case 'last_edited_time': return escapeHtml((p.last_edited_time || '').slice(0, 10));
    case 'formula': {
      const f = p.formula || {};
      return escapeHtml(String(f[f.type] ?? ''));
    }
    case 'relation': return (p.relation || []).length ? `${p.relation.length}개` : '';
    default: return '';
  }
}

export function pageTitle(page) {
  const props = page?.properties || {};
  for (const p of Object.values(props)) {
    if (p.type === 'title') return (p.title || []).map((t) => t.plain_text).join('');
  }
  return '';
}

// ── HTML 그리기 ──
function makeRenderer(ctx) {
  const { slug, headings = [] } = ctx;
  const pageHref = (id) => `/${encodeURIComponent(slug)}/${plainId(id)}`;
  const fileHref = (blockId) => `/api/file?b=${plainId(blockId)}`;
  let hasEquation = false;
  let hasCode = false;

  // 아이콘(이모지 / 외부 이미지 / 노션 업로드 이미지 / 사용자 이모지) → HTML
  function iconHtml(icon, fileUrl) {
    if (!icon) return '';
    if (icon.type === 'emoji') return escapeHtml(icon.emoji);
    const src = icon.type === 'external' ? icon.external?.url
      : icon.type === 'custom_emoji' ? icon.custom_emoji?.url
      : icon.type === 'file' ? fileUrl : '';
    return src ? `<img class="icon-img" src="${escapeHtml(src)}" alt="">` : '';
  }

  // 노션 내부 링크(/abc…, notion.so/…, notion.site/…)는 우리 주소로 돌린다.
  function linkHref(href) {
    if (!href) return '';
    const isInternal = href.startsWith('/') || /^https:\/\/([a-z0-9-]+\.)*notion\.(so|site)\//i.test(href);
    if (isInternal) {
      const id = extractPageId(href);
      if (id) return pageHref(id);
    }
    return /^(https?:|mailto:|tel:)/i.test(href) ? href : '';
  }

  function colorClass(color) {
    return color && color !== 'default' ? ` c-${color.replace(/[^a-z_]/g, '')}` : '';
  }

  function richText(list) {
    return (list || []).map((t) => {
      let inner;
      if (t.type === 'equation') {
        hasEquation = true;
        inner = `<span class="eq">${escapeHtml(t.equation.expression)}</span>`;
      } else if (t.type === 'mention' && (t.mention?.type === 'page' || t.mention?.type === 'database')) {
        const id = t.mention.page?.id || t.mention.database?.id;
        inner = `<a href="${pageHref(id)}" class="mention mention-page"><span class="mention-icon">📄</span><span class="mention-text">${escapeHtml(t.plain_text)}</span></a>`;
      } else if (t.type === 'mention' && t.mention?.type === 'user') {
        inner = `<span class="mention mention-user">@${escapeHtml(t.plain_text.replace(/^@/, ''))}</span>`;
      } else if (t.type === 'mention' && t.mention?.type === 'date') {
        inner = `<span class="mention mention-date">${escapeHtml(t.plain_text)}</span>`;
      } else if (t.type === 'mention' && (t.mention?.type === 'link_mention' || t.mention?.type === 'link_preview')) {
        const url = t.href || t.mention.link_mention?.href || t.mention.link_preview?.url || '';
        inner = /^https?:/i.test(url)
          ? `<a href="${escapeHtml(url)}" class="mention mention-link" target="_blank" rel="noopener">↗ ${escapeHtml(t.mention.link_mention?.title || t.plain_text)}</a>`
          : escapeHtml(t.plain_text);
      } else {
        inner = escapeHtml(t.plain_text).replace(/\n/g, '<br>');
      }
      const a = t.annotations || {};
      if (a.code) inner = `<code>${inner}</code>`;
      if (a.bold) inner = `<strong>${inner}</strong>`;
      if (a.italic) inner = `<em>${inner}</em>`;
      if (a.strikethrough) inner = `<s>${inner}</s>`;
      if (a.underline) inner = `<u>${inner}</u>`;
      if (a.color && a.color !== 'default') inner = `<span class="${colorClass(a.color).trim()}">${inner}</span>`;
      const href = t.type !== 'mention' && t.href ? linkHref(t.href) : '';
      if (href) {
        const external = !href.startsWith('/');
        inner = `<a href="${escapeHtml(href)}"${external ? ' target="_blank" rel="noopener"' : ''}>${inner}</a>`;
      }
      return inner;
    }).join('');
  }

  // 이미지·파일 주소: 노션 업로드 파일은 1시간이면 만료되는 서명 주소라
  // /api/file이 그때그때 새 주소로 받아서 내려 준다. 외부 링크는 그대로.
  function mediaSrc(block, obj) {
    if (!obj) return '';
    if (obj.type === 'external') return obj.external?.url || '';
    if (obj.type === 'file') return fileHref(block.id);
    return '';
  }
  function fileName(obj) {
    const url = obj?.file?.url || obj?.external?.url || '';
    if (obj?.name) return obj.name;
    try { return decodeURIComponent(new URL(url).pathname.split('/').pop()); } catch { return '파일'; }
  }
  const isHtmlName = (name) => /\.html?$/i.test(name || '');

  function caption(obj) {
    const c = richText(obj?.caption);
    return c ? `<figcaption>${c}</figcaption>` : '';
  }

  // 업로드한 HTML 파일 — 노션은 보안 때문에 다운로드만 시키지만, 여기서는
  // /api/file이 격리(sandbox)된 상태로 실행해 준다.
  function htmlFrame(block, obj) {
    const src = mediaSrc(block, obj);
    const name = fileName(obj);
    return `<figure class="htmlfile">
  <div class="htmlfile-bar"><span>📄 ${escapeHtml(name)}</span><a href="${escapeHtml(src)}" target="_blank" rel="noopener">새 탭에서 열기</a></div>
  <iframe src="${escapeHtml(src)}" sandbox="allow-scripts allow-forms allow-popups allow-modals allow-downloads" loading="lazy" title="${escapeHtml(name)}"></iframe>
  ${caption(obj)}
</figure>`;
  }

  function videoEmbed(url) {
    const yt = url.match(/(?:youtube\.com\/(?:watch\?v=|embed\/|shorts\/|live\/)|youtu\.be\/)([\w-]{6,})/);
    if (yt) {
      const t = url.match(/[?&]t=(\d+)/);
      return `https://www.youtube.com/embed/${yt[1]}${t ? `?start=${t[1]}` : ''}`;
    }
    const vimeo = url.match(/vimeo\.com\/(\d+)/);
    if (vimeo) return `https://player.vimeo.com/video/${vimeo[1]}`;
    return null;
  }

  // 노션이 임베드할 때처럼 서비스별로 "임베드용 주소"와 모양(비율/높이)을 고른다.
  function providerEmbed(url) {
    const video = videoEmbed(url);
    if (video) return { src: video, kind: 'ratio' };
    let m;
    if ((m = url.match(/docs\.google\.com\/presentation\/d\/([\w-]+)/))) return { src: `https://docs.google.com/presentation/d/${m[1]}/embed`, kind: 'ratio' };
    if ((m = url.match(/docs\.google\.com\/document\/d\/([\w-]+)/))) return { src: `https://docs.google.com/document/d/${m[1]}/preview`, kind: 'tall' };
    if ((m = url.match(/docs\.google\.com\/spreadsheets\/d\/([\w-]+)/))) return { src: `https://docs.google.com/spreadsheets/d/${m[1]}/preview`, kind: 'tall' };
    if (/docs\.google\.com\/forms\//.test(url)) {
      try {
        const u = new URL(url.replace(/\/edit(\?|#|$)/, '/viewform$1'));
        u.searchParams.set('embedded', 'true');
        return { src: u.href, kind: 'tall' };
      } catch { /* 아래 기본값 */ }
    }
    if ((m = url.match(/drive\.google\.com\/file\/d\/([\w-]+)/))) return { src: `https://drive.google.com/file/d/${m[1]}/preview`, kind: 'ratio' };
    if (/figma\.com\/(file|design|proto|board)\//.test(url)) return { src: `https://www.figma.com/embed?embed_host=share&url=${encodeURIComponent(url)}`, kind: 'ratio' };
    if ((m = url.match(/codepen\.io\/([\w-]+)\/pen\/([\w-]+)/))) return { src: `https://codepen.io/${m[1]}/embed/${m[2]}?default-tab=result`, kind: 'tall' };
    if ((m = url.match(/loom\.com\/share\/([\w-]+)/))) return { src: `https://www.loom.com/embed/${m[1]}`, kind: 'ratio' };
    if (/canva\.com\/design\/.+\/view/.test(url)) return { src: url.includes('embed') ? url : `${url}${url.includes('?') ? '&' : '?'}embed`, kind: 'ratio' };
    if (/\.pdf(\?|$)/i.test(url)) return { src: url, kind: 'tall' };
    return { src: url, kind: 'default' };
  }

  function embedFigure(url, captionObj, title = '임베드') {
    const e = providerEmbed(url);
    return `<figure class="embed embed-${e.kind}"><div class="embed-frame"><iframe src="${escapeHtml(e.src)}" loading="lazy" allowfullscreen allow="autoplay; fullscreen; picture-in-picture; clipboard-write" referrerpolicy="strict-origin-when-cross-origin" title="${escapeHtml(title)}"></iframe></div>${caption(captionObj)}<a class="embed-link" href="${escapeHtml(url)}" target="_blank" rel="noopener">↗ 새 탭에서 열기</a></figure>`;
  }

  function children(b) {
    return b.children?.length ? renderList(b.children) : '';
  }

  function block(b) {
    const v = b[b.type] || {};
    const color = colorClass(v.color);
    switch (b.type) {
      case 'paragraph': {
        const t = richText(v.rich_text);
        return `<p class="${color.trim()}">${t || '&nbsp;'}</p>${b.children ? `<div class="indent">${children(b)}</div>` : ''}`;
      }
      case 'heading_1': case 'heading_2': case 'heading_3': {
        const tag = { heading_1: 'h2', heading_2: 'h3', heading_3: 'h4' }[b.type];
        const h = `<${tag} id="h-${plainId(b.id)}" class="${color.trim()}">${richText(v.rich_text)}</${tag}>`;
        if (v.is_toggleable) return `<details class="toggle-h"><summary>${h}</summary>${children(b)}</details>`;
        return h;
      }
      case 'bulleted_list_item':
      case 'numbered_list_item':
        return `<li class="${color.trim()}">${richText(v.rich_text)}${children(b)}</li>`;
      case 'to_do':
        return `<div class="todo${v.checked ? ' done' : ''}"><span class="box">${v.checked ? '✔' : ''}</span><span>${richText(v.rich_text)}</span></div>${b.children ? `<div class="indent">${children(b)}</div>` : ''}`;
      case 'toggle':
        return `<details class="toggle${color}"><summary>${richText(v.rich_text)}</summary><div class="indent">${children(b)}</div></details>`;
      case 'quote':
        return `<blockquote class="${color.trim()}">${richText(v.rich_text)}${children(b)}</blockquote>`;
      case 'callout': {
        const icon = iconHtml(v.icon, `/api/file?b=${plainId(b.id)}&k=icon`);
        // 배경색이 없는 글자색 콜아웃은 노션처럼 테두리로 그린다.
        const cls = !color ? ' c-gray_background' : color.includes('_background') ? color : `${color} callout-outline`;
        return `<div class="callout${cls}">${icon ? `<span class="callout-icon">${icon}</span>` : ''}<div class="callout-body">${richText(v.rich_text)}${children(b)}</div></div>`;
      }
      case 'code': {
        hasCode = true;
        const [prism, label] = codeLang(v.language);
        const code = escapeHtml((v.rich_text || []).map((t) => t.plain_text).join(''));
        return `<figure class="code"><div class="code-head"><span class="code-lang">${escapeHtml(label)}</span><button type="button" class="code-copy">복사</button></div><pre class="language-${prism}"><code class="language-${prism}">${code}</code></pre>${caption(v)}</figure>`;
      }
      case 'equation':
        hasEquation = true;
        return `<div class="eq eq-block">${escapeHtml(v.expression)}</div>`;
      case 'divider':
        return '<hr>';
      case 'image': {
        const src = mediaSrc(b, v);
        return src ? `<figure class="image"><img src="${escapeHtml(src)}" alt="" loading="lazy">${caption(v)}</figure>` : '';
      }
      case 'video': {
        const url = v.type === 'external' ? v.external?.url || '' : '';
        if (url && videoEmbed(url)) return embedFigure(url, v, '동영상');
        const src = mediaSrc(b, v);
        return src ? `<figure class="video"><video src="${escapeHtml(src)}" controls preload="metadata"></video>${caption(v)}</figure>` : '';
      }
      case 'audio': {
        const src = mediaSrc(b, v);
        return src ? `<figure><audio src="${escapeHtml(src)}" controls preload="none"></audio>${caption(v)}</figure>` : '';
      }
      case 'pdf': {
        const src = mediaSrc(b, v);
        return src ? `<figure class="embed embed-tall"><div class="embed-frame"><iframe src="${escapeHtml(src)}" loading="lazy" title="PDF"></iframe></div>${caption(v)}<a class="embed-link" href="${escapeHtml(src)}" target="_blank" rel="noopener">↗ PDF 새 탭에서 열기</a></figure>` : '';
      }
      case 'file': {
        const name = fileName(v);
        if (isHtmlName(name)) return htmlFrame(b, v);
        const src = mediaSrc(b, v);
        return src ? `<a class="file" href="${escapeHtml(src)}" target="_blank" rel="noopener"><span class="file-icon">📎</span><span>${escapeHtml(name)}</span></a>${caption(v)}` : '';
      }
      case 'embed': {
        const url = v.url || '';
        if (/^https?:/i.test(url) && /\.html?(\?|$)/i.test(url) && /(file\.notion\.so|amazonaws\.com|notion-static|notionusercontent)/i.test(url)) {
          // 노션에 올린 HTML 파일을 임베드로 넣은 경우
          return htmlFrame(b, { type: 'file', file: { url }, name: fileName({ file: { url } }), caption: v.caption });
        }
        if (!/^https?:/i.test(url)) return '';
        return embedFigure(url, v);
      }
      case 'bookmark':
      case 'link_preview': {
        const url = v.url || '';
        if (!/^https?:/i.test(url)) return '';
        const m = b.meta || {};
        const host = (() => { try { return new URL(url).hostname; } catch { return url; } })();
        return `<a class="bookmark" href="${escapeHtml(url)}" target="_blank" rel="noopener">
  <span class="bm-text">
    <span class="bm-title">${escapeHtml(m.title || host)}</span>
    ${m.description ? `<span class="bm-desc">${escapeHtml(m.description)}</span>` : ''}
    <span class="bm-url">${m.icon ? `<img src="${escapeHtml(m.icon)}" alt="" loading="lazy" onerror="this.remove()">` : ''}${escapeHtml(url)}</span>
  </span>
  ${m.image ? `<span class="bm-image"><img src="${escapeHtml(m.image)}" alt="" loading="lazy" onerror="this.parentNode.remove()"></span>` : ''}
</a>${caption(v)}`;
      }
      case 'table': {
        const rows = (b.children || []).filter((r) => r.type === 'table_row');
        const body = rows.map((r, i) => {
          const cells = r.table_row.cells.map((c, j) => {
            const head = (v.has_column_header && i === 0) || (v.has_row_header && j === 0);
            return head ? `<th>${richText(c)}</th>` : `<td>${richText(c)}</td>`;
          }).join('');
          return `<tr>${cells}</tr>`;
        }).join('');
        return `<div class="table-wrap"><table>${body}</table></div>`;
      }
      case 'column_list':
        return `<div class="columns">${(b.children || []).map((c) => `<div class="column">${children(c)}</div>`).join('')}</div>`;
      case 'column':
        return `<div class="column">${children(b)}</div>`;
      case 'synced_block':
        return children(b);
      case 'child_page':
        return `<a class="subpage" href="${pageHref(b.id)}"><span class="subpage-icon">📄</span><span class="subpage-title">${escapeHtml(v.title || '제목 없음')}</span></a>`;
      case 'link_to_page': {
        const id = v.page_id || v.database_id;
        if (!id) return '';
        const t = b.target;
        const ic = t ? iconHtml(t.icon, '') : '';
        return `<a class="subpage" href="${pageHref(id)}"><span class="subpage-icon">${ic || '📄'}</span><span class="subpage-title">${escapeHtml(t ? pageTitle(t) || '제목 없음' : '연결된 페이지')}</span></a>`;
      }
      case 'child_database': {
        const rows = b.rows;
        const head = `<h4 class="db-title">${escapeHtml(v.title || '데이터베이스')}</h4>`;
        if (!rows) return `<section class="database">${head}<p class="muted">항목을 불러오지 못했어요</p></section>`;
        if (!rows.length) return `<section class="database">${head}<p class="muted">항목이 없어요</p></section>`;
        // 제목 열 + 나머지 속성 최대 5개(첫 항목 기준 순서)
        const props = Object.entries(rows[0].properties || {});
        const titleKey = props.find(([, p]) => p.type === 'title')?.[0];
        const others = props.filter(([k, p]) => k !== titleKey && !['rollup', 'files', 'button', 'unique_id', 'verification'].includes(p.type)).slice(0, 5).map(([k]) => k);
        const th = [titleKey, ...others].filter(Boolean).map((k) => `<th>${escapeHtml(k)}</th>`).join('');
        const tr = rows.map((r) => {
          const title = `<td class="db-name"><a href="${pageHref(r.id)}"><span class="subpage-icon">${iconHtml(r.icon, '') || '📄'}</span>${escapeHtml(pageTitle(r) || '제목 없음')}</a></td>`;
          return `<tr>${title}${others.map((k) => `<td>${propHtml(r.properties?.[k])}</td>`).join('')}</tr>`;
        }).join('');
        return `<section class="database">${head}<div class="table-wrap"><table class="db-table"><thead><tr>${th}</tr></thead><tbody>${tr}</tbody></table></div></section>`;
      }
      case 'table_of_contents': {
        if (!headings.length) return '';
        const items = headings.map((h) => `<a class="toc-${h.level}" href="#h-${h.id}">${escapeHtml(h.text)}</a>`).join('');
        return `<nav class="toc${color}">${items}</nav>`;
      }
      case 'breadcrumb':
        return '';
      default:
        return '';
    }
  }

  // 연속된 목록 항목은 <ul>/<ol> 하나로 묶는다.
  function renderList(blocks) {
    let out = '';
    let open = null;
    for (const b of blocks) {
      const tag = b.type === 'bulleted_list_item' ? 'ul' : b.type === 'numbered_list_item' ? 'ol' : null;
      if (tag !== open) {
        if (open) out += `</${open}>`;
        if (tag) out += `<${tag}>`;
        open = tag;
      }
      out += block(b);
    }
    if (open) out += `</${open}>`;
    return out;
  }

  return { renderList, richText, iconHtml, hasEquation: () => hasEquation, hasCode: () => hasCode };
}

/**
 * 페이지 하나를 읽어 { title, icon, coverUrl, html, blocks, hasEquation } 로.
 * slug는 하위 페이지 링크(/{slug}/{id})를 만드는 데 쓴다.
 */
export async function renderPage(token, pageId, slug) {
  const client = makeClient(token);
  const [page, tree] = await Promise.all([client.page(pageId), loadTree(client, pageId)]);
  // 목차 블록용: 페이지 안의 제목들을 미리 모은다.
  const headings = [];
  (function walk(list) {
    for (const b of list || []) {
      const lv = { heading_1: 1, heading_2: 2, heading_3: 3 }[b.type];
      if (lv) headings.push({ id: plainId(b.id), level: lv, text: (b[b.type].rich_text || []).map((t) => t.plain_text).join('') });
      if (b.type !== 'child_page' && b.type !== 'child_database') walk(b.children);
    }
  })(tree.blocks);
  const r = makeRenderer({ slug, headings });
  const html = r.renderList(tree.blocks);
  const icon = page.icon?.type === 'emoji' ? page.icon.emoji : '';
  const iconImg = !icon && page.icon ? r.iconHtml(page.icon, `/api/file?p=${plainId(pageId)}&k=icon`) : '';
  let coverUrl = '';
  if (page.cover?.type === 'external') coverUrl = page.cover.external.url;
  else if (page.cover?.type === 'file') coverUrl = `/api/file?p=${plainId(pageId)}`;
  return {
    title: pageTitle(page) || '제목 없음',
    icon,
    iconImg,
    coverUrl,
    html,
    blocks: tree.count,
    hasEquation: r.hasEquation(),
    hasCode: r.hasCode(),
    lastEdited: page.last_edited_time || null,
    publicUrl: page.public_url || page.url || '',
  };
}
