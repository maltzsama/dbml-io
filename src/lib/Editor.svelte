<script>
  let { code = $bindable(), theme } = $props();

  let textareaEl = $state();
  let highlightedHtml = $derived(highlight(code));

  function highlight(text) {
    return text
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
      .replace(/\b(Table|Enum|Ref|Project|Note|TableGroup|indexes|checks|records)\b/g, '<span class="tok-key">$1</span>')
      .replace(/\b(pk|unique|not null|null|default|increment|primary key|note|ref|headercolor)\b/gi, '<span class="tok-attr">$1</span>')
      .replace(/\b(int|integer|varchar|text|timestamp|datetime|boolean|float|decimal|bigint|date|array)\b/gi, '<span class="tok-type">$1</span>')
      .replace(/'(.*?)'/g, '<span class="tok-str">\'$1\'</span>')
      .replace(/\/\/(.*)/g, '<span class="tok-com">//$1</span>');
  }

  function handleInput(e) {
    code = e.target.value;
  }

  function handleKeydown(e) {
    if (e.key === 'Tab') {
      e.preventDefault();
      const ta = e.target;
      const start = ta.selectionStart, end = ta.selectionEnd;
      ta.value = ta.value.substring(0, start) + '  ' + ta.value.substring(end);
      ta.selectionStart = ta.selectionEnd = start + 2;
      code = ta.value;
    }
  }

  function syncScroll(e) {
    const pre = e.target.parentElement.querySelector('.highlight-layer');
    if (pre) { pre.scrollTop = e.target.scrollTop; pre.scrollLeft = e.target.scrollLeft; }
  }
</script>

<div class="editor-pane">
  <div class="filename">schema.dbml</div>
  <div class="editor-wrap">
    <pre class="highlight-layer" aria-hidden="true">{@html highlightedHtml + '\n'}</pre>
    <textarea
      bind:this={textareaEl}
      value={code}
      oninput={handleInput}
      onkeydown={handleKeydown}
      onscroll={syncScroll}
      spellcheck="false"
      autocomplete="off"
      autocorrect="off"
      autocapitalize="off"
    ></textarea>
  </div>
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
  }

  .highlight-layer, textarea {
    position: absolute;
    inset: 0;
    padding: 16px;
    font-family: var(--mono);
    font-size: 13px;
    line-height: 1.6;
    tab-size: 2;
    white-space: pre;
    overflow: auto;
    margin: 0;
    border: none;
    outline: none;
    resize: none;
  }

  .highlight-layer {
    pointer-events: none;
    color: var(--text);
    z-index: 1;
    background: transparent;
  }

  textarea {
    color: transparent;
    caret-color: var(--text);
    background: transparent;
    z-index: 2;
    -webkit-text-fill-color: transparent;
  }

  :global(.tok-key) { color: var(--accent); font-weight: 600; }
  :global(.tok-attr) { color: #f472b6; }
  :global(.tok-type) { color: #60a5fa; }
  :global(.tok-str) { color: #34d399; }
  :global(.tok-com) { color: var(--text-faint); font-style: italic; }
</style>
