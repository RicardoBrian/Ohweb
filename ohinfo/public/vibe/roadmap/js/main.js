(() => {
  const map = document.getElementById('roadmap');
  const stages = [...map.querySelectorAll('.stage')];
  let clearTimer;

  // ---- 단계 강조: 그림·제목·항목 어디에 올려도 같은 단계 전체가 반응 ----
  function activate(stage) {
    clearTimeout(clearTimer);
    stages.forEach((s) => s.classList.toggle('is-active', s === stage));
    map.dataset.active = stage ? stage.dataset.stage : '';
  }

  function scheduleClear() {
    clearTimeout(clearTimer);
    // 같은 단계 안에서 그림 → 글자로 옮길 때 깜빡이지 않도록 약간 지연
    clearTimer = setTimeout(() => activate(null), 80);
  }

  stages.forEach((stage) => {
    const hotspots = stage.querySelectorAll('.stage__art, .stage__link, .item');
    hotspots.forEach((el) => {
      el.addEventListener('pointerenter', () => activate(stage));
      el.addEventListener('pointerleave', scheduleClear);
      el.addEventListener('focus', () => activate(stage));
      el.addEventListener('blur', scheduleClear);
    });

    const art = stage.querySelector('.stage__art');
    art.addEventListener('pointerenter', () => stage.classList.add('is-art-hover'));
    art.addEventListener('pointerleave', () => stage.classList.remove('is-art-hover'));
  });
})();
