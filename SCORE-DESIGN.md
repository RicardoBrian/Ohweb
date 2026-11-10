# 수행평가 점수 확인 — 설계 (1단계 구현됨)

교사가 admin.kakainfo.com 에서 점수·감점사유를 입력하고 반별로 공개하면, 학생이 kakainfo.com 에 학번+비밀번호로 로그인해 본인 결과를 확인하고 이의신청을 보낸다. 2단계에 서명란을 붙인다.

## 결정한 것
| 항목 | 결정 |
|---|---|
| 학생 로그인 | 기존 kakainfo 학생 로그인 그대로(Firebase Auth `${id}@ohinfo.local`) |
| DB | Firebase `ohweb-93062` (학생 계정이 있는 곳) |
| 점수 | 교사가 입력한 점수를 그대로 보여준다. 감점사유는 계산에 쓰지 않고 이유만 보여준다 |
| 상태 | 점수와 따로: 정상·미제출·결시·인정점 |
| 감점사유 | 과목별 공통 템플릿, CSV/엑셀로 올림(`과목, 코드, 사유`) |
| 점수 파일 | `학교, 학년, 반, 번호, 이름(선택), 점수, 상태, 감점코드(; 구분), 메모` — 학교·학년·반·번호로 학생을 찾는다 |
| 공개 단위 | 평가 안에서 반별 스위치 + 전체 공개/비공개 |
| 학생 이름 | 결과 문서에 복사하지 않고 교사 화면에서 `students` 와 조인 |
| 이의신청 | 학생이 글로 보냄 → 교사는 "확인함" 표시만, 처리는 오프라인 |
| 수정 이력 | 이미 있던 결과를 바꾸면 이전 값·바뀐 내용을 `history` 에 남김(교사만 봄) |
| 홈 타일 | 관리자 → 앱 설정에서 반별로 `수행평가` 켜기(다른 앱과 같음) |

## 파일
- `ohweb/public/score.html` 교사 화면, `ohweb/public/score-core.js` 파일 읽기·학생 맞추기·이력 비교(순수 함수)
- `ohinfo/public/score.html` 학생 화면, `ohinfo/public/home.html` 타일
- `ohweb/public/admin-nav.js`·`admin.html` 메뉴와 앱 설정 목록
- 규칙 `ohweb-firestore.rules`, 테스트 `ohweb-rules-test/rules.test.mjs`(수행평가 블록)·`score-core.test.mjs`

## 데이터
```
score_templates/{id}      subject, items:[{code,label}]                      교사만
score_assessments/{id}    title, subject, term, maxScore,
                          classKeys:[...], publishedClasses:[...]            교사만
score_results/{평가ID}_{학생ID}
                          assessmentId, studentId, classKey,
                          title, subject, term, maxScore   ← 학생 화면용 복사본
                          score(null 가능), status, deductions:[{code,label}], memo,
                          published, publishedAt, createdAt, updatedAt,
                          dispute:{text, at, checked}                         학생: 본인·공개된 것 읽기, dispute 만 쓰기
score_results/{id}/history/{id}
                          at, before, after, summary, wasPublished            교사만
```
- 감점 문구는 저장할 때 결과 문서에 복사한다 → 템플릿을 나중에 고쳐도 이미 저장한 결과는 안 바뀐다.
- 학생 목록 조회는 `where studentId == 본인, published == true` 여야 규칙을 통과한다.
- `classKey` 는 `appSettings` 와 같은 정규화(`학교__g학년__c반`).

## 2단계 — 서명 (아직 안 함)
- 결과 화면 아래 서명란(canvas) + "확인했습니다". `ack:{signedAt, signature(png), scoreAtSign, deductionsAtSign}` 를 결과 문서에 추가.
- 규칙에 학생이 `ack` 만 쓸 수 있는 분기를 `scoreDisputeOnly` 처럼 추가.
- 공개 후 점수를 고치면 `ack` 를 지워 재서명을 받는다(교사 저장 시 함께 처리). 교사 화면에 서명 현황·인쇄.

## 추가 (2026-11-10) — 항목별 점수·비고·제출물
- 메뉴 이름은 **"시험 점수 확인"**(학생 홈 타일·학생 화면·관리자 메뉴).
- **평가 항목**: `score_assessments.criteria [{label,max}]`, 결과에 `items [{label,max,score,reason}]`(이름·배점 복사), 총점 = 항목 합.
  점수 파일에 `① 항목(배점)` / `① 감점 사유` 머리글이 있으면 그대로 읽는다 — 채점 시트 상세 탭을 CSV 로 받아 바로 올림. 항목이 없는 평가는 파일 머리글로 항목을 정한다.
- **학번**(10101) 열로 학생을 찾을 수 있다(평가 대상 반 학생 먼저).
- **비고**: 선생님만 — `score_notes/{평가ID}.notes{학생ID}`(결과 문서에 두면 학생이 읽을 수 있어서 분리).
- **제출물**: 선생님 드라이브에 그대로 둔다. 교사 화면 "제출물 연결"에 폴더 주소 → Apps Script `score-drive.gs`(list) 가 하위 폴더까지 훑고, 파일 이름의 학번으로 학생에 붙여 결과 문서 `files [{id,name,mimeType,size}]` 에 저장(선생님만 씀).
  학생은 `score-drive.gs`(file) 로 받는다 — 스크립트가 학생 토큰으로 결과 문서를 읽어(규칙: 본인·공개된 것만) `files` 에 있는 파일만 보낸다. 드라이브 공유 설정은 바꾸지 않는다.
- 보기: 내려받지 않고 팝업(`score-viewer.js`, 두 사이트에 같은 사본) — 그림 크게, 글 본문, `.sb3` 는 TurboWarp scaffolding 으로 바로 실행.
