<script lang="ts">
  import { onMount } from 'svelte';
  import { render } from 'monza-editor';
  import type { TextareaEvent } from 'monza-editor';
  import 'monza-editor/style.css';

  let { code = $bindable(), theme }: { code: string; theme: string } = $props();

  let editorDiv: HTMLDivElement | undefined = $state();
  let paneEl: HTMLDivElement | undefined = $state();
  let lineCount = $state(1);
  let charCount = $state(0);
  let copyLabel = $state('copy');

  function highlight(text: string): string {
    const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
    const lines = text.split('\n');
    const out = lines.map(line => {
      let h = esc(line);
      h = h.replace(/'(.*?)'/g, '<span class="tok-str">\'$1\'</span>');
      h = h.replace(/\b(Table|Enum|Ref|Project|Note|TableGroup|indexes|checks|records)\b/g, '<span class="tok-key">$1</span>');
      h = h.replace(/\b(pk|unique|not null|null|default|increment|primary key|note|ref|headercolor)\b/gi, '<span class="tok-attr">$1</span>');
      h = h.replace(/\b(int|integer|varchar|text|timestamp|datetime|boolean|float|decimal|bigint|date|array|serial|bigserial)\b/gi, '<span class="tok-type">$1</span>');
      h = h.replace(/\b\d+\b/g, '<span class="tok-num">$&</span>');
      h = h.replace(/([\[\]{}()])/g, '<span class="tok-bra">$1</span>');
      h = h.replace(/(--.*)/g, '<span class="tok-com">$1</span>');
      h = h.replace(/\/\/(.*)/g, '<span class="tok-com">//$1</span>');
      return h;
    });
    return out.join('\n');
  }

  onMount(() => {
    if (!editorDiv) return;
    render(editorDiv, {
      value: code,
      highlight,
      onInput: (e: TextareaEvent) => { code = e.target.value; },
    });
  });

  $effect(() => {
    lineCount = code.split('\n').length;
    charCount = code.length;
  });

  $effect(() => {
    const ta = editorDiv?.querySelector<HTMLTextAreaElement>('textarea');
    if (ta && ta.value !== code) {
      ta.value = code;
      ta.dispatchEvent(new Event('input', { bubbles: true }));
    }
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

<div class="editor-pane" bind:this={paneEl}>
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
    position: relative;
    overflow: hidden;
    --me-padding: 16px;
    font-family: var(--mono);
    font-size: 10px;
    line-height: 1.7;
    tab-size: 2;
    white-space: pre;
    box-sizing: border-box;
  }

  .editor-wrap :global(textarea),
  .editor-wrap :global(pre) {
    font-family: inherit;
    font-size: inherit;
    line-height: inherit;
    white-space: pre !important;
    tab-size: 2;
    box-sizing: border-box;
    margin: 0;
    padding: 16px;
  }

  .editor-wrap :global(textarea) {
    position: absolute;
    top: 0;
    left: 0;
    width: 100%;
    height: 100%;
    background: transparent;
    color: transparent;
    caret-color: var(--accent);
    resize: none;
    border: none;
    outline: none;
    z-index: 2;
  }

  .editor-wrap :global(pre) {
    position: absolute;
    top: 0;
    left: 0;
    width: 100%;
    height: 100%;
    margin: 0;
    overflow: hidden;
    pointer-events: none;
    z-index: 1;
  }

  :global(.tok-key) { color: var(--accent); font-weight: 600; }
  :global(.tok-attr) { color: #f472b6; }
  :global(.tok-type) { color: #60a5fa; }
  :global(.tok-str) { color: #34d399; }
  :global(.tok-com) { color: var(--text-faint); font-style: italic; }
  :global(.tok-num) { color: #fbbf24; }
  :global(.tok-bra) { color: #a78bfa; }
</style>
