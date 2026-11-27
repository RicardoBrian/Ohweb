# 맥 AI 채점 워커

관리자 화면 → 시험 → 결과 조회 → **문항별 채점** → 🤖 AI 채점 제안 에서 요청하면, 이 맥이 `claude -p` 로
단답형·서술형 답에 점수·사유를 **제안**한다. 선생님이 [적용]해야 점수(임시 저장)가 되고, [공개]해야 학생이 본다.

- 설치(로그인하면 자동 시작): `bash tools/ai-grading/install.sh` · 제거: `... install.sh remove`
- 로그: `~/Library/Logs/kakainfo-ai-grading.log`
- 한 번만 돌리기: `node tools/ai-grading/worker.mjs --once`
- 필요: `firebase login`(운영 DB 접속, `tools/exam-grading/firestore.mjs`), `claude` 로그인
- 맥이 꺼져 있으면 요청은 대기했다가 켜지면 처리된다. 화면의 "맥 채점기 연결됨"은 `appSettings/aiGradingWorker.lastSeen`(15초마다).

## 데이터
| 어디 | 무엇 |
|---|---|
| `exams/{시험}.aiRubric` | 시험 공통 채점 기준 |
| `exam_answers/{문항}.rubric` | 문항 채점 기준(정답 `answer` 와 같이 보냄) |
| `exam_answers/{문항}.minScore` | 빈 답·의미 없는 답 점수(문항 폼·AI 패널에서 입력) |
| `exams/{시험}.aiJob` | 요청·진행 `{status: queued→running→done/error, sel, questionIds, redo, progress, message}` |
| `exam_results/*.aiScore·aiReason·aiFlag·aiFlagReason·aiModel·aiAt` | 제안(점수 `score` 는 안 건드림) |

- 보내는 것: 기준·문항·정답, "위 사례" 문항이면 같은 유형 앞 문항의 사례, 답마다 글자 수(직접 셈), 선생님이 이미 매긴 답(예시), 학생 답 원문(번역은 안 보냄 — 외국어 답도 원문 기준). **이름·학번은 안 보냄**(A1, A2…).
- 건너뛰는 것: 객관식·코딩, 미제출, 이미 공개한 학생, 선생님이 매긴 답·이미 제안 있는 답(“다시 채점” 체크 시 둘 다 다시 제안 — 점수는 [적용]해야 바뀜, 매긴 점수와 다르면 AI 제안 검토에 뜸).
- 화면 이탈·제출 시간 초과는 AI 에 보내지 않는다(점수가 아니라 경고 — 관리자 채점 카드·공개 확인·점수 확인 비고에 ⚠). 예시는 선생님이 직접 판단한 답만(AI 제안을 그대로 적용한 점수는 뺌).
- 빈 답·의미 없는 답("1."만, "모름", "я не знаю" 등)은 AI 에 안 보내고 문항의 `exam_answers.minScore`(빈 답 점수, 없으면 0)로 바로 제안, 확인 필요 없이. 애매하면 `aiFlag`(“확인 필요”) — [AI 제안 모두 적용]에서 빠진다.
- 관리자 화면: 위쪽 [🤖 시험 전체 AI 채점] → 끝나면 [AI 제안 검토]에 시험 전체 제안이 문항별로 모임(확인 필요 먼저, 한 번에 적용).
- 환경변수: `AI_GRADER_MODEL`(기본 claude 기본 모델), `AI_GRADER_BATCH`(한 번에 보낼 답 수, 12), `AI_GRADER_PARALLEL`(동시에 보낼 묶음 수, 3), `AI_GRADER_POLL_MS`(15000).
- 테스트: `ohweb-rules-test` 에서 `npm run test:ai-grading`(에뮬레이터 + 가짜 claude).
