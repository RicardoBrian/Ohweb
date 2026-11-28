// 선생님 화면의 스크래치 작품 읽기·쓰기(Firestore). 학생 저장은 서버(/api/lesson)가 같은 형식으로 한다 — ohinfo/lib/scratch-store.js
//   scratch_projects/{id} { json, assets('a.svg,b.wav'), bytes, blocks, sprites, createdAt }
//   scratch_assets/{md5.확장자} { bytes, parts, d } + 조각 {id}_1 … { d }
// 편집기는 다른 사이트(kakainfo.com/scratch/editor.html)라 postMessage 로 주고받는다.
import { db, doc, getDoc, setDoc, addDoc, collection } from './k.js?v=1128';
import { md5Hex } from 'https://kakainfo.com/kaka/md5.js?v=1128';

export const EDITOR = 'https://kakainfo.com/scratch/editor.html?locale=ko';
const ORIGIN = 'https://kakainfo.com';
const PART = 600 * 1024;
const b64ToBytes = b64 => { const s = atob(b64), u = new Uint8Array(s.length); for (let i = 0; i < s.length; i++) u[i] = s.charCodeAt(i); return u; };
const bytesToB64 = u => { let s = ''; for (let i = 0; i < u.length; i += 0x8000) s += String.fromCharCode.apply(null, u.subarray(i, i + 0x8000)); return btoa(s); };

// 작품 읽기 → { json, assets: { id: base64 } }
export async function loadProject(id) {
  const p = (await getDoc(doc(db, 'scratch_projects', id))).data();
  if (!p) throw new Error('작품을 찾을 수 없습니다');
  const ids = String(p.assets || '').split(',').filter(Boolean);
  const assets = {};
  await Promise.all(ids.map(async a => {
    const h = (await getDoc(doc(db, 'scratch_assets', a))).data(); if (!h) return;
    if ((h.parts || 1) === 1) { assets[a] = h.d; return; }
    const segs = [b64ToBytes(h.d)];
    for (let i = 1; i < h.parts; i++) segs.push(b64ToBytes((await getDoc(doc(db, 'scratch_assets', `${a}_${i}`))).data()?.d || ''));
    const all = new Uint8Array(segs.reduce((n, s) => n + s.length, 0)); let o = 0; for (const s of segs) { all.set(s, o); o += s.length; }
    assets[a] = bytesToB64(all);
  }));
  return { json: p.json, assets };
}

// 작품 쓰기(시작 파일) → 새 scratch_projects ID. 그림·소리는 없는 것만, MD5 가 맞는 것만.
export async function saveProject({ json, assets }) {
  const ids = Object.keys(assets);
  for (const id of ids) {
    if ((await getDoc(doc(db, 'scratch_assets', id))).exists()) continue;
    const bytes = b64ToBytes(assets[id]);
    if (md5Hex(bytes) !== id.split('.')[0]) throw new Error(`그림·소리 ${id} 내용이 이름과 다릅니다`);
    const parts = Math.max(1, Math.ceil(bytes.length / PART));
    for (let i = parts - 1; i >= 1; i--) await setDoc(doc(db, 'scratch_assets', `${id}_${i}`), { d: bytesToB64(bytes.subarray(i * PART, (i + 1) * PART)) });
    await setDoc(doc(db, 'scratch_assets', id), { bytes: bytes.length, parts, d: bytesToB64(bytes.subarray(0, PART)) });
  }
  const p = JSON.parse(json), targets = p.targets || [];
  const blocks = targets.reduce((n, t) => n + Object.keys(t.blocks || {}).length, 0);
  const r = await addDoc(collection(db, 'scratch_projects'), { json, assets: ids.join(','), bytes: json.length, blocks, sprites: targets.filter(t => !t.isStage).length, createdAt: new Date().toISOString() });
  return r.id;
}

// 편집기 iframe 이 준비될 때까지
export const editorReady = frame => new Promise(ok => {
  const f = e => { if (e.data?.type === 'kaka-scratch-ready' && e.source === frame.contentWindow) { removeEventListener('message', f); ok(); } };
  addEventListener('message', f);
});
// 편집기에 보내고 답 기다리기
export const ask = (frame, msg, replyType) => new Promise((ok, no) => {
  const f = e => { if (e.data?.type === replyType && e.source === frame.contentWindow) { removeEventListener('message', f); e.data.ok ? ok(e.data) : no(new Error(e.data.error || '편집기 오류')); } };
  addEventListener('message', f);
  frame.contentWindow.postMessage(msg, ORIGIN);
});

// .sb3 파일 → 서버 형식. 숨긴 편집기에 한 번 띄워서 나눈다(스크래치 2 파일도 된다).
export async function unpackSb3(file) {
  const b64 = await new Promise((ok, no) => { const r = new FileReader(); r.onload = () => ok(String(r.result).split(',')[1] || ''); r.onerror = no; r.readAsDataURL(file); });
  const frame = document.createElement('iframe');
  frame.style.cssText = 'position:fixed;left:-3000px;top:0;width:1200px;height:800px;border:0';
  frame.src = EDITOR;
  const ready = editorReady(frame);
  document.body.append(frame);
  try { await ready; return await ask(frame, { type: 'kaka-scratch-unpack', b64 }, 'kaka-scratch-unpacked'); }
  finally { frame.remove(); }
}
