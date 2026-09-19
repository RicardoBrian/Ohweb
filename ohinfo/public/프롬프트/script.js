// ============================================================
//  프롬프트 생성기 — 상태 및 상수
// ============================================================

const PURPOSE_TEXT = {
  work: '이 앱은 업무 효율을 높이기 위한 실용적 도구입니다. 불필요한 장식보다는 빠른 입력과 결과 확인에 집중해주세요.',
  edu: '이 앱은 교육 현장(수업, 평가, 기록)에서 사용됩니다.',
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

const CLOSING_TEXT = '빌드 도구(Vite, React, webpack 등) 없이 순수 HTML/CSS/JS로 작성해주세요. 데스크톱과 모바일 화면 모두에서 자연스럽게 보이도록 반응형으로 만들어주세요. 화면에 보이는 버튼, 안내 문구, 오류 메시지 등 모든 텍스트는 한국어로 작성해주세요. TODO나 "여기에 구현" 같은 미완성 부분 없이, 위에 적은 기능들이 실제로 클릭하면 동작하는 완성된 코드로 작성해주세요. 입력값이 비어있거나 잘못된 경우에도 오류 없이 자연스럽게 동작하도록 예외 처리를 해주세요. 완성된 웹앱을 별도 설명 없이 바로 실행 가능한 코드로 한 번에 작성해주세요.';

// 데이터 저장 방식별 삽입 문구 — 견본 화면(견본/shared/firestore-lite*.js)과 달리
// 실제로 만들어질 앱은 진짜 구글 시트/Firebase를 붙여야 하므로, Gemini가 자리표시
// 상수/설정값을 코드에 남겨두고 연동 방법까지 단계별로 설명하도록 명시한다.
const STORAGE_TEXT = {
  local: '데이터 저장은 브라우저 localStorage만 사용해주세요. 로그인이나 외부 서비스 연동 없이, 각 사용자의 브라우저 안에만 데이터가 저장되면 됩니다.',
  sheets: [
    '데이터는 Google 스프레드시트에 저장하고 불러와주세요. Google Apps Script로 스프레드시트를 웹앱(Web App)으로 배포한 뒤, 그 배포 URL로 fetch(GET/POST)를 보내 데이터를 읽고 쓰는 방식으로 구현해주세요.',
    '코드 안에는 실제 URL 대신 아래처럼 자리표시 상수를 만들어 두고, 제가 나중에 제 배포 URL로 바꿔 넣을 수 있게 해주세요:',
    'const SHEET_WEB_APP_URL = "여기에_Apps_Script_웹앱_URL_붙여넣기";',
    '그리고 제가 직접 연동할 수 있도록 아래 내용을 코드와 함께 단계별로 설명해주세요: (1) 구글 스프레드시트를 새로 만들고 어떤 열(컬럼)로 구성하면 되는지, (2) 스프레드시트의 확장 프로그램 → Apps Script에 붙여넣을 코드(doGet/doPost로 데이터를 읽고 쓰는 코드), (3) Apps Script를 웹앱으로 배포하는 방법과 배포 후 나오는 URL을 어디에 붙여넣어야 하는지.',
  ].join(' '),
  firebase: [
    '데이터는 Firebase(Firestore)에 저장하고 불러와주세요. Firebase JS SDK(CDN 방식)를 사용해서 구현해주세요.',
    '코드 안에는 실제 값 대신 아래처럼 자리표시 설정 객체를 만들어 두고, 제가 나중에 제 Firebase 프로젝트 설정값으로 바꿔 넣을 수 있게 해주세요:',
    'const firebaseConfig = { apiKey: "여기에_API_KEY", authDomain: "여기에_AUTH_DOMAIN", projectId: "여기에_PROJECT_ID", storageBucket: "여기에_STORAGE_BUCKET", messagingSenderId: "여기에_SENDER_ID", appId: "여기에_APP_ID" };',
    '그리고 제가 직접 연동할 수 있도록 아래 내용을 단계별로 설명해주세요: (1) Firebase 콘솔(console.firebase.google.com)에서 새 프로젝트를 만드는 방법, (2) Firestore Database를 테스트 모드로 생성하고 어떤 컬렉션 구조를 쓰면 되는지, (3) "웹 앱 추가"로 앱을 등록해서 위 firebaseConfig 값을 얻는 방법과 그 값을 코드 어디에 붙여넣어야 하는지.',
  ].join(' '),
};

const state = {
  features: [],
  storage: null, // 'local' | 'sheets' | 'firebase'
  designMode: 'custom', // 'custom' | 'preset'
  selectedPreset: null,
};

let featureSeq = 0;
function newFeature() {
  featureSeq++;
  return { key: 'f' + featureSeq, name: '', desc: '', steps: [''] };
}

// 수정 프롬프트(웹앱 수정하기) 화면 전용 상태 — 원래 마법사의 state와는 별개.
const reviseState = {
  newFeatures: [],
  existingNotes: {}, // 기존 기능 key -> 수정 요청 텍스트
  designMode: 'custom',
  selectedPreset: null,
};

let newFeatureSeq = 0;
function newFeatureForRevise() {
  newFeatureSeq++;
  return { key: 'nf' + newFeatureSeq, name: '', desc: '', steps: [''] };
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
//  웹앱 수정하기 — 새로 추가할 기능 (기능 목록과 동일한 카드형 UI)
// ============================================================

function addNewFeature() {
  reviseState.newFeatures.push(newFeatureForRevise());
  renderNewFeatures();
  saveDraft();
}

function removeNewFeature(key) {
  reviseState.newFeatures = reviseState.newFeatures.filter((f) => f.key !== key);
  renderNewFeatures();
  saveDraft();
}

function moveNewFeature(key, dir) {
  const i = reviseState.newFeatures.findIndex((f) => f.key === key);
  const j = i + dir;
  if (i < 0 || j < 0 || j >= reviseState.newFeatures.length) return;
  [reviseState.newFeatures[i], reviseState.newFeatures[j]] = [reviseState.newFeatures[j], reviseState.newFeatures[i]];
  renderNewFeatures();
  saveDraft();
}

function addNewFeatureStep(key) {
  const f = reviseState.newFeatures.find((x) => x.key === key);
  if (f) f.steps.push('');
  renderNewFeatures();
  saveDraft();
}

function removeNewFeatureStep(key, idx) {
  const f = reviseState.newFeatures.find((x) => x.key === key);
  if (f) f.steps.splice(idx, 1);
  renderNewFeatures();
  saveDraft();
}

function updateNewFeatureField(key, field, value) {
  const f = reviseState.newFeatures.find((x) => x.key === key);
  if (f) f[field] = value;
  saveDraft();
}
function updateNewFeatureStepField(key, idx, value) {
  const f = reviseState.newFeatures.find((x) => x.key === key);
  if (f) f.steps[idx] = value;
  saveDraft();
}

function renderNewFeatures() {
  const el = document.getElementById('newFeatureList');
  if (!reviseState.newFeatures.length) {
    el.innerHTML = '<div class="empty-features">추가할 새 기능이 없다면 비워두고 넘어가도 됩니다.</div>';
    return;
  }

  el.innerHTML = reviseState.newFeatures.map((f, i) => `
    <div class="feature-card" data-key="${f.key}">
      <div class="feature-card-head">
        <span>새 기능 ${i + 1}</span>
        <div class="feature-card-actions">
          <button class="icon-btn" type="button" title="위로 이동" onclick="moveNewFeature('${f.key}', -1)" ${i === 0 ? 'disabled' : ''}>▲</button>
          <button class="icon-btn" type="button" title="아래로 이동" onclick="moveNewFeature('${f.key}', 1)" ${i === reviseState.newFeatures.length - 1 ? 'disabled' : ''}>▼</button>
          <button class="icon-btn" type="button" title="기능 삭제" onclick="removeNewFeature('${f.key}')">✕</button>
        </div>
      </div>
      <div class="feature-row">
        <label>기능 이름</label>
        <input type="text" class="inp" placeholder="예: 초 단위 진동 알림" value="${esc(f.name)}"
          oninput="updateNewFeatureField('${f.key}', 'name', this.value)">
      </div>
      <div class="feature-row">
        <label>기능 소개 (1~2줄)</label>
        <input type="text" class="inp" placeholder="예: 소리 대신 화면 전체가 깜빡이며 알려준다"
          value="${esc(f.desc)}" oninput="updateNewFeatureField('${f.key}', 'desc', this.value)">
      </div>
      <div class="feature-row">
        <label>작동 단계</label>
        <div class="step-list">
          ${f.steps.map((s, si) => `
            <div class="step-row">
              <span class="step-row-num">${si + 1}단계</span>
              <input type="text" class="inp" placeholder="예: 시간이 끝나면 화면이 3번 깜빡인다"
                value="${esc(s)}" oninput="updateNewFeatureStepField('${f.key}', ${si}, this.value)">
              ${f.steps.length > 1 ? `<button class="icon-btn" type="button" title="단계 삭제" onclick="removeNewFeatureStep('${f.key}', ${si})">✕</button>` : ''}
            </div>
          `).join('')}
        </div>
        <button class="btn ghost sm" type="button" style="margin-top:8px;" onclick="addNewFeatureStep('${f.key}')">+ 단계 추가</button>
      </div>
    </div>
  `).join('');
}

// ============================================================
//  웹앱 수정하기 — 기존 기능 수정 (읽기 전용 + 수정 요청 메모)
// ============================================================

function renderExistingFeatureNotes() {
  const el = document.getElementById('existingFeatureNotes');
  const feats = state.features.filter((f) => f.name.trim());
  if (!feats.length) {
    el.innerHTML = '<div class="empty-features">수정할 기존 기능이 없습니다.</div>';
    return;
  }
  el.innerHTML = feats.map((f) => {
    const steps = f.steps.map((s) => s.trim()).filter(Boolean);
    return `
    <div class="existing-feature-card">
      <div class="existing-feature-locked">
        <div class="existing-feature-name">${esc(f.name)}</div>
        <div class="existing-feature-desc">${esc(f.desc || '(설명 없음)')}</div>
        ${steps.length ? `<ol class="existing-feature-steps">${steps.map((s) => `<li>${esc(s)}</li>`).join('')}</ol>` : ''}
      </div>
      <label>이 기능을 이렇게 수정해주세요 (수정하지 않으려면 비워두세요. 특정 단계를 콕 집어 얘기하려면 "2번째 단계를 ~로 바꿔주세요"처럼 적어도 됩니다)</label>
      <textarea class="inp" rows="2" placeholder="예: 시작 버튼을 누르면 3초 카운트다운 후 시작하게 해주세요"
        oninput="updateExistingNote('${f.key}', this.value)">${esc(reviseState.existingNotes[f.key] || '')}</textarea>
    </div>
  `;
  }).join('');
}

function updateExistingNote(key, value) {
  reviseState.existingNotes[key] = value;
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

function setReviseDesignMode(mode) {
  reviseState.designMode = mode;
  document.getElementById('reviseModeBtn-custom').classList.toggle('active', mode === 'custom');
  document.getElementById('reviseModeBtn-preset').classList.toggle('active', mode === 'preset');
  document.getElementById('reviseDesignCustom').hidden = mode !== 'custom';
  document.getElementById('reviseDesignPreset').hidden = mode !== 'preset';
  saveDraft();
}

function renderRevisePresets() {
  const el = document.getElementById('revisePresetGrid');
  el.innerHTML = DESIGN_PRESETS.map((p) => `
    <div class="preset-card${reviseState.selectedPreset === p.id ? ' selected' : ''}" onclick="selectRevisePreset('${p.id}')">
      <div class="preset-swatch ${p.swatchClass}"></div>
      <div class="preset-name">${p.name}</div>
      <div class="preset-desc">${p.summary}</div>
    </div>
  `).join('');
}

function selectRevisePreset(id) {
  reviseState.selectedPreset = id;
  renderRevisePresets();
  saveDraft();
}

// ============================================================
//  단계 이동 / 검증
// ============================================================

function goStep(n) {
  if (n === 2 && !validateStep1()) return;
  if (n === 3 && !validateStep2()) return;
  if (n === 4 && !validateStorage()) return;
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

function getStorage() {
  const el = document.querySelector('input[name="storage"]:checked');
  return el ? el.value : null;
}

function validateStorage() {
  const ok = !!getStorage();
  document.getElementById('err-storage').hidden = ok;
  return ok;
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
  if (!validateStorage()) { showStep(3); return; }
  if (!validateStep3()) return;

  const purpose = getPurpose();
  const storage = getStorage();
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
  lines.push('다음 기능들을 구현해주세요. 각 기능은 적어놓은 순서/설명 그대로 실제로 동작해야 하고, 기능이 여러 개면 서로 방해하지 않고 함께 정상 동작해야 합니다:');
  validFeatures.forEach((f) => {
    lines.push(`- ${f.name}: ${f.desc || '(설명 없음)'}`);
    const steps = f.steps.map((s) => s.trim()).filter(Boolean);
    steps.forEach((s, i) => lines.push(`  ${i + 1}. ${s}`));
  });
  lines.push('');

  // 4. 데이터 저장 방식
  lines.push(STORAGE_TEXT[storage]);
  lines.push('');

  // 5. 디자인
  if (state.designMode === 'custom') {
    lines.push(document.getElementById('designText').value.trim());
  } else {
    const preset = DESIGN_PRESETS.find((p) => p.id === state.selectedPreset);
    lines.push(preset.text);
  }
  lines.push('');

  // 6. 고정 문구
  lines.push(CLOSING_TEXT);

  document.getElementById('resultText').value = lines.join('\n');
  showStep(5);
}

// ============================================================
//  웹앱 수정하기 — 화면 진입 / 수정 프롬프트 조립
// ============================================================

function openRevise() {
  renderNewFeatures();
  renderExistingFeatureNotes();
  renderRevisePresets();
  document.querySelectorAll('.panel').forEach((p) => p.classList.remove('active'));
  document.getElementById('panel-revise').classList.add('active');
  window.scrollTo({ top: 0, behavior: 'smooth' });
}

function generateRevisePrompt() {
  const newFeats = reviseState.newFeatures.filter((f) => f.name.trim());
  const notes = state.features
    .filter((f) => f.name.trim() && (reviseState.existingNotes[f.key] || '').trim())
    .map((f) => ({ f, note: reviseState.existingNotes[f.key].trim() }));
  const bug = document.getElementById('reviseBugText').value.trim();
  const designCustom = document.getElementById('reviseDesignText').value.trim();
  const hasDesign = reviseState.designMode === 'custom' ? !!designCustom : !!reviseState.selectedPreset;

  const hasAnything = newFeats.length > 0 || notes.length > 0 || !!bug || hasDesign;
  document.getElementById('err-revise').hidden = hasAnything;
  if (!hasAnything) return;

  const lines = [];
  lines.push('아래 요청대로 기존 웹앱을 수정해주세요. 언급하지 않은 기존 기능과 디자인은 그대로 유지해주세요.');
  lines.push('');

  if (newFeats.length) {
    lines.push('다음 기능을 새로 추가해주세요:');
    newFeats.forEach((f) => {
      lines.push(`- ${f.name}: ${f.desc || '(설명 없음)'}`);
      const steps = f.steps.map((s) => s.trim()).filter(Boolean);
      steps.forEach((s, i) => lines.push(`  ${i + 1}. ${s}`));
    });
    lines.push('');
  }

  if (notes.length) {
    lines.push('다음 기존 기능을 수정해주세요:');
    notes.forEach(({ f, note }) => {
      lines.push(`- ${f.name}`);
      lines.push(`  기존 설명: ${f.desc || '(설명 없음)'}`);
      const steps = f.steps.map((s) => s.trim()).filter(Boolean);
      if (steps.length) {
        lines.push('  기존 작동 단계:');
        steps.forEach((s, i) => lines.push(`    ${i + 1}. ${s}`));
      }
      lines.push(`  수정 요청: ${note}`);
    });
    lines.push('');
  }

  if (bug) {
    lines.push('다음 문제를 고쳐주세요:');
    lines.push(bug);
    lines.push('');
  }

  if (hasDesign) {
    lines.push('디자인을 다음과 같이 바꿔주세요:');
    if (reviseState.designMode === 'custom') {
      lines.push(designCustom);
    } else {
      lines.push(DESIGN_PRESETS.find((p) => p.id === reviseState.selectedPreset).text);
    }
    lines.push('');
  }

  lines.push('수정된 전체 코드를 다시 한 번에, 생략 없이 작성해주세요. (빌드 도구 없이 순수 HTML/CSS/JS, 기존에 쓰던 데이터 저장 방식(localStorage/구글 시트/Firebase 등) 그대로 유지, 화면 텍스트는 한국어 등 기존 제약은 동일하게 적용해주세요.) TODO나 "여기에 구현" 같은 미완성 부분 없이 실제로 동작하는 코드로 작성해주세요.');

  document.getElementById('resultText').value = lines.join('\n');
  showStep(5);
  toast('수정 프롬프트가 생성되었습니다');
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
  document.querySelectorAll('input[name="storage"]').forEach((el) => { el.checked = false; });
  document.getElementById('designText').value = '';
  state.selectedPreset = null;
  setDesignMode('custom');
  renderPresets();
  document.getElementById('err-purpose').hidden = true;
  document.getElementById('err-topic').hidden = true;
  document.getElementById('err-features').hidden = true;
  document.getElementById('err-storage').hidden = true;
  document.getElementById('err-design').hidden = true;

  reviseState.newFeatures = [];
  reviseState.existingNotes = {};
  reviseState.selectedPreset = null;
  document.getElementById('reviseBugText').value = '';
  document.getElementById('reviseDesignText').value = '';
  setReviseDesignMode('custom');
  document.getElementById('err-revise').hidden = true;

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

  document.querySelector('input[name="storage"][value="local"]').checked = true;

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
      storage: getStorage(),
      designMode: state.designMode,
      designText: document.getElementById('designText').value,
      selectedPreset: state.selectedPreset,
      revise: {
        newFeatures: reviseState.newFeatures.map((f) => ({ name: f.name, desc: f.desc, steps: f.steps })),
        existingNotes: reviseState.existingNotes,
        bugText: document.getElementById('reviseBugText').value,
        designMode: reviseState.designMode,
        designText: document.getElementById('reviseDesignText').value,
        selectedPreset: reviseState.selectedPreset,
      },
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

  if (draft.storage) {
    const el = document.querySelector(`input[name="storage"][value="${draft.storage}"]`);
    if (el) el.checked = true;
  }

  document.getElementById('designText').value = draft.designText || '';
  state.selectedPreset = draft.selectedPreset || null;
  setDesignMode(draft.designMode === 'preset' ? 'preset' : 'custom');

  const r = draft.revise;
  if (r) {
    if (Array.isArray(r.newFeatures) && r.newFeatures.length) {
      reviseState.newFeatures = r.newFeatures.map((f) => ({
        key: 'nf' + (++newFeatureSeq),
        name: f.name || '',
        desc: f.desc || '',
        steps: Array.isArray(f.steps) && f.steps.length ? f.steps : [''],
      }));
    }
    reviseState.existingNotes = r.existingNotes && typeof r.existingNotes === 'object' ? r.existingNotes : {};
    document.getElementById('reviseBugText').value = r.bugText || '';
    document.getElementById('reviseDesignText').value = r.designText || '';
    reviseState.selectedPreset = r.selectedPreset || null;
    setReviseDesignMode(r.designMode === 'preset' ? 'preset' : 'custom');
  }

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
