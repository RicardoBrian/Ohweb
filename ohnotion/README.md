# ohnotion — notion.kakainfo.com

학생에게 보여줄 노션 페이지를 내 도메인에서 보여 주는 사이트.

## 왜 이렇게 만들었나 (중요)

학교에서 노션이 무한 새로고침에 빠지거나 깨지는 원인은 **노션의 요청 제한(429)** 이었다.
학교는 학생 PC 전체가 공인 IP 하나를 같이 쓰는데, 반 전체가 노션을 열면 노션이 그 IP를
"요청 과다"로 보고 CSS/JS를 거절한다(실제 콘솔: `_assets/*.js 429`, MIME `text/html`).
그래서 처음 버전처럼 iframe으로 `notion.site`를 띄우는 방식으로는 해결이 안 됐다.

지금은 **학생 브라우저가 노션에 전혀 접속하지 않는다.** Cloudflare 서버가 공식
**Notion API**로 페이지를 읽어 HTML로 그려 두고(2분마다 새로), 학생은 그것만 받는다.
학생이 몇 명이든 노션 쪽 요청은 몇 분에 몇 건이다. 노션 API가 잠깐 장애여도 마지막으로
그린 내용을 보여 준다(최대 7일).

노션에 올린 **HTML 파일**(노션은 다운로드만 시킴)도 여기서는 바로 실행된다 — 격리된
상태(CSP sandbox)로 내려 줘서 같은 도메인의 관리 페이지에 손대지 못한다.

## 주소

| 주소 | 누가 | 내용 |
|---|---|---|
| `notion.kakainfo.com/` | 학생 | 등록된 페이지 목록 (숨김 페이지 제외) |
| `notion.kakainfo.com/{주소}` | 학생 | 그 노션 페이지 |
| `notion.kakainfo.com/{주소}/{페이지ID}` | 학생 | 그 안의 하위 페이지 (본문 링크로 이동) |
| `notion.kakainfo.com/admin` | 관리자 | 등록·수정·삭제·순서 + 모니터링 |

## 처음 한 번: 노션 통합 연결

1. 노션 → **설정 → 연결(통합) → 통합 개발/새 통합 만들기**(내부 통합). 읽기 권한만 있으면 된다.
2. 나온 시크릿(`ntn_…`)을 Cloudflare Pages `ohnotion` → Settings → Variables and Secrets에
   **`NOTION_TOKEN`** (Secret, Production)으로 넣고 재배포.
3. 학생에게 보여줄 노션 페이지마다 오른쪽 위 **··· → 연결 → 그 통합 추가**.
   하위 페이지는 자동으로 포함된다. **연결한 페이지는 이 사이트로 누구나 볼 수 있다** —
   공개하면 안 되는 페이지에는 연결하지 않는다. "웹에 게시"는 안 해도 된다.

## 페이지 등록

`notion.kakainfo.com/admin` → Google 로그인 → 주소(`공지`), 노션 페이지 링크(공유 → 링크
복사), 제목(비우면 노션 제목) → **등록**. `notion.so`/`notion.site`/임베드 iframe 코드 모두
받는다. 링크에서 32자리 페이지 ID만 쓰므로 사이트 첫 화면 주소(`xxx.notion.site/`)는 안 된다.

노션에서 내용을 고치면 학생 화면에 **2분 안에** 반영된다. 바로 보이게 하려면 관리
페이지의 **⟳**(지금 새로 불러오기).

## 모니터링

- **점검**(`/api/check`) — 노션 API로 그 페이지가 읽히는지(토큰·통합 연결). ⟳는 전체를 새로 그림.
- **학생 기록**(`notion_stats`, 오늘 / 최근 7일)
  | 기록 | 뜻 |
  |---|---|
  | 열람 | 연 횟수(탭당 1번) |
  | 이상해요 신고 | 학생이 상단 버튼을 누름 |
  | 예전 내용으로 대신 | 노션 API 장애로 마지막 저장본을 보여 줌 |
  | 불러오기 실패 | 저장본도 없어 못 보여 줌 |
  slow/timeout/loop(옛)는 iframe 방식이던 첫 버전의 기록이다.

## 구조

```
functions/
  [[slug]].js        목록 / 페이지 / 하위 페이지 (Notion API → HTML)
  api/check.js       점검 · 지금 새로 불러오기
  api/file.js        노션 이미지·파일·HTML을 우리 도메인으로(서명 주소 갱신, HTML은 격리)
  api/report.js      학생 기록 +1
lib/                 (functions/ 밖이라 라우트가 아님)
  notion.js          Notion API 클라이언트(동시 3건, 429 재시도) + 블록 → HTML
  render.js          캐시: 신선본 2분 / 예비본 7일, 같은 페이지 동시 그리기 합치기
  shared.js          주소 규칙, Firestore REST, 통계 기록
public/
  view.js, view.css  학생 화면(노션 요청 없음, 웹 폰트도 없음)
  admin.html/js/css  관리 페이지
```

Firestore (규칙은 레포 루트 `ohweb-firestore.rules`):

- `notion_pages/{주소}` — `title`, `url`, `pageId`, `order`, `hidden`, `createdAt`, `updatedAt`. 읽기 공개, 쓰기 관리자.
- `notion_stats/{YYYY-MM-DD}_{주소}` — 결과별 카운터 + `lastAt`. 읽기 관리자, 쓰기는 서버(서비스 계정)만.

## 한계

- 노션의 모든 블록을 똑같이 그리지는 못한다. 글·제목·목록·토글·콜아웃·표·코드·이미지·
  동영상·파일·PDF·임베드·북마크·열·하위 페이지·데이터베이스(제목 목록)·수식을 그린다.
  데이터베이스는 표/보드 보기 대신 항목 제목 목록으로 나온다.
- Cloudflare 무료 플랜은 요청당 CPU 시간이 짧다. 아주 큰 페이지(블록 수천 개)는 하위 페이지로 나눈다.

## 배포

`CLOUDFLARE.md` 8번 참고.
