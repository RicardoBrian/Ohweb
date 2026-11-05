// 관리 목록 공통 부품 — "필터 줄 + 같은 수업끼리 묶은 카드".
// 정보 게시판·시험 배정·AI 실험실·설문지·학생 질문처럼 학교·학년·반이 늘수록 길어지는 목록을
// 같은 모양으로 정리한다. 화면마다 데이터는 다르지만 필터와 접기 동작은 이 파일 하나가 맡는다.
//
//   AG.bar(key, { schools, grades, status: ['ON','OFF'] 라벨, search })  → 필터 줄 HTML
//   AG.on(key, render)       필터가 바뀌면 render() 를 다시 부른다
//   AG.pass(key, { school, grade, on, text })  → 이 항목이 지금 필터에 맞는지
//   AG.groupBy(list, keyFn)  → [{ key, items }] (처음 나온 순서 유지)
//   AG.isOpen(key, gid) / AG.toggle(key, gid)  묶음 접기·펼치기 (브라우저에 기억)
//   AG.classLabel(grade, cls)  → "1학년 2반" / "1학년 전체" / "학교 전체"
//
// 필터·접힘 상태는 localStorage 에 둔다(보는 사람 편의용, 없어도 동작한다).
(function () {
  var S = {}, R = {};
  var E = function (s) { return String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;'); };
  var nv = function (v) { return String(v || '').replace(/학년|년급|학|반|班|кл\./g, '').trim(); };
  function load(key) {
    if (S[key]) return S[key];
    var st = { school: '', grade: '', status: '', q: '', closed: {} };
    try { var raw = localStorage.getItem('ag_' + key); if (raw) { var o = JSON.parse(raw); st.school = o.school || ''; st.grade = o.grade || ''; st.status = o.status || ''; st.closed = o.closed || {}; } } catch (e) { /* 저장 못 해도 동작 */ }
    return (S[key] = st);
  }
  function save(key) {
    var st = S[key];
    try { localStorage.setItem('ag_' + key, JSON.stringify({ school: st.school, grade: st.grade, status: st.status, closed: st.closed })); } catch (e) { /* 무시 */ }
  }
  function seg(key, field, opts, cur) {
    return '<div class="ag-seg" role="group">' + opts.map(function (o) {
      return '<button type="button" class="' + (String(cur) === String(o[0]) ? 'on' : '') + '" data-ag="' + E(key) + '" data-f="' + field + '" data-v="' + E(o[0]) + '">' + E(o[1]) + '</button>';
    }).join('') + '</div>';
  }

  var AG = {
    nv: nv, esc: E,
    state: load,
    on: function (key, fn) { R[key] = fn; },
    bar: function (key, o) {
      o = o || {};
      var st = load(key);
      if (o.schools && st.school && o.schools.indexOf(st.school) < 0) st.school = '';
      var html = '<div class="ag-bar">';
      if (o.search !== false) html += '<input class="inp ag-q" type="search" data-ag="' + E(key) + '" data-f="q" placeholder="' + E(o.search || '이름 검색…') + '" value="' + E(st.q) + '">';
      if (o.schools && o.schools.length > 1) {
        html += '<select class="inp ag-sel" data-ag="' + E(key) + '" data-f="school"><option value="">학교 전체</option>' +
          o.schools.map(function (s) { return '<option value="' + E(s) + '"' + (s === st.school ? ' selected' : '') + '>' + E(s) + '</option>'; }).join('') + '</select>';
      }
      if (o.grades && o.grades.length > 1) html += seg(key, 'grade', [['', '전체']].concat(o.grades.map(function (g) { return [g, /^\d+$/.test(g) ? g + '학년' : g]; })), st.grade);
      if (o.status) html += seg(key, 'status', [['', '전체'], ['on', o.status[0]], ['off', o.status[1]]], st.status);
      if (o.extra) html += o.extra;
      return html + '</div>';
    },
    // item: { school, grade, on(bool), text }
    pass: function (key, it) {
      var st = load(key);
      if (st.school && (it.school || '') !== st.school) return false;
      if (st.grade) {
        var g = nv(it.grade);
        if (st.grade === '기타' ? /^[123]$/.test(g) : g !== st.grade) return false;
      }
      if (st.status === 'on' && !it.on) return false;
      if (st.status === 'off' && it.on) return false;
      if (st.q && String(it.text || '').toLowerCase().indexOf(st.q.toLowerCase()) < 0) return false;
      return true;
    },
    active: function (key) { var st = load(key); return !!(st.school || st.grade || st.status || st.q); },
    reset: function (key) { var st = load(key); st.school = st.grade = st.status = st.q = ''; save(key); if (R[key]) R[key](); },
    groupBy: function (list, fn) {
      var m = new Map();
      list.forEach(function (x) { var k = fn(x); if (!m.has(k)) m.set(k, []); m.get(k).push(x); });
      return Array.from(m, function (e) { return { key: e[0], items: e[1] }; });
    },
    isOpen: function (key, gid) { return !load(key).closed[gid]; },
    toggle: function (key, gid) {
      var st = load(key);
      if (st.closed[gid]) delete st.closed[gid]; else st.closed[gid] = 1;
      save(key);
      document.querySelectorAll('[data-ag-g="' + CSS.escape(key + '|' + gid) + '"]').forEach(function (el) { el.classList.toggle('closed', !!st.closed[gid]); });
    },
    // 묶음 머리를 눌렀을 때 쓰는 속성 (onclick 에서 문자열 escape 걱정 없게)
    gattr: function (key, gid) { return 'data-ag-g="' + E(key + '|' + gid) + '"'; },
    classLabel: function (g, c) {
      g = nv(g); c = nv(c);
      if (!g) return '학교 전체';
      if (!c) return g + '학년 전체';
      return g + '학년 ' + c + '반';
    },
    byClass: function (a, b) {
      return (parseInt(nv(a.grade)) || 99) - (parseInt(nv(b.grade)) || 99) || (parseInt(nv(a.cls)) || 0) - (parseInt(nv(b.cls)) || 0);
    },
    // 학년 목록(있는 것만, 1·2·3 다음 기타)
    gradesOf: function (vals) {
      var set = new Set(vals.map(nv));
      var out = ['1', '2', '3'].filter(function (g) { return set.has(g); });
      if (Array.from(set).some(function (g) { return !/^[123]$/.test(g); })) out.push('기타');
      return out;
    },
    empty: function (key, msg) {
      return '<div class="empty-state">' + E(msg || '조건에 맞는 항목이 없습니다.') +
        (AG.active(key) ? '<div style="margin-top:10px;"><button type="button" class="btn ghost sm" data-ag-reset="' + E(key) + '">필터 지우기</button></div>' : '') + '</div>';
    },
  };

  var qTimer = null;
  document.addEventListener('click', function (e) {
    var b = e.target.closest && e.target.closest('button[data-ag][data-f]');
    if (b) {
      var st = load(b.dataset.ag); st[b.dataset.f] = b.dataset.v; save(b.dataset.ag);
      b.parentNode.querySelectorAll('button').forEach(function (x) { x.classList.toggle('on', x === b); });
      if (R[b.dataset.ag]) R[b.dataset.ag]();
      return;
    }
    var r = e.target.closest && e.target.closest('[data-ag-reset]');
    if (r) { AG.reset(r.dataset.agReset); return; }
    var h = e.target.closest && e.target.closest('.ag-h');
    if (h && !e.target.closest('button, a, input, select, label, .ag-acts')) {
      var g = h.closest('[data-ag-g]');
      if (g) { var i = g.dataset.agG.indexOf('|'); AG.toggle(g.dataset.agG.slice(0, i), g.dataset.agG.slice(i + 1)); }
    }
  });
  document.addEventListener('change', function (e) {
    var s = e.target;
    if (s.matches && s.matches('select[data-ag]')) { var st = load(s.dataset.ag); st[s.dataset.f] = s.value; save(s.dataset.ag); if (R[s.dataset.ag]) R[s.dataset.ag](); }
  });
  document.addEventListener('input', function (e) {
    var s = e.target;
    if (s.matches && s.matches('input[data-ag]')) {
      load(s.dataset.ag).q = s.value;
      clearTimeout(qTimer);
      qTimer = setTimeout(function () {
        if (!R[s.dataset.ag]) return;
        var pos = s.selectionStart, key = s.dataset.ag;
        R[key]();
        // 목록과 함께 필터 줄을 다시 그린 경우 입력칸 포커스를 되돌린다
        var n = document.querySelector('input[data-ag="' + CSS.escape(key) + '"]');
        if (n && n !== document.activeElement) { n.focus(); try { n.setSelectionRange(pos, pos); } catch (er) { /* 무시 */ } }
      }, 120);
    }
  });
  window.AG = AG;
})();
