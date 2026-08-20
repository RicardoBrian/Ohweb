# SeatChange

교실 자리 배정. 제약조건을 지키면서 좌석을 배정하고, 프로젝터로 뽑기 연출을 띄운다.

`kakainfo.com` 계열 앱들과 같은 규격이다 — 빌드 스텝 없음, `public/`이 그대로 배포,
`theme.css`는 `design-reference/`와 동일한 사본.

## 구조

```
public/
  index.html   화면
  app.js       상태 관리 · 렌더링
  app.css      페이지 전용 스타일 (theme.css 토큰만 사용)
  arrange.js   배정 엔진 — DOM 의존 없음
  theme.css    공용 디자인 시스템 (design-reference에서 복사)
arrange.test.mjs  엔진 테스트
```

## 배정 엔진

단순 셔플이 아니다. 교실에서 실제로 필요한 건 "완전 랜덤"이 아니라
"시력 나쁜 애는 앞줄, 저 둘은 떼어놓고, 지난번이랑 다르게"이기 때문에
제약 만족 문제로 푼다.

지원하는 규칙:

- **고정석** — 특정 학생을 특정 자리에 못박음
- **앞줄 고정** — 시력·키 배려. 앞줄로 칠 줄 수를 지정 가능
- **짝 금지** — 두 학생이 짝꿍이 되지 않게. 통로 건너편은 짝으로 치지 않음
- **직전과 다른 자리** — 전원 이동
- **직전과 다른 짝** — 지난번 짝꿍 회피

MRV(선택지가 적은 학생부터) 휴리스틱 + 백트래킹으로 탐색한다.
규칙이 서로 충돌해서 답이 없으면 포기하지 않고 **완화 가능한 규칙을 정해진
순서로 하나씩 끄면서** 다시 시도하고, 무엇을 못 지켰는지 화면에 알린다.
교실에서는 "배정 불가"보다 "이건 못 지켰습니다"가 쓸모 있다.

`seed`를 결과와 함께 저장하므로 같은 입력 + 같은 seed = 같은 결과다.
"다시 돌려봐" 요구에 재현이 되고, 공정성 시비도 막을 수 있다.

## 테스트

```sh
node seatchange/arrange.test.mjs
```

## 현재 한계

- 저장은 **localStorage**다. 브라우저를 바꾸면 명단이 따라오지 않는다.
  다른 앱들처럼 Firestore를 붙이려면 `app.js`의 `save()` / `load()`만 갈아끼우면 된다.
  (그러려면 Firebase 프로젝트를 하나 만들고 `firebase-config.js`를 추가해야 한다.)
- 공유 링크가 아직 없다. 위의 Firestore 작업이 선행되어야 한다.
- 인쇄는 브라우저 인쇄를 그대로 쓴다. PNG 내보내기는 아직 없다.

## Firestore 규칙

`firestore.rules`가 이 앱의 실제 방어선이다. 로그인 화면이 없는 대신 익명
인증(Anonymous Auth)으로 브라우저마다 uid를 받아 좌석표 소유자로 기록한다 —
사용자는 로그인을 의식하지 않지만 규칙은 소유자를 구분할 수 있다.

- **읽기는 열려 있다** — 공유 링크를 아는 사람이 배치도를 볼 수 있어야 하므로.
  문서 ID(자동 생성 긴 문자열)가 사실상 비밀번호 역할을 한다.
- **쓰기는 만든 사람만.** `create`는 `ownerUid == request.auth.uid`를 강제하고,
  `update`는 기존 문서의 `ownerUid`와 일치해야 하며 그 값 자체는 바꿀 수 없다.
- 스키마도 검증한다 — 허용된 필드 외에는 거부, `rows`/`cols`는 1~12,
  `updatedAt`은 서버 시각과 일치해야 함(클라이언트가 시각을 위조 못 하게).
- 정의하지 않은 컬렉션은 기본적으로 전부 거부된다.

**절대 테스트 모드(`allow read, write: if request.time < timestamp.date(...)`)를
쓰지 않는다.** 그 규칙은 지정한 날짜가 지나면 조건이 거짓이 되어 전 사이트가
갑자기 전부 거부로 뒤집힌다 — 30일 뒤 접근이 막히는 원인이 이것이다.

규칙은 `rules-test/`에서 실제 Firestore 에뮬레이터로 검증한다 (자세한 건
`rules-test/README.md`):

```sh
cd seatchange
npm --prefix rules-test install
npx firebase-tools emulators:exec --only firestore --project demo-seatchange \
  "node rules-test/firestore.rules.test.mjs"
```

Firestore를 아직 연결하지 않은 지금(저장은 localStorage)도 규칙 파일을 미리
넣어둔 이유는, Firestore를 붙이는 순간 테스트 모드로 시작하고 싶은 유혹을
없애기 위해서다. 붙일 때 콘솔의 Rules 탭에 이 파일 내용을 그대로 붙여넣으면 된다.
