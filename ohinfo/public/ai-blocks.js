// AI 코딩 — 블록 정의·도구 상자·코드 만들기. aicode.html이 Blockly(구글 오픈소스 블록 편집기)를 불러온 뒤 쓴다.
// 블록 글자는 ai-i18n.js의 b_* 문구. 만든 코드는 ai-stage.js의 api만 부른다(그 밖의 것은 쓸 수 없다).

export const COLORS = { event: '#FFBF00', ai: '#0FBD8C', motion: '#4C97FF', looks: '#9966FF', sound: '#CF63CF', control: '#FFAB19', op: '#59C059', vars: '#FF8C1A' };
export const COSTUMES = ['🐱', '🐶', '🐰', '🐻', '🐼', '🐧', '🐸', '🦊', '🐯', '🐢', '🐟', '🦄', '🤖', '👾', '🚀', '⚽', '🍎', '⭐', '❤️', '🌈'];
const BG = ['#ffffff', '#dff1ff', '#e6f7d9', '#fff6cc', '#ffe3ef', '#ede7ff', '#1f2340'];
const SOUND_IDS = ['beep', 'ding', 'pop', 'fanfare', 'buzz'];

// ctx: { t, kind: 'image'|'text'|'table', prob: 'class'|'reg', labels: () => [[이름, id]], features: () => [[이름, 번호]] }
export function defineBlocks(B, J, ctx) {
  const { t } = ctx;
  const O = J.Order;
  B.Extensions.isRegistered('ai_hat') || B.Extensions.register('ai_hat', function () { this.hat = 'cap'; });
  const opt = list => (list.length ? list : [['-', '']]);
  const labelOpts = () => opt(ctx.labels());
  const featOpts = () => opt(ctx.features().map(([n, i]) => [n, String(i)]));
  const stmt = (type, colour, msg, args = [], extra = {}) => ({ type, message0: msg, args0: args, previousStatement: null, nextStatement: null, colour, ...extra });
  const hat = (type, msg, args = []) => ({ type, message0: msg, args0: args, nextStatement: null, colour: COLORS.event, extensions: ['ai_hat'] });
  const val = name => ({ type: 'input_value', name });
  const drop = (name, options) => ({ type: 'field_dropdown', name, options });

  B.common.defineBlocksWithJsonArray([
    hat('ev_start', t('b_start')),
    hat('ev_result', t('b_onResult')),
    hat('ev_click', t('b_onClick')),
    // AI
    stmt('ai_ask_image', COLORS.ai, t('b_askImage')),
    stmt('ai_camera', COLORS.ai, t('b_camera'), [drop('ON', [[t('b_on'), '1'], [t('b_off'), '0']])]),
    stmt('ai_ask_text', COLORS.ai, t('b_askText'), [val('TEXT')]),
    stmt('ai_ask_table', COLORS.ai, t('b_askTable')),
    stmt('ai_set_input', COLORS.ai, t('b_setInput'), [drop('F', featOpts), val('V')]),
    { type: 'ai_input_value', message0: t('b_inputValue'), args0: [drop('F', featOpts)], output: null, colour: COLORS.ai },
    { type: 'ai_result', message0: t('b_result'), output: null, colour: COLORS.ai },
    { type: 'ai_is', message0: t('b_isResult'), args0: [drop('L', labelOpts)], output: 'Boolean', colour: COLORS.ai },
    { type: 'ai_prob', message0: t('b_prob'), args0: [drop('L', labelOpts)], output: 'Number', colour: COLORS.ai },
    stmt('ai_ask_user', COLORS.ai, t('b_askUser'), [val('Q')]),
    { type: 'ai_answer', message0: t('b_answer'), output: null, colour: COLORS.ai },
    // 동작
    stmt('mo_move', COLORS.motion, t('b_move'), [val('N')]),
    stmt('mo_turn', COLORS.motion, t('b_turn'), [val('D')]),
    stmt('mo_goto', COLORS.motion, t('b_goto'), [val('X'), val('Y')]),
    stmt('mo_change_x', COLORS.motion, t('b_changeX'), [val('D')]),
    stmt('mo_change_y', COLORS.motion, t('b_changeY'), [val('D')]),
    // 모양
    stmt('lo_say_for', COLORS.looks, t('b_sayFor'), [val('TEXT'), val('SEC')]),
    stmt('lo_say', COLORS.looks, t('b_say'), [val('TEXT')]),
    stmt('lo_costume', COLORS.looks, t('b_costume'), [drop('E', COSTUMES.map(e => [e, e]))]),
    stmt('lo_size', COLORS.looks, t('b_size'), [val('P')]),
    stmt('lo_change_size', COLORS.looks, t('b_changeSize'), [val('D')]),
    stmt('lo_bg', COLORS.looks, t('b_bg'), [drop('C', BG.map((c, i) => [t('b_bgs')[i], c]))]),
    stmt('lo_show', COLORS.looks, t('b_show'), [drop('ON', [[t('b_showOn'), '1'], [t('b_showOff'), '0']])]),
    // 소리
    stmt('so_play', COLORS.sound, t('b_sound'), [drop('S', SOUND_IDS.map((s, i) => [t('b_sounds')[i], s]))]),
    // 제어
    stmt('ct_wait', COLORS.control, t('b_wait'), [val('SEC')]),
    { type: 'ct_forever', message0: `${t('b_forever')} %1`, args0: [{ type: 'input_dummy' }], message1: '%1', args1: [{ type: 'input_statement', name: 'DO' }], previousStatement: null, colour: COLORS.control },
    { type: 'ct_stop', message0: t('b_stop'), previousStatement: null, colour: COLORS.control },
  ]);

  const g = J.javascriptGenerator;
  const v = (b, name, order = O.NONE, dflt = '0') => g.valueToCode(b, name, order) || dflt;
  const q = s => g.quote_(String(s == null ? '' : s));
  const F = g.forBlock;
  for (const k of ['ev_start', 'ev_result', 'ev_click']) F[k] = () => '';
  F.ai_ask_image = () => 'await api.askImage();\n';
  F.ai_camera = b => `api.camera(${b.getFieldValue('ON') === '1'});\n`;
  F.ai_ask_text = b => `await api.askText(${v(b, 'TEXT', O.NONE, "''")});\n`;
  F.ai_ask_table = () => 'await api.askTable();\n';
  F.ai_set_input = b => `api.setInput(${Number(b.getFieldValue('F')) || 0}, ${v(b, 'V')});\n`;
  F.ai_input_value = b => [`api.inputValue(${Number(b.getFieldValue('F')) || 0})`, O.FUNCTION_CALL];
  F.ai_result = () => ['api.result()', O.FUNCTION_CALL];
  F.ai_is = b => [`api.isResult(${q(b.getFieldValue('L'))})`, O.FUNCTION_CALL];
  F.ai_prob = b => [`api.prob(${q(b.getFieldValue('L'))})`, O.FUNCTION_CALL];
  F.ai_ask_user = b => `await api.ask(${v(b, 'Q', O.NONE, "''")});\n`;
  F.ai_answer = () => ['api.answer()', O.FUNCTION_CALL];
  F.mo_move = b => `api.move(${v(b, 'N')});\n`;
  F.mo_turn = b => `api.turn(${v(b, 'D')});\n`;
  F.mo_goto = b => `api.goTo(${v(b, 'X')}, ${v(b, 'Y')});\n`;
  F.mo_change_x = b => `api.changeX(${v(b, 'D')});\n`;
  F.mo_change_y = b => `api.changeY(${v(b, 'D')});\n`;
  F.lo_say_for = b => `await api.sayFor(${v(b, 'TEXT', O.NONE, "''")}, ${v(b, 'SEC')});\n`;
  F.lo_say = b => `api.say(${v(b, 'TEXT', O.NONE, "''")});\n`;
  F.lo_costume = b => `api.costume(${q(b.getFieldValue('E'))});\n`;
  F.lo_size = b => `api.size(${v(b, 'P')});\n`;
  F.lo_change_size = b => `api.changeSize(${v(b, 'D')});\n`;
  F.lo_bg = b => `api.bg(${q(b.getFieldValue('C'))});\n`;
  F.lo_show = b => `api.show(${b.getFieldValue('ON') === '1'});\n`;
  F.so_play = b => `await api.sound(${q(b.getFieldValue('S'))});\n`;
  F.ct_wait = b => `await api.wait(${v(b, 'SEC')});\n`;
  F.ct_forever = b => `while (true) {\n${g.statementToCode(b, 'DO')}  await api.tick();\n}\n`;
  F.ct_stop = () => 'api.stopAll();\n';
  // 모든 반복이 한 번 돌 때마다 화면에 양보한다(무한 반복이 멈추지 않게). 블록 하나마다 멈춤을 확인한다.
  g.INFINITE_LOOP_TRAP = 'await api.tick();\n';
  g.STATEMENT_PREFIX = 'api.check();\n';
}

