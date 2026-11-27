#!/bin/bash
# 맥에 AI 채점 워커를 launchd 로 등록한다(로그인하면 자동 시작, 죽으면 다시 뜸).
#   bash tools/ai-grading/install.sh          설치·재시작
#   bash tools/ai-grading/install.sh remove   제거
set -e
LABEL=com.kakainfo.ai-grading
PLIST="$HOME/Library/LaunchAgents/$LABEL.plist"
LOG="$HOME/Library/Logs/kakainfo-ai-grading.log"
DIR="$(cd "$(dirname "$0")" && pwd)"
launchctl bootout "gui/$(id -u)/$LABEL" 2>/dev/null || true
if [ "$1" = "remove" ]; then rm -f "$PLIST"; echo "제거함"; exit 0; fi
NODE="$(command -v node)"; CLAUDE="$(command -v claude)"
[ -n "$NODE" ] && [ -n "$CLAUDE" ] || { echo "node 와 claude 가 PATH 에 있어야 합니다"; exit 1; }
mkdir -p "$HOME/Library/LaunchAgents"
cat > "$PLIST" <<PL
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0"><dict>
  <key>Label</key><string>$LABEL</string>
  <key>ProgramArguments</key><array><string>$NODE</string><string>$DIR/worker.mjs</string></array>
  <key>EnvironmentVariables</key><dict>
    <key>PATH</key><string>$(dirname "$CLAUDE"):$(dirname "$NODE"):/usr/local/bin:/usr/bin:/bin</string>
    <key>AI_GRADER_CMD</key><string>$CLAUDE</string>
  </dict>
  <key>RunAtLoad</key><true/>
  <key>KeepAlive</key><true/>
  <key>ThrottleInterval</key><integer>30</integer>
  <key>StandardOutPath</key><string>$LOG</string>
  <key>StandardErrorPath</key><string>$LOG</string>
</dict></plist>
PL
launchctl bootstrap "gui/$(id -u)" "$PLIST"
echo "설치함 — 로그: $LOG"
