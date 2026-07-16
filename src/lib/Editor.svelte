<script lang="ts">
  import { onMount, onDestroy } from 'svelte';
  import { EditorState, Compartment } from '@codemirror/state';
  import { EditorView, keymap, lineNumbers, highlightActiveLine, highlightActiveLineGutter } from '@codemirror/view';
  import { defaultKeymap, history, historyKeymap, indentWithTab } from '@codemirror/commands';
  import { StreamLanguage, syntaxHighlighting, HighlightStyle, bracketMatching, indentOnInput } from '@codemirror/language';
  import { tags as t } from '@lezer/highlight';
  import { closeBrackets, closeBracketsKeymap } from '@codemirror/autocomplete';

  let { code = $bindable(), theme }: { code: string; theme: string } = $props();

  let editorDiv: HTMLDivElement | undefined = $state();
  let view: EditorView | undefined;
  let lineCount = $state(1);
  let charCount = $state(0);
  let copyLabel = $state('copy');

  // ── DBML stream tokenizer ─────────────────────────────────────────
  // Same token classes the old regex highlighter used, but wired into
  // CodeMirror's proper token system so the editor knows how to render
  // and select them without any layered textarea/pre trickery.
  const KEYWORDS = /^(Table|Enum|Ref|Project|Note|TableGroup|indexes|checks|records)\b/;
  const ATTRS = /^(pk|unique|not\s+null|null|default|increment|primary\s+key|note|ref|headercolor)\b/i;
  const TYPES = /^(int|integer|varchar|text|timestamp|datetime|boolean|float|decimal|bigint|date|array|serial|bigserial|json|uuid|char)\b/i;

  const dbmlLang = StreamLanguage.define({
    name: 'dbml',
    startState: () => ({ inString: false as false | "'" | '"' }),
    token(stream, state) {
      if (state.inString) {
        while (!stream.eol()) {
          const ch = stream.next();
          if (ch === state.inString) { state.inString = false; return 'string'; }
        }
        return 'string';
      }
      if (stream.eatSpace()) return null;

      if (stream.match('//')) { stream.skipToEnd(); return 'comment'; }
      if (stream.match('--')) { stream.skipToEnd(); return 'comment'; }

      const ch = stream.peek();
      if (ch === "'" || ch === '"') {
        stream.next();
        state.inString = ch as "'" | '"';
        while (!stream.eol()) {
          const c = stream.next();
          if (c === ch) { state.inString = false; return 'string'; }
        }
        return 'string';
      }

      if (stream.match(/^\d+(\.\d+)?/)) return 'number';
      if (stream.match(/^[\[\]{}()]/)) return 'bracket';
      if (stream.match(KEYWORDS)) return 'keyword';
      if (stream.match(ATTRS)) return 'attribute';
      if (stream.match(TYPES)) return 'type';
      if (stream.match(/^[A-Za-z_][A-Za-z0-9_]*/)) return null;

      stream.next();
      return null;
    },
    tokenTable: {
      keyword: t.keyword,
      string: t.string,
      comment: t.lineComment,
      number: t.number,
      bracket: t.bracket,
      attribute: t.propertyName,
      type: t.typeName,
    },
  });

  const dbmlHighlight = HighlightStyle.define([
    { tag: t.keyword, color: 'var(--accent)', fontWeight: '600' },
    { tag: t.propertyName, color: '#f472b6' },
    { tag: t.typeName, color: '#60a5fa' },
    { tag: t.string, color: '#34d399' },
    { tag: t.lineComment, color: 'var(--text-faint)', fontStyle: 'italic' },
    { tag: t.number, color: '#fbbf24' },
    { tag: t.bracket, color: '#a78bfa' },
  ]);

  // Colors follow CSS variables so switching light/dark from App.svelte
  // just works — no theme rebuild needed.
  function buildTheme() {
    return EditorView.theme({
      '&': {
        height: '100%',
        fontSize: '11px',
        backgroundColor: 'transparent',
        color: 'var(--text)',
      },
      '.cm-scroller': {
        fontFamily: 'var(--mono)',
        lineHeight: '1.7',
        overflow: 'auto',
      },
      '.cm-content': {
        padding: '16px 0',
        caretColor: 'var(--text)',
      },
      '.cm-line': {
        padding: '0 14px',
      },
      '&.cm-focused': {
        outline: 'none',
      },
      '.cm-gutters': {
        backgroundColor: 'transparent',
        color: 'var(--text-faint)',
        border: 'none',
        fontFamily: 'var(--mono)',
        fontSize: '10px',
      },
      '.cm-activeLineGutter': {
        backgroundColor: 'transparent',
        color: 'var(--text-dim)',
      },
      '.cm-activeLine': {
        backgroundColor: 'rgba(129,140,248,0.04)',
      },
      '.cm-cursor': {
        borderLeftColor: 'var(--accent)',
        borderLeftWidth: '2px',
      },
      // Native selection — no overlay, no ghost. This is the whole point
      // of moving to CodeMirror: selection is rendered by the browser on
      // real DOM nodes, not a transparent textarea layered on a mirror.
      '.cm-selectionBackground, ::selection': {
        backgroundColor: 'rgba(129,140,248,0.25) !important',
      },
      '&.cm-focused .cm-selectionBackground, &.cm-focused ::selection': {
        backgroundColor: 'rgba(129,140,248,0.35) !important',
      },
      '.cm-matchingBracket': {
        backgroundColor: 'rgba(129,140,248,0.2)',
        outline: '1px solid var(--accent)',
      },
    }, { dark: true });
  }

  // Compartment lets us reconfigure without rebuilding the whole editor
  // (kept here for future extensions; not strictly used yet).
  const editableCompartment = new Compartment();

  function mount() {
    if (!editorDiv) return;
    const state = EditorState.create({
      doc: code,
      extensions: [
        lineNumbers(),
        highlightActiveLine(),
        highlightActiveLineGutter(),
        history(),
        bracketMatching(),
        closeBrackets(),
        indentOnInput(),
        dbmlLang,
        syntaxHighlighting(dbmlHighlight),
        keymap.of([
          ...closeBracketsKeymap,
          ...defaultKeymap,
          ...historyKeymap,
          indentWithTab,
        ]),
        editableCompartment.of(EditorView.editable.of(true)),
        buildTheme(),
        EditorView.updateListener.of((update) => {
          if (update.docChanged) {
            const next = update.state.doc.toString();
            if (next !== code) code = next;
          }
        }),
      ],
    });
    view = new EditorView({ state, parent: editorDiv });
  }

  onMount(mount);
  onDestroy(() => view?.destroy());

  // External updates (undo/redo from App.svelte, or format button):
  // sync the editor doc without triggering another update event.
  $effect(() => {
    if (!view) return;
    const current = view.state.doc.toString();
    if (current !== code) {
      view.dispatch({
        changes: { from: 0, to: current.length, insert: code },
      });
    }
  });

  $effect(() => {
    lineCount = code.split('\n').length;
    charCount = code.length;
  });

  function copyCode() {
    navigator.clipboard.writeText(code).then(() => {
      copyLabel = 'copied!';
      setTimeout(() => copyLabel = 'copy', 1200);
    });
  }

  function formatCode() {
    code = code
      .split('\n')
      .map(l => l.trimEnd())
      .join('\n')
      .replace(/\n{3,}/g, '\n\n')
      .trim();
  }
