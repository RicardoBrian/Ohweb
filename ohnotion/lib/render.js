/**
 * 그린 페이지(HTML 조각) 캐시 — 노션 API를 학생 수와 상관없이 가끔만 부르게 한다.
 *
 *   신선본  FRESH_TTL(2분) — 이 안이면 노션에 안 묻고 바로 보낸다.
 *   예비본  STALE_TTL(7일) — 신선본이 만료되면 예비본을 바로 보내고, 뒤에서
 *           새로 그려 둘 다 갈아 끼운다(stale-while-revalidate). 노션 API가
 *           장애여도 학생은 마지막으로 성공한 내용을 본다.
 *   둘 다 없을 때만 학생이 그리기를 기다린다(처음 한 번, 또는 7일 넘게 아무도 안 봤을 때).
 *
 * 같은 isolate 안에서 같은 페이지를 동시에 그리지 않게 진행 중인 작업을 공유한다
 * (반 전체가 동시에 열어도 노션 요청은 한 번).
 * Cache API는 Cloudflare 데이터센터별이라, 같은 학교 학생들은 같은 캐시를 쓴다.
 */
import { renderPage } from './notion.js';
import { cacheGet, cachePut } from './shared.js';

const FRESH_TTL = 120;
const STALE_TTL = 7 * 86400;
const inflight = new Map();

const keys = (pageId, slug) => ({
  fresh: `render:${slug}:${pageId}`,
  stale: `render-stale:${slug}:${pageId}`,
});

function renderAndStore(context, pageId, slug) {
  const k = keys(pageId, slug);
  if (inflight.has(k.fresh)) return inflight.get(k.fresh);
  const job = (async () => {
    const t0 = Date.now();
    const data = await renderPage(context.env.NOTION_TOKEN, pageId, slug);
    data.renderedAt = new Date().toISOString();
    data.renderMs = Date.now() - t0;
    await Promise.all([
      cachePut(context, k.fresh, data, FRESH_TTL),
      cachePut(context, k.stale, data, STALE_TTL),
    ]);
    return data;
  })();
  inflight.set(k.fresh, job);
  job.finally(() => inflight.delete(k.fresh)).catch(() => {});
  return job;
}

/**
 * → { data, source } — source: 'fresh' | 'stale' | 'live'.
 * 예비본조차 없는데 그리기가 실패하면 예외를 그대로 던진다.
 * force면 캐시를 건너뛰고 지금 그린다(관리 페이지의 "지금 갱신").
 */
export async function getRendered(context, pageId, slug, { force = false, onBackgroundError } = {}) {
  const k = keys(pageId, slug);
  if (!force) {
    const fresh = await cacheGet(context, k.fresh);
    if (fresh) return { data: fresh, source: 'fresh' };
    const stale = await cacheGet(context, k.stale);
    if (stale) {
      // 일단 예비본을 보내고, 새로 그리기는 응답 뒤에 마저 한다.
      context.waitUntil(renderAndStore(context, pageId, slug).catch((e) => {
        console.error('노션 다시 그리기 실패(예비본 사용 중):', e?.message || e);
        return onBackgroundError?.(e);
      }));
      return { data: stale, source: 'stale' };
    }
  }
  try {
    return { data: await renderAndStore(context, pageId, slug), source: 'live' };
  } catch (e) {
    if (force) throw e;
    const stale = await cacheGet(context, k.stale);
    if (stale) return { data: stale, source: 'stale', error: e };
    throw e;
  }
}
