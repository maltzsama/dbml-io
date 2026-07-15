<script lang="ts">
  import { compileDBML, type CompiledDBML } from './lib/parser';
  import { DEFAULT_DBML } from './lib/defaults';
  import Sidebar from './lib/Sidebar.svelte';
  import Editor from './lib/Editor.svelte';
  import Diagram from './lib/Diagram.svelte';
  import './app.css';

  let theme = $state('dark');
  let lineMode = $state('ortho');
  let showEditor = $state(true);
  let showLegend = $state(true);
  let dbmlCode = $state(DEFAULT_DBML);
  let parsedData: CompiledDBML = $derived(compileDBML(dbmlCode));

  let diagramRef: { executeAction: (a: string) => void } | undefined = $state();

  let undoStack = $state<string[]>([]);
  let redoStack = $state<string[]>([]);
  let isUndoing = $state(false);
  let prevCode = DEFAULT_DBML;

  function undo() {
    if (undoStack.length === 0) return;
    isUndoing = true;
    redoStack.push(dbmlCode);
    dbmlCode = undoStack.pop()!;
    prevCode = dbmlCode;
    isUndoing = false;
  }

  function redo() {
    if (redoStack.length === 0) return;
    isUndoing = true;
    dbmlCode = redoStack.pop()!;
    undoStack.push(dbmlCode);
    prevCode = dbmlCode;
    isUndoing = false;
  }

  $effect(() => {
    document.documentElement.setAttribute('data-theme', theme);
  });

  $effect(() => {
    if (isUndoing) return;
    const cur = dbmlCode;
    if (cur === prevCode) return;
    if (undoStack.length === 0 || undoStack[undoStack.length - 1] !== prevCode) {
      if (undoStack.length > 100) undoStack.shift();
      undoStack.push(prevCode);
    }
    redoStack = [];
    prevCode = cur;
  });

  $effect(() => {
    function onKey(e: KeyboardEvent) {
      const mod = e.ctrlKey || e.metaKey;
      const t = e.target as HTMLElement;
      if (t?.closest('.editor-wrap') && mod && e.key === 'z') {
        e.preventDefault();
        e.shiftKey ? redo() : undo();
      }
      if (mod && e.key === 'b') {
        e.preventDefault();
        showEditor = !showEditor;
      }
      if (mod && e.key === 'l') {
        e.preventDefault();
        showLegend = !showLegend;
      }
    }
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  });

  type Action = 'theme' | 'line' | 'fit' | 'svg' | 'png' | 'undo' | 'redo' | 'editor' | 'legend';

  function handleAction(action: Action) {
    if (action === 'theme') {
      theme = theme === 'light' ? 'dark' : 'light';
    } else if (action === 'line') {
      lineMode = lineMode === 'ortho' ? 'bezier' : 'ortho';
    } else if (action === 'fit' || action === 'svg' || action === 'png') {
      diagramRef?.executeAction(action);
    } else if (action === 'undo') {
      undo();
    } else if (action === 'redo') {
      redo();
    } else if (action === 'editor') {
      showEditor = !showEditor;
    } else if (action === 'legend') {
      showLegend = !showLegend;
    }
  }
</script>

<main class="layout">
  <Sidebar {theme} {lineMode} {showEditor} onaction={handleAction} />
  {#if showEditor}
    <Editor bind:code={dbmlCode} {theme} />
  {/if}

  <div class="diagram-area">
    {#if parsedData.error}
      <div class="error-pane">
        <div class="error-icon">⚠</div>
        <div class="error-msg">Parse error: {parsedData.error}</div>
      </div>
    {:else}
      <Diagram data={parsedData} {theme} {lineMode} {showLegend} bind:this={diagramRef} />
    {/if}
  </div>
</main>

<style>
  .layout {
    display: flex;
    width: 100vw;
    height: 100vh;
    overflow: hidden;
  }

  .diagram-area {
    flex: 1;
    height: 100%;
    position: relative;
    overflow: hidden;
  }

  .error-pane {
    width: 100%; height: 100%;
    display: flex; flex-direction: column;
    align-items: center; justify-content: center;
    gap: 12px; background: var(--bg); color: var(--text-dim);
  }

  .error-icon { font-size: 32px; opacity: 0.4; }
  .error-msg {
    font-family: var(--mono); font-size: 13px;
    max-width: 500px; text-align: center; line-height: 1.5;
    background: var(--surface); border: 1px solid var(--border);
    padding: 16px 24px; border-radius: 8px;
  }
</style>
