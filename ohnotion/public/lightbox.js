// 사진 크게 보기 — 노션처럼 본문 사진을 누르면 어두운 화면 위에 크게 띄운다.
//
//   클릭 / 더블클릭        확대·축소(맞춤 ↔ 2배)
//   휠 / + -              확대·축소,  끌기 = 확대한 사진 옮기기
//   ← →                   같은 페이지(발표 중이면 같은 슬라이드)의 다른 사진
//   Esc / 바깥 클릭 / ✕   닫기
// 발표 모드 슬라이드 안의 사진에서도 된다(슬라이드는 본문을 복사한 것이라 문서 전체에서 클릭을 받는다).
(function () {
  const SEL = '.notion figure.image img';
  const MIN = 1;
  const MAX = 6;

  let box = null;
  let list = [];
  let index = 0;
  let scale = 1;
  let tx = 0;
  let ty = 0;
  let drag = null;
  let moved = false;

  function build() {
    box = document.createElement('div');
    box.className = 'lightbox';
    box.hidden = true;
    box.innerHTML = `
      <div class="lb-top">
        <span class="lb-count"></span>
        <span class="lb-tools">
          <button type="button" data-a="out" title="축소 (-)">−</button>
          <span class="lb-zoom">100%</span>
          <button type="button" data-a="in" title="확대 (+)">+</button>
          <a class="lb-open" target="_blank" rel="noopener" title="원본 새 탭에서 열기">↗</a>
          <button type="button" data-a="close" title="닫기 (Esc)">✕</button>
        </span>
      </div>
      <button type="button" class="lb-nav lb-prev" data-a="prev" aria-label="이전 사진">‹</button>
      <div class="lb-stage"><img class="lb-img" alt=""></div>
      <button type="button" class="lb-nav lb-next" data-a="next" aria-label="다음 사진">›</button>
      <div class="lb-caption"></div>`;
    document.body.appendChild(box);

    box.addEventListener('click', (e) => {
      const a = e.target.closest('[data-a]')?.dataset.a;
      if (a === 'close') return close();
      if (a === 'prev') return show(index - 1);
      if (a === 'next') return show(index + 1);
      if (a === 'in') return zoomTo(scale * 1.5);
      if (a === 'out') return zoomTo(scale / 1.5);
      if (e.target.classList.contains('lb-img')) {
        if (moved) return;   // 끌어서 옮긴 뒤의 클릭은 무시
        return zoomTo(scale > 1 ? 1 : 2, e);
      }
      // 사진 바깥(어두운 곳)을 누르면 닫기
      if (e.target === box || e.target.classList.contains('lb-stage')) close();
    });

    const img = box.querySelector('.lb-img');
    box.querySelector('.lb-stage').addEventListener('wheel', (e) => {
      e.preventDefault();
      zoomTo(scale * (e.deltaY < 0 ? 1.15 : 1 / 1.15), e);
    }, { passive: false });
    img.addEventListener('pointerdown', (e) => {
      moved = false;
      if (scale <= 1) return;
      drag = { x: e.clientX - tx, y: e.clientY - ty };
      img.setPointerCapture(e.pointerId);
      img.classList.add('dragging');
    });
    img.addEventListener('pointermove', (e) => {
      if (!drag) return;
      tx = e.clientX - drag.x;
      ty = e.clientY - drag.y;
      moved = true;
      apply();
    });
    const end = () => { drag = null; img.classList.remove('dragging'); };
    img.addEventListener('pointerup', end);
    img.addEventListener('pointercancel', end);
    img.addEventListener('dragstart', (e) => e.preventDefault());
  }

  function apply() {
    const img = box.querySelector('.lb-img');
    img.style.transform = `translate(${tx}px, ${ty}px) scale(${scale})`;
    img.style.cursor = scale > 1 ? 'grab' : 'zoom-in';
    box.querySelector('.lb-zoom').textContent = `${Math.round(scale * 100)}%`;
  }

  // 누른 곳(또는 가운데)을 기준으로 확대·축소
  function zoomTo(next, e) {
    next = Math.min(MAX, Math.max(MIN, next));
    if (next === 1) { tx = 0; ty = 0; }
    else if (e) {
      const r = box.querySelector('.lb-stage').getBoundingClientRect();
      const cx = e.clientX - (r.left + r.width / 2);
      const cy = e.clientY - (r.top + r.height / 2);
      tx = cx - ((cx - tx) * next) / scale;
      ty = cy - ((cy - ty) * next) / scale;
    }
    scale = next;
    apply();
  }

  function show(i) {
    if (!list.length) return;
    index = (i + list.length) % list.length;
    const src = list[index];
    const img = box.querySelector('.lb-img');
    img.src = src.currentSrc || src.src;
    scale = 1; tx = 0; ty = 0;
    apply();
    box.querySelector('.lb-open').href = img.src;
    const cap = src.closest('figure')?.querySelector('figcaption')?.textContent || '';
    box.querySelector('.lb-caption').textContent = cap;
    box.querySelector('.lb-count').textContent = list.length > 1 ? `${index + 1} / ${list.length}` : '';
    box.querySelectorAll('.lb-nav').forEach((b) => { b.hidden = list.length < 2; });
  }

  function open(img) {
    if (!box) build();
    // 발표 모드가 전체 화면이면 그 안에 있어야 보인다.
    const host = document.fullscreenElement || document.body;
    if (box.parentNode !== host) host.appendChild(box);
    // 발표 중이면 지금 슬라이드의 사진들, 아니면 문서 본문의 사진들 사이를 오간다.
    const scope = img.closest('.slide') || document.querySelector('main.doc') || document;
    list = [...scope.querySelectorAll(SEL)];
    box.hidden = false;
    document.documentElement.classList.add('lb-open');
    show(Math.max(0, list.indexOf(img)));
  }

  function close() {
    if (!box || box.hidden) return;
    box.hidden = true;
    document.documentElement.classList.remove('lb-open');
    box.querySelector('.lb-img').removeAttribute('src');
  }

  document.addEventListener('click', (e) => {
    const img = e.target.closest?.(SEL);
    if (!img || img.closest('a')) return;
    e.preventDefault();
    e.stopPropagation();
    open(img);
  }, true);

  // 발표 모드의 키 처리보다 먼저 받아서, 사진이 떠 있는 동안은 슬라이드가 넘어가지 않게 한다.
  window.addEventListener('keydown', (e) => {
    if (!box || box.hidden) return;
    const k = e.key;
    if (k === 'Escape') close();
    else if (k === 'ArrowRight') show(index + 1);
    else if (k === 'ArrowLeft') show(index - 1);
    else if (k === '+' || k === '=') zoomTo(scale * 1.5);
    else if (k === '-' || k === '_') zoomTo(scale / 1.5);
    else if (k === '0') zoomTo(1);
    else return;
    e.preventDefault();
    e.stopPropagation();
  }, true);
})();
