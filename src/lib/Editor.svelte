<script lang="ts">
  import { onMount } from 'svelte';
  import { render } from 'monza-editor';
  import type { TextareaEvent } from 'monza-editor';
  import 'monza-editor/style.css';

  let { code = $bindable(), theme }: { code: string; theme: string } = $props();

  let editorDiv: HTMLDivElement | undefined = $state();

  function highlight(text: string): string {
    return text
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
      .replace(/\b(Table|Enum|Ref|Project|Note|TableGroup|indexes|checks|records)\b/g, '<span class="tok-key">$1</span>')
      .replace(/\b(pk|unique|not null|null|default|increment|primary key|note|ref|headercolor)\b/gi, '<span class="tok-attr">$1</span>')
      .replace(/\b(int|integer|varchar|text|timestamp|datetime|boolean|float|decimal|bigint|date|array)\b/gi, '<span class="tok-type">$1</span>')
      .replace(/'(.*?)'/g, '<span class="tok-str">\'$1\'</span>')
      .replace(/\/\/(.*)/g, '<span class="tok-com">//$1</span>');
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
    const ta = editorDiv?.querySelector<HTMLTextAreaElement>('textarea');
    if (ta && ta.value !== code) {
      ta.value = code;
      ta.dispatchEvent(new Event('input', { bubbles: true }));
    }
  });
</script>

<div class="editor-pane">
  <div class="filename">schema.dbml</div>
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

  .filename {
    padding: 10px 16px;
    font-size: 11px;
    font-family: var(--mono);
    color: var(--accent);
    background: var(--bg);
    border-bottom: 1px solid var(--border);
  }

  .editor-wrap {
    flex: 1;
    position: relative;
    overflow: hidden;
    --me-padding: 16px;
    font-family: var(--mono);
    font-size: 13px;
    line-height: 1.6;
    tab-size: 2;
    white-space: pre;
  }

  .editor-wrap :global(textarea),
  .editor-wrap :global(pre) {
    font-family: inherit;
    font-size: inherit;
    line-height: inherit;
    white-space: pre !important;
    tab-size: 2;
  }

  :global(.tok-key) { color: var(--accent); font-weight: 600; }
  :global(.tok-attr) { color: #f472b6; }
  :global(.tok-type) { color: #60a5fa; }
  :global(.tok-str) { color: #34d399; }
  :global(.tok-com) { color: var(--text-faint); font-style: italic; }
</style>