</script>

<div class="editor-pane">
  <div class="toolbar">
    <span class="fn">schema.dbml</span>
    <span class="stats">{lineCount} lines · {charCount} chars</span>
    <div class="tbtns">
      <button onclick={formatCode} title="Format">format</button>
      <button onclick={copyCode} title="Copy">{copyLabel}</button>
    </div>
  </div>
  <div bind:this={editorDiv} class="editor-wrap"></div>
</div>

<style>
  .editor-pane {
    width: 380px;
    height: 100%;
    background-color: var(--surface);
    border-right: 1px solid var(--border);
    display: flex;
    flex-direction: column;
    flex-shrink: 0;
  }

  .toolbar {
    display: flex;
    align-items: center;
    gap: 8px;
    padding: 6px 14px;
    font-size: 10px;
    font-family: var(--mono);
    background: var(--bg);
    border-bottom: 1px solid var(--border);
    flex-shrink: 0;
  }

  .fn {
    color: var(--accent);
    font-weight: 600;
    font-size: 10px;
  }

  .stats {
    color: var(--text-faint);
    margin-right: auto;
  }

  .tbtns {
    display: flex;
    gap: 4px;
  }

  .tbtns button {
    background: none;
    border: 1px solid var(--border);
    border-radius: 4px;
    color: var(--text-dim);
    cursor: pointer;
    font-family: var(--mono);
    font-size: 9px;
    padding: 2px 8px;
    text-transform: lowercase;
    letter-spacing: 0.04em;
    transition: all 0.1s;
  }

  .tbtns button:hover {
    border-color: var(--accent);
    color: var(--accent);
    background: rgba(255,255,255,0.03);
  }

  .editor-wrap {
    flex: 1;
    min-height: 0;
    overflow: hidden;
  }

  /* CodeMirror mounts its own DOM inside .editor-wrap. Give it full size. */
  :global(.editor-wrap .cm-editor) {
    height: 100%;
  }
</style>