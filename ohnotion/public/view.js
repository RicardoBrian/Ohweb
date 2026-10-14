// 노션 뷰어 — iframe이 실제로 열렸는지 지켜보고, 안 열리면 학생에게 대안을
// 보여주고, 결과를 /api/report로 한 번 보낸다(관리 페이지 모니터링용).
// 판정 기준은 functions/[[slug]].js 머리말 참고.
(function () {
  const SLOW_MS = 8000;      // 이보다 늦게 열리면 '느림'
  const TIMEOUT_MS = 20000;  // 이때까지 안 열리면 '안 열림'
  const LOOP_LOADS = 4;      // LOOP_WINDOW_MS 안에 이만큼 다시 로드되면 '무한 새로고침'
  const LOOP_WINDOW_MS = 40000;

  const wrap = document.getElementById('frameWrap');
  const frame = document.getElementById('frame');
  const loading = document.getElementById('loading');
  const notice = document.getElementById('notice');
  const noticeText = document.getElementById('noticeText');
  const slug = wrap.dataset.slug;
  const src = frame.getAttribute('src');

  let start = Date.now();
  let loads = [];
  let reported = false;
  let timeoutTimer = null;
  let settleTimer = null;

  function report(result, ms) {
    if (reported) return;
    reported = true;
    const body = JSON.stringify({ slug, result, ms: Math.round(ms || 0) });
    try {
      if (navigator.sendBeacon && navigator.sendBeacon('/api/report', new Blob([body], { type: 'application/json' }))) return;
    } catch { /* 아래 fetch로 */ }
    fetch('/api/report', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body, keepalive: true }).catch(() => {});
  }

  function showNotice(text) {
    noticeText.textContent = text;
    notice.hidden = false;
  }

  function arm() {
    clearTimeout(timeoutTimer);
    clearTimeout(settleTimer);
    start = Date.now();
    loads = [];
    loading.hidden = false;
    timeoutTimer = setTimeout(() => {
      if (loads.length) return;
      report('timeout', Date.now() - start);
      showNotice('노션이 열리지 않고 있어요. 새 탭에서 열어 보세요.');
    }, TIMEOUT_MS);
  }

  // about:blank(우리가 멈출 때 넣는 빈 화면)의 load는 세지 않는다. 같은 출처라
  // 주소를 읽을 수 있고, 노션이 열려 있으면 교차 출처라 읽다가 예외가 난다.
  function isBlank() {
    try { return frame.contentWindow.location.href === 'about:blank'; } catch { return false; }
  }

  function onLoad(now) {
    if (isBlank()) return;
    loads.push(now);
    loading.hidden = true;
    clearTimeout(timeoutTimer);

    const recent = loads.filter((t) => now - t <= LOOP_WINDOW_MS);
    if (recent.length >= LOOP_LOADS) {
      report('loop', now - start);
      showNotice('노션이 계속 새로고침되고 있어요. 새 탭에서 열어 보세요.');
      // 무한 새로고침을 멈춘다 — 그대로 두면 학생 PC만 계속 바쁘다.
      frame.src = 'about:blank';
      return;
    }
    if (loads.length === 1) {
      // 첫 로드 뒤 잠깐 더 지켜보고(무한 새로고침인지) 정상으로 기록한다.
      const ms = now - start;
      clearTimeout(settleTimer);
      settleTimer = setTimeout(() => report(ms > SLOW_MS ? 'slow' : 'ok', ms), LOOP_WINDOW_MS);
    }
  }

  // 결과를 보내기 전에 페이지를 떠나면 그때까지의 상태로 기록한다.
  window.addEventListener('pagehide', () => {
    if (reported) return;
    const elapsed = Date.now() - start;
    if (loads.length) report(loads[0] - start > SLOW_MS ? 'slow' : 'ok', loads[0] - start);
    else if (elapsed > SLOW_MS) report('timeout', elapsed);
  });

  document.getElementById('reportBtn').addEventListener('click', () => {
    // 버튼 신고는 자동 판정과 별개로 항상 남긴다.
    reported = false;
    clearTimeout(settleTimer);
    report('report', Date.now() - start);
    showNotice('알려줘서 고마워요. 그동안은 새 탭에서 열어 보세요.');
  });

  function reloadFrame() {
    notice.hidden = true;
    arm();
    frame.src = src;
  }
  document.getElementById('reloadBtn').addEventListener('click', reloadFrame);
  document.getElementById('retryBtn').addEventListener('click', reloadFrame);
  document.getElementById('closeNotice').addEventListener('click', () => { notice.hidden = true; });

  // iframe의 onload 속성이 load 시각을 window.__frameLoads에 쌓는다 — 이 스크립트가
  // 늦게 받아져서 첫 load를 놓쳐도 그 기록으로 따라잡는다.
  const early = window.__frameLoads || [];
  const seen = early.length;
  window.__frameLoads = { push: (t) => onLoad(t) };
  arm();
  // 시작 시각은 페이지를 열기 시작한 때로 잡는다(이 스크립트가 늦게 돌아도 정확하게).
  start = performance.timeOrigin || start;
  for (let i = 0; i < seen; i++) onLoad(early[i]);
})();
