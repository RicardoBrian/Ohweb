# 수업일지(ohlog) 작업 지침

주소: `classnote.gwansan.com` (Cloudflare Pages `classnotee`). DB: Firebase `ohweb-93062` 의 `classlog_users`·`classlog_feedback` (`DB.md`).
고친 뒤에는 `ohweb-rules-test` 에서 `npm run test:classlog` 를 통과시키고 PR 을 만들어 main 에 합친다.
`ohlog/public/` 을 바꾸면 견본(`ohinfo/public/vibe/classlog`)은 Actions `vibe-build` 가 자동으로 맞춘다.

## 수업일지(ohlog) — 컴시간 시간표
- 컴시간은 비공식 사이트라 구조가 바뀔 수 있다.
- **2026-11-07 부터 컴시간이 시간표 응답을 암호화(`enc5:…`)한다** → 서버(Cloudflare)는 컴시간에 직접 접속하지 않는다.
  - GitHub Actions `comci-boot`(`.github/workflows/comci-boot.yml`, 30분마다)가 진짜 브라우저로 `/st` 를 열어 학교를 검색하고 `onclick="sc_disp(코드)"` 를 눌러, 페이지가 스스로 푼 시간표(JSON.parse 직후)를 가로챈다(`ohlog/tools/comci-capture.mjs`). 일자 목록의 주(보통 이번 주·다음 주)를 모두 받는다.
  - 결과는 **데이터 전용 브랜치 `comci-data`** 에 학교별 `<코드>_<학교이름>.json` = `{ code, name, region, query, changedAt, weeks: [{ r, label, raw }] }` 으로 커밋한다(바뀐 학교만). main 이 안 바뀌니 재배포도 없다. 등록 실패는 `{ code, name, error, at }`.
  - 서버(`functions/api/comci.js`)는 그 파일을 GitHub API 로 읽어(`lib/github.js` `listSchools`·`readSchool`, 목록 1분 캐시·파일은 sha 별) 기존 `parseTimetable` 로 해석만 한다. GitHub 이 안 되면 마지막으로 읽은 사본(3일)을 `stale` 로 준다.
  - 학교 검색(`?q=`)은 **등록된 학교 중에서만**(파일 이름) 찾는다. 컴시간 검색 응답도 암호화돼 있어서다.
  - 목록에 없는 학교: 가입 화면 '학교 코드로 추가'(이름+코드) → `POST /api/comci-sync {code,name}` → 워크플로를 그 학교만으로 실행(`inputs`, 같은 코드는 3분에 한 번) → 앱이 15초마다 `/api/comci?code=` 를 다시 봐서 나오면 이어서 진행. 코드는 컴시간학생 검색 결과의 `sc_disp(숫자)`. 검색 결과 JSON 의 다른 숫자들은 매번 바뀌는 가짜다.
- 자동 수집 상태는 `/api/comci-sync`(GET 상태·경고, POST 다시 켜고 전체 지금 실행 — 3분에 한 번). 관리자 화면 '승인 관리'의 '컴시간 자동 수집' 카드가 이것을 쓰고, 꺼짐·실패·2시간 무실행이면 경고+텔레그램(하루 한 번). Cloudflare 비밀값 `GITHUB_TOKEN`(이 레포 Actions 읽기·쓰기 fine-grained 토큰)이 있어야 한다.
- 실패하면 Actions 실행의 `comci-capture` 아티팩트(학교별 화면·요청 기록)부터 본다. 진단: `https://classnotee.pages.dev/api/comci?diag=1`(저장소·컴시간 응답), `…/api/comci?code=43917&raw=1`(저장된 원본).
- **`classnote.gwansan.com` 은 서버의 5xx 오류 문장을 Cloudflare "Host Error" 페이지로 가린다.** 그래서 `/api/comci` 는 오류를 424 로 돌려준다. 5xx 를 새로 쓰지 말 것.
- 앱은 마지막 시간표를 기기(localStorage)에 보관하므로, 저장소가 안 돼도 화면에는 마지막 시간표가 남는다(최근 주를 이번 주에 맞춰 보여주고 자동 보고).

## 수업일지(ohlog) — 화면 파일 보관(서비스 워커)
- `ohlog/public/sw.js` 가 화면 파일(`/`, app.js, css, firebase-config.js)을 폰에 보관해 켤 때 바로 띄운다. 켤 때·앱으로 돌아올 때 뒤에서 새로 받아 비교하고, 바뀌었으면 통째로 바꾼 뒤 'updated' 를 보내 앱이 스스로 다시 연다.
- 화면 파일을 새로 추가하면 `sw.js` 의 `SHELL` 목록에도 넣는다(안 넣으면 그 파일은 그냥 인터넷에서 받는다). `/api/*`·외부 주소는 손대지 않는다.
- 견본에는 서비스 워커를 넣지 않는다(`ohinfo/tools/vibe/build.py` `build_classlog`). `app.js` 의 `navigator.serviceWorker.register('/sw.js')` 줄을 바꾸면 거기도 맞춘다(안 맞추면 견본 빌드가 실패한다).
- 지난 주 시간표: 컴시간은 지난 주를 안 주므로 받아 본 주를 기기에 최근 12주 보관(`classlog:arch:*`)해 주 목록에 '저장본'(음수 r)으로 붙인다.
