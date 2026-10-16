// 학생 화면 — 열람 기록 한 번, "이상해요" 신고, 수식 그리기.
// 노션 내용은 서버가 HTML로 다 그려서 보내므로(functions/[[slug]].js) 여기서는
// 노션에 아무것도 요청하지 않는다.
(function () {
  const slug = document.body.dataset.slug;
  const notice = document.getElementById('notice');
  const noticeText = document.getElementById('noticeText');

  function report(result) {
    if (!slug) return;
    const body = JSON.stringify({ slug, result });
    try {
      if (navigator.sendBeacon && navigator.sendBeacon('/api/report', new Blob([body], { type: 'application/json' }))) return;
    } catch { /* 아래 fetch로 */ }
    fetch('/api/report', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body, keepalive: true }).catch(() => {});
  }

  // 같은 페이지를 새로고침할 때마다 세지 않도록, 탭마다 한 번만 센다.
  try {
    const key = `viewed:${location.pathname}`;
    if (!sessionStorage.getItem(key)) { sessionStorage.setItem(key, '1'); report('ok'); }
  } catch { report('ok'); }

  let reported = false;
  document.getElementById('reportBtn')?.addEventListener('click', () => {
    if (!reported) report('report');
    reported = true;
    noticeText.textContent = '알려줘서 고마워요. 선생님이 확인할게요.';
    notice.hidden = false;
  });
  document.getElementById('closeNotice')?.addEventListener('click', () => { notice.hidden = true; });

  // 코드 블록 "복사" 버튼(노션처럼 코드 위에 마우스를 올리면 보임).
  // 발표 모드 슬라이드에 복사된 코드에서도 되도록 문서 전체에서 한 번에 받는다.
  document.addEventListener('click', async (e) => {
    const btn = e.target.closest?.('.code-copy');
    if (!btn) return;
    {
      const code = btn.closest('figure.code')?.querySelector('code')?.textContent || '';
      try {
        await navigator.clipboard.writeText(code);
      } catch {
        const ta = document.createElement('textarea');
        ta.value = code;
        document.body.appendChild(ta);
        ta.select();
        try { document.execCommand('copy'); } catch { /* 무시 */ }
        ta.remove();
      }
      btn.textContent = '복사됨';
      setTimeout(() => { btn.textContent = '복사'; }, 1500);
    }
  });

  // 수식(KaTeX는 수식이 있는 페이지에서만 불러온다).
  function renderMath() {
    if (!window.katex) return;
    document.querySelectorAll('.eq').forEach((el) => {
      try {
        window.katex.render(el.textContent, el, { displayMode: el.classList.contains('eq-block'), throwOnError: false });
      } catch { /* 원문 그대로 둔다 */ }
    });
  }
  if (document.querySelector('.eq')) {
    if (window.katex) renderMath();
    else window.addEventListener('load', renderMath);
  }
})();
