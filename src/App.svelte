<script lang="ts">
  import { compileDBML, type CompiledDBML } from './lib/parser';
  import { DEFAULT_DBML } from './lib/defaults';
  import Sidebar from './lib/Sidebar.svelte';
  import Editor from './lib/Editor.svelte';
  import Diagram from './lib/Diagram.svelte';
  import './app.css';

  let theme = $state('dark');
  let lineMode = $state('ortho');
  let dbmlCode = $state(DEFAULT_DBML);
  let parsedData: CompiledDBML = $derived(compileDBML(dbmlCode));

  let diagramRef: { executeAction: (a: string) => void } | undefined = $state();

  $effect(() => {
    document.documentElement.setAttribute('data-theme', theme);
  });

  type Action = 'theme' | 'line' | 'fit' | 'svg' | 'png';

  function handleAction(action: Action) {
    if (action === 'theme') {
      theme = theme === 'light' ? 'dark' : 'light';
    } else if (action === 'line') {
      lineMode = lineMode === 'ortho' ? 'bezier' : 'ortho';
    } else if (action === 'fit' || action === 'svg' || action === 'png') {
      diagramRef?.executeAction(action);
    }
  }
</script>

<main class="layout">
  <Sidebar {theme} {lineMode} onaction={handleAction} />
  <Editor bind:code={dbmlCode} {theme} />

  <div class="diagram-area">
    {#if parsedData.error}
      <div class="error-pane">
        <div class="error-icon">⚠</div>
        <div class="error-msg">Parse error: {parsedData.error}</div>
      </div>
    {:else}
      <Diagram data={parsedData} {theme} {lineMode} bind:this={diagramRef} />
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
