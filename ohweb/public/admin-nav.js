// 관리 페이지 공통 메뉴 — PC 왼쪽 사이드바 + 모바일 하단 탭바 (보기 전용)
// 페이지의 기존 상단 바(.nav) 안에 메뉴를 넣고, 와플 버튼·다크 토글은 같은 요소를 그대로 옮긴다.
// 이동은 원래 와플 메뉴와 똑같이: admin.html 안에서는 goApp(), 다른 페이지에서는 같은 주소로.
// 모양은 admin-sky.css (body.ui-sky) 가 담당한다.
(function () {
  var MENU = [
    ['관리', [['schools', '학교', 'school'], ['students', '학생', 'people'], ['apps', '앱 설정', 'grid']]],
    ['수업', [['paddlet', '정보 게시판', 'board'], ['exam', '시험', 'clipboard'], ['ailab', 'AI 실험실', 'ai'],
              ['forms', '설문지', 'doc'], ['messages', '학생 질문', 'chat']]],
    ['도구', [['timer', '타이머', 'timer'], ['notice', '공지 메모', 'notice'], ['settle', '정산 관리', 'wallet']]],
  ];
  var TABS = [['students', '학생', 'people'], ['schools', '학교', 'school'], ['exam', '시험', 'clipboard'], ['messages', '질문', 'chat']];
  var PAGES = { forms: 'forms.html', messages: 'messages.html', timer: 'timer.html', notice: 'notice.html', settle: 'settle.html' };

  // 메뉴 아이콘 (페이지마다 가진 아이콘이 달라서 따로 둔다)
  var ICONS = {
    school: '<path d="M12 4 3 8.5 12 13l9-4.5Z"/><path d="M7 10.8V16c0 1.2 2.2 3 5 3s5-1.8 5-3v-5.2"/><path d="M20 8.5V15"/>',
    people: '<circle cx="9" cy="8" r="3"/><path d="M3.5 19c0-3 2.5-5 5.5-5s5.5 2 5.5 5"/><circle cx="17" cy="9" r="2.4"/><path d="M14.8 19c.2-2.3 1.9-4 3.9-4.3"/>',
    grid: '<rect x="4" y="4" width="7" height="7" rx="1.5"/><rect x="13" y="4" width="7" height="7" rx="1.5"/><rect x="4" y="13" width="7" height="7" rx="1.5"/><rect x="13" y="13" width="7" height="7" rx="1.5"/>',
    board: '<rect x="3" y="4" width="18" height="12" rx="1.5"/><path d="M7 12.5h5M9 16l-3 4.5M15 16l3 4.5"/>',
    clipboard: '<rect x="5" y="5" width="14" height="16" rx="2"/><rect x="9" y="3.3" width="6" height="3.2" rx="1"/><path d="M8 12h8M8 16h6"/>',
    ai: '<rect x="5" y="7" width="14" height="11" rx="3"/><path d="M12 7V4M3 11.5V14M21 11.5V14"/><circle cx="9.5" cy="12.5" r="1"/><circle cx="14.5" cy="12.5" r="1"/>',
    doc: '<path d="M7 3.5h7l4 4v13a1 1 0 0 1-1 1H7a1 1 0 0 1-1-1V4.5a1 1 0 0 1 1-1Z"/><path d="M14 3.5V8h4M8.5 13h7M8.5 16.5H13"/>',
    chat: '<path d="M4 5.5h16a1 1 0 0 1 1 1V16a1 1 0 0 1-1 1H9l-4.5 4V17H4a1 1 0 0 1-1-1V6.5a1 1 0 0 1 1-1Z"/>',
    timer: '<circle cx="12" cy="13" r="8"/><path d="M12 13V8.5M12 13l3 1.5M9.5 2.5h5"/>',
    notice: '<path d="M4 9v6h3l6 4V5L7 9Z"/><path d="M17.5 9.5a4 4 0 0 1 0 5"/>',
    wallet: '<rect x="3" y="6" width="18" height="13" rx="2"/><path d="M3 9h14a3 3 0 0 1 3 3"/><circle cx="16.5" cy="13" r="1"/>',
    more: '<circle cx="6" cy="12" r="1.2"/><circle cx="12" cy="12" r="1.2"/><circle cx="18" cy="12" r="1.2"/>',
  };
  function icon(name, size) {
    return '<svg width="' + size + '" height="' + size + '" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' + ICONS[name] + '</svg>';
  }

  var onAdmin = !!document.getElementById('section-students') && typeof window.goApp === 'function';
  var page = (location.pathname.split('/').pop() || '').replace('.html', '');

  window.adminNavGo = function (id) {
    if (onAdmin && !PAGES[id]) { window.goApp(id); return; }
    if (onAdmin && (id === 'forms' || id === 'messages')) { window.goApp(id); return; }
    location.href = PAGES[id] || ('admin.html#' + id);
  };

  var nav = document.querySelector('.nav');
  if (!nav) return;
  var brand = nav.querySelector('.nav-brand');
  if (brand && !brand.querySelector('.nav-brand-sub')) {
    var sub = document.createElement('span'); sub.className = 'nav-brand-sub'; sub.textContent = '관리자';
    brand.appendChild(sub);
  }

  // 사이드바 메뉴
  var side = document.createElement('div');
  side.className = 'side-menu';
  side.innerHTML = MENU.map(function (g) {
    return '<div class="side-head">' + g[0] + '</div>' + g[1].map(function (m) {
      return '<button type="button" class="side-item" data-sec="' + m[0] + '" onclick="adminNavGo(\'' + m[0] + '\')">' + icon(m[2], 18) + m[1] + '</button>';
    }).join('');
  }).join('');
  if (brand) brand.after(side); else nav.prepend(side);

  // 와플·다크 토글을 한 줄(.nav-right)로 모은다 — 같은 요소를 옮기기만 한다
  var right = nav.querySelector('.nav-right');
  if (!right) {
    right = document.createElement('div'); right.className = 'nav-right';
    nav.appendChild(right);
    nav.querySelectorAll(':scope > .waffle-btn, :scope > .dark-toggle').forEach(function (el) { right.appendChild(el); });
  }
  if (!right.querySelector('.nav-dark-label')) {
    var lab = document.createElement('span'); lab.className = 'nav-dark-label'; lab.textContent = '다크 모드';
    right.prepend(lab);
  }

  // 모바일 하단 탭바 — 자주 쓰는 화면 + 나머지는 메뉴(와플)
  var bar = document.createElement('nav');
  bar.className = 'tabbar';
  bar.innerHTML = TABS.map(function (t) {
    return '<button type="button" class="tab" data-sec="' + t[0] + '" onclick="adminNavGo(\'' + t[0] + '\')">' + icon(t[2], 22) + t[1] + '</button>';
  }).join('') + (typeof window.openAppModal === 'function'
    ? '<button type="button" class="tab" onclick="openAppModal()">' + icon('more', 22) + '더보기</button>' : '');
  document.body.appendChild(bar);

  // 지금 화면 표시
  function mark(name) {
    document.querySelectorAll('.side-item[data-sec], .tab[data-sec]').forEach(function (b) { b.classList.toggle('on', b.dataset.sec === name); });
  }
  if (onAdmin) {
    var sync = function () { var a = document.querySelector('.section.active'); mark(a ? a.id.replace('section-', '') : ''); };
    var obs = new MutationObserver(sync);
    document.querySelectorAll('.section').forEach(function (s) { obs.observe(s, { attributes: true, attributeFilter: ['class'] }); });
    sync();
  } else {
    mark(page);
  }
})();
