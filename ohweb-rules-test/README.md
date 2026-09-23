# ohweb-firestore.rules 테스트

`ohweb-firestore.rules`를 Firebase 콘솔에 붙여넣기 **전에** 반드시 돌린다.
규칙을 잠그다가 정상 기능(로그인·시험·질문 등)이 깨지는 걸 미리 잡기 위한 것.

```
cd ohweb-rules-test
npm install
npm test        # Java 필요 (Firestore 에뮬레이터)
```

- "── 공격 ──" 항목은 전부 `✅ 차단`, "── 정상 기능 ──" 항목은 전부 `✅ 허용`이어야 한다.
- 학생 페이지에 Firestore 접근을 새로 추가하면, 그 접근을 "정상 기능"에 한 줄 추가한다.
