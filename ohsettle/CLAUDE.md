# 정산(ohsettle) 작업 지침

친구끼리 쓰는 모임 정산. **배포 원본은 따로 있는 비공개 레포 `RicardoBrian/ohsettle`**(로컬 `~/code/ohsettle`, settle.kakainfo.com 은 그 레포 main 에서 빌드, 관리 화면 admin.html 도 거기에만). 이 폴더는 견본(`kakainfo.com/vibe/settle`)을 만들기 위한 사본이다 — 비공개 레포라 Actions 가 못 받아 와서. **고칠 때는 그 레포를 고치고 `public/index.html`·`firestore.rules` 를 여기에도 똑같이 복사한다.** DB 는 Firebase `ohsettle-10d43`.

- 로그인·관리자 승인 없음. **프로젝트 문서 ID 가 곧 초대 링크**(`settle.kakainfo.com/#<ID>`). 규칙이 목록 조회를 막아서 ID 를 모르면 아무것도 못 본다.
- 화면은 `public/index.html` 하나. 이 기기에서 연 프로젝트는 localStorage `ohsettle_recent` 에만 남는다.
- 데이터: `settle_trips/{ID}` { name, members[] } → `expenses`(date, desc, amount 정수, payer, memberData) · `transfers`(date, sender, receiver, amount, memo).
  `memberData` 는 `"철수,영희"`(똑같이 나눔, 남는 원은 결제자부터 1원씩) 또는 `"철수:3000,영희:7000"`(직접 입력, 합계 = 금액). 그래서 참여자 이름에 `,` `:` 금지.
- 예전 판 문서(code·status·memo 필드, 소수 금액, `status: 'done'`)도 그대로 열린다.
- 규칙 `firestore.rules` 는 자동 배포되지 않는다(목록 조회는 관리자 구글 계정만). 고치면 `npm run test:settle`(여기) 또는 그 레포 `rules-test` 통과 후 `firebase deploy --only firestore:rules --project ohsettle-10d43`.
- 견본 `ohinfo/public/vibe/settle/` 은 자동 생성. 단 그 안의 `firebase-config.js`(가짜 DB 견본 데이터)는 손으로 관리한다.
