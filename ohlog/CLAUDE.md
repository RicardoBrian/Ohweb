# 수업일지(ohlog) 작업 지침

주소: `classnote.gwansan.com` (Cloudflare Pages `classnotee`). DB: Firebase `ohweb-93062` 의 `classlog_users`·`classlog_feedback` (`DB.md`).
고친 뒤에는 `ohweb-rules-test` 에서 `npm run test:classlog` 를 통과시키고 PR 을 만들어 main 에 합친다.
`ohlog/public/` 을 바꾸면 견본(`ohinfo/public/vibe/classlog`)은 Actions `vibe-build` 가 자동으로 맞춘다.

## 수업일지(ohlog) — 컴시간 시간표
- 컴시간은 비공식 사이트라 구조가 바뀔 수 있다. 시간표 오류는 대부분 `ohlog/functions/api/comci.js` 의 `readBoot`·`bootText`(접속 정보 읽기) 문제다.
- 2026-11: 컴시간이 `/st` 의 스크립트를 난독화했다(20KB → 69KB, `sc_data` 등이 사라짐). 그래서 스크립트를 못 읽으면 마지막 정상 접속 정보(`KNOWN_BOOT`, 읽을 때마다 캐시에 90일 저장)로 시도한다. 응답의 `debug.boot` 가 `known`/`lastgood` 이면 이 경로로 받은 것이다.
- 2026-11-03: 데이터 주소도 바뀜(옛 주소 → HTTP 520). `/th`(컴시간교사.kr)도 같은 난독화. 그래서 GitHub Actions `comci-boot`(`.github/workflows/comci-boot.yml`, 1시간마다)가 진짜 브라우저로 `/st` 를 열어 학교를 선택하고, 페이지가 보내는 요청에서 route·search·prefix 를 뽑아 `ohlog/lib/comci-boot.js` 에 커밋한다(바뀐 때만). `debug.boot` 가 `captured` 면 이 값. 실패하면 Actions 실행의 `comci-capture` 아티팩트(화면·요청 기록)부터 본다.
- 2026-11-04: 컴시간은 접속 주소를 **하루에도 여러 번** 바꾼다(바뀌면 옛 주소는 즉시 520). 그래서 서버가 captured 값으로 실패하면 바로 워크플로를 실행시키고(`ohlog/lib/github.js` `kickCapture`, 3분에 한 번), 새 값은 배포를 기다리지 않고 GitHub main 의 `comci-boot.js` 를 직접 읽어 쓴다(`readCaptured`, 1분 캐시). 앱은 `diag.recheck` 면 90·120·180초 뒤 스스로 다시 받고, 세 번 다 실패해야 자동 보고한다.
- 자동 확인 상태는 `/api/comci-sync`(GET 상태·경고, POST 다시 켜고 지금 실행 — 3분에 한 번). 관리자 화면 '승인 관리'의 '컴시간 자동 확인' 카드가 이것을 쓰고, 꺼짐·실패·3시간 무실행이면 경고+텔레그램(하루 한 번). Cloudflare 비밀값 `GITHUB_TOKEN`(이 레포 Actions 읽기·쓰기 fine-grained 토큰)이 있어야 한다.
- 데이터 주소까지 바뀌면 424 + `diag`(받은 페이지 모양)로 실패하고, 앱이 텔레그램으로 자동 보고(`[수업일지 자동 진단]`)하며 최근 주 시간표로 대신 보여준다. 고칠 때는 그 보고의 `diag` 부터 본다.
- **`classnote.gwansan.com` 은 서버의 5xx 오류 문장을 Cloudflare "Host Error" 페이지로 가린다.** 그래서 `/api/comci` 는 오류를 424 로 돌려준다. 5xx 를 새로 쓰지 말 것.
- 진단 순서(주소 앞에 `https://classnotee.pages.dev`):
  1. `/api/comci?diag=1` — 컴시간 서버가 응답하는지
  2. `/api/comci?st=1` — 접속 페이지·스크립트에서 무엇을 찾았는지(`boot`, `linked`, `tags`)
  3. `/api/comci?code=43917&week=1&probe=fetch` (또는 `boot`/`parse`/`full`) — 어느 단계에서 실패하는지
- 앱은 마지막 시간표를 기기(localStorage)와 서버 캐시(하루)에 보관하므로, 컴시간이 고장 나도 화면에는 마지막 시간표가 남는다.

## 수업일지(ohlog) — 화면 파일 보관(서비스 워커)
- `ohlog/public/sw.js` 가 화면 파일(`/`, app.js, css, firebase-config.js)을 폰에 보관해 켤 때 바로 띄운다. 켤 때·앱으로 돌아올 때 뒤에서 새로 받아 비교하고, 바뀌었으면 통째로 바꾼 뒤 'updated' 를 보내 앱이 스스로 다시 연다.
- 화면 파일을 새로 추가하면 `sw.js` 의 `SHELL` 목록에도 넣는다(안 넣으면 그 파일은 그냥 인터넷에서 받는다). `/api/*`·외부 주소는 손대지 않는다.
- 견본에는 서비스 워커를 넣지 않는다(`ohinfo/tools/vibe/build.py` `build_classlog`). `app.js` 의 `navigator.serviceWorker.register('/sw.js')` 줄을 바꾸면 거기도 맞춘다(안 맞추면 견본 빌드가 실패한다).
- 지난 주 시간표: 컴시간은 지난 주를 안 주므로 받아 본 주를 기기에 최근 12주 보관(`classlog:arch:*`)해 주 목록에 '저장본'(음수 r)으로 붙인다.
