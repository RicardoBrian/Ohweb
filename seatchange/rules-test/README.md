# Firestore 규칙 테스트

`../firestore.rules`를 실제 Firestore 에뮬레이터로 검증한다. 규칙을 고칠 때마다
이 테스트를 돌려서 의도한 대로 막고 여는지 확인한다 — 규칙 문법은 조용히
틀린 방향으로 통과되기 쉽다(예: `allow write` 하나가 `create`와 `update`를
동시에 열어버리는 식).

## 실행

`firebase.json`이 `seatchange/`(이 폴더의 부모)를 프로젝트 루트로 보고
`firestore.rules`를 가리키므로, 에뮬레이터는 반드시 `seatchange/`에서 띄운다.
Java가 있어야 에뮬레이터가 돌아간다.

```sh
cd seatchange
npm --prefix rules-test install
npx firebase-tools emulators:exec --only firestore --project demo-seatchange \
  "node rules-test/firestore.rules.test.mjs"
```

처음 실행하면 `firebase-tools`와 Firestore 에뮬레이터 jar를 내려받느라 시간이
걸린다. 통과하면 다음이 출력된다:

```
통과 13 / 실패 0
```
