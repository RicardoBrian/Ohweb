# 관리자 화면(ohweb) 작업 지침

교사용 관리자 화면. 주소 `admin.kakainfo.com`. DB는 Firebase `ohweb-93062` — 컬렉션은 루트 `DB.md`.
`ohweb/public/` 을 바꾸면 견본(`ohinfo/public/vibe/teacher`)은 Actions `vibe-build` 가 자동으로 맞춘다.

## 파일
| 파일 | 무엇 |
|---|---|
| `public/admin.html` | 메인 관리자 화면 (**4300줄 — 통째로 읽지 말 것**, 아래 구역 지도) |
| `public/admin-auth.js` | 관리자 로그인 확인 |
| `public/admin-nav.js` | 왼쪽 메뉴·섹션 전환 |
| `public/admin-rows.js`, `admin-groups.js` | 표 행·반 묶음 그리기 |
| `public/admin-ailab.js` | AI 실습실 관리 |
| `public/exam-qcsv.js` | 시험 문항 CSV |
| `public/forms.html` | 설문 만들기·결과 |
| `public/score.html` + `score-core.js` + `score-config.js` | 수행평가: 감점사유 템플릿·평가 항목(①②③)·점수 입력(CSV/엑셀, 채점 시트 상세 탭 그대로·학번 가능)·비고(선생님만)·반별 공개·이의신청 확인·수정 이력·제출물 연결(드라이브 폴더 → 학번으로 학생)·시험에서 가져오기(exam 결과 → 평가, 문항 = 항목, 다시 가져오기)·학기 성적(같은 학기·과목·학교 학년 평가 합계 → A~E 등급, 기준 바꾸기, CSV). `score-core.js` 는 화면 없는 순수 함수(테스트 `npm run test:score`), `score-config.js` 는 Apps Script 주소 |
| `public/messages.html`, `notice.html` | 메시지·공지 |
| `public/timer.html` | 타이머 |
| `public/temp/{번호}/` | 행사용 임시 페이지(예: `261218` = 12/18 교직원 연수 안내·참여 조사). 공개 주소 `gwansan.com/{번호}` — gwresearch 의 `functions/_middleware.js` 가 `admin.kakainfo.com/temp/{번호}/` 를 대신 보여 준다. DB 는 업무용 `gwansan-work` 의 `apps/temp/events/{번호}/responses`(누구나 제출, 관리자만 결과). 제출하면 `functions/api/temp-sheet.js` 가 관리자 공유용 구글 시트에도 한 줄 추가(행사 번호 → 시트 ID 는 그 파일의 `SHEETS`, 시트는 서비스 계정에 편집자로 공유). 견본 빌드에서 빠짐 |
| `functions/api/temp-sheet.js` | 임시 페이지 참여 조사 → 구글 시트 추가(서버, `FIREBASE_SERVICE_ACCOUNT_KEY`, Sheets API) |
| `public/seats.html` + `seats-themes.js` | 자리 배치: 교실 모양 편집(`seat_rooms`)·뽑기(남은 학생 중 하나 → 1번 빈자리부터 차례로)·고정석·결석·자리 바꾸기·발표 모드(화면 꽉 채움, 무대 옆/아래 자동)·인쇄·저장/기록(`seat_plans`). 뽑기 연출 테마 6개(대포·캡슐·인형뽑기·포토카드·숏폼·풍선)는 `seats-themes.js` — 테마는 연출만, 누가 뽑힐지·기입은 seats.html (테스트 `npm run test:seats`). 공개용 판 `ohinfo/public/자리바꾸기.html` 이 따로 있고 `seats-themes.js` 를 똑같이 복사해 쓴다 — 테마를 고치면 두 곳 다 |
| `functions/api/reset-student-password.js` | 학생 비밀번호 초기화(서버, `FIREBASE_SERVICE_ACCOUNT_KEY`) |
| `functions/api/translate.js` | 번역(서버, `GOOGLE_TRANSLATE_KEY`) |

## admin.html 구역 지도
줄 번호는 바뀌므로 **구역 이름으로 검색**한다: `grep -n "// ── 시험 관리 ──" ohweb/public/admin.html` → 그 근처만 읽는다.

- 화면(HTML) 섹션: `id="section-schools"`, `section-students`, `section-apps`, `section-ailab`, `section-paddlet`(게시판), `section-exam`
- 스크립트 구역(`// ── 이름 ──`):
  - 공통: `유틸`, `번역`, `섹션 진입 시 firebase 데이터 로딩`, `다크모드 초기화 / 토글`, `초기화`
  - 학교·학생: `학교 관리`, `CSV 업로드`, `학생 목록`, `공개용 학생 명단(student_directory)`, `학생 이름·비밀번호 수정`, `학생 로그인 계정`, `학생 개별 추가`
  - 앱 공개: `앱 설정`, `앱 공개 설정`
  - 게시판(패들릿): `패들릿 수업 관리`, `패들릿 배정 드롭다운`, `패들릿 일괄 번역`
  - 시험: `시험 관리`, `시험지 유형`, `문제 관리`, `정답 분리`, `문항 순서`, `문항 CSV`, `문항 이미지`, `배정 관리`, `학생별 유형 나누기`, `배정의 유형 정하기`, `결과 조회`, `시험 시각 표시`, `실시간 현황판`, `결과 PDF 내보내기`, `채점 모달`, `제출 실패 학생의 보관 답안`
  - 한 번 쓰고 마는 정리 도구: `정답 분리 마이그레이션`, `누락 번역 보완`, `레거시 시스템 데이터 가져오기`

## 테스트
`ohweb-rules-test` 에서 `npm run test:rules`(규칙), `npm run test:exam`(시험), `npm run test:login`(학생 로그인), `npm run test:score`(시험 점수 확인 단위+e2e), `npm run test:grading`(채점 도구).
