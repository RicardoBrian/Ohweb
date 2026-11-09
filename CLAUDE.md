# Ohweb 작업 지침 (Claude Code)

이 레포는 학교용 웹앱 여러 개를 담고 있다. 각 폴더가 Cloudflare Pages 프로젝트 하나다(`CLOUDFLARE.md`).

## 레포 지도 — 작업할 폴더의 CLAUDE.md 를 먼저 본다
| 폴더 | 무엇 | 주소 |
|---|---|---|
| `ohweb/` | 교사용 관리자 화면 | admin.kakainfo.com |
| `ohinfo/` | 학생용 사이트 + 견본(`public/vibe/`) | kakainfo.com |
| `ohlog/` | 수업일지 | classnote.gwansan.com |
| `ohnotion/` | 노션 페이지 공개 | – |
| `ohshrt/` | 단축 URL | – |
| `ohsettle/` | 정산(개인용, DB 따로) | settle.kakainfo.com |
| `ohweb-rules-test/` | Firestore 규칙·화면 테스트 (`npm run test`) | – |

- **DB: `DB.md`** — 어느 앱이 어느 컬렉션을 쓰는지. 컬렉션을 새로 만들면 거기도 고친다.
- `ohinfo/public/vibe/` 는 견본으로, `ohinfo/tools/vibe/build.py` 가 실제 앱에서 **자동 생성**한다(Actions `vibe-build`). **손으로 고치지 말고** 원본을 고친다. 검색할 때도 `vibe/` 는 빼고 본다(같은 이름 파일이 있어 헷갈린다).
- 큰 파일(`ohweb/public/admin.html` 4300줄, `ohinfo/public/ohdlet.html`·`exam.html`, `ohinfo/public/ai-i18n.js`)은 통째로 읽지 말고, 각 폴더 CLAUDE.md 의 구역 이름으로 검색해 그 부분만 읽는다.

## 버그 수정 원칙
- **고치기 전에 실제 오류 메시지를 먼저 확보한다.** 메시지 없이 추측으로 고치지 않는다.
  사용자에게 확인을 부탁할 때는 열어볼 주소·볼 곳을 하나로 정확히 준다.
- 원인을 확인하기 전에는 관련 없는 코드를 바꾸지 않는다. **잘 되던 기능은 요청 없이 건드리지 않는다.**
- 원인이 확인되면 그 원인만 고친다. "겸사겸사" 개선은 먼저 묻는다.
- 같은 문제로 두 번 고쳐도 안 되면 멈추고, 지금까지 확인한 사실과 모르는 것을 정리해 보고한다.

## 작업 마무리
- ohlog 를 고치면 `ohweb-rules-test` 에서 `npm run test:classlog` 를 통과시킨 뒤 PR 을 만들어 **main 에 합친다**(사용자가 따로 말하지 않아도).
- Firestore 규칙(`ohweb-firestore.rules`)은 자동 배포되지 않는다. 고치면 `npm run test:rules` 통과 후, Firebase 콘솔에 붙여넣어 게시해야 한다고 사용자에게 알린다.
- 사용자에게는 한국어로, 짧게, 무엇을 바꿨고 무엇을 확인했는지(확인 못 한 것도) 말한다.
