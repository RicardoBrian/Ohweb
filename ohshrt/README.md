# oh sh.rt

비밀번호로 보호되는 관리 페이지와 누구나 접근 가능한 단축 URL을 제공하는
Cloudflare Workers 기반 URL 단축기입니다.

## 기능

- 관리 페이지(`/`)는 비밀번호 입력 후에만 접근 가능
- 단축된 URL(`/코드`)은 누구나 접근 가능 (302 리다이렉트)
- 원본 URL 입력 시 자동 코드 생성, 또는 커스텀 코드 지정 가능
- 관리 페이지에서 링크 목록 조회 / 복사 / 삭제
- 별도 빌드 과정 없는 순수 HTML/CSS/JS + Workers 정적 에셋

## 로컬 개발

```bash
npm install

# KV 네임스페이스 생성 (최초 1회)
npx wrangler kv namespace create LINKS
# 출력된 id를 wrangler.toml의 id 값에 넣어주세요

# 로컬 환경변수 설정 (.dev.vars 파일 생성, git에는 커밋되지 않음)
cat <<'EOF' > .dev.vars
ADMIN_PASSWORD=여기에_원하는_비밀번호
SESSION_SECRET=여기에_임의의_긴_랜덤_문자열
EOF

npm run dev
```

`http://localhost:8788` 에서 확인할 수 있습니다.

## 배포

Cloudflare 대시보드에서 **Workers & Pages → Create → Workers → Import a
repository** 로 이 저장소를 연결하면, 빌드 명령 없이 기본 배포 명령
(`npx wrangler deploy`)만으로 배포됩니다.

배포 전에 아래 두 가지를 설정해야 합니다.

1. **KV 바인딩** — 위에서 만든 네임스페이스 id를 `wrangler.toml`의
   `[[kv_namespaces]]` id 값에 넣고 커밋합니다. (대시보드에서
   Settings → Bindings 로 연결해도 됩니다.)
2. **Secret 두 개** — 대시보드의 Settings → Variables and Secrets 에서
   추가하거나, 아래 명령으로 등록합니다.

   ```bash
   npx wrangler secret put ADMIN_PASSWORD
   npx wrangler secret put SESSION_SECRET
   ```

   - `ADMIN_PASSWORD`: 관리 페이지 비밀번호
   - `SESSION_SECRET`: 세션 쿠키 서명용 임의의 긴 랜덤 문자열

배포가 끝나면 `프로젝트명.<서브도메인>.workers.dev` 주소가 생성되며,
Settings → Domains & Routes 에서 커스텀 도메인을 연결할 수 있습니다.

로컬에서 직접 배포하려면:

```bash
npx wrangler login
npm run deploy
```

## 구조

```
src/
  index.js      Worker 진입점 — /api/* 라우팅과 단축코드 리다이렉트
  utils.js      세션 쿠키 서명/검증 유틸
public/
  index.html, style.css, app.js   관리 페이지 (정적 에셋으로 서빙)
wrangler.toml   정적 에셋 및 KV 바인딩 설정
```

`public/` 의 파일과 경로가 겹치지 않는 요청만 Worker로 전달되므로,
`/` 는 관리 페이지가, `/코드` 는 리다이렉트가 처리됩니다.
