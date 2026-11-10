// 수행평가 제출물 보기 — 내려받지 않고 그 자리에서 팝업으로 연다.
//   그림: 크게 보기(누르면 원래 크기 ↔ 화면 맞춤)
//   글(txt·구글 문서): 본문
//   스크래치(.sb3): TurboWarp 스캐폴딩으로 바로 실행(초록 깃발·멈춤)
// 학생 화면(ohinfo/public)과 교사 화면(ohweb/public)이 같은 파일을 쓴다 — 두 벌을 같게 유지한다.
// d = Apps Script(score-drive.gs) 'file' 응답 { name, mimeType, text? , data?(base64) }

const SCAFFOLDING = 'https://cdn.jsdelivr.net/npm/@turbowarp/scaffolding@0.4.0/dist/scaffolding-min.js';
let scaffoldingLoad = null;
const esc = s => String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

export function fileKind(d) {
  const name = String(d?.name || '').toLowerCase(), mime = String(d?.mimeType || '');
  if (d?.text != null) return 'text';
  if (/^image\//.test(mime) || /\.(png|jpe?g|gif|webp|bmp)$/.test(name)) return 'image';
  if (name.endsWith('.sb3') || name.endsWith('.sb2')) return 'scratch';
  return 'other';
}
export function bytesOf(d) { return Uint8Array.from(atob(d.data || ''), c => c.charCodeAt(0)); }
export function objectUrl(d) { return URL.createObjectURL(new Blob([bytesOf(d)], { type: d.mimeType || 'application/octet-stream' })); }

function injectStyle() {
  if (document.getElementById('sv-style')) return;
  const st = document.createElement('style');
  st.id = 'sv-style';
  st.textContent = `
  .sv-back { position: fixed; inset: 0; z-index: 30000; background: rgba(15,18,32,0.72); display: flex; align-items: center; justify-content: center; padding: 14px; }
  .sv-card { background: var(--bg-elevated, #fff); color: var(--text, #1d1d1f); border-radius: 18px; width: min(980px, 100%); max-height: 94vh; display: flex; flex-direction: column; box-shadow: 0 24px 70px rgba(0,0,0,0.4); overflow: hidden; }
  .sv-head { display: flex; align-items: center; gap: 10px; padding: 12px 14px 10px 18px; border-bottom: 1px solid var(--border, #e5e5ea); }
  .sv-title { flex: 1; min-width: 0; font-weight: 800; font-size: 0.92rem; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .sv-btn { font: inherit; font-size: 0.85rem; font-weight: 700; border: 1px solid var(--border, #ddd); background: var(--surface, #f5f5f7); color: var(--text, #1d1d1f); border-radius: 50px; padding: 6px 14px; cursor: pointer; display: inline-flex; align-items: center; gap: 6px; }
  .sv-btn.go { background: #22b14c; border-color: #22b14c; color: #fff; }
  .sv-btn.stop { background: #e5484d; border-color: #e5484d; color: #fff; }
  .sv-x { width: 34px; height: 34px; border-radius: 50%; border: none; background: none; cursor: pointer; color: var(--sub, #666); font-size: 1.3rem; line-height: 1; }
  .sv-body { flex: 1; overflow: auto; display: flex; align-items: center; justify-content: center; background: var(--sky-chip, #f2f3f7); min-height: 200px; }
  .sv-body img { max-width: 100%; max-height: calc(94vh - 70px); display: block; cursor: zoom-in; }
  .sv-body img.full { max-width: none; max-height: none; cursor: zoom-out; }
  .sv-body.top { align-items: flex-start; justify-content: flex-start; }
  .sv-text { white-space: pre-wrap; word-break: break-word; font-size: 0.92rem; line-height: 1.6; padding: 18px 20px; width: 100%; margin: 0; font-family: inherit; }
  .sv-stage { width: min(100%, calc((94vh - 80px) * 4 / 3)); aspect-ratio: 4 / 3; background: #fff; position: relative; }
  .sv-msg { padding: 30px 20px; text-align: center; color: var(--sub, #666); font-size: 0.9rem; }`;
  document.head.appendChild(st);
}

function loadScaffolding() {
  if (window.Scaffolding) return Promise.resolve(window.Scaffolding);
  if (!scaffoldingLoad) scaffoldingLoad = new Promise((ok, fail) => {
    const s = document.createElement('script');
    s.src = SCAFFOLDING;
    s.onload = () => (window.Scaffolding ? ok(window.Scaffolding) : fail(new Error('player')));
    s.onerror = () => { scaffoldingLoad = null; fail(new Error('player')); };
    document.head.appendChild(s);
  });
  return scaffoldingLoad;
}

// T: 화면 문구 { close, start, stop, loadingPlayer, cantPlay, cantPreview }
export function openViewer(d, T = {}) {
  injectStyle();
  const t = { close: '닫기', start: '시작', stop: '멈춤', loadingPlayer: '스크래치 실행기를 불러오는 중…', cantPlay: '이 프로젝트를 실행하지 못했어요.', cantPreview: '이 형식은 미리 볼 수 없어요.', ...T };
  const kind = fileKind(d);
  const back = document.createElement('div');
  back.className = 'sv-back';
  back.innerHTML = `<div class="sv-card" role="dialog" aria-label="${esc(d.name)}">
    <div class="sv-head"><div class="sv-title">${esc(d.name)}</div><span class="sv-tools"></span><button class="sv-x" title="${esc(t.close)}" aria-label="${esc(t.close)}">×</button></div>
    <div class="sv-body"></div></div>`;
  document.body.appendChild(back);
  const body = back.querySelector('.sv-body'), tools = back.querySelector('.sv-tools');
  const urls = [];
  let player = null;
  const close = () => {
    try { player?.stopAll?.(); player?.vm?.quit?.(); } catch { /* 이미 멈춤 */ }
    urls.forEach(u => URL.revokeObjectURL(u));
    back.remove(); document.removeEventListener('keydown', onKey);
  };
  const onKey = e => { if (e.key === 'Escape') close(); };
  document.addEventListener('keydown', onKey);
  back.addEventListener('click', e => { if (e.target === back || e.target.closest('.sv-x')) close(); });

  if (kind === 'image') {
    const u = objectUrl(d); urls.push(u);
    body.innerHTML = `<img src="${u}" alt="">`;
    body.querySelector('img').onclick = e => { e.target.classList.toggle('full'); body.classList.toggle('top', e.target.classList.contains('full')); };
  } else if (kind === 'text') {
    body.classList.add('top');
    body.innerHTML = `<pre class="sv-text">${esc(d.text)}</pre>`;
  } else if (kind === 'scratch') {
    body.innerHTML = `<div class="sv-msg">${esc(t.loadingPlayer)}</div>`;
    (async () => {
      try {
        const S = await loadScaffolding();
        if (!back.isConnected) return;
        player = new S.Scaffolding();
        player.width = 480; player.height = 360; player.resizeMode = 'preserve-ratio';
        player.shouldConnectPeripherals = false;
        player.setup();
        body.innerHTML = '<div class="sv-stage"></div>';
        player.appendTo(body.querySelector('.sv-stage'));
        await player.loadProject(bytesOf(d).buffer);
        if (!back.isConnected) return;
        tools.innerHTML = `<button class="sv-btn go">🏁 ${esc(t.start)}</button> <button class="sv-btn stop">⏹ ${esc(t.stop)}</button>`;
        tools.querySelector('.go').onclick = () => player.greenFlag();
        tools.querySelector('.stop').onclick = () => player.stopAll();
        player.relayout();
        player.greenFlag();
      } catch (e) {
        console.error(e);
        if (back.isConnected) body.innerHTML = `<div class="sv-msg">${esc(t.cantPlay)}</div>`;
      }
    })();
  } else {
    body.innerHTML = `<div class="sv-msg">${esc(t.cantPreview)}</div>`;
  }
  return close;
}
