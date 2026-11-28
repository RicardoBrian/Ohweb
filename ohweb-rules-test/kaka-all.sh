#!/usr/bin/env bash
# kaká 테스트 묶음을 차례로 돌리고 한 줄씩만 보여 준다(실패한 줄은 다 보여 준다).
# 사용: npm run test:kaka-all
export LC_ALL=en_US.UTF-8 LANG=en_US.UTF-8
cd "$(dirname "$0")"; node build-fbcdn.mjs >/dev/null; fail=0
for t in kaka-course kaka-doc kaka-student kaka-python kaka-flow; do
  out=$(npx firebase emulators:exec --only firestore,auth --project ohweb-93062 "node $t.e2e.mjs" 2>&1)
  n=$(grep -c "^✅" <<<"$out" || true)
  if grep -qE "^❌|실패" <<<"$out"; then fail=1; echo "❌ $t — $n passed"; grep -E "^❌" <<<"$out" | sed 's/^/   /'; else echo "✅ $t — $n checks"; fi
done
exit $fail
