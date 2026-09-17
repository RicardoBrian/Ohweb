# Cloudflare Pages 이전 가이드

Vercel에 흩어져 있던 4개 앱을 Cloudflare Pages로 옮기고 `kakainfo.com` 하위에 붙인다.
도메인이 이미 Cloudflare에 있으므로 DNS 레코드와 인증서는 자동으로 처리된다.

## 1. 프로젝트별 설정

Cloudflare 대시보드 → Workers & Pages → Create → Pages → Connect to Git → `RicardoBrian/Ohweb` 선택.
같은 레포로 프로젝트를 4개 만든다. 프로젝트 이름은 서로 달라야 한다.

| 프로젝트 | Root directory | Build command | Build output directory | 도메인 |
|---|---|---|---|---|
| `ohinfo` | `ohinfo` | *(비움)* | `public` | `kakainfo.com` (학생용, 루트 도메인) |
| `ohweb` | `ohweb` | *(비움)* | `public` | `admin.kakainfo.com` |
| `ohsettle` | `ohsettle` | *(비움)* | `public` | `settle.kakainfo.com` |
| `seatchange` | `seatchange` | *(비움)* | `public` | `seat.kakainfo.com` |

- **Build command는 반드시 비운다.** 빌드 스텝이 없는 정적 사이트다. 프레임워크 프리셋은 `None`.
- Build output directory는 root directory 기준 상대경로다. 즉 실제 경로는 `ohinfo/public`이 된다.
- 도메인은 위가 제안일 뿐이다. `seat.kakainfo.com` 외에는 원하는 대로 바꿔도 된다.

## 2. Build watch paths — 빼먹으면 안 됨

기본값은 "레포의 아무 파일이나 바뀌면 전 프로젝트 빌드"다. 이대로 두면 seatchange만
고쳐도 4개가 전부 재배포된다. 프로젝트마다 Settings → Build → Build watch paths에서:

| 프로젝트 | Include paths |
|---|---|
| `ohinfo` | `ohinfo/*` |
| `ohweb` | `ohweb/*` |
| `ohsettle` | `ohsettle/*` |
| `seatchange` | `seatchange/*` |

Vercel의 Ignored Build Step에 대응하는 설정이다.

## 3. 커스텀 도메인 붙이기

프로젝트 → Custom domains → Set up a custom domain → 예: `seat.kakainfo.com` 입력.

`kakainfo.com`이 같은 Cloudflare 계정에 있으므로 CNAME 레코드가 자동 생성되고
인증서도 자동 발급된다. **DNS를 손으로 건드릴 필요가 없다.**

> Vercel + Cloudflare 조합에서 겪던 문제(CNAME 수동 입력, 주황 구름 프록시와
> 인증서 충돌)가 여기서는 발생하지 않는다. 이게 이번 이전의 가장 큰 실익이다.

## 4. `/api/translate` — Vercel 함수의 Cloudflare 대응

`ohinfo`와 `ohweb`은 번역 API를 쓴다. Vercel의 `api/translate.js`는 Node 스타일
`(req, res)` 시그니처라 Cloudflare에서 그대로 돌지 않아서, 웹 표준
`Request → Response`로 옮긴 `functions/api/translate.js`를 각 프로젝트에 추가했다:

```
ohinfo/functions/api/translate.js   (Cloudflare)
ohweb/functions/api/translate.js    (Cloudflare)
```

호출부(`fetch('/api/translate', ...)`)는 경로가 같아서 한 줄도 고치지 않았다.

이전이 끝난 뒤 옛 Vercel 파일(`ohinfo/api/`, `ohweb/api/`, 각 프로젝트의
`vercel.json`)은 모두 삭제했다. 이제 4개 앱 전부 Cloudflare Pages에서만
서빙된다.

### 첫 배포 때 확인할 것

Pages Functions는 프로젝트 루트(= root directory 적용 후)의 `functions/` 디렉터리를
찾는다. 즉 `ohweb/functions/`가 인식되어야 한다. 문서 설명이 모호한 부분이라
**첫 배포 후 반드시 실제로 찔러보고 확인한다:**

```sh
curl -X POST https://admin.kakainfo.com/api/translate \
  -H 'Content-Type: application/json' \
  -d '{"texts":["자리 바꾸기"],"targetLang":"EN"}'
# 기대: {"translations":[{"text":"change seats"}]}
```

404가 나오면 Functions가 인식되지 않은 것이다. 그때는 `functions/`를
`public/` 안이 아니라 바깥(현재 위치)에 둔 게 맞는지, Pages 빌드 로그에
`Compiled Worker` 줄이 있는지부터 본다.

## 4-1. 환경변수(Secret) — 프로젝트별로 따로 넣어야 한다