// 도구 상자: 모델 종류에 맞는 AI 블록만
export function toolbox(ctx) {
  const { t, kind, prob } = ctx;
  const num = n => ({ shadow: { type: 'math_number', fields: { NUM: n } } });
  const txt = s => ({ shadow: { type: 'text', fields: { TEXT: s } } });
  const b = (type, inputs) => ({ kind: 'block', type, ...(inputs ? { inputs } : {}) });
  const cls = prob !== 'reg';
  const ai = [
    ...(kind === 'image' ? [b('ai_camera'), b('ai_ask_image')] : []),
    ...(kind === 'text' ? [b('ai_ask_user', { Q: txt(t('b_defAsk')) }), b('ai_answer'), b('ai_ask_text', { TEXT: txt(t('b_defText')) })] : []),
    ...(kind === 'table' ? [b('ai_set_input', { V: num(0) }), b('ai_input_value'), b('ai_ask_table')] : []),
    b('ai_result'),
    ...(cls ? [b('ai_is'), b('ai_prob')] : []),
    ...(kind !== 'text' ? [b('ai_ask_user', { Q: txt(t('b_defAsk')) }), b('ai_answer')] : []),
  ];
  return {
    kind: 'categoryToolbox',
    contents: [
      { kind: 'category', name: t('b_cEvent'), colour: COLORS.event, contents: [b('ev_start'), b('ev_result'), b('ev_click')] },
      { kind: 'category', name: t('b_cAI'), colour: COLORS.ai, contents: ai },
      { kind: 'category', name: t('b_cLooks'), colour: COLORS.looks, contents: [b('lo_say_for', { TEXT: txt(t('b_defSay')), SEC: num(2) }), b('lo_say', { TEXT: txt(t('b_defSay')) }), b('lo_costume'), b('lo_size', { P: num(100) }), b('lo_change_size', { D: num(10) }), b('lo_bg'), b('lo_show')] },
      { kind: 'category', name: t('b_cMotion'), colour: COLORS.motion, contents: [b('mo_move', { N: num(10) }), b('mo_turn', { D: num(15) }), b('mo_goto', { X: num(0), Y: num(0) }), b('mo_change_x', { D: num(10) }), b('mo_change_y', { D: num(10) })] },
      { kind: 'category', name: t('b_cSound'), colour: COLORS.sound, contents: [b('so_play')] },
      { kind: 'category', name: t('b_cControl'), colour: COLORS.control, contents: [b('ct_wait', { SEC: num(1) }), b('controls_repeat_ext', { TIMES: num(10) }), b('ct_forever'), b('controls_if'), { kind: 'block', type: 'controls_if', extraState: { hasElse: true } }, b('ct_stop')] },
      { kind: 'category', name: t('b_cOp'), colour: COLORS.op, contents: [
        b('math_arithmetic', { A: num(1), B: num(1) }), b('math_random_int', { FROM: num(1), TO: num(10) }),
        b('logic_compare', { A: num(0), B: num(50) }), b('logic_operation'), b('logic_negate'),
        b('text_join'), b('text'), b('math_number')] },
      { kind: 'category', name: t('b_cVars'), colour: COLORS.vars, custom: 'VARIABLE' },
    ],
  };
}

