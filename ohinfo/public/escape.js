// 사용자 입력을 HTML에 넣을 때 쓰는 공용 유틸.
//
// 예전엔 페이지마다 escHtml/fmtMsg를 따로 정의했고(ohdlet.html엔 둘 다
// 있었는데 구현이 서로 달랐다), 다른 페이지엔 아예 없었다. 그래서 어떤
// 자리는 이스케이프되고 어떤 자리는 안 되는 상태가 됐다 — 게시글 작성자
// 이름과 프로필 사진이 그대로 들어가던 게 대표적이다.

// & < > 뿐 아니라 따옴표까지 막는다. 예전 구현은 & < > 만 처리해서
// <img src="${값}"> 같은 속성 자리에 넣으면 따옴표로 빠져나가
// onerror= 를 주입할 수 있었다.
export function escHtml(s) {
  return String(s ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

// 본문 텍스트 → HTML. 이스케이프를 먼저 하고, 그 다음 http(s) 링크만
// <a>로 바꾼다. 순서가 반대면 링크로 감싼 부분이 이스케이프를 피해간다.
export function fmtMsg(text) {
  if (!text) return '';
  return escHtml(text).replace(
    /(https?:\/\/[^\s<]+)/g,
    '<a href="$1" target="_blank" rel="noopener noreferrer">$1</a>'
  );
}

// 프로필 사진 URL 검증. students 컬렉션은 아직 쓰기가 열려 있어서 학생이
// 자기 photoUrl에 아무 문자열이나 넣을 수 있고, 그게 <img src>로 들어가면
// 그 게시판을 보는 모든 사람에게 스크립트가 돈다. 우리가 실제로 쓰는 두
// 형태(업로드한 base64, https 이미지 주소)만 통과시키고 나머지는 버린다.
export function safePhotoUrl(url) {
  const s = String(url ?? '').trim();
  if (/^data:image\/(png|jpe?g|gif|webp|avif);base64,[A-Za-z0-9+/=\s]+$/i.test(s)) return s;
  if (/^https:\/\/[^\s"'<>]+$/i.test(s)) return s;
  return '';
}
