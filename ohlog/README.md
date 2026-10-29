# ohlog — 수업일지

컴시간 시간표 위에 반별 수업 기록과 진도를 남기는 교사용 사이트(Cloudflare Pages).

## 구조

| 경로 | 역할 |
|---|---|
| `functions/api/comci.js` | 컴시간 프록시. 학교 검색, 교사별 주간 시간표 (Cloudflare 캐시: `/st` 1시간, 주 10분) |
| `public/index.html` · `public/app.js` | 앱(로그인 → 학교·이름 신청 → 관리자 승인 → 일지) |
| `public/theme.css` · `public/admin-sky.css` | **ohweb/public에서 복사**. 디자인을 바꾸면 같이 복사한다 |
| `public/firebase-config.js` | ohweb과 같은 Firebase 프로젝트(ohweb-93062), Auth·Firestore만 |

데이터는 `classlog_users/{uid}`(프로필·승인 상태)와 그 아래 `logs`·`plans`·`extras`, 그리고 `classlog_feedback`(피드백, 읽기는 관리자만).
규칙은 레포 루트 `ohweb-firestore.rules`의 "수업일지" 부분. **규칙을 고치면 Firebase 콘솔에 다시 붙여넣어 게시해야 한다.**

## 새 버전이 앱에 반영되는 방식
홈 화면 앱(iOS)은 새로고침이 없어서, 앱이 스스로 확인한다. `functions/api/version.js` 가 배포된 화면 파일 내용으로 버전값을 만들고(빌드·수동 버전 올리기 불필요),
`app.js` 의 `checkUpdate` 가 처음 열 때 기억한 값과 달라지면(앱으로 돌아올 때·10분마다·설정의 "앱 업데이트 확인") 새로 불러온다. 작성 중이면 "새 버전이 있어요" 알림줄만 띄운다.
화면 파일은 `_headers` 로 캐시하지 않는다. **화면 파일을 새로 추가하면 `version.js` 의 `FILES` 에 넣어야 변경이 감지된다.**

## 빠른 시작(홈 화면 앱)
켜자마자 로그인·Firestore 를 기다리지 않고, 지난번 승인된 계정이면 저장해 둔 시간표(`classlog:tt:*`)와 프로필(`classlog:last`)로 **먼저 화면을 그린다**(`bootFromCache`).
Firebase SDK 는 `index.html` 의 `modulepreload` 로 미리 받고 `app.js` 에서 늦게 불러오며(`sdkReady`), 일지 데이터가 도착하기 전(`S.live` 가 false)에는 일지·계획 쓰기를 막아 덮어쓰기를 방지한다.
`theme.css` 의 구글 폰트 `@import` 는 화면 그리기를 막아 뺐다. Firebase SDK 를 쓰는 새 코드는 반드시 `await sdkReady` 뒤에 둔다.

## 기능 요약
- 폰(홈 화면 앱)에서는 처음에 **시간표**가 열린다(`manifest.webmanifest` + iOS 메타). 시간표는 localStorage 에 보관해 컴시간이 느려도 바로 보인다.
- **학급·교사 시간표**: 학급별(담임 확인) / 교사별(다른 선생님 수업 확인). 보기 전용 — 일지는 내 수업(시간표·오늘)에서만 열린다.
- 일지 **진도**는 직접 적기가 기본이고, ▾ 로 계획표·이전 진도에서 고른다. 닫기 전 변경 확인, "저장 후 다음 수업".
- 학년은 칸 바탕 색, 과목은 이름 앞 점 색(옅게). 글자 크기는 설정에서 4단계.
- 우측 하단 푸터: 저작권·인스타·메일 + **피드백**(Firestore 저장 + ohinfo 질문방과 같은 Apps Script `notify` 로 텔레그램 알림).

## 배포 전에 한 번

1. **Firestore 규칙**: `ohweb-firestore.rules`를 Firebase 콘솔 → Firestore → 규칙에 붙여넣고 게시.
   붙여넣기 전 `ohweb-rules-test`에서 `npm run test:rules`.
2. **로그인 허용 도메인**: Firebase 콘솔 → Authentication → 설정 → 승인된 도메인에
   `classnotee.pages.dev`와 `classnote.gwansan.com`을 추가. 안 하면 Google 로그인 팝업이 `auth/unauthorized-domain`으로 실패한다.
3. 관리자(`qjatjr7575@gmail.com`)는 가입하면 바로 승인되고, 메뉴에 "승인 관리"가 생긴다.

## 테스트

`ohweb-rules-test`에서 `npm run test:classlog`. 실제 `comci.js`와 화면을 에뮬레이터로 돌린다.
화면 캡처가 필요하면 `SHOTS=폴더` 환경변수를 준다(휴대폰·태블릿·노트북·큰 모니터 해상도별).

## 컴시간 해석

컴시간은 비공식이라 형식이 바뀔 수 있다. 설정 화면 맨 아래 "해석: … 겹침 N"에서 겹침이 0이 아니면
교사/과목 해석이 틀렸을 수 있다(`comci.js`의 `DECODERS`). 접속 문제는 `/api/comci?diag=1`.
