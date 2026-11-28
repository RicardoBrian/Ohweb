#!/usr/bin/env bash
# 스테이징한 변경을 커밋 → push → PR → squash 합치기. 지금 폴더(worktree)의 브랜치에서 쓴다.
# 사용: tools/dev/ship.sh "커밋·PR 제목" "PR 본문(선택)"
# 내가 바꾼 파일만 git add 한 뒤에 부른다(git add -A 금지 — 원본 폴더엔 사용자 작업이 있다).
set -euo pipefail
title="${1:?제목}"; body="${2:-}"
CO="${CO_AUTHOR:-Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>}"
br=$(git rev-parse --abbrev-ref HEAD)
[ "$br" = main ] && { echo "❌ main 에서는 안 됩니다"; exit 1; }
git diff --cached --quiet && { echo "❌ 스테이징된 변경이 없습니다"; exit 1; }
git diff --cached --name-status | sed 's/^/  /'
git commit -q -m "$title" -m "$CO"
git push -q -u origin "$br" 2>&1 | grep -v "^remote:" || true
url=$(gh pr create --title "$title" --body "$(printf '%s\n\n🤖 Generated with [Claude Code](https://claude.com/claude-code)' "$body")")
gh pr merge "$url" --squash --delete-branch >/dev/null 2>&1 || gh pr merge "$url" --squash >/dev/null
echo "✅ 합침: $url"
