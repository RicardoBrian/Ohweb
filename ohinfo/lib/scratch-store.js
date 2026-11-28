// 스크래치 작품 저장소 — Firestore. 설계: PLATFORM-DESIGN.md §8.10
//   scratch_projects/{자동ID}  { json(project.json 글자), assets('a.svg,b.wav'), bytes, blocks, sprites, createdAt }
//   scratch_assets/{md5.확장자} { bytes, parts, d(base64) }  + 큰 파일은 조각 scratch_assets/{md5.확장자}_1, _2 … { d }
// 그림·소리는 내용의 MD5가 이름이라 같은 파일(기본 고양이 등)은 모든 학생이 한 벌만 같이 쓴다.
// 그래서 저장할 때마다 쌓이는 건 project.json(보통 수 KB)뿐이다. 서버가 MD5를 직접 확인해 남의 파일을 덮어쓰지 못한다.
import { md5 } from '../public/kaka/md5.js';

export const ASSET_RE = /^[a-f0-9]{32}\.(svg|png|jpg|jpeg|bmp|gif|wav|mp3)$/;
export const MAX_JSON = 900 * 1024;          // Firestore 문서 하나 1MiB 안
export const MAX_ASSET = 10 * 1024 * 1024;   // 그림·소리 하나 10MB 까지
const PART = 600 * 1024;                     // 조각 하나(base64 로 800KB)

export function b64ToBytes(b64) {
  const s = atob(b64), u = new Uint8Array(s.length);
  for (let i = 0; i < s.length; i++) u[i] = s.charCodeAt(i);
  return u;
}
export function bytesToB64(u) {
  let s = '';
  for (let i = 0; i < u.length; i += 0x8000) s += String.fromCharCode.apply(null, u.subarray(i, i + 0x8000));
  return btoa(s);
}

// project.json → 쓰는 그림·소리 이름, 블록·스프라이트 수
export function inspect(project) {
  const targets = Array.isArray(project?.targets) ? project.targets : [];
  const ids = new Set();
  let blocks = 0;
  for (const t of targets) {
    for (const a of [...(t.costumes || []), ...(t.sounds || [])]) {
      const id = String(a.md5ext || (a.assetId && a.dataFormat ? `${a.assetId}.${a.dataFormat}` : '')).toLowerCase();
      if (id) ids.add(id);
    }
    blocks += Object.keys(t.blocks || {}).length;
  }
  return { assets: [...ids], blocks, sprites: targets.filter(t => !t.isStage).length };
}

export async function missingAssets(db, ids) {
  const got = await db.getMany(ids.map(id => `scratch_assets/${id}`));
  return ids.filter(id => !got[`scratch_assets/${id}`]);
}

export async function putAsset(db, id, bytes) {
  if (!ASSET_RE.test(id)) throw new Error('그림·소리 이름이 올바르지 않습니다.');
  if (bytes.length > MAX_ASSET) throw new Error('그림·소리 하나가 너무 큽니다(10MB까지).');
  if (await md5(bytes) !== id.split('.')[0]) throw new Error('그림·소리 내용이 이름과 다릅니다.');
  const parts = Math.max(1, Math.ceil(bytes.length / PART));
  for (let i = parts - 1; i >= 1; i--) await db.set(`scratch_assets/${id}_${i}`, { d: bytesToB64(bytes.subarray(i * PART, (i + 1) * PART)) });
  await db.set(`scratch_assets/${id}`, { bytes: bytes.length, parts, d: bytesToB64(bytes.subarray(0, PART)) }); // 머리 문서는 마지막에(있으면 다 있는 것)
}

export async function getAssets(db, ids) {
  const heads = await db.getMany(ids.map(id => `scratch_assets/${id}`));
  const more = [];
  for (const id of ids) { const h = heads[`scratch_assets/${id}`]; for (let i = 1; i < (h?.parts || 1); i++) more.push(`scratch_assets/${id}_${i}`); }
  const rest = await db.getMany(more);
  const out = {};
  for (const id of ids) {
    const h = heads[`scratch_assets/${id}`]; if (!h) continue; // 없으면 편집기가 스크래치 라이브러리에서 찾는다
    if ((h.parts || 1) === 1) { out[id] = h.d || ''; continue; }
    const segs = [b64ToBytes(h.d || '')];
    for (let i = 1; i < h.parts; i++) segs.push(b64ToBytes(rest[`scratch_assets/${id}_${i}`]?.d || ''));
    const all = new Uint8Array(segs.reduce((n, s) => n + s.length, 0));
    let o = 0; for (const s of segs) { all.set(s, o); o += s.length; }
    out[id] = bytesToB64(all);
  }
  return out;
}

export async function loadProject(db, id) {
  const p = await db.get(`scratch_projects/${id}`);
  if (!p) return null;
  return { json: p.json, assets: await getAssets(db, String(p.assets || '').split(',').filter(Boolean)) };
}
