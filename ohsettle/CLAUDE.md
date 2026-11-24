# 정산(ohsettle) 작업 지침

친구끼리 쓰는 모임 정산. 주소 `settle.kakainfo.com`(Cloudflare Pages 프로젝트 `ohsettle`, 출력 폴더 `public`). DB 는 Firebase `ohsettle-10d43` 하나(학교 DB 와 따로).

- 로그인·관리자 승인 없음. **프로젝트 문서 ID 가 곧 초대 링크**(`settle.kakainfo.com/#<ID>`). 규칙이 목록 조회를 막아서 ID 를 모르면 아무것도 못 본다.
- 화면은 `public/index.html` 하나. 이 기기에서 연 프로젝트는 localStorage `ohsettle_recent` 에만 남는다.
- 데이터: `settle_trips/{ID}` { name, members[] } → `expenses`(date, desc, amount 정수, payer, memberData) · `transfers`(date, sender, receiver, amount, memo).
  `memberData` 는 `"철수,영희"`(똑같이 나눔, 남는 원은 결제자부터 1원씩) 또는 `"철수:3000,영희:7000"`(직접 입력, 합계 = 금액). 그래서 참여자 이름에 `,` `:` 금지.
- 예전 판 문서(code·status·memo 필드, 소수 금액, `status: 'done'`)도 그대로 열린다.
- 규칙 `firestore.rules` 는 자동 배포되지 않는다. 고치면 `ohweb-rules-test` 에서 `npm run test:settle` 통과 후 `firebase deploy --only firestore:rules --project ohsettle-10d43`(이 폴더의 `firebase.json`).
- 견본 `ohinfo/public/vibe/settle/` 은 자동 생성. 단 그 안의 `firebase-config.js`(가짜 DB 견본 데이터)는 손으로 관리한다.
- 배포: Cloudflare Pages 가 main 에 `ohsettle/*` 이 바뀔 때만 다시 빌드한다. 사이트가 옛 화면이면(예: 프로젝트를 머지 전에 만들어 첫 빌드가 옛 커밋) 이 폴더 아래를 고쳐 main 에 올리면 새로 빌드된다. 옛 화면은 목록 조회를 해서 새 규칙에 막힌다(`Missing or insufficient permissions`).
