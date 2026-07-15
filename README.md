# dbml-io

> Visualize your database schemas instantly.

[![GitHub Pages](https://img.shields.io/badge/GitHub%20Pages-Live-blue?logo=github)](https://maltzsama.github.io/dbml-io/)
[![CI](https://github.com/maltzsama/dbml-io/actions/workflows/ci.yml/badge.svg)](https://github.com/maltzsama/dbml-io/actions/workflows/ci.yml)
[![License](https://img.shields.io/badge/License-Apache%202.0-green.svg)](LICENSE)

A browser-based DBML visualizer and editor. Write or paste DBML code, see a live-updating entity-relationship diagram rendered as you type.

<!-- Add a screenshot or GIF here -->
<!-- ![dbml-io demo](./demo.png) -->

## Features

### Editor

- **Syntax highlighting** for DBML keywords, types, strings, comments, and numbers
- **Undo/Redo** with full history stack (up to 100 entries)
- **Format** code (trim whitespace, collapse extra newlines)
- **Copy to clipboard** with feedback
- Live **line and character count**

### Diagram

- **Interactive canvas** with pan (click-drag) and zoom (scroll wheel, 0.12x - 4x)
- **Drag table cards** to reposition them freely
- **Two line styles**: Orthogonal (grid-routed with Dijkstra) or Bezier curves
- **Star schema auto-detection**: Fact, Dimension, and Snowflake tables get distinct visual treatments
- **Hover tooltips** showing field details (PK, FK, NN, UQ badges, defaults, notes)
- **Line dragging** to nudge relationship paths
- **Fit All** button to auto-fit the entire diagram in view
- **Search** tables and fields by name or type

### Export

- **PNG** at 2x retina resolution
- **SVG** with clean vector output

### UI

- **Dark and Light themes**
- **Collapsible editor panel**
- **Legend** panel explaining table types and key indicators
- **Keyboard shortcuts** for all major actions

## Supported DBML Syntax

| Construct | Syntax | Details |
|---|---|---|
| **Tables** | `Table name { ... }` | With alias (`as`), `headercolor` setting |
| **Fields** | `name type [settings]` | Full type support including parameterized (`varchar(255)`) |
| **Field Settings** | `pk`, `not null`, `unique`, `increment`, `default:`, `note:`, `ref:`, `headercolor` | Inline references via `ref: > table.field` |
| **Composite PKs** | `indexes { (f1, f2) [pk] }` | Parsed from indexes block |
| **Enums** | `Enum name { ... }` | With per-value notes |
| **References** | Inline, Short, Long | All 3 DBML reference forms supported |
| **Relation Types** | `>` `<` `-` `<>` | One-to-many, many-to-one, one-to-one, many-to-many |
| **Table Groups** | `TableGroup name { ... }` | With member list and note |
| **Project Info** | `Project name { ... }` | Database type and metadata |
| **Table Groups** | `TableGroup name { ... }` | Group members visually |
| **Composite Refs** | `table.f1(p1) > table.f2(p2)` | Parenthesized field references |
| **Comments** | `//` and `/* */` | Single-line and multi-line |
| **Strings** | `'...'` and `'''...'''` | Single-quoted and triple-quoted |
| **Backtick IDs** | `` `reserved_name` `` | For reserved-word column names |
| **Aliases** | `Table users as u` | Resolved across all references |

## Keyboard Shortcuts

| Shortcut | Action |
|---|---|
| `Ctrl+Z` / `Cmd+Z` | Undo |
| `Ctrl+Shift+Z` / `Cmd+Shift+Z` | Redo |
| `Ctrl+B` / `Cmd+B` | Toggle editor panel |
| `Ctrl+L` / `Cmd+L` | Toggle legend |
| `Ctrl+F` / `Cmd+F` | Focus diagram search |
| `Escape` | Clear search |
| `+` / `-` | Zoom in / out |
| Scroll wheel | Zoom to cursor |

## Getting Started

```bash
# Clone
git clone https://github.com/maltzsama/dbml-io.git
cd dbml-io

# Install dependencies
npm install

# Start dev server
npm run dev
```

Open [http://localhost:5173](http://localhost:5173) in your browser.

## Live Demo

**[https://maltzsama.github.io/dbml-io/](https://maltzsama.github.io/dbml-io/)**

## Tech Stack

- [Svelte 5](https://svelte.dev/) (runes: `$state`, `$derived`, `$effect`)
- [TypeScript](https://www.typescriptlang.org/)
- [Vite 7](https://vite.dev/)
- Custom tokenizer-based DBML parser (zero runtime dependencies)
- [html-to-image](https://github.com/bubkoo/html-to-image) for export

## Development

```bash
npm run dev          # Dev server with HMR
npm run build        # Production build to dist/
npm run preview      # Preview production build
npm run typecheck    # Type-check with svelte-check
npm test             # Run tests once
npm run test:watch   # Run tests in watch mode
```

### CI/CD

- **CI** (`.github/workflows/ci.yml`): Type-check, test, and build on every push/PR to `main` and `develop`
- **Release** (`.github/workflows/release.yml`): Semantic versioning on push to `main`
- **Deploy** (`.github/workflows/deploy.yml`): Auto-deploy to GitHub Pages on new releases

## License

[Apache License 2.0](LICENSE)
