#!/usr/bin/env node
// AI 채점 테스트용 가짜 claude: 프롬프트를 받아 [A#] 마다 점수를 돌려준다.
// 답에 "상자" 가 있으면 만점, "모름" 이면 flag. 받은 프롬프트는 AI_STUB_LOG 에 덧붙인다.
import { appendFileSync } from 'node:fs';
let s = ''; process.stdin.on('data', d => s += d); process.stdin.on('end', () => {
  if (process.env.AI_STUB_LOG) appendFileSync(process.env.AI_STUB_LOG, s + '\n=====\n');
  const max = Number((s.match(/배점 (\d+)점/) || [])[1] || 0);
  const items = [...s.matchAll(/^\[(A\d+)\] (.*)$/gm)].map(([, id, v]) => ({ id, score: /상자/.test(v) ? max + 5 : 3,
    reason: /상자/.test(v) ? '핵심어가 있다.' : '핵심어가 빠졌다.', flag: /모름/.test(v), flagReason: /모름/.test(v) ? '판단 어려움' : '' }));
  process.stdout.write(JSON.stringify({ is_error: false, structured_output: { items }, modelUsage: { 'stub-model': {} } }));
});
