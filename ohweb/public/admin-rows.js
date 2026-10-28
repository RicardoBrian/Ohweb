// 목록의 행(또는 표의 줄)을 누르면 수정이 열리게 한다 — 별도 "수정" 연필 버튼 대신.
//
// 쓰는 법: 행에 data-open="실행할 전역 함수 이름"과 data-arg="넘길 값"을 달면 된다.
//   <div class="list-item" data-open="editExam" data-arg="abc123"> …
// 행 안의 버튼·링크·입력·스위치를 누르면 그쪽 동작만 하고 행 클릭은 무시한다.
// 글자를 드래그해서 고르는 중이거나, 끌어서 순서를 바꾸는 중이면 열지 않는다.
// 키보드: 행에 Tab 으로 가서 Enter / Space 로 연다.
(function () {
  var SKIP = 'button, a, input, select, textarea, label, summary, .q-drag-handle, [data-no-open]';

  function openRow(row) {
    var fn = window[row.dataset.open];
    if (typeof fn !== 'function') return;
    fn(row.dataset.arg);
  }

  document.addEventListener('click', function (e) {
    var row = e.target.closest && e.target.closest('[data-open]');
    if (!row || e.target.closest(SKIP)) return;
    var sel = window.getSelection && window.getSelection();
    if (sel && String(sel).length > 0) return;          // 글자를 고르는 중
    openRow(row);
  });

  document.addEventListener('keydown', function (e) {
    if (e.key !== 'Enter' && e.key !== ' ') return;
    var row = e.target.matches && e.target.matches('[data-open]') ? e.target : null;
    if (!row) return;
    e.preventDefault();
    openRow(row);
  });

  // 키보드로 접근할 수 있게 tabindex 와 role 을 달아 준다(목록이 다시 그려질 때마다).
  function decorate(root) {
    (root || document).querySelectorAll('[data-open]:not([tabindex])').forEach(function (row) {
      row.setAttribute('tabindex', '0');
      row.setAttribute('role', 'button');
    });
  }
  new MutationObserver(function () { decorate(); }).observe(document.documentElement, { childList: true, subtree: true });
  decorate();
})();
