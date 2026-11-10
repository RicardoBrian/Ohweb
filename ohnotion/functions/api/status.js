/**
 * Cloudflare Pages Function — GET /api/status
 *
 * 사이트가 지금 닫혀 있는지(관리 페이지 "학생 화면 닫기"). 학생 화면(view.js)과
 * 닫힘 안내 화면이 30초마다 물어서, 바뀌면 스스로 새로고침한다.
 * → { closed: bool }
 */
import { getSiteStatus } from '../../lib/shared.js';

export async function onRequestGet(context) {
  const { closed } = await getSiteStatus(context);
  return new Response(JSON.stringify({ closed }), {
    headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' },
  });
}
