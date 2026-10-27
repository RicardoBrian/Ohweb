// AI 실험실 — 문장(텍스트) 분류 활동의 ②~④ 화면. ailab.js가 배정 종류가 'text'일 때만 불러온다.
// ①(레이블·담당 정하기)과 ⑤(배포)는 이미지 활동 화면을 그대로 쓴다.
//  ② 문장 모으기: 내가 맡은 레이블의 예시 문장을 직접 써서 넣는다(여러 줄을 붙여 넣으면 한 줄씩).
//  ③ 학습: 대표가 학습(브라우저에서 바로) — AI가 문장을 조각내 읽는 법, 레이블마다 배운 단서 단어를 본다.
//          모둠원은 학습에 쓰지 않을 테스트 문장을 쓴다.
//  ④ 평가: 테스트 문장 채점 + 틀린 문장의 "영향 준 단어" 색칠, 직접 써 보기.
// 문장 기록은 사진과 같은 자리(ai_projects/{pid}/images)에 thumb 없이 text로 둔다 — 장수 세기·단계 열림이 그대로 된다.

import * as X_ from './ai-text-core.js?v=202610220501';

export function makeText(X) {
  const { S, E } = X;
  const t = (k, v) => X.t(k, v);
  const P = () => S.project;
  const COLORS = ['#0090ff', '#e5484d', '#30a46c', '#f76b15', '#6e56cf', '#e93d82', '#12a594', '#ffb224'];
  const colorOf = id => COLORS[Math.max(0, X.labelsOf().findIndex(l => l.id === id)) % 8];
  const texts = (kind, labelId) => X.imgs(kind, labelId).filter(i => typeof i.text === 'string');
  const lead = k => `<p class="lead">${E(t(k))}</p>`;

  // ── 문장 넣는 칸 ──
  function inputBox(kind, labelId) {
    const zone = `${kind}:${labelId}`;
    return `<div class="tx-in"><textarea id="tx-${kind}-${E(labelId)}" data-field="xtext" data-zone="${E(zone)}" rows="2" maxlength="300" placeholder="${E(t(kind === 'test' ? 'xTestPh' : 'xPh'))}">${E(S.drafts['x:' + zone] || '')}</textarea>
      <button class="btn primary sm" data-act="xadd" data-zone="${E(zone)}">${E(t('xAdd'))}</button></div>`;
  }
  function listHtml(kind, labelId, canDel) {
    const list = texts(kind, labelId).sort((a, b) => X.ms(b.createdAt) - X.ms(a.createdAt));
    if (!list.length) return '';
    return `<ul class="tx-list">${list.map(i => `<li><span>${E(i.text)}</span>${canDel(i) ? `<button class="ph-x" data-act="xdel" data-id="${E(i.id)}" aria-label="${E(t('del'))}">×</button>` : ''}</li>`).join('')}</ul>`;
  }

  // ── ② 문장 모으기 ──
  function step2() {
    const labels = X.labelsOf(), min = X.minTrain();
    const counts = labels.map(l => texts('train', l.id).length);
    let h = lead('xs2Lead') + `<div class="two"><div class="howto"><b>${E(t('howTo'))}</b><ol>${t('xHowTo').map(x => `<li>${E(x)}</li>`).join('')}</ol></div>${X.tipsHtml(t('xs2Tips'))}</div>`;
    if (meanMode()) h += `<div class="note">🌏 ${E(t('xLangNote'))}</div>`;
    if (X.C.isUnbalanced(counts)) h += `<div class="note warn">⚖️ ${E(t('xUnbalanced'))}</div>`;
    h += `<div class="lgrid">${labels.map(l => {
      const mine = X.isMine(l), c = texts('train', l.id).length;
      const pct = Math.min(100, Math.round(c * 100 / min));
      return `<div class="lcard${mine ? ' mine' : ''}">
        <div class="lc-head"><b>${E(l.name)}</b>${X.ownerTag(l)}</div>
        ${X.isLeader() && X.members().length > 1 ? X.ownerChips(l, 's2') : ''}
        <div class="prog"><div class="bar"><span style="width:${pct}%"></span></div><span class="cnt">${E(t('xCountOf', { c, m: min }))}</span></div>
        <div class="lc-state ${c >= min ? 'ok' : ''}">${E(c >= min ? t('enough') : t('xNeedMore', { n: min - c }))}</div>
        ${mine ? inputBox('train', l.id) : `<div class="not-mine">${E(t('notMine', { name: X.namesOf(l) }))}</div>`}
        ${listHtml('train', l.id, i => i.owner === S.me || X.isLeader())}
      </div>`;
    }).join('')}</div>`;
    if (P().step >= 3) h += X.nextBtn(3, 's2Next');
    return h;
  }

  // ── ③ 학습 ──
  const model = () => P().txModel || null;
  // 뜻 이해 AI: 선생님이 배정에서 고른 수업만(없으면 단어 조각 AI). 학습할 때 서버가 안 되면 단어 조각으로 대신한다.
  const meanMode = () => (S.asg && S.asg.textModel) === 'mean';
  const mean = () => P().txMean || null;
  const both = () => ({ model: model(), mean: mean() });
  // 서버에 물어 얻은 결과(문장 → 맞히기·영향 준 단어)를 잠시 기억한다
  S.xCache = S.xCache || {};
  function later(key, fn) {
    if (S.xCache[key]) return S.xCache[key] === 'busy' ? null : S.xCache[key];
    S.xCache[key] = 'busy';
    fn().then(v => { S.xCache[key] = v; X.schedule(); }).catch(() => { delete S.xCache[key]; });
    return null;
  }
  const trainSamples = () => {
    const ids = new Set(X.labelsOf().map(l => l.id));
    return texts('train').filter(i => ids.has(i.labelId));
  };
  const sameData = () => {
    const p = P();
    if (!p.modelVersion || !Array.isArray(p.trainedIds) || !model()) return false;
    const ids = X.labelsOf().map(l => l.id);
    if (ids.length !== model().labels.length || ids.some(id => !model().labels.includes(id))) return false;
    const now = trainSamples().map(i => i.id), before = new Set(p.trainedIds);
    return now.length === before.size && now.every(id => before.has(id));
  };
  const newSince = () => {
    const p = P();
    if (!Array.isArray(p.trainedIds)) return 0;
    const used = new Set(p.trainedIds);
    return trainSamples().filter(i => !used.has(i.id)).length;
  };

  function step3() {
    const leader = X.isLeader(), solo = X.members().length === 1;
    const tab = S.s3tab || (leader || solo ? 'train' : 'test');
    let h = lead('xs3Lead');
    h += `<div class="seg sub">
      <button data-act="s3tab" data-v="train" class="${tab === 'train' ? 'on' : ''}">🧠 ${E(t('tabTrain'))}${leader ? '' : ` · ${E(X.leaderName())}`}</button>
      <button data-act="s3tab" data-v="test" class="${tab === 'test' ? 'on' : ''}">🧪 ${E(t('xTabTest'))}</button></div>`;
    h += tab === 'train' ? trainTab(leader) : testTab();
    if (P().step >= 4) h += `<div class="next"><button class="btn primary" data-act="step" data-v="4">${E(t('s3Next'))} →</button></div>`;
    return h;
  }
  function trainTab(leader) {
    const p = P(), labels = X.labelsOf(), m = model(), v = p.modelVersion || 0;
    let h = leader ? '' : `<div class="note">${E(t('leaderOnly', { name: X.leaderName() }))}</div>`;
    h += `<div class="card"><h3>${E(t('xTrainData'))}</h3><div class="tdata">${labels.map(l => `<div class="trow"><b>${E(l.name)}</b><span class="cnt">${E(t('xCountOf', { c: texts('train', l.id).length, m: X.minTrain() }))}</span></div>`).join('')}</div>
      ${newSince() ? `<div class="note warn">${E(t('xNewSince', { n: newSince() }))}</div>` : ''}</div>`;
    h += `<div class="note">${E(t(meanMode() ? 'xModeMeanNote' : 'xModeWordsNote'))}</div>`;
    // AI가 문장을 읽는 법: 단어 + 두 글자 조각(단어 조각 AI)
    const ex = trainSamples()[0];
    if (ex && !meanMode()) h += `<div class="card"><h3>✂️ ${E(t('xPiecesTitle'))}</h3><p class="muted sm">${E(t('xPiecesHelp'))}</p>
      <div class="xpieces">${X_.pieces(ex.text).map(x => `<div class="xpc"><b>${E(x.w)}</b>${x.f.map(f => `<span>${E(f)}</span>`).join('')}</div>`).join('')}</div></div>`;
    h += '<div class="card train-box">';
    if (leader) h += `<button class="btn primary big" data-act="xtrain" ${S.xTraining ? 'disabled' : ''}>🧠 ${E(v ? t('retrain', { n: v + 1 }) : t('trainStart'))}</button>`;
    if (S.xTraining) h += `<div class="muted"><span class="spin"></span>${E(t('xMeanTraining'))}</div>`;
    if (S.xNoChange && sameData()) h += `<div class="note warn">${E(t('xNoChange', { n: v }))}<div class="next"><button class="btn" data-act="step" data-v="2">← ${E(t('xGoCollect'))}</button></div></div>`;
    if (S.xJust === v && v) h += `<div class="note ok">✅ ${E(t('trainDone', { n: v }))}</div>`;
    const models = Object.values(p.models || {}).filter(x => x && x.v).sort((a, b) => b.v - a.v);
    if (models.length) h += `<h4>${E(t('modelList'))}</h4><div class="mlist">${models.map(x => `<div class="mitem${x.v === v ? ' cur' : ''}"><b>${E(t('xModelItem', { n: x.v, c: x.photos || 0 }))}</b>${x.valAcc != null ? ` · ${E(t('xTrainAcc', { p: x.valAcc }))}` : ''}</div>`).join('')}</div>
      <p class="muted sm">ⓘ ${E(t('xTrainAccHelp'))}</p>`;
    else if (!leader) h += `<div class="muted">${E(t('noModelYet'))}</div>`;
    h += '</div>';
    if (m && mean()) h += mapCard();
    else if (m) {
      const tw = X_.topWords(m, trainSamples());
      h += `<div class="card"><h3>🔎 ${E(t('xCluesTitle'))}</h3><p class="muted sm">${E(t('xCluesHelp'))}</p>
        ${labels.map(l => `<div class="xclue"><b style="color:${colorOf(l.id)}">${E(l.name)}</b>${(tw[l.id] || []).map(w => `<span class="xw" style="--c:${colorOf(l.id)};--s:.55">${E(w)}</span>`).join('') || '<span class="muted">-</span>'}</div>`).join('')}</div>`;
    }
    return h;
  }
  // 뜻 지도: 학습 문장의 뜻 숫자를 2차원으로 — 같은 레이블 문장이 모이는지, 레이블 중심(★)은 어디인지
  function mapCard() {
    const list = trainSamples().filter(i => (P().trainedIds || []).includes(i.id));
    const key = `map:${P().modelVersion}:` + list.map(i => i.id).join(',');
    const pts = later(key, async () => {
      const vs = await X_.embedTexts(list.map(i => i.text));
      const ms = mean();
      const cv = ms.labels.map(id => X_.decodeVec(ms.cents[id]));
      const xy = X_.project2d([...vs, ...cv]);
      return { pts: list.map((i, k) => ({ x: xy[k][0], y: xy[k][1], id: i.labelId, text: i.text })), cents: ms.labels.map((id, k) => ({ x: xy[vs.length + k][0], y: xy[vs.length + k][1], id })) };
    });
    let body = `<div class="muted"><span class="spin"></span>${E(t('xMapLoading'))}</div>`;
    if (pts) {
      const all = [...pts.pts, ...pts.cents];
      const xs = all.map(p => p.x), ys = all.map(p => p.y);
      const [x0, x1, y0, y1] = [Math.min(...xs), Math.max(...xs), Math.min(...ys), Math.max(...ys)];
      const W = 520, H = 320, pad = 16;
      const X1 = x => pad + (x - x0) / ((x1 - x0) || 1) * (W - 2 * pad), Y1 = y => H - pad - (y - y0) / ((y1 - y0) || 1) * (H - 2 * pad);
      body = `${legend()}<svg class="tchart xmap" viewBox="0 0 ${W} ${H}" role="img">${pts.pts.map(p => `<circle cx="${X1(p.x).toFixed(1)}" cy="${Y1(p.y).toFixed(1)}" r="6" fill="${colorOf(p.id)}" fill-opacity=".7"><title>${E(p.text)}</title></circle>`).join('')}
        ${pts.cents.map(c => `<text x="${X1(c.x).toFixed(1)}" y="${(Y1(c.y) + 9).toFixed(1)}" text-anchor="middle" font-size="26" fill="${colorOf(c.id)}" stroke="#fff" stroke-width="1.5">★</text>`).join('')}</svg>`;
    }
    return `<div class="card"><h3>🗺️ ${E(t('xMapTitle'))}</h3><p class="muted sm">${E(t('xMapHelp'))}</p>${body}</div>`;
  }
  function testTab() {
    const labels = X.labelsOf(), min = X.minTest();
    let h = `<div class="note">${E(t('xTestLead'))}<br><b>${E(t('xTestNote'))}</b></div>
      <div class="muted">${E(t('xTestCount', { c: texts('test').length, m: min }))}</div>`;
    h += `<div class="lgrid">${labels.map(l => {
      const c = texts('test', l.id).length;
      return `<div class="lcard test"><div class="lc-head"><b>${E(l.name)}</b><span class="cnt ${c >= min ? 'ok' : ''}">${c} / ${min}</span></div>
        ${inputBox('test', l.id)}${listHtml('test', l.id, () => true)}</div>`;
    }).join('')}</div>`;
    return h;
  }

  // ── ④ 평가 ──
  const labelById = id => X.labelsOf().find(l => l.id === id);
  function wordsHtml(ws) {
    return `<div class="xwords">${ws.map(x => (x.id && x.s > 0.05 ? `<span class="xw" style="--c:${colorOf(x.id)};--s:${Math.max(0.15, x.s).toFixed(2)}" title="${E((labelById(x.id) || {}).name || '')}">${E(x.w)}</span>` : `<span class="xw0">${E(x.w)}</span>`)).join(' ')}</div>`;
  }
  const legend = () => `<div class="tleg">${X.labelsOf().map(l => `<span><i style="background:${colorOf(l.id)}"></i>${E(l.name)}</span>`).join('')}</div>`;
  function bars(probs) {
    return `<div class="ebars">${X.labelsOf().map(l => { const pct = Math.round((probs[l.id] || 0) * 100); return `<div class="erow"><span>${E(l.name)}</span><div class="bar"><span style="width:${pct}%"></span></div><span class="cnt">${pct}%</span></div>`; }).join('')}</div>`;
  }
  function step4() {
    const p = P();
    let h = lead('xs4Lead');
    if (!X.C.hasModel(p) || !model()) return h + `<div class="note warn">${E(t('noModelYet'))}</div>`;
    const tests = texts('test');
    if (!tests.length) return h + `<div class="note warn">${E(t('xNoTests'))}</div><div class="next"><button class="btn" data-act="goto-test">← ${E(t('xTabTest'))}</button></div>`;
    const rounds = X.C.evalRounds(p), cur = rounds[rounds.length - 1];
    h += `<div class="card eval-top"><button class="btn primary" data-act="xeval">▶ ${E(rounds.length ? t('rerun') : t('runEval'))}</button>
      ${cur && (cur.modelVersion || 0) !== (p.modelVersion || 0) ? `<div class="note warn">${E(t('notEvaluated', { n: p.modelVersion }))} ${E(t('modelChanged'))}</div>` : ''}
      ${newSince() ? `<div class="note">${E(t('xNewSince', { n: newSince() }))}</div>` : ''}
      ${rounds.length > 1 ? `<div class="history"><b>${E(t('history'))}</b> ${rounds.map(r => `<span class="hchip">${E(t('roundN', { n: r.n }))} ${r.pct}%</span>`).join(' → ')}</div>` : ''}</div>`;
    if (cur) h += resultHtml(cur) + X.ratingHtml(cur) + X.causeHtml(cur, 'xCauses', 'xFixPh');
    h += tryHtml();
    h += `<div class="note">${E(t('xRetrainHint'))}</div>`;
    h += `<div class="next two-btn"><button class="btn" data-act="step" data-v="2">← ${E(t('xGoCollect'))}</button>
      ${p.step >= 5 ? `<button class="btn primary" data-act="step" data-v="5">${E(t('goDeploy'))} →</button>` : `<span class="muted">${E(t('needStarToDeploy'))}</span>`}</div>`;
    return h;
  }
  function resultHtml(r) {
    const per = r.per || {};
    const eb = X.labelsOf().map(l => {
      const x = per[l.id] || { total: 0, correct: 0 };
      const pct = x.total ? Math.round(x.correct * 100 / x.total) : 0;
      return `<div class="erow"><span>${E(l.name)}</span><div class="bar"><span style="width:${pct}%"></span></div><span class="cnt">${x.correct}/${x.total}</span></div>`;
    }).join('');
    const m = model();
    const wordsOf = txt => {
      if (!mean()) return X_.predictText(m, txt).words;
      const r = later(`ex:${P().modelVersion}:${txt}`, () => X_.predictAny(both(), txt));
      return r ? r.words : X_.words(txt).map(w => ({ w, id: '', s: 0 }));
    };
    const wrong = (r.wrong || []).map(w => {
      const im = S.images.find(i => i.id === w.imgId);
      const txt = im ? im.text : '';
      return `<div class="xwrong">${txt && m ? wordsHtml(wordsOf(txt)) : `<span class="muted">${E(txt || '?')}</span>`}
        <div class="xwl"><span class="muted">${E(t('answer'))}</span> <b>${E((labelById(w.labelId) || {}).name || '?')}</b> · <span class="muted">${E(t('aiSaid'))}</span> <b class="bad">${E((labelById(w.got) || {}).name || '?')}</b> ${w.p}%</div></div>`;
    }).join('');
    return `<div class="card"><div class="score"><span class="big">${r.pct}%</span><span>${E(t('xScore', { n: r.total, c: r.correct }))}</span><span class="hchip">${E(t('roundN', { n: r.n }))}</span>${r.modelVersion ? `<span class="hchip">${E(t('evalWith', { n: r.modelVersion }))}</span>` : ''}</div>
      <div class="ebars">${eb}</div>
      <h4>${E(t('xWrongTitle'))}</h4>${wrong ? `${legend()}<p class="muted sm">${E(t(mean() ? 'xWordsHelpMean' : 'xWordsHelp'))}</p><div class="xwrongs">${wrong}</div>` : `<div class="ok-msg">${E(t('allRight'))}</div>`}</div>`;
  }
  function tryHtml() {
    const tr = S.xTry;
    let res = '';
    if (tr && tr.busy) res = `<div class="muted"><span class="spin"></span>${E(t('thinking'))}</div>`;
    else if (tr && tr.probs) res = `<div class="xtry">${legend()}${wordsHtml(tr.words)}${bars(tr.probs)}${tr.via === 'words' && mean() ? `<div class="muted sm">${E(t('xFallback'))}</div>` : ''}</div>`;
    return `<details class="card" ${tr ? 'open' : ''}><summary><b>${E(t('xTryOne'))}</b> <span class="muted">${E(t('tryOneHint'))}</span></summary>
      <div class="tx-in"><textarea id="tx-try" data-field="xtext" data-zone="try:x" rows="2" maxlength="100" placeholder="${E(t('xTryPh'))}">${E(S.drafts['x:try:x'] || '')}</textarea>
      <button class="btn primary sm" data-act="xtry">${E(t('xTryBtn'))}</button></div>${res}</details>`;
  }

  // ── 다음에 누를 곳 ──
  function nextTarget(has) {
    const p = P(), open = p.step || 1, leader = X.isLeader();
    const nextBtnSel = '.next .btn.primary[data-act="step"]';
    switch (S.viewStep) {
      case 2: {
        const done = X.labelsOf().filter(X.isMine).every(l => texts('train', l.id).length >= X.minTrain());
        return done && open >= 3 ? has(nextBtnSel) : '';
      }
      case 3: {
        const tab = S.s3tab || (leader || X.members().length === 1 ? 'train' : 'test');
        if (!X.C.hasModel(p)) return leader && tab === 'train' ? has('[data-act="xtrain"]') : '';
        const testOk = X.labelsOf().every(l => texts('test', l.id).length >= X.minTest());
        if (!testOk) return tab === 'test' ? '' : has('[data-act="s3tab"][data-v="test"]');
        return open >= 4 ? has(nextBtnSel) : '';
      }
      case 4: {
        const cur = X.C.currentEval(p);
        if (!cur || (cur.modelVersion || 0) !== (p.modelVersion || 0)) return has('[data-act="xeval"]');
        const mine = (cur.stars || {})[S.me];
        if (!mine || !mine.s) return has('.stars');
        return open >= 5 ? has(nextBtnSel) : '';
      }
      default: return '';
    }
  }

  // ── 동작 ──
  async function addTexts(kind, labelId, raw) {
    const lines = String(raw || '').split(/\r?\n/).map(X_.normText).filter(Boolean);
    const keys = new Set(texts('train').concat(texts('test')).map(i => X_.sameKey(i.text)));
    let added = 0;
    for (const text of lines) {
      const k = X_.sameKey(text);
      if ([...k].length < 2) { X.toast(t('xShort'), 'warn'); continue; }
      if (X.C.hasBadWord(text)) { X.toast(t('xBad'), 'warn'); continue; }
      if (keys.has(k)) { X.toast(t('xDup'), 'warn'); continue; }
      keys.add(k);
      try {
        await X.setDoc(X.doc(X.db, 'ai_projects', S.pid, 'images', X.C.newId('tx')), {
          labelId, kind, owner: S.me, thumb: '', text, fp: '', driveId: '', w: 0, h: 0, small: false, createdAt: X.serverTimestamp(),
        });
        added++;
      } catch (e) { console.error(e); X.toast(t('error'), 'err'); break; }
    }
    return added;
  }
  const actions = {
    async xadd(_, el) {
      const zone = el.dataset.zone;
      const [kind, labelId] = zone.split(':');
      const box = X.$(`tx-${kind}-${labelId}`);
      const raw = box ? box.value : (S.drafts['x:' + zone] || '');
      if (!raw.trim()) return;
      delete S.drafts['x:' + zone];
      if (box) box.value = '';
      const n = await addTexts(kind, labelId, raw);
      if (n > 1) X.toast(t('xAdded', { n }), 'ok');
      setTimeout(() => { const b = X.$(`tx-${kind}-${labelId}`); if (b) b.focus(); }, 50);
    },
    async xdel(_, el) {
      if (!confirm(t('xDeleteConfirm'))) return;
      try { await X.deleteDoc(X.doc(X.db, 'ai_projects', S.pid, 'images', el.dataset.id)); }
      catch (e) { X.toast(t('error'), 'err'); }
    },
    async xtrain() {
      if (!X.isLeader()) return;
      const labels = X.labelsOf(), list = trainSamples();
      if (!list.length) return;
      if (sameData()) { S.xNoChange = true; X.toast(t('xNoChange', { n: P().modelVersion }), 'warn'); return X.schedule(); }
      S.xNoChange = false;
      const ids = labels.map(l => l.id);
      const m = X_.trainText(list.map(i => ({ text: i.text, labelId: i.labelId })), ids);
      let ok = list.filter(i => X_.predictText(m, i.text).top === i.labelId).length;
      // 뜻 이해 AI: 문장을 뜻 숫자로 바꿔 레이블마다 중심을 기억한다(안 되면 단어 조각 AI만)
      let mn = null;
      if (meanMode()) {
        S.xTraining = true; X.schedule();
        try {
          const vs = await X_.embedTexts(list.map(i => i.text));
          mn = X_.meanModel(vs, list, ids);
          ok = list.filter((i, k) => X_.predictVec(mn, vs[k]).top === i.labelId).length;
        } catch (e) { console.warn('embed', e); X.toast(t('xFallback'), 'warn'); }
        S.xTraining = false;
      }
      const v = (P().modelVersion || 0) + 1;
      const counts = {};
      list.forEach(i => { counts[i.labelId] = (counts[i.labelId] || 0) + 1; });
      const done = await X.safeUpdate(X.pref(), {
        txModel: m, txMean: mn, modelVersion: v, mapping: X.C.identityMapping(labels), mappingOk: true,
        trainedIds: list.map(i => i.id), modelAt: X.serverTimestamp(),
        [`models.v${v}`]: { v, at: X.serverTimestamp(), photos: list.length, counts, valAcc: Math.round(ok * 100 / list.length) },
      });
      if (done) { S.xJust = v; X.toast(t('trainDone', { n: v }), 'ok'); }
      X.schedule();
    },
    async xeval() {
      const m = model(), tests = texts('test');
      if (!m || !tests.length) return;
      const use = tests.filter(im => m.labels.includes(im.labelId));
      let preds = null;
      if (mean()) {
        try { const vs = await X_.embedTexts(use.map(im => im.text)); preds = vs.map(v => X_.predictVec(mean(), v)); }
        catch (e) { console.warn('embed', e); X.toast(t('xFallback'), 'warn'); }
      }
      const results = use.map((im, k) => {
        const r = preds ? preds[k] : X_.predictText(m, im.text);
        return { imgId: im.id, labelId: im.labelId, got: r.top, p: Math.round(r.probs[r.top] * 100), ok: r.top === im.labelId };
      });
      if (!results.length) return;
      const sc = X.C.scoreResults(results);
      const rounds = X.C.evalRounds(P());
      const n = rounds.length ? rounds[rounds.length - 1].n + 1 : 1;
      await X.safeUpdate(X.pref(), {
        [`evals.r${n}`]: {
          n, at: X.serverTimestamp(), total: sc.total, correct: sc.correct, pct: sc.pct, per: sc.per,
          wrong: results.filter(r => !r.ok).map(({ imgId, labelId, got, p }) => ({ imgId, labelId, got, p })),
          modelVersion: P().modelVersion || 0, stars: {}, cause: [], causeText: '', fix: '',
        },
      });
      S.drafts.star = null; delete S.drafts.reason; delete S.drafts.causeText; delete S.drafts.fix;
    },
    async xtry() {
      const m = model();
      const box = X.$('tx-try');
      const txt = X_.normText(box ? box.value : '');
      if (!m || !txt) return;
      S.drafts['x:try:x'] = txt;
      S.xTry = { busy: true }; X.schedule();
      try { S.xTry = await X_.predictAny(both(), txt); }
      catch { S.xTry = { ...X_.predictText(m, txt), via: 'words' }; }
      X.schedule();
    },
  };
  function onInput(el) {
    if (el.dataset.field !== 'xtext') return false;
    S.drafts['x:' + el.dataset.zone] = el.value;
    return true;
  }
  // Enter = 넣기(Shift+Enter = 줄바꿈). 한글 조합 중 Enter는 무시.
  function onKey(e) {
    const el = e.target;
    if (!el.dataset || el.dataset.field !== 'xtext' || e.key !== 'Enter' || e.shiftKey || e.isComposing) return;
    e.preventDefault();
    const btn = el.parentElement.querySelector('[data-act="xadd"], [data-act="xtry"]');
    if (btn) actions[btn.dataset.act](btn.dataset.v, btn);
  }

  // ── ⑤ 배포 ──
  function appText() {
    const m = model();
    if (!m) return null;
    const ex = trainSamples()[0];
    const mn = mean();
    return { model: { labels: m.labels, feats: m.feats, counts: m.counts, totals: m.totals, docs: m.docs }, ...(mn ? { mean: { labels: mn.labels, dim: mn.dim, cents: mn.cents } } : {}), sample: ex ? ex.text : '' };
  }
  function sampleState(a, labelIdx) {
    const l = a.labels[Math.min(labelIdx, a.labels.length - 1)];
    const ex = (l && texts('train', l.id)[0]) || null;
    const text = ex ? ex.text : (a.text && a.text.sample) || '';
    if (!a.text || !text) return { text: '' };
    if (a.text.mean) {
      const r = later(`ex:${P().modelVersion}:${text}`, () => X_.predictAny(a.text, text));
      return r ? { text, probs: r.probs, words: r.words, status: 'ready' } : { text, status: 'thinking' };
    }
    const r = X_.predictText(a.text.model, text);
    return { text, probs: r.probs, words: r.words, status: 'ready' };
  }

  return { step(n) { return n === 2 ? step2() : n === 3 ? step3() : step4(); }, nextTarget, actions, onInput, onKey, appText, sampleState, addTexts };
}
