#!/usr/bin/env bash
# 배포 확인: 주소의 내용에 글자(정규식)가 보일 때까지 최대 N초(기본 150). .html 은 308 이라 -L 로 따라간다.
# 사용: tools/dev/wait-deploy.sh <주소> <찾을 글자> [초]   여러 개면 여러 번 부른다.
url="${1:?주소}"; pat="${2:?찾을 글자}"; max="${3:-150}"; t=0
while [ "$t" -lt "$max" ]; do
  if curl -sL "$url?nocache=$RANDOM" | grep -qE "$pat"; then echo "✅ 배포됨(${t}초): $url"; exit 0; fi
  sleep 10; t=$((t + 10))
done
echo "❌ ${max}초 안에 안 보임: $url"; exit 1
