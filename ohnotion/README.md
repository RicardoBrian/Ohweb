# ohnotion — notion.kakainfo.com

노션 "웹에 게시" 페이지를 내 도메인에서 띄워 주는 사이트. 학교 PC에서 노션 직접
링크(`notion.so`)가 무한 새로고침에 빠지는 일이 있어서 만들었다. 게시 링크
(`*.notion.site`)를 iframe으로 넣으면 잘 열린다는 걸 구글 사이트 임베드로 확인했다.

나머지 앱과 같은 방식(Cloudflare Pages + Firebase `ohweb-93062`, 빌드 스텝 없음).

## 주소

| 주소 | 누가 | 내용 |
|---|---|---|
| `notion.kakainfo.com/` | 학생 | 등록된 페이지 목록 (숨김 페이지 제외) |
| `notion.kakainfo.com/{주소}` | 학생 | 그 노션 페이지를 화면 가득 띄운 뷰어 |
| `notion.kakainfo.com/admin` | 관리자 | 등록·수정·삭제·순서 + 모니터링 |

주소는 한글/영문/숫자/`-`/`_` 40자까지 (예: `/공지`, `/수행평가`).

## 페이지 등록하는 법

1. 노션 페이지 → 오른쪽 위 **공유** → **게시** 탭 → **웹에 게시**.
2. 나온 `https://….notion.site/…` 링크를 복사.
3. `notion.kakainfo.com/admin` → Google 로그인 → 주소·제목·링크 넣고 **등록**.

노션 내용을 고치는 건 노션에서만 하면 된다 — 이 사이트는 노션 화면을 그대로 띄울 뿐이다.
관리 페이지에서 바꾼 제목·링크는 학생 화면에 **최대 2분** 뒤 반영된다(캐시).

## 모니터링

관리 페이지가 두 가지를 같이 보여 준다.

- **서버 점검** (`/api/check`) — Cloudflare 서버가 노션 링크를 직접 열어 본다.
  노션이 살아 있는지, 게시가 꺼지지 않았는지, 임베드를 막지 않는지. 등록할 때도 한 번 돈다.
- **학생 기록** (`/api/report` → Firestore `notion_stats`) — 학생 PC의 뷰어가 실제로
  열렸는지 한 번씩 보낸다. 오늘 / 최근 7일 집계.

| 기록 | 뜻 |
|---|---|
| 열림 | 8초 안에 열림 |
| 느림 | 열렸지만 8초 넘게 걸림 |
| 안 열림 | 20초가 지나도 안 열림 → 학생 화면에 "새 탭에서 열기" 안내 |
| 무한 새로고침 | 40초 안에 4번 이상 다시 로드됨 → 로드를 멈추고 안내 |
| 안 열려요 신고 | 학생이 상단 **안 열려요** 버튼을 누름 |

한계: 교차 출처 iframe이라 안쪽은 못 본다. 네트워크가 막혀 브라우저 오류 화면이 뜬
경우는 "열림"으로 잡힐 수 있어서, 학생이 누르는 신고 버튼을 같이 둔다.

## 구조

```
functions/
  [[slug]].js        / 와 /{주소} — 학생 화면을 서버에서 HTML로 만든다(Firebase SDK 없음)
  api/check.js       서버 점검 (*.notion.site만 받음)
  api/report.js      학생 기록 +1 (서비스 계정으로 Firestore에 씀)
lib/shared.js        위 함수들이 같이 쓰는 코드 (functions/ 밖이라 라우트가 아님)
public/
  view.js, view.css  학생 뷰어 — 웹 폰트도 안 불러올 만큼 가볍게
  admin.html/js/css  관리 페이지 (ohshrt 관리 페이지와 같은 로그인·디자인)
```

Firestore (규칙은 레포 루트 `ohweb-firestore.rules`):

- `notion_pages/{주소}` — `title`, `url`, `order`, `hidden`, `createdAt`, `updatedAt`. 읽기 공개, 쓰기 관리자.
- `notion_stats/{YYYY-MM-DD}_{주소}` — 결과별 카운터 + `lastAt`. 읽기 관리자, 쓰기는 `/api/report`만.

## 배포

`CLOUDFLARE.md` 8번 참고.
