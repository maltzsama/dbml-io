<script lang="ts">
  let { theme, lineMode, onaction }: {
    theme: string;
    lineMode: string;
    onaction: (action: string) => void;
  } = $props();
</script>

<aside class="sidebar">
  <div class="logo">⬡</div>

  <nav class="nav">
    <button onclick={() => onaction('theme')} title={theme === 'dark' ? 'Light mode' : 'Dark mode'}>
      {theme === 'dark' ? '☀' : '☾'}
    </button>
    <button onclick={() => onaction('line')} title={lineMode === 'ortho' ? 'Bezier lines' : 'Ortho lines'}>
      {lineMode === 'ortho' ? '⌐' : '~'}
    </button>

    <div class="spacer"></div>

    <button onclick={() => onaction('undo')} title="Undo (Ctrl+Z)">↩</button>
    <button onclick={() => onaction('redo')} title="Redo (Ctrl+Shift+Z)">↪</button>

    <div class="spacer"></div>

    <button onclick={() => onaction('fit')} title="Fit all">⊞</button>
    <button onclick={() => onaction('svg')} title="Export SVG">↓s</button>
    <button onclick={() => onaction('png')} title="Export PNG">↓p</button>
  </nav>
</aside>

<style>
  .sidebar {
    width: 48px;
    height: 100%;
    background-color: var(--surface);
    border-right: 1px solid var(--border);
    display: flex;
    flex-direction: column;
    align-items: center;
    padding: 14px 0;
    box-sizing: border-box;
    flex-shrink: 0;
  }

  .logo {
    font-size: 18px;
    margin-bottom: 20px;
    color: var(--accent);
    font-weight: 700;
  }

  .nav {
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 4px;
    flex: 1;
  }

  .spacer { flex: 1; }

  button {
    background: none;
    border: 1px solid transparent;
    cursor: pointer;
    font-size: 14px;
    padding: 6px;
    border-radius: 6px;
    transition: all 0.12s;
    color: var(--text-dim);
    width: 32px;
    height: 32px;
    display: grid;
    place-items: center;
    font-family: var(--mono);
  }

  button:hover {
    background-color: rgba(255,255,255,0.04);
    border-color: var(--border);
    color: var(--text);
  }
</style>
