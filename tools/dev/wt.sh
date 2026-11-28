#!/usr/bin/env bash
# 작업용 깨끗한 폴더(git worktree)를 origin/main 에서 만든다. 사용자의 커밋 안 한 작업(~/code/Ohweb)은 건드리지 않는다.
# 사용: tools/dev/wt.sh <브랜치이름>   → 만든 폴더 경로를 출력. 끝나면 tools/dev/wt.sh --rm <브랜치이름>
set -euo pipefail
REPO=$(git -C "$(dirname "$0")" rev-parse --show-toplevel 2>/dev/null || echo "$HOME/code/Ohweb")
MAIN="$HOME/code/Ohweb"
BASE="${TMPDIR:-/tmp}/ohweb-wt"
if [ "${1:-}" = "--rm" ]; then
  d="$BASE/$2"; git -C "$MAIN" worktree remove --force "$d" 2>/dev/null || true; git -C "$MAIN" branch -D "$2" >/dev/null 2>&1 || true; echo "지움: $d"; exit 0
fi
br="${1:?브랜치 이름}"; d="$BASE/$br"
mkdir -p "$BASE"
git -C "$MAIN" fetch -q origin main
git -C "$MAIN" worktree add -q -b "$br" "$d" origin/main
# 테스트 의존성은 원본 폴더 것을 빌려 쓴다(설치 안 함). 커밋에는 안 들어간다(.gitignore).
EX="$(git -C "$MAIN" rev-parse --path-format=absolute --git-common-dir)/info/exclude"; grep -qx "ohweb-rules-test/node_modules" "$EX" 2>/dev/null || echo "ohweb-rules-test/node_modules" >> "$EX"
[ -d "$MAIN/ohweb-rules-test/node_modules" ] && ln -s "$MAIN/ohweb-rules-test/node_modules" "$d/ohweb-rules-test/node_modules"
echo "$d"
