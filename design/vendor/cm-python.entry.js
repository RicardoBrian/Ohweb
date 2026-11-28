// 파이썬 코드 편집기(CodeMirror 6) — kakainfo.com/kaka/vendor/cm-python.js 로 묶어서 쓴다.
// CodeMirror 5는 맥에서 한글이 ㅎㅗㅇ 처럼 풀려 들어가서 6으로 바꿨다(6은 입력기 조합을 브라우저에 맡긴다).
// 다시 묶기: npm i codemirror@6 @codemirror/lang-python esbuild 후
//   npx esbuild design/vendor/cm-python.entry.js --bundle --format=esm --minify --outfile=ohinfo/public/kaka/vendor/cm-python.js
import { EditorView, keymap, lineNumbers, highlightActiveLine, highlightActiveLineGutter, drawSelection, placeholder as ph } from '@codemirror/view';
import { EditorState, Compartment } from '@codemirror/state';
import { defaultKeymap, history, historyKeymap, indentWithTab } from '@codemirror/commands';
import { indentOnInput, bracketMatching, syntaxHighlighting, HighlightStyle, indentUnit } from '@codemirror/language';
import { closeBrackets, closeBracketsKeymap } from '@codemirror/autocomplete';
import { python } from '@codemirror/lang-python';
import { tags as t } from '@lezer/highlight';

// 색은 kaka.css 의 코드 상자 변수를 그대로 쓴다.
const style = HighlightStyle.define([
  { tag: [t.keyword, t.controlKeyword, t.operatorKeyword, t.definitionKeyword, t.moduleKeyword], color: 'var(--code-key)' },
  { tag: [t.string, t.number, t.bool, t.null], color: 'var(--code-str)' },
  { tag: t.comment, color: 'var(--code-muted)', fontStyle: 'italic' },
]);
const theme = EditorView.theme({
  '&': { color: 'var(--code-ink)', backgroundColor: 'var(--code-bg)', fontSize: '15px' },
  '.cm-content': { fontFamily: 'var(--font-mono)', lineHeight: '24px', padding: '12px 0', caretColor: 'var(--code-ink)' },
  '.cm-scroller': { fontFamily: 'var(--font-mono)', minHeight: 'var(--cm-min, 320px)' },
  '.cm-gutters': { backgroundColor: 'var(--code-bg)', color: 'var(--code-muted)', border: 'none', fontFamily: 'var(--font-mono)' },
  '.cm-gutterElement': { lineHeight: '24px' },
  '.cm-lineNumbers .cm-gutterElement': { padding: '0 12px 0 14px' },
  '.cm-activeLine, .cm-activeLineGutter': { backgroundColor: 'rgba(255,255,255,.04)' },
  '&.cm-focused .cm-cursor': { borderLeftColor: 'var(--code-ink)', borderLeftWidth: '2px' },
  '&.cm-focused': { outline: 'none' },
  '.cm-selectionBackground, &.cm-focused .cm-selectionBackground, ::selection': { backgroundColor: 'rgba(255,255,255,.16) !important' },
  '.cm-matchingBracket': { backgroundColor: 'rgba(255,255,255,.12)', outline: 'none' },
}, { dark: true });

// parent 안에 편집기를 만든다. onChange(코드), keys: { 'Mod-s': fn, 'Mod-Enter': fn }
export function pyEditor(parent, { doc = '', onChange, keys = {}, placeholder = '' } = {}) {
  const ro = new Compartment();
  const view = new EditorView({
    parent,
    state: EditorState.create({ doc, extensions: [
      lineNumbers(), highlightActiveLineGutter(), highlightActiveLine(), history(), drawSelection(),
      indentOnInput(), bracketMatching(), closeBrackets(), indentUnit.of('    '), EditorState.tabSize.of(4),
      python(), syntaxHighlighting(style), theme, ph(placeholder), ro.of(EditorState.readOnly.of(false)),
      keymap.of([...Object.entries(keys).map(([key, run]) => ({ key, run: () => { run(); return true; }, preventDefault: true })),
        ...closeBracketsKeymap, ...defaultKeymap, ...historyKeymap, indentWithTab]),
      EditorView.updateListener.of(u => { if (u.docChanged && onChange) onChange(u.state.doc.toString()); }),
    ] }),
  });
  let silent = false;
  return {
    view,
    getValue: () => view.state.doc.toString(),
    // 코드를 통째로 바꾼다(onChange 는 부르지 않는다)
    setValue(code) { silent = true; const prev = onChange; onChange = null; view.dispatch({ changes: { from: 0, to: view.state.doc.length, insert: code } }); onChange = prev; silent = false; },
    setReadOnly: on => view.dispatch({ effects: ro.reconfigure(EditorState.readOnly.of(!!on)) }),
    isReadOnly: () => view.state.readOnly,
    focus: () => view.focus(),
    cursorEnd: () => view.dispatch({ selection: { anchor: view.state.doc.length } }),
  };
}
