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
| `ohsettle/` | 정산 견본용 사본 — 배포 원본은 레포 `ohsettle`(`ohsettle/CLAUDE.md`) | settle.kakainfo.com |
| `ohweb-rules-test/` | Firestore 규칙·화면 테스트 (`npm run test`) | – |
| `tools/exam-grading/` | 시험 채점 도구(내보내기·반영, 운영 DB 직접). 세션 절차는 스킬 `/exam-grading` | – |
| `tools/ai-grading/` | 맥 AI 채점 워커(launchd, `claude -p`). 관리자 문항별 채점의 [AI 채점] 요청을 처리해 점수 제안만 단다(README) | – |
| `tools/trial-account/` | kakainfo 체험 계정(체험학교) 만들기·되돌리기(운영 DB 직접) | – |

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
- **사용자가 안 해도 되는 일은 사용자에게 넘기지 않는다.** 로컬(이 컴퓨터의 CLI·스크립트·브라우저 자동화)에서 할 수 있는 건 최대한 직접 한다.
  콘솔에 붙여넣기·설정 파일 만들기·명령 실행 같은 걸 "해 주세요"로 넘기지 말고 먼저 직접 해 보고, 정말 막힐 때만 이유와 함께 부탁한다.
- **개발이 끝나면 묻지 말고 바로 main 에 합쳐 배포한다.** 사용자는 개발 과정을 따로 검토하지 않고 늘 바로 배포한다(2026-11-24 사용자 지시).
  순서: 관련 테스트 통과 → 브랜치에 커밋(내가 바꾼 파일만 add, 사용자의 커밋 안 한 작업은 건드리지 않음) → push → PR 생성 → `gh pr merge --squash --delete-branch` → 로컬 main 으로 돌아와 pull.
  테스트가 실패하면 합치지 않고 실패 내용을 보고한다.
- 새 플랫폼 kaká(`ohweb/public/k/`, `ohinfo/public/k/`, `ohinfo/public/kaka/`)를 고치면 배포가 끝난 뒤 `ohweb-rules-test` 에서 `npm run smoke:kaka` 로 **실제 배포된 파일**을 열어 본다(로그인·DB만 에뮬레이터). 로컬 e2e 통과만으로 끝났다고 하지 않는다.
- ohlog 를 고치면 `ohweb-rules-test` 에서 `npm run test:classlog` 를 통과시킨 뒤 위 순서대로 main 에 합친다.
- Firestore 규칙(`ohweb-firestore.rules`)은 자동 배포되지 않는다. 고치면 `npm run test:rules` 통과 후 `tools/dev/deploy-rules.sh` 로 직접 배포한다(운영이 main 과 다르면 멈춘다).
- 사용자에게는 한국어로, 짧게, 무엇을 바꿨고 무엇을 확인했는지(확인 못 한 것도) 말한다.

## 빠르게 일하기 (토큰 아끼기)
같은 긴 명령을 매번 새로 쓰지 말고 아래 스크립트를 쓴다. 출력은 결과 한두 줄만 나오게 되어 있다.
| 할 일 | 명령 |
|---|---|
| 작업 폴더 만들기(사용자 작업과 분리) | `d=$(tools/dev/wt.sh 브랜치이름)` → 끝나면 `tools/dev/wt.sh --rm 브랜치이름` |
| kaká 테스트 전부 | `cd ohweb-rules-test && npm run -s test:kaka-all` (실패한 줄만 자세히) |
| 커밋·PR·합치기 | 내 파일만 `git add` → `tools/dev/ship.sh "제목" "본문"` |
| 배포 확인 | `tools/dev/wait-deploy.sh 주소 찾을글자 [초]` (기본 150초, .html 주소도 됨) |
| 배포 후 실제 사이트 점검(kaká) | `npm run smoke:kaka` |
| 규칙 배포 | `tools/dev/deploy-rules.sh` (`--check` 는 비교만) |

- **화면 확인 스크린샷은 비싸다.** 바뀐 부분만 잘라서(clip), deviceScaleFactor 1 로 찍는다. 전체 화면·2배 해상도는 사용자에게 보여 줄 때만.
- 테스트·빌드 출력은 `grep`/`tail` 로 결과 줄만 본다. 큰 파일은 필요한 줄만 읽는다(`grep -n` → `sed -n`).
- 확인을 위해 같은 파일을 다시 읽지 않는다(고친 직후 Read 금지).