| 프로젝트 | 변수명 | 값 | 쓰는 곳 |
|---|---|---|---|
| `ohweb` | `GOOGLE_TRANSLATE_KEY` | Google Cloud Translation API 키 | `/api/translate` |
| `ohweb` | `FIREBASE_SERVICE_ACCOUNT_KEY` | 서비스 계정 JSON 전체 | `/api/reset-student-password` (학생 비밀번호 재설정) |
| `ohinfo` | `GOOGLE_TRANSLATE_KEY` | 위와 같은 값 | `/api/translate` |
| `ohinfo` | `FIREBASE_SERVICE_ACCOUNT_KEY` | 위와 같은 값 | `/api/grade-exam` (시험 채점) |

**서비스 계정 키는 두 프로젝트에 같은 값을 넣으면 된다.** Pages 프로젝트가
다르면 환경변수도 따로 관리되므로, 한쪽만 넣으면 그쪽 기능만 동작한다.

키 발급: Firebase 콘솔 → 프로젝트 설정(⚙) → 서비스 계정 → "새 비공개 키 생성".
키 **삭제**는 Firebase 콘솔에 없다 — Google Cloud 콘솔 → IAM 및 관리자 →
서비스 계정 → 해당 계정 → 키 탭에서 지운다.

### 매번 걸리는 것 세 가지

1. **이름 오타.** 한 글자만 달라도 함수에서는 그냥 "없음"으로 보인다.
2. **Production / Preview는 별개다.** 커스텀 도메인(admin.kakainfo.com 등)은
   Production이다. Preview에만 넣으면 실제 사이트에서는 안 붙는다.
3. **넣은 뒤 재배포해야 적용된다.** 환경변수는 배포 시점에 묶여서, 이미 떠
   있는 배포에는 소급되지 않는다. Deployments 탭 → 맨 위 배포 →
   Retry deployment, 또는 새 커밋 푸시.

`/api/reset-student-password`는 키가 없을 때 관리자에게 현재 배포에 들어와
있는 환경변수 **이름 목록**을 돌려준다(값은 안 준다). 위 셋 중 뭐가 틀렸는지
브라우저 콘솔에서 바로 확인할 수 있다.

## 5. 이전 순서

라이브 서비스를 깨지 않으려면 도메인 전환을 마지막에 한다.

1. 4개 Pages 프로젝트 생성 → `*.pages.dev` 임시 주소로 먼저 배포된다.
2. 임시 주소에서 각 앱을 실제로 눌러본다. 특히 **번역 기능**과 **Firestore 읽기/쓰기**.
   - Firebase 콘솔 → Authentication → Settings → Authorized domains에
     `*.pages.dev`와 최종 도메인을 추가해야 로그인이 동작한다.
3. 문제없으면 커스텀 도메인을 붙인다.
4. Vercel 프로젝트를 지우고, 레포에서 `vercel.json`과 `api/`를 삭제한다.

**완료됨.** 4개 앱 전부 `kakainfo.com` 하위 서브도메인(Cloudflare에서 구입한
도메인)에 연결돼 있고, Vercel 프로젝트·`vercel.json`·`api/`는 레포에서 모두
제거했다.

## 6. seatchange

새로 추가한 4번째 앱. `theme.css`는 `design-reference/`에서 복사한 것으로 나머지
3개와 동일하다. 자세한 내용은 `seatchange/README.md`.

## 7. ohshrt — URL 단축기, 나머지 4개와 동일한 방식(Pages)

`ohshrt`는 URL 단축기다. 처음엔 Cloudflare Workers + KV로 독립적으로 만들었었는데,
Workers Builds(Git 연동 배포)에서 시크릿이 실제 배포된 Worker에 안 붙는 문제를
반복적으로 겪어서(대시보드 프로젝트 이름과 `wrangler.toml`의 `name`이 서로 다른
리소스를 가리키는 등) 포기하고, **나머지 4개와 동일하게 Pages + Firebase**로
다시 만들었다. 그래서 이 프로젝트도:

> Workers & Pages → Create → **Pages**(Workers 아님) → Connect to Git →
> `RicardoBrian/Ohweb` 선택 → Root directory `ohshrt`, Build output directory `public`

1번 섹션의 나머지 4개와 완전히 동일한 설정이다. 별도의 KV/Secret/wrangler.toml이
필요 없다 — 데이터는 `ohweb-93062`의 Firestore `short_links` 컬렉션에 저장되고
(규칙은 `ohweb-firestore.rules` 참고), 로그인은 ohweb과 동일한 Google 로그인
(`admin-auth.js`)이다.

Custom domain: **`short.kakainfo.com`** — 단, 이건 **관리 페이지**의 도메인이다.
단축 링크 자체는 학생용 짧은 도메인인 **`kakainfo.com/코드`**로 나가고, 그
리다이렉트는 ohinfo 프로젝트의 `ohinfo/functions/[[code]].js`가 처리한다
(ohshrt에도 같은 사본이 있다 — 한쪽 고치면 다른 쪽도 같이 고쳐야 함).

Build watch paths도 다른 4개와 동일하게 `ohshrt/*`로 좁힌다. 자세한 내용은
`ohshrt/README.md`.
