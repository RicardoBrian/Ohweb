// 발표 모드 — 노션 페이지를 슬라이드로 보여 준다(노션 유료 기능 대신).
//
// 슬라이드 나누는 규칙(노션에서 페이지를 쓰는 습관 그대로):
//   1. 구분선(---)마다 새 슬라이드(구분선 자체는 안 보임)
//   2. 그리고 "제목 1"마다 새 슬라이드(2개 이상일 때). 제목 1이 1개 이하면 "제목 2"마다
//   3. 둘 다 없으면 본문 전체가 한 장
//   맨 앞에는 항상 표지(아이콘 + 페이지 제목).
//
// 조작: → ↓ Space PageDown Enter = 다음 / ← ↑ PageUp Backspace = 이전 / Home End
//       F = 전체 화면, B 또는 . = 화면 가리기, Esc = 끝내기, 화면 오른쪽/왼쪽 클릭, 스와이프.
//       발표용 리모컨(클리커)은 보통 PageDown/PageUp을 보내므로 그대로 된다.
// 주소에 #present(또는 #present=3)를 붙이면 바로 발표 모드로 열린다.
(function () {
  const W = 1280;           // 슬라이드 설계 크기(16:9). 화면에 맞춰 통째로 확대/축소한다.
  const H = 720;
  const PAD = 72;           // 슬라이드 안쪽 여백
  const MIN_FIT = 0.55;     // 내용이 넘치면 이 배율까지 줄이고, 그래도 넘치면 슬라이드 안에서 스크롤

  const doc = document.querySelector('.notion');
  if (!doc) return;

  let deck = null;          // 발표 화면 요소
  let slides = [];
  let index = 0;
  let hideTimer = null;

  // ── 슬라이드 만들기 ──
  function isHeading(el, tag) {
    if (el.tagName === tag) return true;
    // 토글 제목(<details class="toggle-h"><summary><h2>)도 제목으로 본다.
    return el.matches?.('details.toggle-h') && !!el.querySelector(`:scope > summary > ${tag.toLowerCase()}`);
  }

  function buildSlides() {
    const nodes = [...doc.children].filter((n) => !n.matches('.toc'));
    const groups = [];
    let splitTag = null;
    if (nodes.filter((n) => isHeading(n, 'H2')).length >= 2) splitTag = 'H2';
    else if (nodes.filter((n) => isHeading(n, 'H3')).length >= 2) splitTag = 'H3';
    let cur = [];
    for (const n of nodes) {
      if (n.tagName === 'HR') { groups.push(cur); cur = []; continue; }
      if (splitTag && isHeading(n, splitTag) && cur.length) { groups.push(cur); cur = []; }
      cur.push(n);
    }
    groups.push(cur);

    const out = [titleSlide()];
    for (const g of groups) {
      // 빈 문단만 있는 묶음은 건너뛴다.
      if (!g.some((n) => (n.textContent || '').trim() || n.querySelector?.('img, iframe, video, table, pre'))) continue;
      const s = document.createElement('section');
      s.className = 'slide';
      const inner = document.createElement('div');
      inner.className = 'slide-inner notion';
      for (const n of g) {
        const c = n.cloneNode(true);
        if (c.matches?.('details.toggle-h')) c.open = true;
        inner.appendChild(c);
      }
      s.appendChild(inner);
      out.push(s);
    }
    return out;
  }

  // 표지: 학생들이 보고 들어올 주소(note.kakainfo.com/주소)를 화면 폭에 꽉 차게.
  // 페이지 제목은 위에 작게. 하위 페이지에서 발표해도 주소는 학습지 첫 주소로 보여 준다
  // (/주소/긴ID는 학생이 따라 치기 어렵고, 들어오면 본문 링크로 이동할 수 있으니까).
  function titleSlide() {
    const s = document.createElement('section');
    s.className = 'slide slide-title';
    const cover = document.querySelector('.cover');
    if (cover) s.style.setProperty('--cover', getComputedStyle(cover).backgroundImage);

    const head = document.createElement('div');
    head.className = 'title-head';
    const icon = document.querySelector('.doc-icon');
    if (icon) {
      const i = icon.cloneNode(true);
      i.className = 'slide-icon';
      head.appendChild(i);
    }
    const h = document.createElement('h1');
    h.textContent = document.querySelector('.doc-title')?.textContent || document.title;
    head.appendChild(h);
    s.appendChild(head);

    const slug = document.body.dataset.slug || '';
    const addr = document.createElement('div');
    addr.className = 'title-addr';
    addr.innerHTML = '<div class="addr-label">이 주소로 들어오세요</div><div class="addr-url"><span class="addr-host"></span><span class="addr-slug"></span></div>';
    addr.querySelector('.addr-host').textContent = `${location.host}/`;
    addr.querySelector('.addr-slug').textContent = slug;
    s.appendChild(addr);
    return s;
  }

  // 주소 글씨를 슬라이드 폭(여백 제외)에 꼭 맞는 크기로.
  // 한 줄로 했을 때 너무 작아지면(긴 주소) 두 줄로 나눠 각 줄을 폭에 맞춘다.
  function fitAddress(s) {
    const url = s.querySelector('.addr-url');
    if (!url) return;
    const host = url.querySelector('.addr-host');
    const slug = url.querySelector('.addr-slug');
    const avail = W - PAD * 2;
    const fitOne = (el, max) => {
      el.style.fontSize = '100px';
      const w = el.scrollWidth || el.getBoundingClientRect().width;
      return w ? Math.min(max, Math.floor((100 * avail) / w)) : max;
    };
    url.classList.remove('two-line');
    host.style.fontSize = slug.style.fontSize = '';
    url.style.fontSize = '';
    const one = fitOne(url, 240);
    if (one >= 110) { url.style.fontSize = `${one}px`; return; }
    url.classList.add('two-line');
    url.style.fontSize = '';
    const slugSize = fitOne(slug, 260);
    host.style.fontSize = `${Math.min(fitOne(host, 140), slugSize)}px`;
    slug.style.fontSize = `${slugSize}px`;
  }

  // ── 화면 ──
  function open(start = 0) {
    if (deck) return;
    slides = buildSlides();
    deck = document.createElement('div');
    deck.className = 'deck';
    deck.innerHTML = `
      <div class="deck-stage"><div class="deck-canvas"></div></div>
      <div class="deck-blank" hidden></div>
      <div class="deck-ui">
        <button type="button" data-a="prev" aria-label="이전">‹</button>
        <span class="deck-count"></span>
        <button type="button" data-a="next" aria-label="다음">›</button>
        <button type="button" data-a="full" aria-label="전체 화면">⛶</button>
        <button type="button" data-a="close" aria-label="발표 끝내기">✕</button>
      </div>
      <div class="deck-progress"><span></span></div>`;
    const canvas = deck.querySelector('.deck-canvas');
    slides.forEach((s) => canvas.appendChild(s));
    document.body.appendChild(deck);
    document.body.classList.add('presenting');
    // 코드 색칠(Prism)이 늦게 끝났을 수도 있어 슬라이드 쪽도 한 번 더 칠한다.
    try { window.Prism?.highlightAllUnder?.(canvas); } catch { /* 무시 */ }

    deck.querySelector('.deck-ui').addEventListener('click', (e) => {
      const a = e.target.closest('button')?.dataset.a;
      if (a === 'prev') go(index - 1);
      else if (a === 'next') go(index + 1);
      else if (a === 'full') toggleFull();
      else if (a === 'close') close();
    });
    // 화면 왼쪽 1/3 클릭 = 이전, 나머지 = 다음(링크·버튼·영상·코드는 제외).
    deck.querySelector('.deck-stage').addEventListener('click', (e) => {
      if (e.target.closest('a, button, iframe, video, audio, summary, pre, input, .htmlfile')) return;
      if (window.getSelection()?.toString()) return;
      go(e.clientX < window.innerWidth / 3 ? index - 1 : index + 1);
    });
    let touchX = null;
    deck.addEventListener('touchstart', (e) => { touchX = e.touches[0].clientX; }, { passive: true });
    deck.addEventListener('touchend', (e) => {
      if (touchX == null) return;
      const dx = e.changedTouches[0].clientX - touchX;
      if (Math.abs(dx) > 50) go(dx < 0 ? index + 1 : index - 1);
      touchX = null;
    }, { passive: true });
    deck.addEventListener('mousemove', showUi);
    window.addEventListener('resize', layout);
    document.addEventListener('keydown', onKey, true);

    layout();
    // 이미지·글꼴이 늦게 오면 높이가 바뀌므로 그때 다시 맞춘다(세로 가운데 유지).
    let relayout = null;
    const later = () => { clearTimeout(relayout); relayout = setTimeout(layout, 50); };
    canvas.addEventListener('load', later, true);
    document.fonts?.ready?.then(later);
    go(Math.min(Math.max(start, 0), slides.length - 1), true);
    showUi();
  }

  function close() {
    if (!deck) return;
    if (document.fullscreenElement) document.exitFullscreen?.().catch(() => {});
    document.removeEventListener('keydown', onKey, true);
    window.removeEventListener('resize', layout);
    deck.remove();
    deck = null;
    document.body.classList.remove('presenting');
    if (location.hash.startsWith('#present')) history.replaceState(null, '', location.pathname + location.search);
  }

  // 1280×720 슬라이드를 화면에 맞게 확대/축소하고, 넘치는 슬라이드는 내용만 더 줄인다.
  function layout() {
    if (!deck) return;
    const scale = Math.min(window.innerWidth / W, window.innerHeight / H);
    const canvas = deck.querySelector('.deck-canvas');
    canvas.style.transform = `translate(-50%, -50%) scale(${scale})`;
    slides.forEach(fit);
  }
  function fit(s) {
    if (s.classList.contains('slide-title')) { fitAddress(s); return; }   // 표지는 주소 크기만 맞춘다
    const inner = s.querySelector('.slide-inner');
    inner.style.transform = '';
    inner.style.width = '';
    inner.style.right = '';
    inner.style.top = '';
    s.classList.remove('slide-scroll');
    const avail = H - PAD * 2;
    const need = inner.scrollHeight;
    if (need <= avail) {
      // 남는 높이의 절반만큼 내려서 세로 가운데에 둔다(PPT처럼).
      inner.style.top = `${PAD + Math.floor((avail - need) / 2)}px`;
      return;
    }
    const f = avail / need;
    if (f < MIN_FIT) {
      // 너무 많이 줄여야 하면 글씨는 그대로 두고 슬라이드 안에서 스크롤한다(위에서부터).
      s.classList.add('slide-scroll');
      return;
    }
    // 줄인 뒤에도 가로 폭이 슬라이드 폭과 같도록, 줄이기 전 폭을 1/f 만큼 넓혀 둔다.
    // 줄이면 높이가 꼭 맞으므로 위쪽 여백 그대로.
    inner.style.right = 'auto';
    inner.style.width = `${(W - PAD * 2) / f}px`;
    inner.style.transform = `scale(${f})`;
  }

  function go(i, instant = false) {
    if (!deck) return;
    index = Math.min(Math.max(i, 0), slides.length - 1);
    slides.forEach((s, k) => {
      s.classList.toggle('active', k === index);
      s.classList.toggle('before', k < index);
      if (instant) s.style.transition = 'none';
    });
    if (instant) requestAnimationFrame(() => slides.forEach((s) => { s.style.transition = ''; }));
    // 지나간 슬라이드의 영상은 멈춘다(유튜브 등은 iframe을 다시 불러 멈춘다).
    slides.forEach((s, k) => {
      if (k === index) return;
      s.querySelectorAll('video, audio').forEach((m) => m.pause?.());
    });
    const active = slides[index];
    const activeInner = active.querySelector('.slide-inner');
    if (activeInner) activeInner.scrollTop = 0;
    // 지금 슬라이드와 다음 슬라이드의 늦게 불러오는 이미지/iframe을 미리 불러온다.
    [active, slides[index + 1]].filter(Boolean).forEach((s) => s.querySelectorAll('[loading="lazy"]').forEach((el) => { el.loading = 'eager'; }));
    deck.querySelector('.deck-count').textContent = `${index + 1} / ${slides.length}`;
    deck.querySelector('.deck-progress span').style.width = `${((index + 1) / slides.length) * 100}%`;
    history.replaceState(null, '', `${location.pathname}${location.search}#present=${index + 1}`);
  }

  function toggleFull() {
    if (document.fullscreenElement) document.exitFullscreen?.().catch(() => {});
    else deck?.requestFullscreen?.().catch(() => {});
  }

  function showUi() {
    if (!deck) return;
    deck.classList.add('show-ui');
    clearTimeout(hideTimer);
    hideTimer = setTimeout(() => deck?.classList.remove('show-ui'), 2500);
  }

  function onKey(e) {
    if (!deck) return;
    if (e.target.closest?.('input, textarea, [contenteditable]')) return;
    const blank = deck.querySelector('.deck-blank');
    const k = e.key;
    let handled = true;
    if (['ArrowRight', 'ArrowDown', 'PageDown', ' ', 'Enter', 'n', 'N'].includes(k)) { blank.hidden = true; go(index + 1); }
    else if (['ArrowLeft', 'ArrowUp', 'PageUp', 'Backspace', 'p', 'P'].includes(k)) { blank.hidden = true; go(index - 1); }
    else if (k === 'Home') go(0);
    else if (k === 'End') go(slides.length - 1);
    else if (k === 'f' || k === 'F') toggleFull();
    else if (k === 'b' || k === 'B' || k === '.') blank.hidden = !blank.hidden;
    else if (k === 'Escape') { if (!document.fullscreenElement) close(); }
    else handled = false;
    if (handled) { e.preventDefault(); e.stopPropagation(); }
  }

  // ── 시작 ──
  function startFromHash() {
    const m = location.hash.match(/^#present(?:=(\d+))?$/);
    if (m) open(m[1] ? Number(m[1]) - 1 : 0);
  }
  document.getElementById('presentBtn')?.addEventListener('click', () => {
    open(0);
    deck?.requestFullscreen?.().catch(() => {});
  });
  window.addEventListener('hashchange', () => { if (!deck) startFromHash(); });
  // 글꼴·수식·코드 색칠이 끝난 뒤 복사해야 슬라이드에도 그대로 나온다.
  if (document.readyState === 'complete') startFromHash();
  else window.addEventListener('load', startFromHash);
})();
