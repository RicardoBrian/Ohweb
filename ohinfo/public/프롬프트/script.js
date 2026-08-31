// ============================================================
//  프롬프트 생성기 — 상태 및 상수
// ============================================================

const PURPOSE_TEXT = {
  work: '이 앱은 업무 효율을 높이기 위한 실용적 도구입니다. 불필요한 장식보다는 빠른 입력과 결과 확인에 집중해주세요.',
  edu: '이 앱은 교육 현장(수업, 평가, 기록)에서 사용됩니다. 인쇄하거나 캡처해서 보관하기 좋은 레이아웃을 고려해주세요.',
  personal: '이 앱은 개인이 편하게 쓰는 용도입니다. 사용자 취향에 맞게 자유롭게 스타일링해도 좋습니다.',
};

const DESIGN_PRESETS = [
  {
    id: 'liquid',
    name: '리퀴드 (Liquid Glass)',
    summary: '반투명 유리 카드 + 부드러운 그라데이션',
    swatchClass: 'swatch-liquid',
    text: '유리처럼 반투명하고 매끈한 \'리퀴드 글래스\' 스타일로 디자인해주세요. backdrop-filter blur를 활용한 반투명 카드, 부드럽게 흐르는 듯한 곡선과 그라데이션, 은은한 광택 하이라이트를 사용하고, 배경은 부드러운 그라데이션 컬러로 채워주세요.',
  },
  {
    id: 'bw',
    name: '흑백',
    summary: '화이트/그레이 배경 + 블랙 텍스트 모노톤',
    swatchClass: 'swatch-bw',
    text: '흑백 모노톤으로 디자인해주세요. 배경은 흰색 또는 아주 옅은 회색, 텍스트와 요소는 검정~짙은 회색 계열로 통일하고, 타이포그래피의 굵기와 크기 대비로 위계를 표현해주세요.',
  },
  {
    id: 'minimal',
    name: '미니멀',
    summary: '넉넉한 여백 + 채도 낮은 중성 컬러',
    swatchClass: 'swatch-minimal',
    text: '미니멀 디자인으로 만들어주세요. 불필요한 장식 요소를 제거하고, 여백을 넉넉하게 사용하며, 채도가 낮은 중성 색상 팔레트(화이트, 그레이, 소프트 블루 등)를 사용하고, 그림자는 아주 은은하게만 적용해주세요.',
  },
  {
    id: 'warm',
    name: '따뜻한 느낌',
    summary: '베이지·코랄·살구빛 웜톤, 둥근 모서리',
    swatchClass: 'swatch-warm',
    text: '따뜻하고 포근한 느낌으로 디자인해주세요. 베이지, 크림, 코랄, 살구빛 같은 채도 낮은 웜톤 컬러를 사용하고, 모서리는 둥글게, 폰트는 부드러운 느낌으로 해주세요.',
  },
  {
    id: 'neon',
    name: '네온',
    summary: '어두운 배경 + 네온 글로우 사이버펑크',
    swatchClass: 'swatch-neon',
    text: '어두운 배경 위에 네온 컬러(형광 그린, 시안, 마젠타, 퍼플 등)로 포인트를 주는 사이버펑크/네온 스타일로 디자인해주세요. 글로우(glow) 효과와 그라데이션 테두리를 적극 활용해주세요.',
  },
];

const CLOSING_TEXT = '빌드 도구(Vite, React, webpack 등) 없이 순수 HTML/CSS/JS 단일 파일로 작성해주세요. 데스크톱과 모바일 화면 모두에서 자연스럽게 보이도록 반응형으로 만들어주세요. 데이터 저장이 필요하면 브라우저 localStorage를 사용해주세요(Firebase나 다른 외부 데이터베이스는 쓰지 마세요). 완성된 웹앱을 별도 설명 없이 바로 실행 가능한 코드로 한 번에 작성해주세요.';

const state = {
  features: [],
  designMode: 'custom', // 'custom' | 'preset'
  selectedPreset: null,
};

let featureSeq = 0;
function newFeature() {
  featureSeq++;
  return { key: 'f' + featureSeq, name: '', desc: '', steps: [''] };
}

// ============================================================
//  기능 목록 (동적 카드)
// ============================================================

