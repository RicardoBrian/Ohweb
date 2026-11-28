// 스크래치 파일 저장소 — 선생님 구글 드라이브(Apps Script 웹앱 ohinfo/apps-script/scratch-drive.gs).
// 주소와 비밀값은 Firestore kaka_config/scratch {url, secret}(선생님만 읽는 문서)에 있고, 서버는 서비스 계정으로 읽는다.
// 선생님 화면 k/settings.html 에서 [연결]하면 채워진다.
let cache = null, cacheAt = 0;

export async function scratchStore(db) {
  if (!cache || Date.now() - cacheAt > 60000) { cache = await db.get('kaka_config/scratch'); cacheAt = Date.now(); }
  const c = cache;
  if (!c?.url || !c?.secret) return null;
  const call = async (action, body) => {
    let r;
    try { r = await fetch(c.url, { method: 'POST', redirect: 'follow', headers: { 'Content-Type': 'text/plain' }, body: JSON.stringify({ action, secret: c.secret, ...body }) }); }
    catch (e) { throw new Error('드라이브 저장 서버에 연결할 수 없습니다.'); }
    const text = await r.text();
    let d; try { d = JSON.parse(text); } catch { throw new Error(`드라이브 저장 서버 응답 오류 (HTTP ${r.status})`); }
    if (d.error) throw new Error('드라이브: ' + d.error);
    return d;
  };
  return {
    save: (folders, name, b64) => call('save', { folders, name, b64 }),
    load: fileId => call('load', { fileId }),
    trash: fileId => call('trash', { fileId }).catch(e => console.error('scratch trash:', e.message)),
  };
}
export const resetScratchStore = () => { cache = null; };
