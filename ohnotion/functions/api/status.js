/**
 * Cloudflare Pages Function — GET /api/status?slug={주소}
 *
 * 그 주소가 지금 숨겨져 있는지(관리 페이지 목록의 ⏸). 학생 화면(view.js)과 닫힘 안내
 * 화면이 30초마다 물어서, 바뀌면 스스로 새로고침한다.
 * → { closed: bool }
 */
import { isClosed } from '../../lib/shared.js';

export async function onRequestGet(context) {
  const slug = (new URL(context.request.url).searchParams.get('slug') || '').normalize('NFC');
  const closed = slug ? await isClosed(context, slug) : false;
  return new Response(JSON.stringify({ closed }), {
    headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' },
  });
}
