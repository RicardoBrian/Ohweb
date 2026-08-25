# oh sh.rt

Google 로그인으로 보호되는 관리 페이지와 누구나 접근 가능한 단축 URL을 제공하는
Cloudflare Pages 기반 URL 단축기입니다.

나머지 4개 앱(`ohweb`/`ohinfo`/`ohsettle`/`seatchange`)과 동일한 방식(Pages,
빌드 스텝 없음)으로 배포되고, 같은 Firebase 프로젝트(`ohweb-93062`)를 씁니다.
원래는 Cloudflare Workers + KV로 독립적으로 만들었었는데, Workers Builds(Git
연동 배포) 쪽에서 시크릿 바인딩 문제를 반복적으로 겪어서 검증된 Pages+Firebase
조합으로 다시 만들었습니다.

## 기능

- 관리 페이지(`/`)는 Google 로그인(관리자 계정 1개) 후에만 접근 가능
- 단축된 URL(`/코드`)은 누구나 접근 가능 (302 리다이렉트)
- 원본 URL 입력 시 자동 코드 생성, 또는 커스텀 코드 지정 가능
- 관리 페이지에서 링크 목록 조회 / 복사 / 삭제
- 별도 빌드 과정 없는 순수 HTML/CSS/JS + Pages Functions

## 도메인이 두 개다 — 관리 페이지와 단축 링크가 서로 다른 곳에 산다

| | 도메인 | 어느 프로젝트 |
|---|---|---|
| 관리 페이지 | `short.kakainfo.com` | `ohshrt` (이 폴더) |
| 단축 링크 | `kakainfo.com/코드` | **`ohinfo`** |

단축 링크는 학생들이 바로 열 수 있게 짧은 학생용 도메인(`kakainfo.com`)에
있어야 한다. 그런데 그 도메인은 ohinfo 프로젝트가 서빙하므로, 리다이렉트
Function은 `ohinfo/functions/[[code]].js`에 있다. 이 폴더에도 같은 파일을
두어서 `short.kakainfo.com/코드`로도 열리긴 하지만, 관리 페이지가 만들어
보여주는 링크는 항상 `kakainfo.com/코드`다(`public/app.js`의 `publicBase`).

두 Function은 같은 내용이라 한쪽을 고치면 다른 쪽도 같이 고쳐야 한다.

## 구조

```
public/
  index.html            관리 페이지 뼈대
  app.js                로그인 + 대시보드 (Firestore 클라이언트 SDK로 직접 CRUD)
  admin-auth.js         Google 로그인 (ohweb/public/admin-auth.js와 동일 패턴)
  firebase-config.js    ohweb-93062 프로젝트 설정
  style.css
functions/
  [[code]].js           단축코드 → 원본 URL 리다이렉트
                         (ohinfo/functions/[[code]].js와 동일한 사본)
```

데이터는 Firestore의 `short_links` 컬렉션에 저장됩니다 — 문서 ID가 단축 코드,
`url`/`createdAt` 필드를 가집니다. 규칙은 레포 루트의 `ohweb-firestore.rules`
참고 (`get`은 누구나, 쓰기/목록 조회는 관리자만).

## 배포

`CLOUDFLARE.md`의 다른 4개 앱과 동일한 절차입니다 — Workers & Pages → Create →
**Pages**(Workers 아님) → Connect to Git → Root directory `ohshrt`, Build
output directory `public`, Build command 비움.

Firebase 콘솔에서 `ohweb-93062`의 Authentication → Sign-in method에 Google이
켜져 있어야 하고, 로그인은 `qjatjr7575@gmail.com` 계정 하나만 허용됩니다
(`admin-auth.js`의 `ADMIN_EMAIL`).

커스텀 도메인은 `short.kakainfo.com`.