function addFeature() {
  state.features.push(newFeature());
  renderFeatures();
  saveDraft();
}

function removeFeature(key) {
  state.features = state.features.filter((f) => f.key !== key);
  renderFeatures();
  saveDraft();
}

function moveFeature(key, dir) {
  const i = state.features.findIndex((f) => f.key === key);
  const j = i + dir;
  if (i < 0 || j < 0 || j >= state.features.length) return;
  [state.features[i], state.features[j]] = [state.features[j], state.features[i]];
  renderFeatures();
  saveDraft();
}

function addStep(featureKey) {
  const f = state.features.find((x) => x.key === featureKey);
  if (f) f.steps.push('');
  renderFeatures();
  saveDraft();
}

function removeStep(featureKey, idx) {
  const f = state.features.find((x) => x.key === featureKey);
  if (f) f.steps.splice(idx, 1);
  renderFeatures();
  saveDraft();
}

function esc(s) {
  return String(s || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

function renderFeatures() {
  const el = document.getElementById('featureList');
  if (!state.features.length) {
    el.innerHTML = '<div class="empty-features">아직 추가된 기능이 없습니다. "기능 추가" 버튼을 눌러보세요.</div>';
    return;
  }

  el.innerHTML = state.features.map((f, i) => `
    <div class="feature-card" data-key="${f.key}">
      <div class="feature-card-head">
        <span>기능 ${i + 1}</span>
        <div class="feature-card-actions">
          <button class="icon-btn" type="button" title="위로 이동" onclick="moveFeature('${f.key}', -1)" ${i === 0 ? 'disabled' : ''}>▲</button>
          <button class="icon-btn" type="button" title="아래로 이동" onclick="moveFeature('${f.key}', 1)" ${i === state.features.length - 1 ? 'disabled' : ''}>▼</button>
          <button class="icon-btn" type="button" title="기능 삭제" onclick="removeFeature('${f.key}')">✕</button>
        </div>
      </div>
      <div class="feature-row">
        <label>기능 이름</label>
        <input type="text" class="inp" placeholder="예: 집중 타이머" value="${esc(f.name)}"
          oninput="updateFeatureField('${f.key}', 'name', this.value)">
      </div>
      <div class="feature-row">
        <label>기능 소개 (1~2줄)</label>
        <input type="text" class="inp" placeholder="예: 설정한 시간 동안 카운트다운하고 종료 시 알림을 준다"
          value="${esc(f.desc)}" oninput="updateFeatureField('${f.key}', 'desc', this.value)">
      </div>
      <div class="feature-row">
        <label>작동 단계</label>
        <div class="step-list">
          ${f.steps.map((s, si) => `
            <div class="step-row">
              <span class="step-row-num">${si + 1}단계</span>
              <input type="text" class="inp" placeholder="예: 사용자가 시작 버튼을 누른다"
                value="${esc(s)}" oninput="updateStepField('${f.key}', ${si}, this.value)">
              ${f.steps.length > 1 ? `<button class="icon-btn" type="button" title="단계 삭제" onclick="removeStep('${f.key}', ${si})">✕</button>` : ''}
            </div>
          `).join('')}
        </div>
        <button class="btn ghost sm" type="button" style="margin-top:8px;" onclick="addStep('${f.key}')">+ 단계 추가</button>
      </div>
    </div>
  `).join('');
}

function updateFeatureField(key, field, value) {
  const f = state.features.find((x) => x.key === key);
  if (f) f[field] = value;
  saveDraft();
}
function updateStepField(key, idx, value) {
  const f = state.features.find((x) => x.key === key);
  if (f) f.steps[idx] = value;
  saveDraft();
}

// ============================================================
//  디자인 (직접 작성 / 견본 선택)
// ============================================================

function setDesignMode(mode) {
  state.designMode = mode;
  document.getElementById('modeBtn-custom').classList.toggle('active', mode === 'custom');
  document.getElementById('modeBtn-preset').classList.toggle('active', mode === 'preset');
  document.getElementById('designCustom').hidden = mode !== 'custom';
  document.getElementById('designPreset').hidden = mode !== 'preset';
  saveDraft();
}

function renderPresets() {
  const el = document.getElementById('presetGrid');
  el.innerHTML = DESIGN_PRESETS.map((p) => `
    <div class="preset-card${state.selectedPreset === p.id ? ' selected' : ''}" onclick="selectPreset('${p.id}')">
      <div class="preset-swatch ${p.swatchClass}"></div>
      <div class="preset-name">${p.name}</div>
      <div class="preset-desc">${p.summary}</div>
    </div>
  `).join('');
}

function selectPreset(id) {
  state.selectedPreset = id;
  renderPresets();
  saveDraft();
}

// ============================================================
//  단계 이동 / 검증
// ============================================================

function goStep(n) {
  if (n === 2 && !validateStep1()) return;
  if (n === 3 && !validateStep2()) return;
  showStep(n);
}

function showStep(n) {
  document.querySelectorAll('.panel').forEach((p) => p.classList.remove('active'));
  document.getElementById('panel-' + n).classList.add('active');

  document.querySelectorAll('.step').forEach((s) => {
    const stepNum = Number(s.dataset.step);
    s.classList.toggle('active', stepNum === n);
    s.classList.toggle('done', stepNum < n);
  });
  window.scrollTo({ top: 0, behavior: 'smooth' });
}

function getPurpose() {
  const el = document.querySelector('input[name="purpose"]:checked');
  return el ? el.value : null;
}

function validateStep1() {
  const ok = !!getPurpose();
  document.getElementById('err-purpose').hidden = ok;
  return ok;
}

function validateStep2() {
  const topic = document.getElementById('topic').value.trim();
  const topicOk = !!topic;
  document.getElementById('err-topic').hidden = topicOk;

  const validFeatures = state.features.filter((f) => f.name.trim());
  const featuresOk = validFeatures.length > 0;
  document.getElementById('err-features').hidden = featuresOk;

  return topicOk && featuresOk;
}

function validateStep3() {
  let ok = false;
  if (state.designMode === 'custom') {
    ok = !!document.getElementById('designText').value.trim();
  } else {
    ok = !!state.selectedPreset;
  }
  document.getElementById('err-design').hidden = ok;
  return ok;
}

// ============================================================
//  프롬프트 조립
// ============================================================

function generatePrompt() {
  if (!validateStep1()) { showStep(1); return; }
  if (!validateStep2()) { showStep(2); return; }
  if (!validateStep3()) return;

  const purpose = getPurpose();
  const topic = document.getElementById('topic').value.trim();
  const validFeatures = state.features.filter((f) => f.name.trim());

  const lines = [];

  // 0. 앱을 만들어달라는 지시문임을 맨 앞에 명확히 한다 — 뒤따르는 문장들은
  // 전부 이 지시를 위한 조건/맥락이지, 앱 자체를 소개하는 글이 아니다.
  lines.push('아래 조건에 맞는 웹앱을 만들어주세요.');
  lines.push('');

  // 1. 목적별 삽입 문구
  lines.push(PURPOSE_TEXT[purpose]);
  lines.push('');

  // 2. 주제
  lines.push(`이 앱의 주제는 ${topic}입니다.`);
  lines.push('');

  // 3. 기능 목록
  lines.push('다음 기능들을 구현해주세요:');
  validFeatures.forEach((f) => {
    lines.push(`- ${f.name}: ${f.desc || '(설명 없음)'}`);
    const steps = f.steps.map((s) => s.trim()).filter(Boolean);
    steps.forEach((s, i) => lines.push(`  ${i + 1}. ${s}`));
  });
  lines.push('');

  // 4. 디자인
  if (state.designMode === 'custom') {
    lines.push(document.getElementById('designText').value.trim());
  } else {
    const preset = DESIGN_PRESETS.find((p) => p.id === state.selectedPreset);
    lines.push(preset.text);
  }
  lines.push('');

  // 5. 고정 문구
  lines.push(CLOSING_TEXT);

  document.getElementById('resultText').value = lines.join('\n');
  showStep(4);
}

// ============================================================
//  결과 화면: 복사 / 초기화
// ============================================================

async function copyResult() {
  const text = document.getElementById('resultText').value;
  try {
    await navigator.clipboard.writeText(text);
    toast('클립보드에 복사되었습니다');
  } catch {
    // Clipboard API를 못 쓰는 환경 — textarea 선택으로 대체
    const ta = document.getElementById('resultText');
    ta.focus();
    ta.select();
    try {
      document.execCommand('copy');
      toast('클립보드에 복사되었습니다');
    } catch {
      alert('복사에 실패했습니다. 직접 선택해서 복사해주세요.');
    }
  }
}

let toastTimer = null;
function toast(msg) {
  const el = document.getElementById('toast');
  el.textContent = msg;
  el.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => el.classList.remove('show'), 2400);
}

function resetAll() {
  document.querySelectorAll('input[name="purpose"]').forEach((el) => { el.checked = false; });
  document.getElementById('topic').value = '';
  state.features = [newFeature()];
  renderFeatures();
  document.getElementById('designText').value = '';
  state.selectedPreset = null;
  setDesignMode('custom');
  renderPresets();
  document.getElementById('err-purpose').hidden = true;
  document.getElementById('err-topic').hidden = true;
  document.getElementById('err-features').hidden = true;
  document.getElementById('err-design').hidden = true;
  clearDraft();
  showStep(1);
}

// ============================================================
//  예시로 채워보기
// ============================================================

function fillExample() {
  document.querySelector('input[name="purpose"][value="edu"]').checked = true;
  document.getElementById('topic').value = '수업 집중용 타이머';

  state.features = [{
    key: 'f' + (++featureSeq),
    name: '집중 타이머',
    desc: '설정한 시간 동안 카운트다운하고, 시간이 끝나면 알림을 준다',
    steps: [
      '선생님이 분/초를 입력하고 시작 버튼을 누른다',
      '화면에 남은 시간이 큰 숫자로 표시된다',
      '시간이 끝나면 알림음이 울리고 화면이 깜빡인다',
    ],
  }];
  renderFeatures();

  state.selectedPreset = 'minimal';
  setDesignMode('preset');
  renderPresets();

  toast('예시 데이터를 채웠습니다. 자유롭게 고쳐서 써보세요');
  saveDraft();
}

// ============================================================
//  임시 저장 (localStorage) — 새로고침해도 작성 중이던 내용 유지
// ============================================================

const DRAFT_KEY = 'promptgen_draft';

function saveDraft() {
  try {
    const draft = {
      purpose: getPurpose(),
      topic: document.getElementById('topic').value,
      features: state.features.map((f) => ({ name: f.name, desc: f.desc, steps: f.steps })),
      designMode: state.designMode,
      designText: document.getElementById('designText').value,
      selectedPreset: state.selectedPreset,
    };
    localStorage.setItem(DRAFT_KEY, JSON.stringify(draft));
  } catch { /* localStorage를 못 쓰는 환경이면 임시 저장은 그냥 건너뛴다 */ }
}

function clearDraft() {
  try { localStorage.removeItem(DRAFT_KEY); } catch {}
}

function loadDraft() {
  let draft;
  try { draft = JSON.parse(localStorage.getItem(DRAFT_KEY) || 'null'); } catch { draft = null; }
  if (!draft) return false;

  if (draft.purpose) {
    const el = document.querySelector(`input[name="purpose"][value="${draft.purpose}"]`);
    if (el) el.checked = true;
  }
  document.getElementById('topic').value = draft.topic || '';

  if (Array.isArray(draft.features) && draft.features.length) {
    state.features = draft.features.map((f) => ({
      key: 'f' + (++featureSeq),
      name: f.name || '',
      desc: f.desc || '',
      steps: Array.isArray(f.steps) && f.steps.length ? f.steps : [''],
    }));
  }

  document.getElementById('designText').value = draft.designText || '';
  state.selectedPreset = draft.selectedPreset || null;
  setDesignMode(draft.designMode === 'preset' ? 'preset' : 'custom');

  return true;
}

// ============================================================
//  다크모드
// ============================================================

function toggleDark() {
  document.body.classList.toggle('dark');
  localStorage.setItem('dark', document.body.classList.contains('dark') ? '1' : '0');
}
if (localStorage.getItem('dark') === '1') document.body.classList.add('dark');
const darkToggleEl = document.getElementById('darkToggle');
darkToggleEl.addEventListener('click', toggleDark);
darkToggleEl.addEventListener('keydown', (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); toggleDark(); } });

// ============================================================
//  초기화
// ============================================================

if (!loadDraft()) {
  state.features.push(newFeature());
}
renderFeatures();
renderPresets();