// 처음 열었을 때 놓아 두는 예시 프로그램
export function starter(ctx) {
  const { t, kind } = ctx;
  const txt = s => ({ shadow: { type: 'text', fields: { TEXT: s } } });
  const num = n => ({ shadow: { type: 'math_number', fields: { NUM: n } } });
  const chain = list => list.reduceRight((next, blk) => (next ? { ...blk, next: { block: next } } : blk), null);
  let body;
  if (kind === 'image') {
    body = chain([{ type: 'ai_camera', fields: { ON: '1' } }, { type: 'lo_say_for', inputs: { TEXT: txt(t('b_defShow')), SEC: num(2) } },
      { type: 'ct_forever', inputs: { DO: { block: chain([{ type: 'ai_ask_image' }, { type: 'lo_say', inputs: { TEXT: { ...txt(''), block: { type: 'ai_result' } } } }, { type: 'ct_wait', inputs: { SEC: num(1) } }]) } } }]);
  } else if (kind === 'text') {
    body = chain([{ type: 'ai_ask_user', inputs: { Q: txt(t('b_defAsk')) } }, { type: 'ai_ask_text', inputs: { TEXT: { ...txt(''), block: { type: 'ai_answer' } } } },
      { type: 'lo_say_for', inputs: { TEXT: { ...txt(''), block: { type: 'ai_result' } }, SEC: num(2) } }]);
  } else {
    body = chain([{ type: 'ai_ask_table' }, { type: 'lo_say_for', inputs: { TEXT: { ...txt(''), block: { type: 'ai_result' } }, SEC: num(2) } }]);
  }
  return { blocks: { languageVersion: 0, blocks: [{ type: 'ev_start', x: 30, y: 30, next: { block: body } }] } };
}

// 작업 공간 → 실행할 수 있는 프로그램 글. 이벤트 블록(모자 블록)에 붙은 것만 실행한다.
export function compile(B, J, ws) {
  const g = J.javascriptGenerator;
  g.init(ws);
  const parts = { start: [], result: [], click: [] };
  const map = { ev_start: 'start', ev_result: 'result', ev_click: 'click' };
  for (const top of ws.getTopBlocks(true)) {
    const ev = map[top.type];
    if (!ev || !top.isEnabled()) continue;
    const next = top.getNextBlock();
    if (!next) continue;
    parts[ev].push(g.blockToCode(next));
  }
  const defs = g.finish('');
  const fn = list => `[${list.map(code => `async function () {\n${code}}`).join(',\n')}]`;
  return `${defs}\nreturn { start: ${fn(parts.start)}, result: ${fn(parts.result)}, click: ${fn(parts.click)} };`;
}
// 프로그램 글 → (api) => { start: [async fn], result: [...], click: [...] }
export function build(src) {
  return new Function('api', src);
}
