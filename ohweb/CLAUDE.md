# 관리자 화면(ohweb) 작업 지침

교사용 관리자 화면. 주소 `admin.kakainfo.com`. DB는 Firebase `ohweb-93062`(정산 화면만 `ohsettle-10d43`) — 컬렉션은 루트 `DB.md`.
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
| `public/messages.html`, `notice.html` | 메시지·공지 |
| `public/settle.html` + `settle-firebase-config.js` | 정산(개인용, DB `ohsettle-10d43`) |
| `public/timer.html` | 타이머 |
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
`ohweb-rules-test` 에서 `npm run test:rules`(규칙), `npm run test:exam`(시험), `npm run test:login`(학생 로그인).
