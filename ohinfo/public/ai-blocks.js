// AI 코딩 — 블록 정의·도구 상자·코드 만들기. aicode.html이 Blockly(구글 오픈소스 블록 편집기)를 불러온 뒤 쓴다.
// 블록 글자는 ai-i18n.js의 b_* 문구. 만든 코드는 ai-stage.js의 api만 부른다(그 밖의 것은 쓸 수 없다).

export const COLORS = { event: '#FFBF00', ai: '#0FBD8C', motion: '#4C97FF', looks: '#9966FF', sound: '#CF63CF', control: '#FFAB19', sense: '#5CB1D6', op: '#59C059', vars: '#FF8C1A', list: '#FF661A' };
export const COSTUMES = ['🐱', '🐶', '🐰', '🐻', '🐼', '🐧', '🐸', '🦊', '🐯', '🐢', '🐟', '🦄', '🤖', '👾', '🚀', '⚽', '🍎', '⭐', '❤️', '🌈'];
const BG = ['#ffffff', '#dff1ff', '#e6f7d9', '#fff6cc', '#ffe3ef', '#ede7ff', '#1f2340'];
const SOUND_IDS = ['beep', 'ding', 'pop', 'fanfare', 'buzz'];
const KEYS = ['space', 'up', 'down', 'left', 'right', 'any', ...'abcdefghijklmnopqrstuvwxyz0123456789'];
// 이벤트 모자 블록 → 실행기 이벤트 이름(ai-stage.js Runtime.fire)
const HATS = { ev_start: () => 'start', ev_result: () => 'result', ev_click: () => 'click', ev_stage_click: () => 'stage',
  ev_key: b => 'key:' + b.getFieldValue('KEY'), ev_receive: b => 'msg:' + String(b.getFieldValue('MSG') || '') };

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
  const keyOpts = () => KEYS.map(k => [k.length === 1 ? k : t('b_key_' + k), k]);
  const msgField = { type: 'field_input', name: 'MSG', text: t('b_defMsg') };
  const rep = (type, msg, args = [], output = null, colour = COLORS.motion) => ({ type, message0: msg, args0: args, output, colour });
  const tgt = () => drop('T', [[t('b_random'), 'random'], [t('b_mouse'), 'mouse']]);
  const fx = () => drop('FX', [[t('b_fxColor'), 'color'], [t('b_fxGhost'), 'ghost'], [t('b_fxBright'), 'brightness']]);
  const boolIn = name => ({ type: 'input_value', name, check: 'Boolean' });

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
    // ── 스크래치 기본 블록(캐릭터 하나 기준) ──
    // 이벤트
    hat('ev_key', t('b_onKey'), [drop('KEY', keyOpts)]),
    hat('ev_stage_click', t('b_onStage')),
    hat('ev_receive', t('b_onReceive'), [msgField]),
    stmt('ev_broadcast', COLORS.event, t('b_broadcast'), [msgField]),
    stmt('ev_broadcast_wait', COLORS.event, t('b_broadcastWait'), [msgField]),
    // 동작
    stmt('mo_turn_left', COLORS.motion, t('b_turnLeft'), [val('D')]),
    stmt('mo_goto_target', COLORS.motion, t('b_gotoTarget'), [tgt()]),
    stmt('mo_glide', COLORS.motion, t('b_glide'), [val('SEC'), val('X'), val('Y')]),
    stmt('mo_glide_target', COLORS.motion, t('b_glideTarget'), [val('SEC'), tgt()]),
    stmt('mo_point', COLORS.motion, t('b_point'), [val('D')]),
    stmt('mo_point_mouse', COLORS.motion, t('b_pointMouse')),
    stmt('mo_set_x', COLORS.motion, t('b_setX'), [val('V')]),
    stmt('mo_set_y', COLORS.motion, t('b_setY'), [val('V')]),
    stmt('mo_bounce', COLORS.motion, t('b_bounce')),
    stmt('mo_rot', COLORS.motion, t('b_rotStyle'), [drop('R', [[t('b_rotLR'), 'lr'], [t('b_rotNone'), 'none'], [t('b_rotAll'), 'all']])]),
    rep('mo_x', t('b_xPos'), [], 'Number'), rep('mo_y', t('b_yPos'), [], 'Number'), rep('mo_dir', t('b_dir'), [], 'Number'),
    // 모양
    stmt('lo_think_for', COLORS.looks, t('b_thinkFor'), [val('TEXT'), val('SEC')]),
    stmt('lo_think', COLORS.looks, t('b_think'), [val('TEXT')]),
    stmt('lo_next_costume', COLORS.looks, t('b_nextCostume')),
    stmt('lo_next_bg', COLORS.looks, t('b_nextBg')),
    stmt('lo_change_fx', COLORS.looks, t('b_changeFx'), [fx(), val('V')]),
    stmt('lo_set_fx', COLORS.looks, t('b_setFx'), [fx(), val('V')]),
    stmt('lo_clear_fx', COLORS.looks, t('b_clearFx')),
    rep('lo_costume_num', t('b_costumeNum'), [], 'Number', COLORS.looks), rep('lo_bg_num', t('b_bgNum'), [], 'Number', COLORS.looks), rep('lo_size_val', t('b_sizeVal'), [], 'Number', COLORS.looks),
    // 소리
    stmt('so_play_wait', COLORS.sound, t('b_soundWait'), [drop('S', SOUND_IDS.map((x, i) => [t('b_sounds')[i], x]))]),
    stmt('so_stop', COLORS.sound, t('b_stopSounds')),
    stmt('so_change_vol', COLORS.sound, t('b_changeVol'), [val('V')]),
    stmt('so_set_vol', COLORS.sound, t('b_setVol'), [val('V')]),
    rep('so_vol', t('b_vol'), [], 'Number', COLORS.sound),
    // 제어
    stmt('ct_wait_until', COLORS.control, t('b_waitUntil'), [boolIn('C')]),
    { type: 'ct_repeat_until', message0: t('b_repeatUntil'), args0: [boolIn('C')], message1: '%1', args1: [{ type: 'input_statement', name: 'DO' }], previousStatement: null, nextStatement: null, colour: COLORS.control },
    { type: 'ct_stop_this', message0: t('b_stopThis'), previousStatement: null, colour: COLORS.control },
    // 감지
    rep('se_touching', t('b_touching'), [drop('W', [[t('b_mouse'), 'mouse'], [t('b_edge'), 'edge']])], 'Boolean', COLORS.sense),
    rep('se_dist', t('b_distMouse'), [], 'Number', COLORS.sense),
    rep('se_key', t('b_keyPressed'), [drop('KEY', keyOpts)], 'Boolean', COLORS.sense),
    rep('se_mouse_down', t('b_mouseDown'), [], 'Boolean', COLORS.sense),
    rep('se_mouse_x', t('b_mouseX'), [], 'Number', COLORS.sense), rep('se_mouse_y', t('b_mouseY'), [], 'Number', COLORS.sense),
    rep('se_timer', t('b_timer'), [], 'Number', COLORS.sense),
    stmt('se_reset_timer', COLORS.sense, t('b_resetTimer')),
    rep('se_current', t('b_current'), [drop('K', ['year', 'month', 'date', 'day', 'hour', 'minute', 'second'].map((k, i) => [t('b_curs')[i], k]))], 'Number', COLORS.sense),
    // 연산
    rep('op_letter', t('b_letterOf'), [val('S'), val('I')], null, COLORS.op),
    rep('op_length', t('b_lengthOf'), [val('S')], 'Number', COLORS.op),
    rep('op_contains', t('b_contains'), [val('A'), val('B')], 'Boolean', COLORS.op),
    // 변수 보이기
    stmt('va_show', COLORS.vars, t('b_showVar'), [{ type: 'field_variable', name: 'VAR', variable: null }]),
    stmt('va_hide', COLORS.vars, t('b_hideVar'), [{ type: 'field_variable', name: 'VAR', variable: null }]),
  ]);

  const g = J.javascriptGenerator;
  const v = (b, name, order = O.NONE, dflt = '0') => g.valueToCode(b, name, order) || dflt;
  const q = s => g.quote_(String(s == null ? '' : s));
  const F = g.forBlock;
  for (const k of Object.keys(HATS)) F[k] = () => '';
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
  const cond = b => v(b, 'C', O.NONE, 'false');
  const tg = b => q(b.getFieldValue('T'));
  const varName = b => { const m = b.workspace.getVariableById(b.getFieldValue('VAR')); return m ? m.name : ''; };
  F.ev_broadcast = b => `await api.broadcast(${q(b.getFieldValue('MSG'))}, false);\n`;
  F.ev_broadcast_wait = b => `await api.broadcast(${q(b.getFieldValue('MSG'))}, true);\n`;
  F.mo_turn_left = b => `api.turnLeft(${v(b, 'D')});\n`;
  F.mo_goto_target = b => `api.goToTarget(${tg(b)});\n`;
  F.mo_glide = b => `await api.glide(${v(b, 'SEC')}, ${v(b, 'X')}, ${v(b, 'Y')});\n`;
  F.mo_glide_target = b => `await api.glideTarget(${v(b, 'SEC')}, ${tg(b)});\n`;
  F.mo_point = b => `api.pointDir(${v(b, 'D')});\n`;
  F.mo_point_mouse = () => 'api.pointMouse();\n';
  F.mo_set_x = b => `api.setX(${v(b, 'V')});\n`;
  F.mo_set_y = b => `api.setY(${v(b, 'V')});\n`;
  F.mo_bounce = () => 'api.bounce();\n';
  F.mo_rot = b => `api.rotStyle(${q(b.getFieldValue('R'))});\n`;
  F.mo_x = () => ['api.xPos()', O.FUNCTION_CALL];
  F.mo_y = () => ['api.yPos()', O.FUNCTION_CALL];
  F.mo_dir = () => ['api.direction()', O.FUNCTION_CALL];
  F.lo_think_for = b => `await api.thinkFor(${v(b, 'TEXT', O.NONE, "''")}, ${v(b, 'SEC')});\n`;
  F.lo_think = b => `api.think(${v(b, 'TEXT', O.NONE, "''")});\n`;
  F.lo_next_costume = () => `api.nextCostume(${JSON.stringify(COSTUMES)});\n`;
  F.lo_next_bg = () => `api.nextBg(${JSON.stringify(BG)});\n`;
  F.lo_change_fx = b => `api.changeFx(${q(b.getFieldValue('FX'))}, ${v(b, 'V')});\n`;
  F.lo_set_fx = b => `api.setFx(${q(b.getFieldValue('FX'))}, ${v(b, 'V')});\n`;
  F.lo_clear_fx = () => 'api.clearFx();\n';
  F.lo_costume_num = () => [`api.costumeNum(${JSON.stringify(COSTUMES)})`, O.FUNCTION_CALL];
  F.lo_bg_num = () => [`api.bgNum(${JSON.stringify(BG)})`, O.FUNCTION_CALL];
  F.lo_size_val = () => ['api.sizeVal()', O.FUNCTION_CALL];
  F.so_play_wait = b => `await api.soundWait(${q(b.getFieldValue('S'))});\n`;
  F.so_stop = () => 'api.stopSounds();\n';
  F.so_change_vol = b => `api.changeVol(${v(b, 'V')});\n`;
  F.so_set_vol = b => `api.setVol(${v(b, 'V')});\n`;
  F.so_vol = () => ['api.volume()', O.FUNCTION_CALL];
  F.ct_wait_until = b => `await api.waitUntil(() => (${cond(b)}));\n`;
  F.ct_repeat_until = b => `while (!(${cond(b)})) {\n${g.statementToCode(b, 'DO')}  await api.tick();\n}\n`;
  F.ct_stop_this = () => 'return;\n';
  F.se_touching = b => [`api.touching(${q(b.getFieldValue('W'))})`, O.FUNCTION_CALL];
  F.se_dist = () => ['api.distMouse()', O.FUNCTION_CALL];
  F.se_key = b => [`api.keyDown(${q(b.getFieldValue('KEY'))})`, O.FUNCTION_CALL];
  F.se_mouse_down = () => ['api.mouseDown()', O.FUNCTION_CALL];
  F.se_mouse_x = () => ['api.mouseX()', O.FUNCTION_CALL];
  F.se_mouse_y = () => ['api.mouseY()', O.FUNCTION_CALL];
  F.se_timer = () => ['api.timer()', O.FUNCTION_CALL];
  F.se_reset_timer = () => 'api.resetTimer();\n';
  F.se_current = b => [`api.current(${q(b.getFieldValue('K'))})`, O.FUNCTION_CALL];
  F.op_letter = b => [`api.letterOf(${v(b, 'I', O.NONE, '1')}, ${v(b, 'S', O.NONE, "''")})`, O.FUNCTION_CALL];
  F.op_length = b => [`api.lengthOf(${v(b, 'S', O.NONE, "''")})`, O.FUNCTION_CALL];
  F.op_contains = b => [`api.contains(${v(b, 'A', O.NONE, "''")}, ${v(b, 'B', O.NONE, "''")})`, O.FUNCTION_CALL];
  F.va_show = b => `api.showVar(${q(varName(b))}, () => ${g.getVariableName(b.getFieldValue('VAR'))});\n`;
  F.va_hide = b => `api.hideVar(${q(varName(b))});\n`;
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
  const ask = [b('ai_ask_user', { Q: txt(t('b_defAsk')) }), b('ai_answer')];
  return {
    kind: 'categoryToolbox',
    contents: [
      { kind: 'category', name: t('b_cEvent'), colour: COLORS.event, contents: [b('ev_start'), b('ev_click'), b('ev_stage_click'), b('ev_key'), b('ev_result'),
        b('ev_receive'), b('ev_broadcast'), b('ev_broadcast_wait')] },
      { kind: 'category', name: t('b_cAI'), colour: COLORS.ai, contents: ai },
      { kind: 'category', name: t('b_cMotion'), colour: COLORS.motion, contents: [b('mo_move', { N: num(10) }), b('mo_turn', { D: num(15) }), b('mo_turn_left', { D: num(15) }),
        b('mo_goto_target'), b('mo_goto', { X: num(0), Y: num(0) }), b('mo_glide_target', { SEC: num(1) }), b('mo_glide', { SEC: num(1), X: num(0), Y: num(0) }),
        b('mo_point', { D: num(90) }), b('mo_point_mouse'), b('mo_change_x', { D: num(10) }), b('mo_set_x', { V: num(0) }), b('mo_change_y', { D: num(10) }), b('mo_set_y', { V: num(0) }),
        b('mo_bounce'), b('mo_rot'), b('mo_x'), b('mo_y'), b('mo_dir')] },
      { kind: 'category', name: t('b_cLooks'), colour: COLORS.looks, contents: [b('lo_say_for', { TEXT: txt(t('b_defSay')), SEC: num(2) }), b('lo_say', { TEXT: txt(t('b_defSay')) }),
        b('lo_think_for', { TEXT: txt(t('b_defThink')), SEC: num(2) }), b('lo_think', { TEXT: txt(t('b_defThink')) }),
        b('lo_costume'), b('lo_next_costume'), b('lo_bg'), b('lo_next_bg'), b('lo_change_size', { D: num(10) }), b('lo_size', { P: num(100) }),
        b('lo_change_fx', { V: num(25) }), b('lo_set_fx', { V: num(0) }), b('lo_clear_fx'), b('lo_show'), b('lo_costume_num'), b('lo_bg_num'), b('lo_size_val')] },
      { kind: 'category', name: t('b_cSound'), colour: COLORS.sound, contents: [b('so_play_wait'), b('so_play'), b('so_stop'), b('so_change_vol', { V: num(-10) }), b('so_set_vol', { V: num(100) }), b('so_vol')] },
      { kind: 'category', name: t('b_cControl'), colour: COLORS.control, contents: [b('ct_wait', { SEC: num(1) }), b('controls_repeat_ext', { TIMES: num(10) }), b('ct_forever'),
        b('controls_if'), { kind: 'block', type: 'controls_if', extraState: { hasElse: true } }, b('ct_wait_until'), b('ct_repeat_until'), b('ct_stop'), b('ct_stop_this')] },
      { kind: 'category', name: t('b_cSense'), colour: COLORS.sense, contents: [b('se_touching'), b('se_dist'), ...ask, b('se_key'), b('se_mouse_down'), b('se_mouse_x'), b('se_mouse_y'),
        b('se_timer'), b('se_reset_timer'), b('se_current')] },
      { kind: 'category', name: t('b_cOp'), colour: COLORS.op, contents: [
        b('math_arithmetic', { A: num(1), B: num(1) }), b('math_random_int', { FROM: num(1), TO: num(10) }),
        b('logic_compare', { A: num(0), B: num(50) }), b('logic_operation'), b('logic_negate'),
        b('text_join'), b('op_letter', { S: txt(t('b_defWord')), I: num(1) }), b('op_length', { S: txt(t('b_defWord')) }), b('op_contains', { A: txt(t('b_defWord')), B: txt(t('b_defLetter')) }),
        b('math_modulo', { DIVIDEND: num(10), DIVISOR: num(3) }), b('math_round', { NUM: num(3.5) }), b('math_single', { NUM: num(9) }), b('math_trig', { NUM: num(45) }),
        b('text'), b('math_number')] },
      { kind: 'category', name: t('b_cVars'), colour: COLORS.vars, custom: 'VARS_PLUS' },
      { kind: 'category', name: t('b_cList'), colour: COLORS.list, contents: [
        { kind: 'block', type: 'lists_create_with', extraState: { itemCount: 0 } }, b('lists_create_with'), b('lists_getIndex'), b('lists_setIndex'),
        b('lists_length'), b('lists_isEmpty'), b('lists_indexOf')] },
    ],
  };
}

