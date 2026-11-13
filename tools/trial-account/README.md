# kakainfo 체험 계정 (`tools/trial-account`)

바깥 사람들이 kakainfo.com 학생 화면을 직접 써 보게 하는 공용 계정.

- 로그인: kakainfo.com → **체험학교 / 1학년 / 1반 / 1번**, 비밀번호 **kakainfo**
- 들어 있는 것: 게시판(`체험학교 정보`) 글 3개, 연습 시험 1개, 설문 1개(친구 응답 3개), 질문하기 대화 1개, AI 실험실 모둠, 수행평가 점수 2개. 반 친구 4명은 가상 학생(로그인 불가).

| 명령 | 하는 일 |
|---|---|
| `node tools/trial-account/trial.mjs` | 미리보기 — 지울 것·만들 것 개수만. 쓰지 않음 |
| `node tools/trial-account/trial.mjs --write` | 처음 만들기 = 되돌리기. 체험 사용자가 남긴 글·시험 제출·설문·AI 작업을 지우고 견본 내용과 비밀번호를 처음대로 |

- 접속: 이 컴퓨터의 firebase CLI 로그인(`firebase login`)으로 운영 DB 에 직접(채점 도구와 같은 `../exam-grading/firestore.mjs`). `FIRESTORE_EMULATOR_HOST` 가 있으면 에뮬레이터(Auth 는 건너뜀).
- 지우는 대상은 체험학교 것만 찾는다: 게시판 `classTitle == '체험학교 정보'`, 시험 `asId == 'trial-as1'`, AI `asId == 'trial-ai1'`, 점수 `trial-score1·2`, 학생 ID `trial-*` 의 질문·설문.
- 공용 계정 보호
  - 규칙(`ohweb-firestore.rules` 의 `isTrial()`): 이 계정은 체험학교 게시판·AI 모둠만 읽고 쓴다. `trial-*` 학생은 비밀번호 오류로 잠기지 않고, 사진을 못 바꾼다. 다른 학생에게는 영향 없음.
  - 학생 화면(`ohinfo/public/student-auth.js`): `trial-*` 는 비밀번호 변경을 막는다.
- 남는 것: 학생 이름 공개 읽기(`students` 규칙 1단계)는 체험 계정과 상관없이 원래 열려 있다. 번역·코드 실행 같은 서버 기능은 실제로 돈다.
- 시험은 한 번 제출하면 다시 못 푼다 → 사람들이 많이 써 본 뒤 `--write` 로 되돌린다.
