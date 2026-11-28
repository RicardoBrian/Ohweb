// 선생님 화면 ↔ 스크래치 저장소(선생님 구글 드라이브의 Apps Script 웹앱, ohinfo/apps-script/scratch-drive.gs).
// 주소·비밀값은 Firestore kaka_config/scratch(선생님만 읽음). settings.html 에서 연결한다.
import { db, doc, getDoc, setDoc } from './k.js?v=1128';

let cfg;
export async function scratchCfg(fresh) {
  if (cfg === undefined || fresh) { const s = await getDoc(doc(db, 'kaka_config', 'scratch')); cfg = s.exists() ? s.data() : null; }
  return cfg?.url && cfg?.secret ? cfg : null;
}
export async function gas(action, body = {}, c) {
  c = c || await scratchCfg();
  if (!c) throw new Error('스크래치 저장소가 연결되지 않았습니다(설정)');
  const r = await fetch(c.url, { method: 'POST', redirect: 'follow', headers: { 'Content-Type': 'text/plain' }, body: JSON.stringify({ action, secret: c.secret, ...body }) });
  const d = await r.json().catch(() => ({ error: `응답 오류 (HTTP ${r.status})` }));
  if (d.error) throw new Error(d.error);
  return d;
}
export const fileToB64 = f => new Promise((ok, no) => { const r = new FileReader(); r.onload = () => ok(String(r.result).split(',')[1] || ''); r.onerror = no; r.readAsDataURL(f); });

// 처음 연결: 비밀값을 만들어 Apps Script 에 한 번 알려 주고(register), 같은 값을 Firestore 에 둔다.
export async function connect(url) {
  url = String(url || '').trim();
  if (!/^https:\/\/script\.google\.com\/macros\/s\/[\w-]+\/exec$/.test(url) && !/^http:\/\/(localhost|127\.0\.0\.1):\d+\//.test(url)) throw new Error('웹 앱 URL 형식이 아닙니다(https://script.google.com/macros/s/…/exec)');
  const secret = Array.from(crypto.getRandomValues(new Uint8Array(32)), b => b.toString(16).padStart(2, '0')).join('');
  const r = await fetch(url, { method: 'POST', redirect: 'follow', headers: { 'Content-Type': 'text/plain' }, body: JSON.stringify({ action: 'register', secret }) });
  const d = await r.json().catch(() => ({ error: '웹 앱이 응답하지 않습니다. 배포할 때 "액세스: 모든 사용자"인지 확인하세요.' }));
  if (d.error) throw new Error(d.error);
  const c = { url, secret };
  // 저장·불러오기·휴지통 한 바퀴로 드라이브 권한까지 확인
  const t = await gas('save', { folders: ['연결 확인'], name: '연결 확인', b64: btoa('kaka') }, c);
  if ((await gas('load', { fileId: t.fileId }, c)).b64 !== btoa('kaka')) throw new Error('드라이브에 저장한 것을 다시 읽지 못했습니다');
  await gas('trash', { fileId: t.fileId }, c);
  await setDoc(doc(db, 'kaka_config', 'scratch'), { url, secret, connectedAt: new Date().toISOString() });
  cfg = c;
}
