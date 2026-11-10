// 다국어 학습지 — 언어 고르기.
//
// 관리 페이지에서 "다국어 학습지"로 등록한 주소는 서버가 body 에 data-langs="en,zh"(한국어 말고
// 다른 언어들)와 data-lang="지금 언어"를 붙여 준다. 언어마다 노션 페이지가 따로 있고,
// /주소?lang=en 이면 서버가 그 언어 페이지를 그린다(functions/[[slug]].js).
//
// 학생이 언어를 안 고르고 그냥 보는 일이 많아서, 이 주소를 탭에서 처음 열면 **반드시 먼저 고르게**
// 한다(가리개를 닫을 수 없음). 학교 PC는 여러 학생이 같이 쓰므로 고른 언어는 그 탭에만 기억한다
// (sessionStorage) — 다음 시간에 다른 학생이 열면 다시 묻는다.
// 선생님 브라우저(관리 페이지에 로그인한 적 있는 곳)는 묻지 않는다. 위쪽 🌐 버튼으로 언제든 바꿀 수 있다.
// 발표 따라가기 중에도 가리개가 발표 화면 위에 뜨고, 고르면 그 언어 페이지에서 같은 장으로 이어진다.
(function () {
  // ⚠ public/admin.js 의 LANGS 와 같게 유지한다.
  const NAMES = {
    ko: '한국어', en: 'English', zh: '中文', ru: 'Русский', vi: 'Tiếng Việt', ja: '日本語',
    uz: 'Oʻzbekcha', mn: 'Монгол', kk: 'Қазақша', ky: 'Кыргызча', th: 'ไทย',
    tl: 'Filipino', km: 'ខ្មែរ', ne: 'नेपाली', id: 'Bahasa Indonesia', ar: 'العربية',
    es: 'Español', fr: 'Français', de: 'Deutsch',
  };
  // 가리개 제목 — 그 학습지에 있는 언어로 "언어를 고르세요"를 같이 보여 준다.
  const ASK = {
    ko: '언어를 고르세요', en: 'Choose your language', zh: '请选择语言', ru: 'Выберите язык',
    vi: 'Chọn ngôn ngữ', ja: '言語を選んでください', uz: 'Tilni tanlang', mn: 'Хэлээ сонгоно уу',
    kk: 'Тілді таңдаңыз', ky: 'Тилди тандаңыз', th: 'เลือกภาษา', tl: 'Piliin ang wika',
    km: 'ជ្រើសរើសភាសា', ne: 'भाषा छान्नुहोस्', id: 'Pilih bahasa', ar: 'اختر لغتك',
    es: 'Elige tu idioma', fr: 'Choisissez votre langue', de: 'Sprache wählen',
  };

  const body = document.body;
  const slug = body.dataset.slug;
  const others = (body.dataset.langs || '').split(',').filter(Boolean);
  if (!slug || !others.length) return;
  const all = ['ko', ...others];
  const current = body.dataset.lang || 'ko';
  const key = `lang-picked:${slug}`;
  const name = (c) => NAMES[c] || c;

  const btn = document.getElementById('langBtn');
  if (btn) {
    btn.textContent = `🌐 ${name(current)}`;
    btn.addEventListener('click', () => show(false));
  }

  let isTeacher = false;
  try { isTeacher = localStorage.getItem('kakanotion-teacher') === '1'; } catch { /* 학생 */ }
  let picked = false;
  try {
    // 언어가 붙은 링크(?lang=en)로 바로 들어왔으면 고른 것으로 본다.
    if (new URLSearchParams(location.search).has('lang')) sessionStorage.setItem(key, current);
    picked = !!sessionStorage.getItem(key);
  } catch { /* 저장 못 하면 매번 묻는다 */ }
  if (!isTeacher && !picked) show(true);

  function choose(code) {
    try { sessionStorage.setItem(key, code); } catch { /* 무시 */ }
    if (code === current) { document.querySelector('.lang-pick')?.remove(); return; }
    // 발표 중이면(#present=3) 그 장 그대로 이어지게 해시는 남긴다.
    const qs = code === 'ko' ? '' : `?lang=${encodeURIComponent(code)}`;
    location.replace(`${location.pathname}${qs}${location.hash}`);
  }

  function show(forced) {
    if (document.querySelector('.lang-pick')) return;
    const box = document.createElement('div');
    box.className = 'lang-pick';
    box.setAttribute('role', 'dialog');
    box.setAttribute('aria-modal', 'true');
    const title = all.map((c) => ASK[c]).filter(Boolean);
    box.innerHTML = `
      <div class="lang-card">
        <div class="lang-globe">🌐</div>
        <div class="lang-ask">${title.map((t, i) => `<div${i ? ' class="sub"' : ''}></div>`).join('')}</div>
        <div class="lang-list"></div>
        ${forced ? '' : '<button type="button" class="lang-close" aria-label="닫기">✕</button>'}
      </div>`;
    box.querySelectorAll('.lang-ask > div').forEach((el, i) => { el.textContent = title[i]; });
    const list = box.querySelector('.lang-list');
    all.forEach((c) => {
      const b = document.createElement('button');
      b.type = 'button';
      b.className = `lang-opt${c === current && !forced ? ' on' : ''}`;
      b.lang = c;
      b.textContent = name(c);
      b.addEventListener('click', () => choose(c));
      list.appendChild(b);
    });
    box.querySelector('.lang-close')?.addEventListener('click', () => box.remove());
    // 고르기 전에는 발표 화면 단축키 등 다른 키가 먹지 않게 한다(Tab·Enter 로 고르는 건 됨).
    box.addEventListener('keydown', (e) => {
      if (e.key === 'Escape' && !forced) box.remove();
      if (!['Tab', 'Enter', ' '].includes(e.key)) e.stopPropagation();
    });
    body.appendChild(box);
    box.querySelector('.lang-opt')?.focus();
  }
})();
