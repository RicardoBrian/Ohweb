/**
 * Cloudflare Pages Function — GET /api/file?b={블록ID} | ?p={페이지ID}(표지)  (&k=icon: 아이콘)
 *
 * 노션에 올린 이미지·파일을 우리 도메인으로 내려 준다.
 *   - 노션 업로드 파일 주소는 1시간이면 만료되는 서명 주소라 HTML에 그대로 못
 *     넣는다. 여기서 그때그때 블록을 읽어 새 주소로 받아 온다.
 *   - 학생 브라우저가 노션/S3에 직접 붙지 않는다(학교망 차단·429 회피).
 *   - HTML 파일: 노션은 보안 때문에 다운로드만 시키는데, 여기서는 실행되게
 *     text/html로 내려 준다. 대신 CSP sandbox로 "출처 없는" 격리 상태에서만
 *     돌게 해서, 같은 도메인의 관리 페이지(로그인 정보)에 절대 손대지 못한다.
 *
 * 받은 파일은 50분 캐싱한다(서명 주소 만료 전에 갈아 끼움).
 */
import { makeClient, explainError } from '../../lib/notion.js';

const CACHE_SECONDS = 50 * 60;
const SANDBOX = 'sandbox allow-scripts allow-forms allow-popups allow-modals allow-downloads';

function fileUrlOf(obj) {
  if (!obj) return null;
  if (obj.type === 'file') return obj.file?.url || null;
  if (obj.type === 'external') return obj.external?.url || null;
  return null;
}

function guessType(name, upstream) {
  const ext = (name.match(/\.([a-z0-9]+)$/i)?.[1] || '').toLowerCase();
  const map = {
    html: 'text/html; charset=utf-8', htm: 'text/html; charset=utf-8',
    css: 'text/css; charset=utf-8', js: 'text/javascript; charset=utf-8', json: 'application/json',
    txt: 'text/plain; charset=utf-8', csv: 'text/csv; charset=utf-8',
    png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', gif: 'image/gif', webp: 'image/webp', svg: 'image/svg+xml',
    pdf: 'application/pdf', mp4: 'video/mp4', webm: 'video/webm', mp3: 'audio/mpeg', wav: 'audio/wav',
  };
  return map[ext] || (upstream && upstream !== 'binary/octet-stream' ? upstream : 'application/octet-stream');
}

export async function onRequestGet(context) {
  const { request, env } = context;
  const params = new URL(request.url).searchParams;
  const b = (params.get('b') || '').toLowerCase();
  const p = (params.get('p') || '').toLowerCase();
  const id = b || p;
  if (!/^[0-9a-f]{32}$/.test(id) || !env.NOTION_TOKEN) return new Response('잘못된 요청', { status: 400 });

  const cache = caches.default;
  const cacheKey = new Request(new URL(`/__notion-file/${b ? 'b' : 'p'}/${id}/${params.get('k') || ''}`, request.url));
  const hit = await cache.match(cacheKey);
  if (hit) return hit;

  try {
    const client = makeClient(env.NOTION_TOKEN);
    let url;
    let name = '';
    const kind = params.get('k');   // 'icon'이면 콜아웃/페이지 아이콘
    if (b) {
      const block = await client.block(id);
      const v = block[block.type] || {};
      if (kind === 'icon') url = fileUrlOf(v.icon);
      else if (block.type === 'embed') url = v.url;
      else url = fileUrlOf(v);
      name = v.name || '';
    } else {
      const page = await client.page(id);
      url = fileUrlOf(kind === 'icon' ? page.icon : page.cover);
    }
    if (!url || !/^https:/i.test(url)) return new Response('파일이 없어요', { status: 404 });
    if (!name) {
      try { name = decodeURIComponent(new URL(url).pathname.split('/').pop()); } catch { name = ''; }
    }

    const upstream = await fetch(url);
    if (!upstream.ok) return new Response(`파일을 받지 못했어요 (${upstream.status})`, { status: 502 });

    const type = guessType(name, upstream.headers.get('content-type'));
    const headers = new Headers({
      'Content-Type': type,
      'Cache-Control': `public, max-age=${CACHE_SECONDS}`,
      'X-Content-Type-Options': 'nosniff',
      'Content-Disposition': `inline; filename*=UTF-8''${encodeURIComponent(name || 'file')}`,
    });
    // 스크립트가 돌 수 있는 형식은 격리해서 내려 준다.
    if (/^(text\/html|image\/svg\+xml|text\/xml|application\/xhtml)/.test(type)) headers.set('Content-Security-Policy', SANDBOX);

    const res = new Response(upstream.body, { status: 200, headers });
    context.waitUntil(cache.put(cacheKey, res.clone()));
    return res;
  } catch (e) {
    console.error('notion 파일 실패:', e?.message || e);
    return new Response(explainError(e), { status: 502, headers: { 'Content-Type': 'text/plain; charset=utf-8' } });
  }
}
