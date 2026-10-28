# ohweb-firestore.rules · 학생 로그인 테스트

`ohweb-firestore.rules`를 Firebase 콘솔에 붙여넣기 **전에**, 그리고 학생 로그인
코드(`ohinfo/public/student-auth.js`)를 고친 뒤에 반드시 돌린다. 규칙을 잠그다가
정상 기능(로그인·가입·시험·질문 등)이 깨지는 걸 미리 잡기 위한 것.

```
cd ohweb-rules-test
npm install
npm test        # Java 필요 (Firestore 에뮬레이터)
```

- `rules.test.mjs` — 규칙 단위 테스트. "── 공격 ──"은 전부 `✅ 차단`, "── 정상 기능 ──"은 전부 `✅ 허용`.
- `login.e2e.mjs` — 실제 `student-auth.js`를 Auth·Firestore 에뮬레이터에서 실행(가입·로그인·잠금·옛 계정 전환).
- `exam.e2e.mjs` — 실제 `ohinfo/public`을 브라우저(Chromium)로 띄워 로그인 → 시험 목록(열림·대상 필터, 코드 안 내려감) → 입장(코드·입장 마감 확인) → 언어 전환 중 코드 작성 → 새로고침(타이머 유지·답안 복원) → 제출 → 시간 초과 재입장 자동 제출 → 순서 바뀐 문항 채점·정답 공개 시점까지. 시험 서버(`ohinfo/functions/api/exam.js`)는 실제 코드를 에뮬레이터에 붙여 돌리고, 코드 실행 서버만 모의 응답. Chromium 경로가 따로 있으면 `CHROMIUM_PATH=...`.
- 둘 다 규칙 1단계(students 읽기 공개)와 2단계(`PHASE2` 주석의 잠금 규칙)를 각각 돌린다.
- 학생 페이지에 Firestore 접근을 새로 추가하면 그 접근을 "정상 기능"에 한 줄 추가한다.
