# 학생용 사이트(ohinfo) 작업 지침

학생용 사이트. 주소 `kakainfo.com`. DB는 Firebase `ohweb-93062` — 컬렉션은 루트 `DB.md`.

## 견본(`public/vibe/`) — 손으로 고치지 않는다
- `public/vibe/` 는 바이브 코딩 견본 모음(kakainfo.com/vibe)이다. 대부분 `tools/vibe/build.py` 가 실제 앱을 복사해 만든다:
  teacher←`ohweb/public`, student←`ohinfo/public`, classlog←`ohlog/public`, shortener←`ohshrt/public`, settle←레포 `ohsettle`(비공개, `VIBE_READ_TOKEN`)의 `public`,
  attend←gwansanattend, broadcast←GWBS, volunteer←GWVS, travel←oHtravel, aia←appinventorcheck, roadmap←gwresearch (다른 레포).
- 복사하면서 Firebase 를 가짜(`vibe/shared/fake-firebase/`, 브라우저에만 저장)로 바꾸고 실제 이메일·키·이름을 지운다. 끝에 금지 값 검사를 하고, 남아 있으면 실패한다.
- **Actions `vibe-build` 가 main 에 원본이 바뀔 때와 매일 새벽에 자동으로 돌려 커밋한다.** 그러니 견본이 이상하면 원본이나 `build.py` 를 고친다.
- 손으로 쓴 견본 전용 파일(각 앱의 `firebase-config.js`, seed 데이터 등)은 `build.py` 의 keep 목록에 있고 덮어쓰지 않는다.
- 직접 돌리기: `python3 ohinfo/tools/vibe/build.py` (전부) / `python3 ohinfo/tools/vibe/build.py teacher` (일부).
- 코드를 검색할 때는 `vibe/` 를 빼고 본다. 같은 이름 파일이 두 벌 있어 헷갈린다.

## 파일 (public/)
| 파일 | 무엇 |
|---|---|
| `index.html`, `login.html`, `home.html`, `session.js`, `student-auth.js` | 첫 화면·학생 로그인(Firebase Auth `${id}@ohinfo.local`) |
| `ohdlet.html` | 반 게시판(`posts`) — 2200줄, 구역 이름 `// ── 댓글 ──` 등으로 검색 |
| `exam.html` | 시험 보기 — 1500줄, `// ── 제출 ──`, `// ── 문제 렌더링 ──` 등으로 검색. 서버는 `functions/api/exam.js` |
| `qna.html` | 질문 게시판(`qna_threads`) |
| `formfill.html`, `formlab.html` | 설문 제출 |
| `ailab.html`·`ailab.js`, `aiapp.html`, `aicode.*`, `ai-*.js` | AI 실습실. `ai-i18n.js`(135KB)는 번역 문장 모음 — 통째로 읽지 말 것 |
| `평택타이머1~3.html`, `활성함수.html`, `견본/`, `프롬프트/`, `vcexample/` | 연수·수업용 단독 페이지 |

## 서버(functions/api/)
`exam.js`(시험, `FIREBASE_SERVICE_ACCOUNT_KEY`), `run-python.js`(코드 실행, `PISTON_URL`·`PISTON_TOKEN`), `translate.js`, `ai-model.js`, `embed.js`, `img-proxy.js`.

## 그 밖
- `apps-script/ailab-drive.gs`: AI 실습실 이미지를 구글 드라이브에 올리는 Apps Script (자동 배포 안 됨, Apps Script 편집기에 붙여넣기)
- `scripts/migrate-students-to-auth.mjs`: 한 번 쓰고 끝난 학생 계정 전환 스크립트
- 테스트: `ohweb-rules-test` 에서 `npm run test:login`, `npm run test:exam`
