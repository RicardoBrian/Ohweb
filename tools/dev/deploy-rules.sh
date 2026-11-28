#!/usr/bin/env bash
# Firestore 규칙(ohweb-firestore.rules) 배포: 지금 운영 규칙 = origin/main 인지 확인 → 이 폴더 파일로 배포 → 다시 받아 같은지 확인.
# 사용: tools/dev/deploy-rules.sh [--check]   (--check 는 비교만)
# 운영이 main 과 다르면(누가 콘솔에서 고침) 배포하지 않고 멈춘다.
set -euo pipefail
ROOT=$(git rev-parse --show-toplevel); P=ohweb-93062
FB="$HOME/code/Ohweb/ohweb-rules-test/node_modules/.bin/firebase"
TMP=$(mktemp -d); trap 'rm -rf "$TMP"' EXIT
"$FB" projects:list >/dev/null 2>&1 || true   # 로그인 토큰 새로 받기
live() {
  local tok rel
  tok=$(node -e "console.log(require(process.env.HOME+'/.config/configstore/firebase-tools.json').tokens.access_token)")
  rel=$(curl -s -H "Authorization: Bearer $tok" "https://firebaserules.googleapis.com/v1/projects/$P/releases/cloud.firestore" | node -e "let s='';process.stdin.on('data',d=>s+=d).on('end',()=>console.log(JSON.parse(s).rulesetName))")
  curl -s -H "Authorization: Bearer $tok" "https://firebaserules.googleapis.com/v1/$rel" | node -e "let s='';process.stdin.on('data',d=>s+=d).on('end',()=>process.stdout.write(JSON.parse(s).source.files[0].content))"
}
live > "$TMP/live.rules"
git -C "$ROOT" fetch -q origin main
git -C "$ROOT" show origin/main:ohweb-firestore.rules > "$TMP/main.rules"
if ! diff -q "$TMP/live.rules" "$TMP/main.rules" >/dev/null; then
  if diff -q "$TMP/live.rules" "$ROOT/ohweb-firestore.rules" >/dev/null; then echo "✅ 운영 규칙이 이미 이 폴더 파일과 같습니다"; exit 0; fi
  echo "❌ 운영 규칙이 main 과 다릅니다(콘솔에서 고쳤나?) — 배포 안 함"; diff "$TMP/main.rules" "$TMP/live.rules" | head -20; exit 1
fi
if diff -q "$TMP/live.rules" "$ROOT/ohweb-firestore.rules" >/dev/null; then echo "✅ 바뀐 규칙 없음"; exit 0; fi
echo "바뀌는 부분:"; diff "$TMP/live.rules" "$ROOT/ohweb-firestore.rules" | sed 's/^/  /' | head -40
[ "${1:-}" = "--check" ] && exit 0
cp "$ROOT/ohweb-firestore.rules" "$TMP/ohweb-firestore.rules"
echo '{"firestore":{"rules":"ohweb-firestore.rules"}}' > "$TMP/firebase.json"
(cd "$TMP" && "$FB" deploy --only firestore:rules --project $P 2>&1 | grep -E "Deploy complete|Error" )
live > "$TMP/after.rules"
diff -q "$TMP/after.rules" "$ROOT/ohweb-firestore.rules" >/dev/null && echo "✅ 운영 규칙 = 이 파일" || { echo "❌ 배포 뒤에도 다릅니다"; exit 1; }
