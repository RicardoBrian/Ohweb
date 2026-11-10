# 시험 채점 도구 (`tools/exam-grading`)

kakainfo 시험(exam.html) 답안을 내보내고, 채점한 점수·사유를 DB 에 반영하는 명령줄 도구. Claude 세션용 절차는 `.claude/skills/exam-grading/SKILL.md`.

| 명령 | 하는 일 |
|---|---|
| `node tools/exam-grading/list.mjs [제목]` | 배정 목록(asId·대상·제출·채점대기 수). 읽기만 |
| `node tools/exam-grading/export.mjs <asId…>` / `--exam <examId>` `[--out 폴더]` | `~/exam-grading/<날짜>_<제목>/` 에 `questions.md`, `grades.csv`, `students.csv`, `exam.json`. 읽기만 |
| `node tools/exam-grading/apply.mjs <grades.csv>` | 미리보기(`apply-preview.csv`). 쓰지 않음 |
| `node tools/exam-grading/apply.mjs <grades.csv> --write` | 반영. 학생 단위 — 점수 빈칸·`확인필요`가 있는 학생은 건너뜀(`--allow-flagged` 로 무시) |

- 반영 형식은 관리자 화면 채점 창의 저장과 같다: `exam_results.score·feedback`, `exam_progress.totalScore·totalPoints·needsManual=false·gradedAt` (+ `gradedBy: 'claude-session'`).
  **needsManual 이 false 가 되면 학생 시험 화면에 점수가 공개된다.**
- 접속: 이 컴퓨터의 firebase CLI 로그인(`firebase login`)으로 운영 DB 에 직접 — 보안 규칙을 거치지 않는다. `FIRESTORE_EMULATOR_HOST` 가 있으면 에뮬레이터.
- `grades.csv` 열: 배정, 학생ID, 학번, 이름, 문항, 문항ID, 유형, 배점, 학생답, 정답, 자동판정, 현재점수, **점수, 사유, 확인필요**(채우는 칸). `사유`는 학생에게 보인다.
- 채점 파일에는 학생 이름·답안이 들어 있다 — 레포 밖(`~/exam-grading/`)에 두고 커밋하지 않는다.
- 테스트: `ohweb-rules-test` 에서 `npm run test:grading`.
