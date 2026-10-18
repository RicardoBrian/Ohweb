// AI 실험실 — 표 데이터(CSV) 활동의 ①~④ 화면. ailab.js가 배정 종류가 'table'일 때만 불러온다.
//  ① 문제 정의: 선생님이 준 표를 보고, 무엇을 맞히는 AI인지 쓰고, 쓸 정보(열)를 고른다. 모둠원은 각자 "가장 도움이 될 정보"를 예상한다.
//  ② 데이터 살펴보기: 줄을 나눠 맡아 빈칸·이상한 값을 찾고 뺄지 정한다. 그래프로 정보와 답의 관계를 본다.
//  ③ 학습: 모둠원이 각자 정보 조합(분류는 질문 깊이도)을 골라 실험 모델을 만든다(브라우저에서 바로).
//  ④ 평가: 시험용 줄로 모든 실험을 채점해 공부 점수와 비교하고, 웹앱에 쓸 모델을 고른다.
// 데이터: ai_projects/{pid}의 tFeat · tHyp · tDrop · tChecked · tTrials · evals · tModel

import * as T from './ai-table-core.js?v=202610180700';

export function makeTable(X) {
  const { S, E } = X;
  const t = (k, v) => X.t(k, v);
  const P = () => S.project;

  // ── 데이터(배정에 든 CSV) ──
  let _ds = null, _dsKey = '';
  function ds() {
    const tb = (S.asg && S.asg.table) || {};
    const key = `${S.asg && S.asg.id}|${(tb.csv || '').length}|${tb.target}`;
    if (key !== _dsKey) { _ds = T.makeDataset(tb.csv || '', tb.target || ''); _dsKey = key; _test = null; _iss = null; }
    return _ds;
  }
  let _test = null;
  const testSet = () => (_test || (_test = T.testRows(ds(), S.asg.id)));
  const usable = () => ds().cols.map((_, c) => c).filter(c => T.usableFeature(ds(), c));
  const feats = () => { const f = P().tFeat; return Array.isArray(f) ? f.filter(c => T.usableFeature(ds(), c)) : usable(); };
  let _iss = null, _issKey = '';
  function issues() {
    const used = [...feats(), ds().ti];
    const k = used.join(',');
    if (!_iss || k !== _issKey) { _iss = T.rowIssues(ds(), used); _issKey = k; }
    return _iss;
  }
  // 뺀 줄 표시: Firestore에는 r12 같은 키로 둔다
  function dropMap() {
    const m = {};
    Object.entries(P().tDrop || {}).forEach(([k, v]) => { m[Number(k.slice(1))] = v; });
    return m;
  }
  const ctx = () => ({ drop: dropMap(), test: testSet() });

  // ── 이름(번역) ──
  const tr = () => ((S.asg.table || {}).tr) || {};
  const colTr = c => ((tr().cols || [])[c]) || {};
  const valTr = v => (((tr().vals || []).find(x => x.v === v)) || {}).tr || {};
  const colName = c => colTr(c)[S.lang] || ds().cols[c] || '?';
  const valName = v => valTr(v)[S.lang] || v;
  const clsName = i => valName(ds().classes[i]);
  const isClass = () => ds().prob === 'class';
  const scoreTxt = s => (s == null ? '-' : isClass() ? `${s}%` : `${T.fmt(s)}`);
  const unitOf = () => { const m = ds().target.match(/\(([^)]+)\)\s*$/); return m ? m[1] : ''; };

  const lead = k => `<p class="lead">${E(t(k))}</p>`;
  const tips = list => `<div class="tips"><b>${E(t('tipsTitle'))}</b><ul>${list.map(x => `<li>${E(x)}</li>`).join('')}</ul></div>`;

  // ── 표 그리기 ──
  function tableHtml(idxs, { mark = null, drop = {}, toggle = false, testTag = true } = {}) {
    const d = ds(), iss = issues(), test = testSet();
    const used = new Set([...feats(), d.ti]);
    const head = `<tr><th>#</th>${d.cols.map((c, i) => `<th class="${i === d.ti ? 'tg' : used.has(i) ? '' : 'off'}">${E(colName(i))}${i === d.ti ? ' 🎯' : ''}</th>`).join('')}${testTag ? `<th>${E(t('tUse'))}</th>` : ''}${toggle ? '<th></th>' : ''}</tr>`;
    const body = idxs.map(i => {
      const auto = T.autoDropped(iss[i]);
      const off = auto || drop[i] === true;
      const bad = new Map(iss[i].map(x => [x.c, x.kind]));
      return `<tr class="${off ? 'dropped' : ''}${mark && mark.has(i) ? ' flag' : ''}"><td class="rn">${i + 1}</td>${d.rows[i].map((v, c) => `<td class="${bad.has(c) ? 'bad ' + bad.get(c) : ''}${c === d.ti ? ' tg' : ''}">${E(v === '' ? '—' : (d.types[c] === 'cat' ? valName(v) : v))}</td>`).join('')}
        ${testTag ? `<td><span class="usetag ${test.has(i) ? 'test' : 'train'}">${E(t(test.has(i) ? 'tTestRow' : 'tTrainRow'))}</span></td>` : ''}
        ${toggle ? `<td>${auto ? `<span class="muted sm">${E(t('tAutoOut'))}</span>` : `<button class="btn ghost sm" data-act="tdrop" data-v="${i}" data-on="${drop[i] === true ? 0 : 1}">${E(drop[i] === true ? t('tUndo') : t('tDrop'))}</button>`}</td>` : ''}</tr>`;
    }).join('');
    return `<div class="ttable-wrap"><table class="ttable"><thead>${head}</thead><tbody>${body}</tbody></table></div>`;
  }

  // ── ① 문제 정의 ──
  function step1() {
    const p = P(), d = ds(), leader = X.isLeader();
    let h = lead('ts1Lead') + tips(t('ts1Tips'));
    const name = (S.asg.table || {}).name || '';
    const prob = isClass()
      ? t('tProbClass', { target: colName(d.ti), list: d.classes.map(valName).join(', ') })
      : t('tProbReg', { target: colName(d.ti) });
    h += `<div class="card"><h3>📊 ${E(name || t('tData'))}</h3>
      <div class="tchips"><span>${E(t('tRowsN', { n: d.rows.length }))}</span><span>${E(t('tColsN', { n: d.cols.length }))}</span><span class="tg">🎯 ${E(colName(d.ti))}</span><span>${E(t(isClass() ? 'tKindClass' : 'tKindReg'))}</span></div>
      <div class="note">${E(prob)}</div>
      ${tableHtml(d.rows.slice(0, 6).map((_, i) => i), { testTag: false })}
      <p class="muted sm">${E(t('tPreviewNote', { n: d.rows.length }))}</p></div>`;
    const f = new Set(feats());
    h += `<div class="card">
      <div class="field"><label for="f-topic">${E(t('tTopicLabel'))}</label>
        ${leader ? `<input id="f-topic" data-field="topic" maxlength="40" placeholder="${E(t('tTopicPh'))}" value="${E(X.draftOr('topic', p.topic))}">` : `<div class="ro">${E(p.topic || '…')}</div>`}</div>
      <div class="field"><label>${E(t('tFeatLabel'))}</label>
        <p class="muted sm">${E(t(isClass() ? 'tFeatHelp' : 'tFeatHelpReg'))}</p>
        <div class="ochips">${d.cols.map((_, c) => {
          if (c === d.ti) return '';
          const ok = T.usableFeature(d, c);
          return `<button type="button" class="ochip${f.has(c) ? ' on' : ''}" data-act="tfeat" data-v="${c}" ${leader && ok ? '' : 'disabled'} title="${ok ? '' : E(t('tNumOnly'))}">${E(colName(c))}${d.types[c] === 'num' ? '' : ' 🔤'}</button>`;
        }).join('')}</div>
        ${leader ? '' : `<div class="muted sm">${E(t('s1Wait', { name: X.leaderName() }))}</div>`}</div></div>`;
    h += hypCard();
    if (leader) {
      h += `<div class="card"><div id="s1err" class="err"></div>
        <button class="btn primary" data-act="tconfirm" ${S.busy.s1 ? 'disabled' : ''}>${E(S.busy.s1 ? t('translating') : (p.defined ? t('saveChanges') : t('s1Confirm')))}</button></div>`;
    }
    if (p.defined && p.step >= 2) h += X.nextBtn(2, 'ts2Next');
    return h;
  }
  // 모둠원마다 "가장 도움이 될 정보" 예상(④에서 맞았는지 돌아본다)
  function hypCard() {
    const hyp = P().tHyp || {};
    return `<div class="card"><h3>🤔 ${E(t('tHypTitle'))}</h3><p class="muted sm">${E(t('tHypHelp'))}</p>
      ${X.members().map(m => {
        const v = hyp[m] || {};
        if (m !== S.me) return `<div class="hyp"><b>${E(X.nameOf(m))}</b> ${v.c != null ? `<span class="tag">${E(colName(v.c))}</span> <span class="muted">${E(v.why || '')}</span>` : '<span class="muted">…</span>'}</div>`;
        return `<div class="hyp me"><b>${E(X.nameOf(m))}</b>
          <select data-act="thyp">${['<option value="">' + E(t('tHypPick')) + '</option>', ...usable().map(c => `<option value="${c}" ${v.c === c ? 'selected' : ''}>${E(colName(c))}</option>`)].join('')}</select>
          <input id="f-twhy" data-field="tWhy" maxlength="60" placeholder="${E(t('tWhyPh'))}" value="${E(X.draftOr('tWhy', v.why))}"></div>`;
      }).join('')}</div>`;
  }

  // ── ② 데이터 살펴보기 ──
  function step2() {
    const p = P(), d = ds(), iss = issues(), drop = dropMap(), test = testSet();
    const mine = T.ranges(d.rows.length, X.members())[S.me] || [0, 0];
    const idx = []; for (let i = mine[0]; i < mine[1]; i++) idx.push(i);
    const need = i => T.hasOutlier(iss[i]) && !T.autoDropped(iss[i]) && drop[i] === undefined;
    const flagged = idx.filter(i => iss[i].length);
    const pending = idx.filter(need);
    const ck = p.tChecked || {};
    const autoN = iss.filter(T.autoDropped).length;
    const manN = Object.keys(drop).filter(i => drop[i] === true && !T.autoDropped(iss[i])).length;
    let h = lead('ts2Lead') + tips(t('ts2Tips'));
    h += `<div class="card"><div class="tchips"><span>${E(t('tRowsN', { n: d.rows.length }))}</span>
      <span class="usetag train">${E(t('tTrainRow'))} ${d.rows.length - test.size}</span><span class="usetag test">${E(t('tTestRow'))} ${test.size}</span>
      <span>${E(t('tOutN', { n: autoN + manN }))}</span></div>
      <p class="muted sm">ⓘ ${E(t('tSplitHelp'))}</p>
      <div class="tmembers">${X.members().map(m => { const r = T.ranges(d.rows.length, X.members())[m]; return `<span class="mem${m === S.me ? ' me' : ''}">${ck[m] ? '✅' : '⏳'} ${E(X.nameOf(m))} <small>${r[0] + 1}~${r[1]}</small></span>`; }).join('')}</div></div>`;
    // 내가 맡은 줄
    h += `<div class="card"><h3>🔎 ${E(t('tMyRows', { a: mine[0] + 1, b: mine[1] }))}</h3>`;
    if (!flagged.length) h += `<div class="note ok">${E(t('tNoIssue'))}</div>`;
    else {
      h += `<div class="tissues">${flagged.map(i => {
        const auto = T.autoDropped(iss[i]);
        const desc = iss[i].map(x => issueText(i, x)).join(' · ');
        const by = (p.tDropBy || {})['r' + i];
        return `<div class="tissue${need(i) ? ' need' : ''}"><b>${E(t('tRowN', { n: i + 1 }))}</b> <span>${E(desc)}</span>
          ${auto ? `<span class="tag">${E(t('tAutoOut'))}</span>` : `<span class="tbtns">
            <button class="btn sm${drop[i] === true ? ' primary' : ''}" data-act="tdrop" data-v="${i}" data-on="1">${E(t('tDrop'))}</button>
            <button class="btn sm${drop[i] === false ? ' primary' : ''}" data-act="tdrop" data-v="${i}" data-on="0">${E(t('tKeep'))}</button>
            ${by ? `<small class="muted">${E(X.nameOf(by))}</small>` : ''}</span>`}</div>`;
      }).join('')}</div>`;
    }
    h += `<details class="tdet"${idx.length <= 40 ? ' open' : ''}><summary>${E(t('tSeeRows', { n: idx.length }))}</summary>${tableHtml(idx, { mark: new Set(flagged), drop, toggle: true })}</details>
      <div class="row">${ck[S.me] ? `<span class="note ok">✅ ${E(t('tChecked'))}</span>` : ''}
      <button class="btn primary" data-act="tdone" ${pending.length ? 'disabled' : ''}>${E(ck[S.me] ? t('tCheckAgain') : t('tCheckDone'))}</button>
      ${pending.length ? `<span class="muted">${E(t('tPending', { n: pending.length }))}</span>` : ''}</div></div>`;
    h += chartCard();
    h += `<details class="card"><summary><b>${E(t('tAllRows'))}</b></summary>${tableHtml(d.rows.map((_, i) => i), { drop })}</details>`;
    if (p.step >= 3) h += X.nextBtn(3, 'ts3Next');
    else if (X.members().some(m => !ck[m])) h += `<div class="muted">${E(t('tWaitCheck'))}</div>`;
    return h;
  }
  function issueText(i, x) {
    const d = ds();
    if (x.kind === 'empty') return t('tIssEmpty', { col: colName(x.c) });
    if (x.kind === 'notNum') return t('tIssNotNum', { col: colName(x.c), v: d.rows[i][x.c] });
    const st = T.colStats(d, x.c);
    return t('tIssOut', { col: colName(x.c), v: d.rows[i][x.c], a: T.fmt(st.q1), b: T.fmt(st.q3) });
  }

  // ── 그래프 ──
  const COLORS = ['#0090ff', '#e5484d', '#30a46c', '#f76b15', '#6e56cf', '#e93d82', '#12a594', '#ffb224'];
  function axes(w, h, pad, x0, x1, y0, y1, xl, yl) {
    const ticks = (a, b) => { const n = 4, out = []; for (let k = 0; k <= n; k++) out.push(a + (b - a) * k / n); return out; };
    const X_ = v => pad + (v - x0) / ((x1 - x0) || 1) * (w - pad - 12), Y_ = v => h - pad - (v - y0) / ((y1 - y0) || 1) * (h - pad - 12);
    let s = `<line x1="${pad}" y1="${h - pad}" x2="${w - 8}" y2="${h - pad}" class="ax"/><line x1="${pad}" y1="8" x2="${pad}" y2="${h - pad}" class="ax"/>`;
    ticks(x0, x1).forEach(v => { s += `<text x="${X_(v)}" y="${h - pad + 14}" class="tk" text-anchor="middle">${E(T.fmt(v))}</text>`; });
    if (y1 !== y0 || yl) ticks(y0, y1).forEach(v => { s += `<text x="${pad - 4}" y="${Y_(v) + 3}" class="tk" text-anchor="end">${E(T.fmt(v))}</text>`; });
    s += `<text x="${(w + pad) / 2}" y="${h - 4}" class="al" text-anchor="middle">${E(xl)}</text>`;
    if (yl) s += `<text x="12" y="${(h - pad) / 2}" class="al" text-anchor="middle" transform="rotate(-90 12 ${(h - pad) / 2})">${E(yl)}</text>`;
    return { s, X: X_, Y: Y_ };
  }
  const ext = a => { let lo = Math.min(...a), hi = Math.max(...a); if (lo === hi) { lo -= 1; hi += 1; } const m = (hi - lo) * 0.05; return [lo - m, hi + m]; };
  // 회귀: 점(x, y) + 직선 / 분류: 숫자 정보 → 답마다 한 줄에 점, 글자 정보 → 값마다 답 개수 막대
  function scatterSvg(pts, xl, yl, line) {
    const w = 520, h = 280, pad = 44;
    const [x0, x1] = ext(pts.map(p => p.x)), [y0, y1] = ext(pts.map(p => p.y).concat(line ? [line.a * x0 + line.b, line.a * x1 + line.b] : []));
    const a = axes(w, h, pad, x0, x1, y0, y1, xl, yl);
    let s = a.s + pts.map(p => `<circle cx="${a.X(p.x).toFixed(1)}" cy="${a.Y(p.y).toFixed(1)}" r="4" class="pt${p.test ? ' te' : ''}"/>`).join('');
    if (line) s += `<line x1="${a.X(x0)}" y1="${a.Y(line.a * x0 + line.b)}" x2="${a.X(x1)}" y2="${a.Y(line.a * x1 + line.b)}" class="fit"/>`;
    return `<svg class="tchart" viewBox="0 0 ${w} ${h}" role="img">${s}</svg>`;
  }
  function stripSvg(pts, xl) {
    const K = ds().classes.length, w = 520, h = 50 + K * 34, pad = 44;
    const [x0, x1] = ext(pts.map(p => p.x));
    const a = axes(w, h, pad, x0, x1, 0, 0, xl, '');
    const rowY = k => 18 + k * 34;
    let s = a.s;
    for (let k = 0; k < K; k++) s += `<text x="${pad - 4}" y="${rowY(k) + 4}" class="tk" text-anchor="end">${E(clsName(k))}</text>`;
    s += pts.map((p, j) => `<circle cx="${a.X(p.x).toFixed(1)}" cy="${(rowY(p.k) + ((j * 7) % 13) - 6).toFixed(1)}" r="4" fill="${COLORS[p.k % 8]}" fill-opacity=".7"/>`).join('');
    return `<svg class="tchart" viewBox="0 0 ${w} ${h}" role="img">${s}</svg>`;
  }
  function barsHtml(c) {
    const d = ds(), byVal = new Map();
    ds().rows.forEach((r, i) => {
      if (T.autoDropped(issues()[i]) || dropMap()[i] === true || r[c] === '' || r[d.ti] === '') return;
      const k = d.classes.indexOf(r[d.ti]);
      if (!byVal.has(r[c])) byVal.set(r[c], new Array(d.classes.length).fill(0));
      byVal.get(r[c])[k]++;
    });
    return `<div class="tbars">${[...byVal.entries()].map(([v, cnt]) => {
      const tot = cnt.reduce((x, y) => x + y, 0);
      return `<div class="tbar"><span class="tbl">${E(valName(v))}</span><span class="tbt">${cnt.map((n, k) => n ? `<span style="width:${n * 100 / tot}%;background:${COLORS[k % 8]}" title="${E(clsName(k))} ${n}">${n}</span>` : '').join('')}</span></div>`;
    }).join('')}</div>`;
  }
  const legend = () => (isClass() ? `<div class="tleg">${ds().classes.map((_, k) => `<span><i style="background:${COLORS[k % 8]}"></i>${E(clsName(k))}</span>`).join('')}</div>` : '');
  function chartCard() {
    const d = ds(), fs = usable();
    const c = fs.includes(S.tChart) ? S.tChart : (feats()[0] != null ? feats()[0] : fs[0]);
    let chart = '';
    if (c != null) {
      const drop = dropMap(), iss = issues();
      const ok = i => !T.autoDropped(iss[i]) && drop[i] !== true;
      if (d.types[c] === 'num') {
        const pts = [];
        d.rows.forEach((r, i) => {
          const x = T.toNum(r[c]); if (!ok(i) || Number.isNaN(x) || r[d.ti] === '') return;
          if (isClass()) { const k = d.classes.indexOf(r[d.ti]); if (k >= 0) pts.push({ x, k }); }
          else { const y = T.toNum(r[d.ti]); if (!Number.isNaN(y)) pts.push({ x, y }); }
        });
        chart = pts.length ? (isClass() ? stripSvg(pts, colName(c)) : scatterSvg(pts, colName(c), colName(d.ti))) : '';
      } else chart = barsHtml(c);
    }
    return `<div class="card"><h3>📈 ${E(t('tChartTitle'))}</h3><p class="muted sm">${E(t(isClass() ? 'tChartHelp' : 'tChartHelpReg'))}</p>
      <select data-act="tchart">${fs.map(x => `<option value="${x}" ${x === c ? 'selected' : ''}>${E(colName(x))}</option>`).join('')}</select>
      ${legend()}${chart}</div>`;
  }

  // ── ③ 학습 ──
  function draft() {
    const mine = (P().tTrials || {})[S.me];
    if (!S.tDraft || S.tDraft.pid !== S.pid) S.tDraft = { pid: S.pid, features: (mine ? mine.features : feats()).filter(c => T.usableFeature(ds(), c)), depth: (mine && mine.depth) || 2 };
    return S.tDraft;
  }
  function step3() {
    const p = P(), d = ds(), dr = draft();
    const mine = (p.tTrials || {})[S.me];
    let h = lead(isClass() ? 'ts3Lead' : 'ts3LeadReg') + tips(t(isClass() ? 'ts3Tips' : 'ts3TipsReg'));
    const fset = new Set(dr.features);
    h += `<div class="card"><h3>🧪 ${E(t('tMyTrial'))}</h3>
      <div class="field"><label>${E(t('tTrialFeat'))}</label><div class="ochips">${feats().map(c => `<button type="button" class="ochip${fset.has(c) ? ' on' : ''}" data-act="ttf" data-v="${c}">${E(colName(c))}</button>`).join('')}</div></div>
      ${isClass() ? `<div class="field"><label>${E(t('tDepth'))}</label><div class="seg">${[1, 2, 3, 4, 5].map(n => `<button data-act="tdepth" data-v="${n}" class="${dr.depth === n ? 'on' : ''}">${n}</button>`).join('')}</div>
        <p class="muted sm">ⓘ ${E(t('tDepthHelp'))}</p></div>` : ''}
      <div id="s3err" class="err"></div>
      <button class="btn primary big" data-act="ttrain">🧠 ${E(mine ? t('tRetrain') : t('trainStart'))}</button>
      ${mine && S.tJustTrained ? `<div class="note ok">✅ ${E(t('tTrained', { n: mine.v }))}</div>` : ''}</div>`;
    if (mine) h += `<div class="card"><h3>${E(t('tMyModel', { n: mine.v }))}</h3>
      <div class="score"><span class="big">${E(scoreTxt(mine.score))}</span><span>${E(t(isClass() ? 'tTrainScore' : 'tTrainMae', { n: mine.n }))}</span></div>
      ${modelView(mine)}</div>`;
    h += trialsCard();
    if (p.step >= 4) h += `<div class="next"><button class="btn primary" data-act="step" data-v="4">${E(t('s3Next'))} →</button></div>`;
    return h;
  }
  function trialsCard() {
    const list = X.members().map(m => [m, (P().tTrials || {})[m]]);
    return `<div class="card"><h3>👥 ${E(t('tGroupTrials'))}</h3><div class="ttable-wrap"><table class="ttable"><thead><tr><th>${E(t('tWho'))}</th><th>${E(t('tTrialFeat'))}</th>${isClass() ? `<th>${E(t('tDepthShort'))}</th>` : ''}<th>${E(t(isClass() ? 'tTrainScoreShort' : 'tTrainMaeShort'))}</th></tr></thead>
      <tbody>${list.map(([m, x]) => `<tr><td><b>${E(X.nameOf(m))}</b></td><td>${x ? E(x.features.map(colName).join(', ')) : '<span class="muted">…</span>'}</td>${isClass() ? `<td>${x ? x.depth : ''}</td>` : ''}<td>${x ? E(scoreTxt(x.score)) : ''}</td></tr>`).join('')}</tbody></table></div>
      <p class="muted sm">ⓘ ${E(t('tTrainScoreHelp'))}</p></div>`;
  }
  function modelView(x) {
    const d = ds();
    if (isClass()) return `<div class="tree">${treeHtml(x.model.tree, x.features)}</div><p class="muted sm">ⓘ ${E(t('tTreeHelp'))}</p>`;
    const m = x.model;
    const terms = m.w.map((w, i) => `${i ? (w < 0 ? ' − ' : ' + ') : (w < 0 ? '−' : '')}${T.fmt(Math.abs(w))} × ${colName(x.features[i])}`).join('');
    const eq = `${colName(d.ti)} = ${terms}${m.b < 0 ? ' − ' : ' + '}${T.fmt(Math.abs(m.b))}`;
    const list = T.samples(d, x.features, { ...ctx(), which: 'train' });
    let chart;
    if (x.features.length === 1) chart = scatterSvg(list.map(s => ({ x: s.x[0], y: s.y })), colName(x.features[0]), colName(d.ti), { a: m.w[0], b: m.b });
    else chart = `<p class="muted sm">${E(t('tPredVsReal'))}</p>` + scatterSvg(list.map(s => ({ x: s.y, y: T.linPredict(m, s.x) })), t('tReal'), t('tPred'), { a: 1, b: 0 });
    return `<div class="teq">${E(eq)}</div><p class="muted sm">ⓘ ${E(t(x.features.length === 1 ? 'tEqHelp1' : 'tEqHelp'))}</p>${chart}`;
  }
  function treeHtml(n, fs) {
    if (n.c) {
      const tot = n.c.reduce((a, b) => a + b, 0), k = T.argmax(n.c);
      return `<div class="tleaf" style="--k:${COLORS[k % 8]}">${E(clsName(k))} <small>${E(t('tLeafN', { a: n.c[k], b: tot }))}</small></div>`;
    }
    const c = fs[n.f];
    const q = n.e != null ? t('tQEq', { col: colName(c), v: valName(n.e) }) : t('tQLe', { col: colName(c), v: T.fmt(n.t) });
    return `<div class="tnode"><div class="tq">${E(q)}</div><div class="tkids">
      <div class="tbr"><span class="tyes">${E(t('tYes'))}</span>${treeHtml(n.y, fs)}</div>
      <div class="tbr"><span class="tno">${E(t('tNo'))}</span>${treeHtml(n.n, fs)}</div></div></div>`;
  }

  // ── ④ 평가 ──
  function step4() {
    const p = P(), d = ds();
    const trials = p.tTrials || {};
    let h = lead('ts4Lead');
    const rounds = X.C.evalRounds(p);
    const cur = rounds[rounds.length - 1];
    const stale = cur && Object.entries(trials).some(([m, x]) => x && (!cur.trials || !cur.trials[m] || cur.trials[m].v !== x.v));
    h += `<div class="card eval-top"><button class="btn primary" data-act="teval">▶ ${E(rounds.length ? t('rerun') : t('tRunTest'))}</button>
      <p class="muted sm">${E(t('tTestHelp', { n: testSet().size }))}</p>
      ${stale ? `<div class="note warn">${E(t('tStale'))}</div>` : ''}
      ${rounds.length > 1 ? `<div class="history"><b>${E(t('history'))}</b> ${rounds.map(r => `<span class="hchip">${E(t('roundN', { n: r.n }))} ${E(scoreTxt(isClass() ? r.pct : r.mae))}</span>`).join(' → ')}</div>` : ''}</div>`;
    if (cur && cur.trials) {
      const pick = p.tModel;
      const leader = X.isLeader();
      const rows = X.members().filter(m => cur.trials[m]).map(m => {
        const r = cur.trials[m], x = trials[m];
        const same = x && x.v === r.v;
        const gap = isClass() && r.score != null && r.train != null ? r.train - r.score : 0;
        const on = pick && pick.uid === m && pick.v === r.v;
        return `<tr class="${cur.best === m ? 'best' : ''}"><td><b>${E(X.nameOf(m))}</b> <small class="muted">#${r.v}</small></td><td>${E((r.features || []).map(colName).join(', '))}</td>${isClass() ? `<td>${r.depth || ''}</td>` : ''}
          <td>${E(scoreTxt(r.train))}</td><td><b>${E(scoreTxt(r.score))}</b>${cur.best === m ? ' 🏆' : ''}${gap >= 10 ? ` <span class="warn-txt">${E(t('tGap'))}</span>` : ''}</td>
          <td>${leader ? `<label class="radio"><input type="radio" name="tpick" data-act="tpick" data-v="${E(m)}" ${on ? 'checked' : ''} ${same ? '' : 'disabled'}> ${E(t('tPickThis'))}</label>` : (on ? `✅ ${E(t('tPicked'))}` : '')}</td></tr>`;
      }).join('');
      h += `<div class="card"><h3>📝 ${E(t('tCompare'))}</h3><div class="ttable-wrap"><table class="ttable"><thead><tr><th>${E(t('tWho'))}</th><th>${E(t('tTrialFeat'))}</th>${isClass() ? `<th>${E(t('tDepthShort'))}</th>` : ''}
        <th>${E(t(isClass() ? 'tTrainScoreShort' : 'tTrainMaeShort'))}</th><th>${E(t(isClass() ? 'tTestScoreShort' : 'tTestMaeShort'))}</th><th></th></tr></thead><tbody>${rows}</tbody></table></div>
        <p class="muted sm">ⓘ ${E(t(isClass() ? 'tCompareHelp' : 'tCompareHelpReg'))}</p>
        ${pick ? `<div class="note ok">✅ ${E(t('tPickedNote', { name: X.nameOf(pick.uid), n: pick.v }))}</div>` : `<div class="note">${E(leader ? t('tPickHint') : t('tPickWait', { name: X.leaderName() }))}</div>`}
        ${hypReview()}</div>`;
      h += wrongCard(cur, pick && cur.trials[pick.uid] ? pick.uid : cur.best);
      h += X.ratingHtml(cur) + X.causeHtml(cur, 'tCauses', 'tFixPh');
    }
    h += `<div class="next two-btn"><button class="btn" data-act="step" data-v="3">← ${E(t('tGoTrain'))}</button>
      ${p.step >= 5 ? `<button class="btn primary" data-act="step" data-v="5">${E(t('goDeploy'))} →</button>` : `<span class="muted">${E(t('tNeedPickStar'))}</span>`}</div>`;
    return h;
  }
  // ①에서 한 예상 돌아보기: 가장 좋은 실험이 그 정보를 썼는지
  function hypReview() {
    const hyp = P().tHyp || {};
    const ms = X.members().filter(m => hyp[m] && hyp[m].c != null);
    if (!ms.length) return '';
    return `<div class="tips"><b>${E(t('tHypBack'))}</b><ul>${ms.map(m => `<li>${E(X.nameOf(m))}: ${E(colName(hyp[m].c))}</li>`).join('')}</ul></div>`;
  }
  function wrongCard(cur, uid) {
    const r = cur.trials[uid];
    if (!r) return '';
    const d = ds();
    const list = r.wrong || [];
    const body = list.length ? `<div class="ttable-wrap"><table class="ttable"><thead><tr><th>#</th>${(r.features || []).map(c => `<th>${E(colName(c))}</th>`).join('')}<th>${E(t('answer'))}</th><th>${E(t('aiSaid'))}</th></tr></thead><tbody>${list.map(w => `<tr><td class="rn">${w.i + 1}</td>${(r.features || []).map(c => `<td>${E(d.types[c] === 'cat' ? valName(d.rows[w.i][c]) : d.rows[w.i][c])}</td>`).join('')}
      <td><b>${E(isClass() ? clsName(w.y) : T.fmt(w.y))}</b></td><td class="bad">${E(isClass() ? `${clsName(w.got)} ${w.p}%` : T.fmt(w.got))}</td></tr>`).join('')}</tbody></table></div>` : `<div class="ok-msg">${E(t('allRight'))}</div>`;
    return `<div class="card"><h3>${E(t(isClass() ? 'tWrongTitle' : 'tFarTitle', { name: X.nameOf(uid) }))}</h3>${body}</div>`;
  }

  // ── 다음에 누를 곳 ──
  function nextTarget(has) {
    const p = P(), open = p.step || 1, leader = X.isLeader();
    const nextBtnSel = '.next .btn.primary[data-act="step"]';
    switch (S.viewStep) {
      case 1: return leader && !p.defined ? has('[data-act="tconfirm"]:not([disabled])') : (open >= 2 ? has(nextBtnSel) : '');
      case 2: return (p.tChecked || {})[S.me] ? (open >= 3 ? has(nextBtnSel) : '') : has('[data-act="tdone"]:not([disabled])');
      case 3: return (p.tTrials || {})[S.me] ? (open >= 4 ? has(nextBtnSel) : '') : has('[data-act="ttrain"]');
      case 4: {
        const cur = X.C.currentEval(p);
        if (!cur || !cur.trials) return has('[data-act="teval"]');
        if (leader && !p.tModel) return has('input[data-act="tpick"]:not([disabled])');
        const mine = (cur.stars || {})[S.me];
        if (!mine || !mine.s) return has('.stars');
        return open >= 5 ? has(nextBtnSel) : '';
      }
      default: return '';
    }
  }

  // ── 동작 ──
  const upd = data => X.safeUpdate(X.pref(), data);
  const actions = {
    tfeat(v) {
      if (!X.isLeader()) return;
      const c = Number(v), s = new Set(feats());
      if (s.has(c)) s.delete(c); else s.add(c);
      upd({ tFeat: usable().filter(x => s.has(x)) });
    },
    thyp(v, el) {
      const c = el.value === '' ? null : Number(el.value);
      const cur = (P().tHyp || {})[S.me] || {};
      upd({ [`tHyp.${S.me}`]: { c, why: S.drafts.tWhy != null ? S.drafts.tWhy : (cur.why || '') } });
    },
    async tconfirm() {
      const topic = (S.drafts.topic != null ? S.drafts.topic : P().topic || '').trim();
      const err = X.$('s1err');
      if (!topic) { err.textContent = t('tNoTopic'); return; }
      if (!feats().length) { err.textContent = t('tNeedFeat'); return; }
      S.busy.s1 = true; X.schedule();
      const src = S.lang;
      let topicTr = P().topicTr || {};
      if (P().topic !== topic || !P().defined) {
        for (const lang of X.C.LANGS) {
          if (lang === src) { topicTr = { ...topicTr, [lang]: topic }; continue; }
          try {
            const r = await fetch('/api/translate', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ texts: [topic], targetLang: lang, sourceLang: 'auto' }) });
            const data = await r.json();
            if (data.translations && data.translations[0]) topicTr = { ...topicTr, [lang]: data.translations[0].text };
          } catch { /* 번역이 안 되면 원문 */ }
        }
      }
      // 분류의 답(선생님 데이터의 값들)이 웹앱의 결과 이름이 된다 — 이미지 활동의 레이블과 같은 자리
      const labels = isClass() ? ds().classes.map((v, i) => ({ id: 'c' + i, name: v, owners: [], tr: { ...valTr(v), [src]: valTr(v)[src] || v } })) : [];
      const ok = await upd({ topic, topicTr, labels, tFeat: feats(), defined: true, srcLang: P().srcLang || src, step: Math.max(P().step || 1, 2), updatedAt: X.serverTimestamp() });
      S.busy.s1 = false; delete S.drafts.topic;
      if (ok) X.go(2); else X.schedule();
    },
    tdrop(v, el) {
      const i = Number(v), on = el.dataset.on === '1';
      upd({ [`tDrop.r${i}`]: on, [`tDropBy.r${i}`]: S.me });
    },
    tdone() { upd({ [`tChecked.${S.me}`]: true }); X.toast(t('tChecked'), 'ok'); },
    tchart(v, el) { S.tChart = Number(el.value); X.schedule(); },
    ttf(v) {
      const dr = draft(), c = Number(v), s = new Set(dr.features);
      if (s.has(c)) s.delete(c); else s.add(c);
      dr.features = feats().filter(x => s.has(x)); S.tJustTrained = false; X.schedule();
    },
    tdepth(v) { draft().depth = Number(v); S.tJustTrained = false; X.schedule(); },
    async ttrain() {
      const dr = draft();
      if (!dr.features.length) { X.$('s3err').textContent = t('tNeedFeat'); return; }
      const res = T.fitTrial(ds(), dr, ctx());
      if (res.error) { X.$('s3err').textContent = t('tNoRows'); return; }
      const prev = (P().tTrials || {})[S.me];
      const v = ((prev && prev.v) || 0) + 1;
      const ok = await upd({ [`tTrials.${S.me}`]: { v, features: dr.features, depth: isClass() ? dr.depth : 0, model: res.model, score: res.score, n: res.n, at: X.serverTimestamp() } });
      if (ok) { S.tJustTrained = true; X.toast(t('tTrained', { n: v }), 'ok'); }
      X.schedule();
    },
    async teval() {
      const trials = P().tTrials || {};
      const out = {};
      let best = '';
      for (const m of X.members()) {
        const x = trials[m];
        if (!x || !x.model) continue;
        const r = T.testTrial(ds(), x, ctx());
        out[m] = { v: x.v, features: x.features, depth: x.depth || 0, train: x.score, score: r.score, n: r.n, correct: r.correct || 0, wrong: (r.wrong || []).slice(0, 8) };
        if (T.better(ds().prob, r.score, best ? out[best].score : null)) best = m;
      }
      if (!best) return X.toast(t('tNoTrial'), 'warn');
      const rounds = X.C.evalRounds(P());
      const n = rounds.length ? rounds[rounds.length - 1].n + 1 : 1;
      const b = out[best];
      await upd({
        [`evals.r${n}`]: {
          n, at: X.serverTimestamp(), trials: out, best,
          ...(isClass() ? { total: b.n, correct: b.correct, pct: b.score } : { mae: b.score }),
          modelVersion: 0, stars: {}, cause: [], causeText: '', fix: '',
        },
      });
      S.drafts.star = null; delete S.drafts.reason; delete S.drafts.causeText; delete S.drafts.fix;
    },
    async tpick(v) {
      if (!X.isLeader()) return;
      const cur = X.C.currentEval(P());
      const x = (P().tTrials || {})[v], r = cur && cur.trials && cur.trials[v];
      if (!x || !r || x.v !== r.v) return;
      await upd({ tModel: { uid: v, v: x.v, features: x.features, depth: x.depth || 0, model: x.model, score: r.score, train: x.score } });
    },
  };

  // 입력 칸(①의 예상 이유, ⑤의 단위)
  function onInput(el) {
    const f = el.dataset.field;
    if (f === 'tWhy') {
      S.drafts.tWhy = el.value;
      X.debounce('tWhy', () => {
        const cur = (P().tHyp || {})[S.me] || {};
        upd({ [`tHyp.${S.me}`]: { c: cur.c != null ? cur.c : null, why: el.value.slice(0, 60) } });
      }, 700);
      return true;
    }
    if (f === 'tUnit') {
      S.drafts.tUnit = el.value;
      X.debounce('tUnit', () => upd({ 'app.unit': el.value.slice(0, 8) }), 700);
      return 'preview';
    }
    return false;
  }

  // ── ⑤ 배포에 쓰는 것 ──
  function appTable() {
    const p = P(), d = ds(), m = p.tModel;
    if (!m) return null;
    const unit = (S.drafts.tUnit != null ? S.drafts.tUnit : (p.app && p.app.unit != null ? p.app.unit : unitOf())) || '';
    return {
      prob: d.prob, target: { name: d.target, tr: colTr(d.ti) }, unit: unit.slice(0, 8), key: `${m.uid}:${m.v}`,
      features: m.features.map(c => {
        const sp = T.featureSpec(d, c);
        return { name: d.cols[c], tr: colTr(c), ...sp, ...(sp.type === 'cat' ? { optTr: sp.opts.map(valTr) } : {}) };
      }),
      model: m.model,
    };
  }
  // 미리보기·웹앱 첫 화면 값(가운데 값)으로 맞힌 결과
  function sampleState(table) {
    const ins = table.features.map(f => f.def);
    const r = T.appPredict(table, ins);
    return table.prob === 'class' ? { tIn: ins, probs: Object.fromEntries(r.p.map((p, i) => ['c' + i, p])), status: 'ready' } : { tIn: ins, tv: r.v, status: 'ready' };
  }
  function unitCard() {
    const p = P();
    const v = S.drafts.tUnit != null ? S.drafts.tUnit : (p.app && p.app.unit != null ? p.app.unit : unitOf());
    return `<div class="card"><h3>${E(t('tUnitTitle', { target: colName(ds().ti) }))}</h3><p class="muted sm">${E(t('tUnitHelp'))}</p>
      <input id="f-tunit" data-field="tUnit" maxlength="8" placeholder="${E(t('tUnitPh'))}" value="${E(v || '')}"></div>`;
  }
  function deployLine() {
    const m = P().tModel;
    if (!m) return `<div class="note warn">${E(t('tNoPick'))}</div>`;
    return `<div class="deploy-model"><b>${E(t('tDeployModel', { name: X.nameOf(m.uid), n: m.v, s: scoreTxt(m.score) }))}</b></div>`;
  }

  function summary(project) {
    const base = X.C.buildSummary(project, S.asg);
    const ev = X.C.currentEval(project);
    const m = project.tModel;
    return {
      ...base, labels: [], model: Object.values(project.tTrials || {}).some(x => x && x.model),
      acc: isClass() ? (m ? m.score : (ev && ev.total ? ev.pct : null)) : null,
      mae: isClass() ? null : (m ? m.score : (ev && ev.mae != null ? ev.mae : null)),
      tb: { prob: ds().prob, trials: Object.keys(project.tTrials || {}).length, checked: Object.keys(project.tChecked || {}).length },
    };
  }

  return {
    step(n) { return n === 1 ? step1() : n === 2 ? step2() : n === 3 ? step3() : step4(); },
    nextTarget, actions, onInput, appTable, sampleState, unitCard, deployLine, summary,
    unlock: project => T.nextUnlock(project, X.members()),
    isClass, ds,
  };
}
