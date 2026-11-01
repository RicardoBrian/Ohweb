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

// onclick="fn(…)" 같은 인라인 핸들러에 넣는 문자열 인자. JS 문자열 리터럴로
// 만든 뒤 HTML 이스케이프한다 — '${id}'처럼 따옴표로만 감싸면 값 안의
// 따옴표로 빠져나가 스크립트를 실행할 수 있다(게시글·설문 문서 ID는
// 누구나 만들 수 있다).
export function jsArg(s) {
  return escHtml(JSON.stringify(String(s ?? '')));
}

// 링크(href, iframe src)용 — https만 통과. javascript: 주소는 클릭하거나
// iframe에 넣는 순간 이 페이지 권한으로 실행된다.
export function safeHttpsUrl(url) {
  const s = String(url ?? '').trim();
  return /^https:\/\/[^\s"'<>]+$/i.test(s) ? s : '';
}

// 게시글 첨부 이미지(<img src>)용 — 업로드한 base64 이미지나 https 주소만.
export const safeImgUrl = safePhotoUrl;

// Firestore 문서 ID 검사. 우리 코드가 만드는 ID(자동 생성 ID 등)는 전부
// 영숫자/_/- 라서, 이 밖의 문자가 든 문서는 누군가 일부러 만든 것이다.
export const SAFE_ID = /^[A-Za-z0-9_-]{1,128}$/;
