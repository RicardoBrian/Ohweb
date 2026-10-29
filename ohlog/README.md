# ohlog — 수업일지

컴시간 시간표 위에 반별 수업 기록과 진도를 남기는 교사용 사이트(Cloudflare Pages).

## 구조

| 경로 | 역할 |
|---|---|
| `functions/api/comci.js` | 컴시간 프록시. 학교 검색, 교사별 주간 시간표 (Cloudflare 캐시: `/st` 1시간, 주 10분) |
| `public/index.html` · `public/app.js` | 앱(로그인 → 학교·이름 신청 → 관리자 승인 → 일지) |
| `public/theme.css` · `public/admin-sky.css` | **ohweb/public에서 복사**. 디자인을 바꾸면 같이 복사한다 |
| `public/firebase-config.js` | ohweb과 같은 Firebase 프로젝트(ohweb-93062), Auth·Firestore만 |

데이터는 `classlog_users/{uid}`(프로필·승인 상태)와 그 아래 `logs`·`plans`·`extras`.
규칙은 레포 루트 `ohweb-firestore.rules`의 "수업일지" 부분.

## 배포 전에 한 번

1. **Firestore 규칙**: `ohweb-firestore.rules`를 Firebase 콘솔 → Firestore → 규칙에 붙여넣고 게시.
   붙여넣기 전 `ohweb-rules-test`에서 `npm run test:rules`.
2. **로그인 허용 도메인**: Firebase 콘솔 → Authentication → 설정 → 승인된 도메인에
   `classnotee.pages.dev`(와 붙일 커스텀 도메인)를 추가. 안 하면 Google 로그인 팝업이 `auth/unauthorized-domain`으로 실패한다.
3. 관리자(`qjatjr7575@gmail.com`)는 가입하면 바로 승인되고, 메뉴에 "승인 관리"가 생긴다.

## 테스트

`ohweb-rules-test`에서 `npm run test:classlog`. 실제 `comci.js`와 화면을 에뮬레이터로 돌린다.
화면 캡처가 필요하면 `SHOTS=폴더` 환경변수를 준다(휴대폰·태블릿·노트북·큰 모니터 해상도별).

## 컴시간 해석

컴시간은 비공식이라 형식이 바뀔 수 있다. 설정 화면 맨 아래 "해석: … 겹침 N"에서 겹침이 0이 아니면
교사/과목 해석이 틀렸을 수 있다(`comci.js`의 `DECODERS`). 접속 문제는 `/api/comci?diag=1`.
