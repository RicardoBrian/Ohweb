/* =========================================================
   자료 보기 창
   - 주소 #항목id → 항목 자료 창, #stage-N → 단계 개요 창
   - 뒤로가기·Esc·바깥 클릭·✕ 로 닫힘
   - 자료 목록: assets/data.json (나중에 구글 시트에서 생성)
   - PDF: pdf.js 로 직접 그림 (휴대폰에서도 같은 화면), 영상: YouTube
   ========================================================= */
(() => {
  const dialog = document.getElementById('viewer');
  const DATA_URL = 'assets/data.json';
  const PDFJS = new URL('assets/vendor/pdfjs/', document.baseURI).href;
  // 항목에 들어가면 자료가 1개여도 카드 화면부터 (false 로 바꾸면 예전처럼 1개면 바로 열림)
  const ITEM_CARDS_ALWAYS = true;

  // ---- 로드맵 구조는 index.html 이 원본 ----
  const stages = [...document.querySelectorAll('.stage')].map((el) => ({
    n: Number(el.dataset.stage),
    id: `stage-${el.dataset.stage}`,
    name: el.querySelector('.stage__name').textContent.trim(),
    art: el.querySelector('.stage__art img').getAttribute('src'),
    items: [],
  }));
  const items = [];
  document.querySelectorAll('.stage').forEach((el, i) => {
    el.querySelectorAll('.item').forEach((a) => {
      const item = { id: a.hash.slice(1), title: a.textContent.trim(), stage: stages[i] };
      stages[i].items.push(item);
      items.push(item);
    });
  });
  const stageById = new Map(stages.map((s) => [s.id, s]));
  const itemById = new Map(items.map((it) => [it.id, it]));

  // ---- 자료 목록 ----
  let materials = new Map();
  let intros = {};
  let introPages = {}; // 카드뉴스 PDF → 배포 때 만든 쪽 그림 (있으면 PDF 를 그리지 않고 바로 보여줌)
  let version = '';
  let loadFailed = false;
  const dataReady = fetch(DATA_URL, { cache: 'no-cache' })
    .then((r) => {
      if (!r.ok) throw new Error(`${r.status}`);
      return r.json();
    })
    .then((data) => {
      intros = data.intros || {};
      introPages = data.introPages || {};
      version = data.version || '';
      for (const m of data.materials || []) {
        if (!materials.has(m.item)) materials.set(m.item, []);
        materials.get(m.item).push(m);
      }
    })
    .catch((err) => {
      loadFailed = true;
      console.error('자료 목록을 불러오지 못했습니다:', err);
    });

  // ---- 유틸 ----
  const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
  }[c]));

  function youtubeId(v) {
    if (!v) return '';
    if (/^[\w-]{11}$/.test(v)) return v;
    try {
      const u = new URL(v);
      if (u.hostname === 'youtu.be') return u.pathname.slice(1, 12);
      if (u.searchParams.get('v')) return u.searchParams.get('v');
      const m = u.pathname.match(/\/(?:embed|shorts|live)\/([\w-]{11})/);
      return m ? m[1] : '';
    } catch {
      return '';
    }
  }

  // ---- 분류 (시트의 "분류" 칸) ----
  // 분류가 하나라도 있으면: 항목 → 분류 카드 → 분류별 자료
  // 분류 칸이 빈 자료는 "공통"으로 묶음
  const COMMON = '공통';
  const hasGroups = (list) => list.some((m) => (m.group || '').trim());

  function groupsOf(list) {
    const out = [];
    for (const m of list) {
      const name = (m.group || '').trim() || COMMON;
      let g = out.find((x) => x.name === name);
      if (!g) out.push(g = { name, list: [] });
      g.list.push(m);
    }
    return out;
  }

  const groupPath = (item, name) => `${item.id}/${encodeURIComponent(name)}`;

  // 카드 아래 설명: 자료 제목 2개 + 외 N (보는 사람에게 '무슨 내용'이 있는지)
  // 파일 이름 앞의 꼬리표([2025 보도자료 15], (붙임1) 등)는 떼고 내용만. 자료를 열면 원래 제목 그대로
  function titlesOf(list) {
    if (!list.length) return '자료 준비 중';
    const clean = (t) => String(t).replace(/^\s*(?:[\[(【［（][^\])】］）]{0,40}[\])】］）]\s*)+/, '').replace(/[-_\s]+$/, '').trim() || t;
    const names = [...new Set(list.map((m) => clean(m.title || '')).filter(Boolean))];
    return names.slice(0, 2).join(' · ') + (names.length > 2 ? ` 외 ${names.length - 2}` : '');
  }

  const ICON = {
    pdf: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M7 3h7l5 5v12a1 1 0 0 1-1 1H7a1 1 0 0 1-1-1V4a1 1 0 0 1 1-1z" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linejoin="round"/><path d="M14 3v5h5M9 13h6M9 17h4" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/></svg>',
    intro: '<svg viewBox="0 0 24 24" aria-hidden="true"><rect x="4" y="4" width="13" height="13" rx="2.5" fill="none" stroke="currentColor" stroke-width="1.8"/><path d="M20 8v10a2 2 0 0 1-2 2H8" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/></svg>',
    web: '<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="8.5" fill="none" stroke="currentColor" stroke-width="1.8"/><path d="M3.5 12h17M12 3.5c2.5 2.6 3.5 5.4 3.5 8.5s-1 5.9-3.5 8.5c-2.5-2.6-3.5-5.4-3.5-8.5s1-5.9 3.5-8.5z" fill="none" stroke="currentColor" stroke-width="1.6"/></svg>',
    home: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 11l8-7 8 7M6 9.5V20h12V9.5" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg>',
    full: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 9V4h5M20 9V4h-5M4 15v5h5M20 15v5h-5" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg>',
    video: '<svg viewBox="0 0 24 24" aria-hidden="true"><rect x="3" y="5" width="18" height="14" rx="3" fill="none" stroke="currentColor" stroke-width="1.8"/><path d="M10 9.2v5.6l4.8-2.8z" fill="currentColor"/></svg>',
    close: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M6 6l12 12M18 6L6 18" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"/></svg>',
    next: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M9 5l7 7-7 7" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"/></svg>',
    minus: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M6 12h12" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"/></svg>',
    plus: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M6 12h12M12 6v12" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"/></svg>',
    download: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 4v11m0 0l-4.5-4.5M12 15l4.5-4.5M5 19h14" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg>',
    external: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M14 4h6v6M20 4l-9 9M18 14v5a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V7a1 1 0 0 1 1-1h5" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg>',
  };

  // ---- 주소(해시) ↔ 창 ----
  // #stage-N, #항목id, #항목id/분류, 웹앱 썸네일에서 고른 자료는 끝에 /번호 (#항목id/2, #항목id/분류/2)
  function routeOf(hash) {
    const parts = hash.replace(/^#/, '').split('/');
    const pick = parts.length > 1 && /^\d+$/.test(parts[parts.length - 1]) ? Number(parts.pop()) : 0;
    const [id, g] = parts;
    const group = g ? decodeURIComponent(g) : null;
    if (!group && !pick && stageById.has(id)) return { kind: 'stage', stage: stageById.get(id), path: id };
    if (itemById.has(id)) {
      const base = group ? groupPath(itemById.get(id), group) : id;
      return { kind: 'item', item: itemById.get(id), group, pick, base, path: pick ? `${base}/${pick}` : base };
    }
    return null;
  }

  // 창 안에서 몇 번 이동했는지 기억 → 닫을 때 그만큼 뒤로 가서 로드맵 주소로 복귀
  const depth = () => (history.state && history.state.viewerDepth) || 0;

  function go(path, replace) {
    const d = replace ? depth() : depth() + 1;
    history[replace ? 'replaceState' : 'pushState']({ viewerDepth: d }, '', `#${path}`);
    render();
  }

  function close() {
    const shut = () => {
      history.replaceState(null, '', location.pathname + location.search);
      render();
    };
    const d = depth();
    if (d <= 0) return shut();
    history.go(-d);
    // 창 안에 띄운 웹사이트에서 이동했으면 그 기록이 끼어 있어 위에서 다 못 돌아감 → 그래도 닫기
    setTimeout(() => { if (routeOf(location.hash)) shut(); }, 400);
  }

  document.addEventListener('click', (e) => {
    const a = e.target.closest('a[href^="#"]');
    if (!a || e.defaultPrevented || e.metaKey || e.ctrlKey || e.shiftKey) return;
    const route = routeOf(a.getAttribute('href'));
    if (!route) return;
    e.preventDefault();
    go(route.path, a.hasAttribute('data-replace'));
  });

  // 단계·항목에 손가락·마우스를 올리면 그 카드뉴스 첫 장을 미리 받음
  const warmLink = (e) => {
    const a = e.target.closest?.('a[href^="#"]');
    if (!a) return;
    let id = a.getAttribute('href').slice(1).split('/')[0];
    try { id = decodeURIComponent(id); } catch { return; }
    dataReady.then(() => warmIntro(id));
  };
  ['pointerover', 'touchstart', 'focusin'].forEach((t) => document.addEventListener(t, warmLink, { passive: true }));
  // 첫 화면이 다 뜬 뒤 쉬는 틈에 다섯 단계 카드뉴스 첫 장 (단계를 가장 먼저 누르므로)
  window.addEventListener('load', () => dataReady.then(() => setTimeout(() => stages.forEach((st) => warmIntro(st.id)), 800)));

  window.addEventListener('popstate', render);
  window.addEventListener('hashchange', render);

  dialog.addEventListener('cancel', (e) => {
    e.preventDefault();
    close();
  });

  // 바깥(배경) 클릭 시 닫기
  dialog.addEventListener('click', (e) => {
    if (e.target === dialog) close();
  });

  // ---- 그리기 ----
  let shownKey = '';
  let cleanup = () => {};
  let token = 0;

  function openDialog() {
    if (dialog.open) return;
    dialog.classList.remove('is-closing');
    dialog.showModal();
    document.documentElement.classList.add('has-modal');
  }

  function closeDialog() {
    if (!dialog.open) return;
    cleanup();
    cleanup = () => {};
    shownKey = '';
    const done = () => {
      dialog.close();
      dialog.classList.remove('is-closing');
      dialog.replaceChildren();
      document.documentElement.classList.remove('has-modal');
    };
    if (matchMedia('(prefers-reduced-motion: reduce)').matches) return done();
    dialog.classList.add('is-closing');
    setTimeout(done, 180);
  }

  async function render() {
    const route = routeOf(location.hash);
    if (!route) return closeDialog();
    if (route.path === shownKey && dialog.open) return;
    shownKey = route.path;
    cleanup();
    cleanup = () => {};
    const my = ++token;

    openDialog();
    if (route.kind === 'stage') renderStage(route.stage);
    else renderItem(route, my);
  }

  // 머리글: [위치 표시 / 제목]  ……  [닫기]
  // 단계 화면은 제목 대신 단계 탭(①~⑤)을 보여줌 — 지금 단계가 보이고 다른 단계로 바로 이동
  // up: 왼쪽 위 ‹ 가 가는 곳 = 바로 한 단계 위 (자료 → 카드 화면 → 분류 → 단계)
  function head({ stage, title, crumb, tabs = '', up = '' }) {
    return `
      <header class="viewer__head${tabs ? ' has-tabs' : ''}">
        <div class="viewer__heading">
          <div class="viewer__crumb">${up ? `<a class="viewer__up" href="#${esc(up)}" data-replace aria-label="한 단계 위로" title="한 단계 위로"></a>` : ''}${crumb}</div>
          <div class="viewer__titleline">
            <h2 class="viewer__title${tabs ? ' sr-only' : ''}" id="viewer-title" tabindex="-1">${esc(title)}</h2>
          </div>
          ${tabs}
        </div>
        <img class="viewer__art" src="${esc(stage.art)}" alt="">
        <div class="viewer__actions">
          <button class="hbtn viewer__close" type="button" aria-label="닫기">${ICON.close}</button>
        </div>
      </header>`;
  }

  function stageTabs(current) {
    return `
      <nav class="stagetabs" aria-label="단계">
        ${stages.map((s) => `
          <a class="stagetab" href="#${s.id}" data-replace${s === current ? ' aria-current="page"' : ''}>
            <span class="stagetab__num">${s.n}</span><span class="stagetab__name">${esc(s.name)}</span>
          </a>`).join('')}
      </nav>`;
  }

  function mount(html) {
    dialog.innerHTML = html;
    dialog.setAttribute('aria-labelledby', 'viewer-title');
    dialog.querySelector('.viewer__close').addEventListener('click', close);
    dialog.querySelector('#viewer-title').focus({ preventScroll: true });
  }

  // ---- 단계 개요 ----
  async function renderStage(stage) {
    await dataReady;
    const cards = stage.items.map((it) => {
      const list = materials.get(it.id) || [];
      let meta = !list.length && intros[it.id] ? '소개 카드뉴스' : titlesOf(list);
      if (hasGroups(list)) {
        const names = groupsOf(list).map((g) => g.name);
        meta = names.slice(0, 3).join(' · ') + (names.length > 3 ? ` 외 ${names.length - 3}` : '');
      }
      return `
        <li><a class="card" href="#${esc(it.id)}">
          <span class="card__title">${esc(it.title)}</span>
          <span class="card__meta${list.length || intros[it.id] ? '' : ' is-empty'}">${esc(meta)}</span>
          ${intros[it.id] ? '' : '<span class="card__todo">카드뉴스 준비 중</span>'}
          <span class="card__arrow">${ICON.next}</span>
        </a></li>`;
    }).join('');
    mount(`
      ${head({
        stage,
        title: stage.name,
        crumb: '<span>학생 성장 지원 로드맵</span>',
        tabs: stageTabs(stage),
      })}
      <div class="viewer__body viewer__body--stage has-intro">
        ${intros[stage.id] ? introMarkup(stage.name) : introEmpty()}
        <ul class="cards">${cards}</ul>
      </div>`);
    if (intros[stage.id]) showIntro(dialog.querySelector('.intro'), intros[stage.id]);
    stage.items.forEach((it) => warmIntro(it.id)); // 이 단계 항목들의 카드뉴스 첫 장
    // 휴대폰에서 가로로 넘치면 지금 단계 탭이 보이게
    const cur = dialog.querySelector('.stagetab[aria-current]');
    if (cur) cur.scrollIntoView({ block: 'nearest', inline: 'center' });
  }

  // ---- 소개 카드뉴스 (단계·항목): 정사각형 PDF 한 쪽 = 카드 한 장, 옆으로 넘김 ----
  const TYPES = { video: '영상', intro: '카드뉴스', web: '웹' };

  // 불러오는 중 표시 (용량을 알면 % 함께)
  const LOADING = '<div class="loading" role="status"><span class="spinner"></span><span class="loading__text">불러오는 중…</span></div>';
  function progress(task, box) {
    task.onProgress = ({ loaded, total }) => {
      const t = box.querySelector('.loading__text');
      if (t && total) t.textContent = `불러오는 중… ${Math.min(99, Math.round((loaded / total) * 100))}%`;
    };
  }

  // 카드뉴스가 아직 없는 자리: 어디가 빠졌는지 보이게
  function introEmpty() {
    return `
      <section class="intro intro--empty" aria-label="소개 카드뉴스 준비 중">
        <div class="intro__empty">${ICON.intro}<span>소개 카드뉴스 준비 중</span></div>
      </section>`;
  }

  function introMarkup(name) {
    return `
      <section class="intro" aria-label="${esc(name)} 소개">
        <div class="intro__track" tabindex="0"></div>
        <button class="intro__nav intro__nav--prev" type="button" aria-label="이전 카드">${ICON.next}</button>
        <button class="intro__nav intro__nav--next" type="button" aria-label="다음 카드">${ICON.next}</button>
        <div class="intro__dots" aria-hidden="true"></div>
      </section>`;
  }

  // 카드뉴스 그림 주소 (배포마다 ?v= 가 바뀌어 고친 카드뉴스가 바로 보임)
  const introSrcs = (file) => (introPages[file]?.pages || []).map((p) => `${p}?v=${encodeURIComponent(version)}`);

  // 미리 받아 두기: 열기 전에 첫 장을 받아 두면 누르자마자 보임 (같은 주소라 브라우저가 다시 받지 않음)
  const warmed = new Set();
  function warmIntro(id, all) {
    const srcs = introSrcs(intros[id]);
    for (const src of all ? srcs : srcs.slice(0, 1)) {
      if (warmed.has(src)) continue;
      warmed.add(src);
      const img = new Image();
      img.decoding = 'async';
      img.src = src;
    }
  }

  async function showIntro(box, file) {
    const track = box.querySelector('.intro__track');
    const dots = box.querySelector('.intro__dots');
    let alive = true;
    const prevCleanup = cleanup;
    let task;
    cleanup = () => { alive = false; if (task) task.destroy(); prevCleanup(); };
    const srcs = introSrcs(file);
    const ok = srcs.length && await new Promise((done) => {
      // 그림으로 바로 (첫 장을 못 받으면 예전처럼 PDF 를 그림)
      const { w, h } = introPages[file];
      track.innerHTML = srcs.map((src, j) => `<img class="intro__card" src="${esc(src)}" width="${w}" height="${h}"
        alt="소개 카드 ${j + 1} / ${srcs.length}" decoding="async"${j ? '' : ' fetchpriority="high"'}>`).join('');
      dots.innerHTML = '<span></span>'.repeat(srcs.length);
      const first = track.firstElementChild;
      if (first.complete && first.naturalWidth) return done(true);
      first.addEventListener('load', () => done(true), { once: true });
      first.addEventListener('error', () => done(false), { once: true });
    });
    if (!alive) return;
    if (!ok) { track.replaceChildren(); dots.replaceChildren(); }
    if (!ok) try {
      const lib = await loadPdfjs();
      task = lib.getDocument({ url: new URL(file, document.baseURI).href, cMapUrl: `${PDFJS}cmaps/`, cMapPacked: true, standardFontDataUrl: `${PDFJS}standard_fonts/` });
      track.innerHTML = LOADING;
      progress(task, track);
      const doc = await task.promise;
      track.replaceChildren();
      const size = Math.max(track.clientWidth, 320) * Math.min(window.devicePixelRatio || 1, 2);
      for (let n = 1; n <= doc.numPages && alive; n++) {
        const page = await doc.getPage(n);
        const vp = page.getViewport({ scale: size / page.getViewport({ scale: 1 }).width });
        const canvas = document.createElement('canvas');
        canvas.width = Math.floor(vp.width);
        canvas.height = Math.floor(vp.height);
        canvas.className = 'intro__card';
        canvas.setAttribute('role', 'img');
        canvas.setAttribute('aria-label', `소개 카드 ${n} / ${doc.numPages}`);
        track.append(canvas);
        dots.insertAdjacentHTML('beforeend', '<span></span>');
        await page.render({ canvasContext: canvas.getContext('2d'), viewport: vp }).promise;
      }
    } catch (err) {
      if (alive) { console.error(err); box.remove(); }
      return;
    }
    if (!alive) return;
    const cards = [...track.children];
    const mark = () => {
      const k = Math.round(track.scrollLeft / Math.max(1, cards[0].offsetWidth));
      [...dots.children].forEach((d, j) => d.classList.toggle('is-on', j === k));
      box.querySelector('.intro__nav--prev').disabled = k <= 0;
      box.querySelector('.intro__nav--next').disabled = k >= cards.length - 1;
    };
    const go = (d) => track.scrollBy({ left: d * cards[0].offsetWidth, behavior: 'smooth' });
    box.querySelector('.intro__nav--prev').addEventListener('click', () => go(-1));
    box.querySelector('.intro__nav--next').addEventListener('click', () => go(1));
    track.addEventListener('keydown', (e) => {
      if (e.key === 'ArrowRight') go(1);
      if (e.key === 'ArrowLeft') go(-1);
    });
    track.addEventListener('scroll', () => requestAnimationFrame(mark), { passive: true });
    mark();
  }

  // ---- 항목 자료 ----
  async function renderItem({ item, group, pick, base }, my) {
    const stage = item.stage;
    const stageLink = `<a class="viewer__back" href="#${stage.id}" data-replace><span class="badge">${stage.n}</span><span>${esc(stage.name)}</span></a>`;

    await dataReady;
    if (my !== token) return;

    const all = materials.get(item.id) || [];
    const groups = hasGroups(all) ? groupsOf(all) : [];
    const current = group ? groups.find((g) => g.name === group) : null;

    // 분류가 있는 항목인데 분류를 아직 안 골랐으면 → 분류 카드
    if (groups.length && !current) {
      renderGroups(item, groups, all, stageLink);
      return;
    }

    const list = current ? current.list
      : intros[item.id] ? [{ type: 'intro', title: '소개', file: intros[item.id] }, ...all] : all;
    const crumb = current
      ? `${stageLink}<span class="viewer__sep" aria-hidden="true">›</span><a class="viewer__crumbitem" href="#${esc(item.id)}" data-replace>${esc(item.title)}</a>`
      : stageLink;

    // 항목 첫 화면: 카드뉴스 + 자료 카드 (고르면 #…/번호 로 들어가 지금처럼 창 안에서 엶)
    // ITEM_CARDS_ALWAYS 가 true 면 자료가 1개여도 카드부터, false 면 2개 이상일 때만 (예전 방식)
    const title = current ? current.name : item.title;
    const mats = list.filter((m) => m.type !== 'intro');
    if (!loadFailed && (ITEM_CARDS_ALWAYS ? list.length >= 1 : mats.length > 1)) {
      if (!pick || !list[pick - 1]) {
        renderGallery({ item, stage, title, crumb, list, base, intro: list[0].type === 'intro' ? list[0].file : '', slot: !current, up: current ? item.id : stage.id });
        return;
      }
    }
    mount(`
      ${head({
        stage,
        title,
        crumb: pick ? `${crumb}<span class="viewer__sep" aria-hidden="true">›</span><a class="viewer__crumbitem" href="#${esc(base)}" data-replace>전체 보기</a>` : crumb,
        up: pick ? base : current ? item.id : stage.id,
      })}
      <div class="viewer__body"></div>`);
    const body = dialog.querySelector('.viewer__body');

    if (loadFailed) {
      body.innerHTML = state('자료 목록을 불러오지 못했습니다.', '잠시 후 다시 시도해 주세요. 계속되면 담당 선생님께 알려 주세요.', stage);
      return;
    }
    if (!list.length) {
      body.innerHTML = state('자료 준비 중입니다.', '이 항목의 자료는 곧 올라올 예정입니다.', stage);
      if (!current) {
        body.className = 'viewer__body viewer__body--stage has-intro';
        body.innerHTML = introEmpty() + body.innerHTML;
      }
      return;
    }

    // 소분류(시트의 "소분류" 칸): 목록 위 칩 버튼으로 걸러 보기
    const subs = [...new Set(list.map((m) => (m.sub || '').trim()).filter(Boolean))];
    const subBar = subs.length ? `
      <div class="subfilter" role="group" aria-label="소분류">
        <button class="subfilter__btn" type="button" data-sub="" aria-pressed="true">전체 <small>${list.length}</small></button>
        ${subs.map((x) => `
          <button class="subfilter__btn" type="button" data-sub="${esc(x)}" aria-pressed="false">${esc(x)}
            <small>${list.filter((m) => (m.sub || '').trim() === x).length}</small></button>`).join('')}
      </div>` : '';

    body.classList.toggle('has-list', list.length > 1);
    body.innerHTML = `
      ${list.length > 1 ? `
        <div class="mside">
          ${subBar}
          <nav class="mlist" aria-label="자료 목록">
            ${list.map((m, k) => `
              <button class="mlist__item" type="button" data-k="${k}" data-sub="${esc((m.sub || '').trim())}">
                <span class="mlist__icon is-${esc(m.type)}">${ICON[m.type] || ICON.pdf}</span>
                <span class="mlist__text"><span class="mlist__title">${esc(m.title)}</span>
                <span class="mlist__type">${TYPES[m.type] || '문서 · PDF'}${!subs.length || !m.sub ? '' : ` · ${esc(m.sub)}`}</span></span>
              </button>`).join('')}
          </nav>
          <div class="mpick">
            <select class="mpick__select" aria-label="자료 고르기">
              ${(() => {
                const opt = (m, k) => `<option value="${k}">${esc(m.title)}${TYPES[m.type] ? ` · ${TYPES[m.type]}` : ''}</option>`;
                const loose = list.map((m, k) => [m, k]).filter(([m]) => !(m.sub || '').trim());
                return loose.map(([m, k]) => opt(m, k)).join('') + subs.map((x) => `
                  <optgroup label="${esc(x)}">${list.map((m, k) => [m, k]).filter(([m]) => (m.sub || '').trim() === x).map(([m, k]) => opt(m, k)).join('')}</optgroup>`).join('');
              })()}
            </select>
            <span class="mpick__count"></span>
          </div>
        </div>` : ''}
      <section class="pane" aria-live="polite"></section>`;

    const pane = body.querySelector('.pane');
    const buttons = [...body.querySelectorAll('.mlist__item')];
    const picker = body.querySelector('.mpick__select');
    const pickCount = body.querySelector('.mpick__count');
    let currentK = -1;
    const select = (k) => {
      if (k === currentK) return;
      currentK = k;
      buttons.forEach((b, j) => b.setAttribute('aria-current', j === k ? 'true' : 'false'));
      if (picker) {
        picker.value = String(k);
        pickCount.textContent = `${picker.selectedIndex + 1} / ${list.length}`;
      }
      cleanup();
      cleanup = () => {};
      const m = list[k];
      if (m.type === 'intro') {
        pane.innerHTML = `<div class="intro-pane">${introMarkup(item.title)}</div>`;
        showIntro(pane.querySelector('.intro'), m.file);
      } else if (m.type === 'web') showWeb(pane, m);
      else if (m.type === 'video') showVideo(pane, m);
      else showPdf(pane, m, my);
    };
    buttons.forEach((b) => b.addEventListener('click', () => select(Number(b.dataset.k))));
    if (picker) picker.addEventListener('change', () => select(Number(picker.value)));

    // 소분류 고르면 목록을 거르고, 보고 있던 자료가 빠지면 첫 자료를 엶
    body.querySelectorAll('.subfilter__btn').forEach((btn) => btn.addEventListener('click', () => {
      const x = btn.dataset.sub;
      body.querySelectorAll('.subfilter__btn').forEach((b) => b.setAttribute('aria-pressed', String(b === btn)));
      buttons.forEach((b) => { b.hidden = Boolean(x) && b.dataset.sub !== x; });
      const visible = buttons.filter((b) => !b.hidden);
      if (visible.length && buttons[currentK].hidden) select(Number(visible[0].dataset.k));
    }));
    select(pick && list[pick - 1] ? pick - 1 : 0);
  }

  // ---- 웹앱 썸네일 카드 (대표 이미지가 없거나 안 열리면 아이콘과 사이트 주소) ----
  // 썸네일 그림 주소: 미리 받아 둔 그림이 있으면 그것, 없으면 웹은 대표 이미지(썸네일 칸), PDF·드라이브 영상은 드라이브 미리보기(첫 쪽·첫 장면), 유튜브는 영상 대표 그림
  function thumbOf(m) {
    if (m.thumb) return m.thumb; // 배포 때 미리 받아 둔 그림 (사이트에서 바로)
    if (m.image) return m.image;
    if (m.type === 'pdf') {
      const id = String(m.file || '').match(/^pdf\/([\w-]+)/);
      return id ? `https://drive.google.com/thumbnail?id=${id[1]}&sz=w800` : '';
    }
    if (m.type === 'video') {
      if (m.drive) return `https://drive.google.com/thumbnail?id=${m.drive}&sz=w800`;
      const y = youtubeId(m.youtube);
      return y ? `https://i.ytimg.com/vi/${y}/hqdefault.jpg` : '';
    }
    return '';
  }

  function renderGallery({ item, stage, title, crumb, list, base, intro, slot, up }) {
    const host = (u) => { try { return new URL(u).hostname.replace(/^www\./, ''); } catch { return ''; } };
    const LABEL = { pdf: 'PDF', video: '영상', web: '웹' };
    const cards = list.map((m, k) => {
      if (m.type === 'intro') return '';
      const src = thumbOf(m);
      const ph = m.type === 'web' ? host(m.url) : m.type === 'video' ? '영상' : 'PDF 문서';
      return `
      <li data-sub="${esc((m.sub || '').trim())}"><a class="tcard" href="#${esc(base)}/${k + 1}">
        <span class="tcard__thumb is-${esc(m.type)}">
          <span class="tcard__ph">${ICON[m.type] || ICON.pdf}<span>${esc(ph)}</span></span>
          ${src ? `<img src="${esc(src)}" alt="" loading="lazy" referrerpolicy="no-referrer">` : ''}
          ${m.type === 'video' ? '<span class="tcard__play" aria-hidden="true"></span>' : ''}
          <span class="tcard__badge">${LABEL[m.type] || ''}</span>
        </span>
        <span class="tcard__body">
          <span class="tcard__title">${esc(m.title)}</span>
          ${m.desc || m.sub ? `<span class="tcard__desc">${esc([m.sub, m.desc].filter(Boolean).join(' · '))}</span>` : ''}
        </span>
      </a></li>`;
    }).join('');
    const mats = list.filter((m) => m.type !== 'intro');
    const subs = [...new Set(mats.map((m) => (m.sub || '').trim()).filter(Boolean))];
    const subBar = subs.length > 1 ? `
      <div class="subfilter tgal__subs" role="group" aria-label="소분류">
        <button class="subfilter__btn" type="button" data-sub="" aria-pressed="true">전체 <small>${mats.length}</small></button>
        ${subs.map((x) => `<button class="subfilter__btn" type="button" data-sub="${esc(x)}" aria-pressed="false">${esc(x)}
          <small>${mats.filter((m) => (m.sub || '').trim() === x).length}</small></button>`).join('')}
      </div>` : '';
    mount(`
      ${head({ stage, title, crumb, up })}
      <div class="viewer__body viewer__body--stage${intro || slot ? ' has-intro' : ''}">
        ${intro ? introMarkup(item.title) : slot ? introEmpty() : ''}
        ${cards.trim() ? `<div class="tgal">${subBar}<ul class="tcards">${cards}</ul></div>` : `<div class="state"><p class="state__title">자료 준비 중입니다.</p><p class="state__text">이 항목의 자료는 곧 올라올 예정입니다.</p></div>`}
      </div>`);
    // 그림이 안 열리면(공유 꺼짐·주소 바뀜) 뒤의 기본 그림이 보이게
    dialog.querySelectorAll('.tcard__thumb img').forEach((img) => {
      const drop = () => img.remove();
      img.addEventListener('error', drop);
      // 드라이브 미리보기는 권한이 없으면 아주 작은 빈 그림이 올 때가 있음
      img.addEventListener('load', () => { if (img.naturalWidth < 40) drop(); });
    });
    // 소분류(과목 등) 버튼: 누르면 그 소분류 카드만
    dialog.querySelectorAll('.tgal .subfilter__btn').forEach((btn) => btn.addEventListener('click', () => {
      const x = btn.dataset.sub;
      dialog.querySelectorAll('.tgal .subfilter__btn').forEach((b) => b.setAttribute('aria-pressed', String(b === btn)));
      dialog.querySelectorAll('.tcards > li').forEach((li) => { li.hidden = Boolean(x) && li.dataset.sub !== x; });
    }));
    if (intro) showIntro(dialog.querySelector('.intro'), intro);
  }

  // ---- 분류 카드 (단계 개요와 같은 모양) ----
  function renderGroups(item, groups, all, stageLink) {
    const cards = groups.map((g) => `
      <li><a class="card" href="#${esc(groupPath(item, g.name))}">
        <span class="card__title">${esc(g.name)}</span>
        <span class="card__meta">${esc(titlesOf(g.list))}</span>
        <span class="card__arrow">${ICON.next}</span>
      </a></li>`).join('');
    mount(`
      ${head({
        stage: item.stage,
        title: item.title,
        crumb: stageLink,
        up: item.stage.id,
      })}
      <div class="viewer__body viewer__body--stage has-intro">
        ${intros[item.id] ? introMarkup(item.title) : introEmpty()}
        <ul class="cards">${cards}</ul>
      </div>`);
    if (intros[item.id]) showIntro(dialog.querySelector('.intro'), intros[item.id]);
  }

  function state(title, text, stage) {
    return `
      <div class="state">
        <img class="state__art" src="${esc(stage.art)}" alt="">
        <p class="state__title">${esc(title)}</p>
        <p class="state__text">${esc(text)}</p>
      </div>`;
  }

  // ---- 영상 ----
  function showVideo(pane, m) {
    if (m.drive) return showDriveVideo(pane, m);
    const id = youtubeId(m.youtube);
    if (!id) {
      pane.innerHTML = '<div class="state"><p class="state__title">영상 주소가 올바르지 않습니다.</p></div>';
      return;
    }
    pane.innerHTML = `
      <div class="video-wrap">
        <div class="video">
          <button class="video__poster" type="button" style="background-image:url('https://i.ytimg.com/vi/${id}/hqdefault.jpg')">
            <span class="video__play" aria-hidden="true"></span>
            <span class="sr-only">${esc(m.title)} 재생</span>
          </button>
        </div>
        <div class="video__info">
          <h3 class="pane__title">${esc(m.title)}</h3>
          ${m.desc ? `<p class="pane__desc">${esc(m.desc)}</p>` : ''}
          <a class="btn" href="https://www.youtube.com/watch?v=${id}" target="_blank" rel="noopener">${ICON.external}YouTube에서 보기</a>
        </div>
      </div>`;
    // 누를 때 불러와서 창이 빨리 뜨게 함
    pane.querySelector('.video__poster').addEventListener('click', (e) => {
      const iframe = document.createElement('iframe');
      iframe.src = `https://www.youtube-nocookie.com/embed/${id}?autoplay=1&rel=0&playsinline=1`;
      iframe.title = m.title;
      iframe.allow = 'autoplay; encrypted-media; picture-in-picture; fullscreen';
      iframe.allowFullscreen = true;
      e.currentTarget.replaceWith(iframe);
    }, { once: true });
  }

  // 드라이브 영상: 드라이브 재생기 (파일 공유가 '링크가 있는 모든 사용자'여야 함)
  function showDriveVideo(pane, m) {
    const id = encodeURIComponent(m.drive);
    pane.innerHTML = `
      <div class="video-wrap">
        <div class="video">
          <iframe src="https://drive.google.com/file/d/${id}/preview" title="${esc(m.title)}"
            allow="autoplay; fullscreen" allowfullscreen loading="lazy"></iframe>
        </div>
        <div class="video__info">
          <h3 class="pane__title">${esc(m.title)}</h3>
          ${m.desc ? `<p class="pane__desc">${esc(m.desc)}</p>` : ''}
          <a class="btn" href="https://drive.google.com/file/d/${id}/view" target="_blank" rel="noopener">${ICON.external}드라이브에서 보기</a>
        </div>
      </div>`;
  }

  // ---- 웹사이트·웹앱 ----
  // 막힌 사이트(embed:false)나 휴대폰에서는 먼저 카드로 보여주고 '새 창에서 열기'
  function showWeb(pane, m) {
    const url = esc(m.url);
    const small = matchMedia('(max-width: 767.98px)').matches;
    const card = (note) => `
      <div class="state web-card">
        <span class="web-card__icon">${ICON.web}</span>
        <p class="state__title">${esc(m.title)}</p>
        ${m.desc ? `<p class="state__text">${esc(m.desc)}</p>` : ''}
        <p class="state__text">${note}</p>
        <div class="web-card__btns">
          <a class="btn btn--solid" href="${url}" target="_blank" rel="noopener">${ICON.external}새 창에서 열기</a>
          ${m.embed === false ? '' : '<button class="btn web-card__here" type="button">여기서 보기</button>'}
        </div>
      </div>`;
    const frame = () => {
      pane.innerHTML = `
        <div class="pdf">
          <div class="pdf__bar">
            <div class="pdf__name"><div class="pdf__nameline"><h3 class="pane__title">${esc(m.title)}</h3></div>
              <p class="pdf__desc">${m.desc ? `${esc(m.desc)} · ` : ''}화면이 안 보이면 [새 창에서 열기]를 눌러 주세요</p></div>
            <div class="pdf__tools">
              <button class="icon-btn web-home" type="button" aria-label="처음 화면" title="처음 화면">${ICON.home}</button>
              <button class="icon-btn web-full" type="button" aria-label="전체 화면" title="전체 화면">${ICON.full}</button>
              <a class="btn btn--solid" href="${url}" target="_blank" rel="noopener">${ICON.external}<span>새 창에서 열기</span></a>
            </div>
          </div>
          <iframe class="web-frame" src="${url}" title="${esc(m.title)}" loading="lazy"
            allow="fullscreen; clipboard-read; clipboard-write; camera; microphone; geolocation; autoplay"
            referrerpolicy="strict-origin-when-cross-origin"></iframe>
        </div>`;
      const f = pane.querySelector('.web-frame');
      pane.querySelector('.web-full').addEventListener('click', () => (f.requestFullscreen || f.webkitRequestFullscreen || (() => {})).call(f));

      // 처음 화면: 처음 주소로 다시 불러오기
      // (뒤로·앞으로는 창 안 사이트마다 기록이 다르게 쌓여 믿을 수 없어 두지 않음)
      pane.querySelector('.web-home').addEventListener('click', () => { f.src = m.url; });
    };
    if (m.embed === false) {
      pane.innerHTML = card('이 사이트는 다른 페이지 안에서 열리지 않도록 설정되어 있어 새 창으로 엽니다.');
    } else if (small) {
      pane.innerHTML = card('휴대폰에서는 새 창으로 여는 것이 더 편합니다.');
      pane.querySelector('.web-card__here').addEventListener('click', frame);
    } else {
      frame();
    }
  }

  // ---- PDF ----
  let pdfjsLib;
  async function loadPdfjs() {
    if (!pdfjsLib) {
      pdfjsLib = await import(`${PDFJS}pdf.min.mjs`);
      pdfjsLib.GlobalWorkerOptions.workerSrc = `${PDFJS}pdf.worker.min.mjs`;
    }
    return pdfjsLib;
  }

  async function showPdf(pane, m, my) {
    const file = new URL(m.file, document.baseURI).href;
    pane.innerHTML = `
      <div class="pdf">
        <div class="pdf__bar">
          <div class="pdf__name">
            <div class="pdf__nameline">
              <h3 class="pane__title">${esc(m.title)}</h3>
              <span class="pdf__page" aria-live="off"><b>–</b> / <span>–</span></span>
            </div>
            ${m.desc ? `<p class="pdf__desc" title="${esc(m.desc)}">${esc(m.desc)}</p>` : ''}
          </div>
          <div class="pdf__tools">
            <button class="icon-btn" type="button" data-zoom="-1" aria-label="축소">${ICON.minus}</button>
            <button class="pdf__zoom" type="button" data-zoom="0" title="화면에 맞추기">맞춤</button>
            <button class="icon-btn" type="button" data-zoom="1" aria-label="확대">${ICON.plus}</button>
            <a class="icon-btn" href="${esc(file)}" target="_blank" rel="noopener" aria-label="새 창에서 열기" title="새 창에서 열기">${ICON.external}</a>
            <a class="btn btn--solid" href="${esc(file)}" download>${ICON.download}<span>내려받기</span></a>
          </div>
        </div>
        <div class="pdf__scroll" tabindex="0" aria-label="${esc(m.title)} 미리보기">
          <div class="pdf__pages">${LOADING}</div>
        </div>
      </div>`;

    const scroller = pane.querySelector('.pdf__scroll');
    const holder = pane.querySelector('.pdf__pages');
    const pageNow = pane.querySelector('.pdf__page b');
    const pageAll = pane.querySelector('.pdf__page span');
    const zoomLabel = pane.querySelector('.pdf__zoom');

    let alive = true;
    let doc;
    const pages = [];
    let zoom = 1;
    const ZOOMS = [0.5, 0.67, 0.8, 1, 1.25, 1.5, 2, 2.5, 3];

    const io = new IntersectionObserver((entries) => {
      entries.forEach((en) => {
        if (en.isIntersecting) draw(pages[Number(en.target.dataset.i)]);
      });
    }, { root: scroller, rootMargin: '800px 0px' });

    const ro = new ResizeObserver(() => {
      clearTimeout(ro.t);
      ro.t = setTimeout(relayout, 120);
    });

    cleanup = () => {
      alive = false;
      io.disconnect();
      ro.disconnect();
      if (task) task.destroy();
    };

    let task;
    try {
      const lib = await loadPdfjs();
      if (!alive || my !== token) return;
      task = lib.getDocument({
        url: file,
        cMapUrl: `${PDFJS}cmaps/`,
        cMapPacked: true,
        standardFontDataUrl: `${PDFJS}standard_fonts/`,
      });
      progress(task, holder);
      doc = await task.promise;
      if (!alive) return;
      for (let n = 1; n <= doc.numPages; n++) {
        const page = await doc.getPage(n);
        const vp = page.getViewport({ scale: 1 });
        pages.push({ page, w: vp.width, h: vp.height, el: null, drawnAt: 0, busy: false });
      }
      if (!alive) return;
    } catch (err) {
      if (!alive) return;
      console.error(err);
      holder.innerHTML = `
        <div class="state">
          <p class="state__title">문서를 표시하지 못했습니다.</p>
          <p class="state__text">내려받기 버튼으로 파일을 직접 열어 주세요.</p>
        </div>`;
      return;
    }

    pageAll.textContent = pages.length;
    pageNow.textContent = '1';
    holder.replaceChildren(...pages.map((p, i) => {
      const el = document.createElement('div');
      el.className = 'pdf__sheet is-skeleton';
      el.dataset.i = i;
      el.setAttribute('role', 'img');
      el.setAttribute('aria-label', `${i + 1}쪽`);
      el.style.aspectRatio = `${p.w} / ${p.h}`;
      p.el = el;
      return el;
    }));
    // 첫 쪽이 다 그려질 때까지는 '불러오는 중'만 (빈 종이가 먼저 보이지 않게)
    holder.style.visibility = 'hidden';
    scroller.insertAdjacentHTML('afterbegin', LOADING.replace('class="loading"', 'class="loading loading--over"'));
    const reveal = () => {
      if (!holder.style.visibility) return;
      holder.style.visibility = '';
      scroller.querySelector('.loading--over')?.remove();
    };
    setTimeout(() => alive && reveal(), 5000); // 혹시 첫 쪽이 늦어도 5초 뒤엔 보여줌
    relayout();
    ro.observe(scroller);

    // 기본 크기(“맞춤”)
    // - 가로 문서(발표자료): 한 쪽 전체가 화면 안에 들어오게
    // - 세로 문서(보고서): 폭에 맞춤 (읽기 편한 최대 900px)
    function baseWidth() {
      const pad = scroller.clientWidth < 600 ? 16 : 40;
      const fitWidth = Math.min(scroller.clientWidth - pad, 900);
      const first = pages[0];
      if (first && first.w > first.h) {
        const fitPage = (scroller.clientHeight - pad) * (first.w / first.h);
        return Math.max(200, Math.min(fitWidth, fitPage));
      }
      return Math.max(200, fitWidth);
    }

    function relayout() {
      if (!alive) return;
      const ratio = scroller.scrollTop / Math.max(1, scroller.scrollHeight);
      const w = baseWidth() * zoom;
      pages.forEach((p) => { p.el.style.width = `${w}px`; });
      scroller.scrollTop = ratio * scroller.scrollHeight;
      zoomLabel.textContent = zoom === 1 ? '맞춤' : `${Math.round(zoom * 100)}%`;
      // 이미 보이는 쪽도 다시 알림 받도록 재등록
      pages.forEach((p) => { io.unobserve(p.el); io.observe(p.el); });
    }

    async function draw(p) {
      const cssW = p.el.clientWidth;
      if (!cssW || Math.abs(p.drawnAt - cssW) < 2) return;
      if (p.busy) { p.again = true; return; }
      p.busy = true;
      const dpr = Math.min(window.devicePixelRatio || 1, 2);
      const vp = p.page.getViewport({ scale: (cssW / p.w) * dpr });
      const canvas = document.createElement('canvas');
      canvas.width = Math.floor(vp.width);
      canvas.height = Math.floor(vp.height);
      try {
        await p.page.render({ canvasContext: canvas.getContext('2d'), viewport: vp }).promise;
        if (!alive) return;
        p.el.replaceChildren(canvas);
        p.el.classList.remove('is-skeleton');
        p.drawnAt = cssW;
        if (p === pages[0]) reveal();
      } catch (err) {
        if (alive) { console.error(err); reveal(); }
      } finally {
        p.busy = false;
        if (p.again && alive) { p.again = false; draw(p); }
      }
    }

    // 현재 쪽 번호
    let raf = 0;
    scroller.addEventListener('scroll', () => {
      cancelAnimationFrame(raf);
      raf = requestAnimationFrame(() => {
        const line = scroller.scrollTop + scroller.clientHeight * 0.35;
        let cur = 0;
        pages.forEach((p, i) => { if (p.el.offsetTop <= line) cur = i; });
        pageNow.textContent = String(cur + 1);
      });
    }, { passive: true });

    pane.querySelectorAll('[data-zoom]').forEach((b) => b.addEventListener('click', () => {
      const d = Number(b.dataset.zoom);
      const idx = ZOOMS.indexOf(zoom);
      zoom = d === 0 ? 1 : ZOOMS[Math.max(0, Math.min(ZOOMS.length - 1, idx + d))];
      relayout();
    }));
  }

  // 처음 들어온 주소가 항목이면 바로 열기 (공유 링크)
  render();
})();
