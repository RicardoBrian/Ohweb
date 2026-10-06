#!/bin/sh
# AI 실험실 파일(ai-*.js, ailab.js, ai-themes.css)을 불러오는 주소에 버전(?v=)을 붙인다.
# 고친 파일을 브라우저가 예전 것으로 기억해 "does not provide an export named …" 오류가
# 나는 것을 막는다. AI 실험실 파일을 고친 뒤 커밋 전에 한 번 실행한다(모든 곳에 같은 버전이 붙는다).
set -e
cd "$(dirname "$0")/../public"
V=${1:-$(date +%Y%m%d%H%M)}
sed -i -E "s#'\./(ai-[a-z0-9]+|ailab)\.js(\?v=[^']*)?'#'./\1.js?v=$V'#g" ai-*.js ailab.js aiapp.html ailab.html
sed -i -E "s#src=\"ailab\.js(\?v=[^\"]*)?\"#src=\"ailab.js?v=$V\"#; s#href=\"ai-themes\.css(\?v=[^\"]*)?\"#href=\"ai-themes.css?v=$V\"#" aiapp.html ailab.html
echo "AI 실험실 버전: $V"
