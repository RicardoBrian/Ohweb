# Ohweb 작업 지침 (Claude Code)

이 레포는 학교용 웹앱 여러 개(ohweb·ohinfo·ohlog·ohnotion·ohshrt·ohsettle)를 담고 있다. 각 폴더가 Cloudflare Pages 프로젝트 하나다(`CLOUDFLARE.md`).

## 버그 수정 원칙
- **고치기 전에 실제 오류 메시지를 먼저 확보한다.** 메시지 없이 추측으로 고치지 않는다.
  사용자에게 확인을 부탁할 때는 열어볼 주소·볼 곳을 하나로 정확히 준다.
- 원인을 확인하기 전에는 관련 없는 코드를 바꾸지 않는다. **잘 되던 기능은 요청 없이 건드리지 않는다.**
- 원인이 확인되면 그 원인만 고친다. "겸사겸사" 개선은 먼저 묻는다.
- 같은 문제로 두 번 고쳐도 안 되면 멈추고, 지금까지 확인한 사실과 모르는 것을 정리해 보고한다.

## 수업일지(ohlog) — 컴시간 시간표
- 컴시간은 비공식 사이트라 구조가 바뀔 수 있다. 시간표 오류는 대부분 `ohlog/functions/api/comci.js` 의 `readBoot`·`bootText`(접속 정보 읽기) 문제다.
- 2026-11: 컴시간이 `/st` 의 스크립트를 난독화했다(20KB → 69KB, `sc_data` 등이 사라짐). 그래서 스크립트를 못 읽으면 마지막 정상 접속 정보(`KNOWN_BOOT`, 읽을 때마다 캐시에 90일 저장)로 시도한다. 응답의 `debug.boot` 가 `known`/`lastgood` 이면 이 경로로 받은 것이다.
- 2026-11-03: 데이터 주소도 바뀜(옛 주소 → HTTP 520). `/th`(컴시간교사.kr)도 같은 난독화. 그래서 GitHub Actions `comci-boot`(`.github/workflows/comci-boot.yml`, 매일 05:17)가 진짜 브라우저로 `/st` 를 열어 학교를 선택하고, 페이지가 보내는 요청에서 route·search·prefix 를 뽑아 `ohlog/lib/comci-boot.js` 에 커밋한다(바뀐 때만). `debug.boot` 가 `captured` 면 이 값. 실패하면 Actions 실행의 `comci-capture` 아티팩트(화면·요청 기록)부터 본다.
- 데이터 주소까지 바뀌면 424 + `diag`(받은 페이지 모양)로 실패하고, 앱이 텔레그램으로 자동 보고(`[수업일지 자동 진단]`)하며 최근 주 시간표로 대신 보여준다. 고칠 때는 그 보고의 `diag` 부터 본다.
- **`classnote.gwansan.com` 은 서버의 5xx 오류 문장을 Cloudflare "Host Error" 페이지로 가린다.** 그래서 `/api/comci` 는 오류를 424 로 돌려준다. 5xx 를 새로 쓰지 말 것.
- 진단 순서(주소 앞에 `https://classnotee.pages.dev`):
  1. `/api/comci?diag=1` — 컴시간 서버가 응답하는지
  2. `/api/comci?st=1` — 접속 페이지·스크립트에서 무엇을 찾았는지(`boot`, `linked`, `tags`)
  3. `/api/comci?code=43917&week=1&probe=fetch` (또는 `boot`/`parse`/`full`) — 어느 단계에서 실패하는지
- 앱은 마지막 시간표를 기기(localStorage)와 서버 캐시(하루)에 보관하므로, 컴시간이 고장 나도 화면에는 마지막 시간표가 남는다.

## 작업 마무리
- ohlog 를 고치면 `ohweb-rules-test` 에서 `npm run test:classlog` 를 통과시킨 뒤 PR 을 만들어 **main 에 합친다**(사용자가 따로 말하지 않아도).
- Firestore 규칙(`ohweb-firestore.rules`)은 자동 배포되지 않는다. 고치면 `npm run test:rules` 통과 후, Firebase 콘솔에 붙여넣어 게시해야 한다고 사용자에게 알린다.
- 사용자에게는 한국어로, 짧게, 무엇을 바꿨고 무엇을 확인했는지(확인 못 한 것도) 말한다.
