// 앱 버전 확인. 배포된 화면 파일의 내용으로 버전값을 만든다(빌드·수동 버전 올리기 없이, 배포하면 값이 저절로 바뀜).
// 홈 화면 앱(iOS)은 새로고침 동작이 없어서, 앱이 이 값을 보고 스스로 새 버전을 불러온다(app.js 의 checkUpdate).
const FILES = ['/', '/app.js', '/ohlog.css', '/theme.css', '/admin-sky.css', '/firebase-config.js'];
let memo = { at: 0, v: '' }; // 같은 인스턴스 안에서만 잠깐(30초) 기억 — 배포하면 새 인스턴스라 바로 바뀐다

export async function onRequestGet({ request, env }) {
  if (!memo.v || Date.now() - memo.at > 30000) {
    const parts = await Promise.all(FILES.map(async (f) => {
      const r = await env.ASSETS.fetch(new URL(f, request.url));
      return r.ok ? new Uint8Array(await r.arrayBuffer()) : new Uint8Array();
    }));
    const all = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
    let o = 0;
    for (const p of parts) { all.set(p, o); o += p.length; }
    const dig = new Uint8Array(await crypto.subtle.digest('SHA-256', all));
    memo = { at: Date.now(), v: [...dig.slice(0, 6)].map((b) => b.toString(16).padStart(2, '0')).join('') };
  }
  return new Response(JSON.stringify({ v: memo.v }), {
    headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' },
  });
}
