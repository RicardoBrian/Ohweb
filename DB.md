# DB 지도

어느 앱이 어느 DB의 무엇을 쓰는지. DB를 고치기 전에 이 표부터 본다.
(2026-11-08 코드 기준. 앱이나 컬렉션을 새로 만들면 여기도 고친다.)

## 이 레포(Ohweb)

### Firebase `ohweb-93062` — 학교 메인 DB
규칙: `ohweb-firestore.rules` (자동 배포 안 됨 — `ohweb-rules-test` 에서 `npm run test:rules` 통과 후 Firebase 콘솔에 붙여넣어 게시).

| 컬렉션 | 쓰는 앱 | 내용 |
|---|---|---|
| `schools`, `classes` | ohweb(관리), ohinfo | 학교·반 |
| `students` | ohweb(관리), ohinfo(로그인) | 학생 계정. 로그인은 Firebase Auth `${id}@ohinfo.local` |
| `student_directory` | ohweb, ohinfo | 공개용 학생 명단(이름만) |
| `appSettings` | ohweb, ohinfo, ohnotion | 반 × 앱 공개 설정 · `ohnotion_site` = 노션 페이지 숨기기(closedSlugs) |
| `posts` | ohinfo `ohdlet.html`(게시판), ohweb | 게시판 글 |
| `qna_threads` | ohinfo `qna.html`, ohweb | 질문 게시판 |
| `student_forms`, `student_form_responses` | ohweb `forms.html`, ohinfo `formfill.html` | 설문·제출 |
| `exams`, `exam_questions`, `exam_assignments`, `exam_progress`, `exam_answers`, `exam_results` | ohweb `admin.html`(시험 관리), ohinfo `exam.html`, `ohinfo/functions/api/exam.js` | 시험 |
| `ai_projects`(+하위 `images`, `feedback`), `ai_apps`, `ai_pairs`, `ai_assignments` | ohinfo `ailab*`, `aiapp.html`, ohweb `admin-ailab.js` | AI 실습실 |
| `classlog_users`, `classlog_feedback` | ohlog(수업일지) | 수업일지 사용자·의견 |
| `notion_pages`, `notion_stats`, `notion_secrets` | ohnotion | 노션 공개 페이지 |
| `short_links` | ohshrt | 단축 URL |

### Firebase `ohsettle-10d43` — 정산(개인용)
| 컬렉션 | 쓰는 앱 |
|---|---|
| `settle_trips` | ohsettle, **ohweb `settle.html`(+`settle-firebase-config.js`)** |

### 그 밖
- 견본(`ohinfo/public/vibe/`)은 진짜 DB를 쓰지 않는다. `vibe/shared/fake-firebase/` 가 브라우저 안에만 저장한다.
- Cloudflare 비밀값: ohweb·ohinfo·ohnotion `FIREBASE_SERVICE_ACCOUNT_KEY`, ohweb·ohinfo `GOOGLE_TRANSLATE_KEY`, ohinfo `PISTON_URL`·`PISTON_TOKEN`, ohnotion `NOTION_TOKEN`, ohlog `GITHUB_TOKEN`.
- Google Apps Script: `ohinfo/apps-script/ailab-drive.gs` (AI 실습실 이미지 → 구글 드라이브), ohweb 문항 이미지 업로드.

## 다른 레포

| 레포 | DB | 성격 |
|---|---|---|
| gwansanattend (출결) | **Firebase `gwansan-work`**(2026-11-09 전환) — `apps/attend/…`(반·기록·신고서·보호자·허용·신청·접속 기록), 공용 명렬표 `years/{연도}/students`. 예전 `gwsattend` 는 백업으로 남김 | 학교 |
| GWBS (방송부) | **Firebase `gwansan-work`**(2026-11-09 전환) — `apps/broadcast/…`(일정·출결·매뉴얼·신청곡, 부원 `members` = 명렬표 학생 ID). 예전 `gwbs-3ec22` 는 백업으로 남김 | 학교 |
| GWVS (봉사활동) | **Firebase `gwansan-work`**(업무용 통합, 2026-11-09 전환) — 공용 `staff`·`admins`·`years/{학년도}/students`, 봉사 `apps/volunteer/…`. 예전 `gwvs-77114` 는 백업으로 남김 | 학교 |
| snakeiogwansan | Firebase 실시간 DB (주소는 Cloudflare 비밀값 `FIREBASE_DATABASE_URL`) | 행사 |
| moral | Google Apps Script(시트) — Cloudflare 비밀값 `GAS_URL`·`GAS_KEY` | 수업 |
| gwresearch | Cloudflare KV `gwresearch-pdf`, Apps Script | 수업 |
| dapp (웨이트 기록) | Firebase `dapp-leanmassup` — `sessions`, `routines`, `logs` | 개인 |
| oHtravel | Firebase `ohtravel-3540c` — `trips` | 개인 |
| Olink | Firebase `olink-76ad8` — `links` | 개인 |
| OHktx, OHsplan, ohplayer, asdebate, appinventorcheck | 없음(기기 저장만) | – |

## 알려진 문제 (나중에 정리 — 3단계)
- `students` 가 여러 곳(ohweb-93062, gwsattend, gwbs, gwansan-work)에 따로 있다. 업무용 3개는 `gwansan-work` 의 `years/{학년도}/students` 하나로 모으는 중(봉사·출결·방송부 모두 전환 완료, 2026-11-09). 명렬표 관리: students.kakainfo.com(레포 gwstudents).
- 학교 관리자 화면(ohweb)이 개인용 정산 DB(ohsettle-10d43)에도 붙어 있다(`settle.html`).
- 쓰지 않는 Cloudflare 자원: KV `LINKS`, KV `ohshrt-links`(옛 단축 URL 레포), Worker·D1 `ssoswitch`, Worker `ptvibecoding`.