// 변수 칸: Blockly 기본 변수 블록 + 무대에 변수 보이기/숨기기
export function registerVarsFlyout(B, ws) {
  ws.registerToolboxCategoryCallback('VARS_PLUS', w => {
    const list = B.Variables.flyoutCategoryBlocks(w);
    if (w.getAllVariables().length) for (const type of ['va_show', 'va_hide']) {
      const el = B.utils.xml.createElement('block'); el.setAttribute('type', type); el.setAttribute('gap', '8'); list.push(el);
    }
    return list;
  });
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
  for (const top of ws.getTopBlocks(true)) {
    const evOf = HATS[top.type];
    if (!evOf || !top.isEnabled()) continue;
    const next = top.getNextBlock();
    if (!next) continue;
    const ev = evOf(top);
    (parts[ev] = parts[ev] || []).push(g.blockToCode(next));
  }
  const defs = g.finish('');
  const fn = list => `[${list.map(code => `async function () {\n${code}}`).join(',\n')}]`;
  return `${defs}\nreturn { ${Object.entries(parts).map(([ev, list]) => `${JSON.stringify(ev)}: ${fn(list)}`).join(', ')} };`;
}
// 프로그램 글 → (api) => { start: [async fn], result: [...], click: [...] }
export function build(src) {
  return new Function('api', src);
}
