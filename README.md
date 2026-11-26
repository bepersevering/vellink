# Vellink

[![CI](https://github.com/bepersevering/vellink/actions/workflows/ci.yml/badge.svg)](https://github.com/bepersevering/vellink/actions/workflows/ci.yml) [![Desktop Build](https://github.com/bepersevering/vellink/actions/workflows/build-desktop.yml/badge.svg)](https://github.com/bepersevering/vellink/actions/workflows/build-desktop.yml)

[中文文档](./README.zh-CN.md)

> A Markdown editor built for writers: an immersive, distraction-free writing surface plus extensible knowledge management — and every capability is a plugin.

Vellink puts two usually mutually exclusive things together: **the UI disappears while you write, and everything is at hand when you manage**. By default you only see the editor and a minimal toolbar; the file tree, outline, plugins, AI assistant and graph view all live in drawers, one click away. More importantly, cloud sync, AI knowledge base, and syntax extensions all exist as plugins — nothing is hard-wired into the kernel.

## Why

Most Markdown editors force a trade-off. The ones that write beautifully tend to be closed and unextendable — no plugin system, little knowledge management. The ones with rich plugin ecosystems keep the interface permanently crowded, so focus is the first thing you lose.

Vellink's answer: **a unified document model (IR) as the kernel, with everything above it built as plugins**. The writing surface stays as clean as a plain sheet of paper; extensibility is owned by the community. Under one architecture, the two no longer conflict.

## Core Features

- **Dual modes**: Focus mode hides the UI completely; Manage mode unfolds the file tree, outline, plugin panel, AI assistant and graph
- **WYSIWYG + source dual view**: both views share cursor position and undo stack via a unified document IR
- **Unified document IR**: an AST with bidirectional source maps — the common foundation for the editor, AI rewriting, plugins and collaboration
- **Plugin-first**: six contribution points (commands, menus, view panels, block renderers, syntax, providers); plugins are written in TypeScript
- **Local-first cloud sync**: the VFS abstraction unifies local and cloud storage; WebDAV / S3 / GitHub / Yuque are all plugins; Yjs handles offline merge
- **AI knowledge base**: structure-aware semantic chunking, vector retrieval + backlink graph recall, swappable AI providers (DeepSeek / Ollama / any OpenAI-compatible endpoint)
- **MCP bridging (planned)**: act as an MCP client calling external tools, and as an MCP server exposing documents and retrieval to other agents
- **i18n**: English and Simplified Chinese UI, extensible locale packs
- **Three platforms**: macOS / Windows / Linux

## Getting Started

> The project is in early development (M4.5 workspace). Currently working: React writing UI with live-synced ProseMirror WYSIWYG / CodeMirror 6 views, a multi-document workspace with autosave and a live outline, an installable plugin system, and two official plugins — WebDAV cloud sync and AI knowledge-base Q&A.

```bash
# Prerequisites: Node.js 20+, Rust toolchain, Xcode Command Line Tools (macOS)
git clone https://github.com/bepersevering/vellink.git
cd vellink
npm install
npm run dev            # browser dev server (quick UI verification)
npm run tauri dev      # desktop app
npm test               # run unit tests (106 tests)
npx tsc --noEmit       # type check
```

Architecture design and the phased plan: [`开发清单.md`](./开发清单.md) (Chinese). UI design baseline: [`ui-prototype.html`](./ui-prototype.html).

### CI & Builds

- **CI**: every push to `main` or PR runs `npm ci` → unit tests → type check → frontend build, plus a `cargo check` of the Rust shell; `dist/` is uploaded as an artifact (7-day retention).
- **Desktop build**: push a `v*` tag or trigger "Desktop Build" manually from the Actions page to produce macOS (arm64 / x86_64), Windows and Linux installers in workflow artifacts; pushing a tag also creates a draft Release.
- **Working convention**: commit + push immediately after each milestone task; a green CI run is the acceptance criterion.

## Architecture

```
L4  Plugins           cloud storage · AI knowledge base · syntax · UI extensions
L3  App services      retrieval · sync · graph · AI service bus
L2  Extension runtime contribution points · Worker sandbox · permissions · lifecycle
L1  Platform kernel   IR · commands · event bus · transactions
L0  Host              Tauri 2 (Rust) · filesystem · SQLite · OS keychain
```

Tech stack: TypeScript (primary) + Rust (Tauri host shell), React, ProseMirror (WYSIWYG, integrated), CodeMirror 6 (source view, integrated), Lezer Markdown parsing (shared by both views), ESM plugin runtime + six contribution points (integrated), WebDAV VFS + ETag sync (integrated), OpenAI-compatible AIProvider + in-memory vector retrieval (integrated); OS keychain / SQLite + sqlite-vec / Yjs arrive with the Tauri packaging stage.

## Plugin Development

A plugin is an ESM module with a `manifest.json` that declares what it contributes to the host:

```json
{
  "id": "storage.webdav",
  "activationEvents": ["onStorageProvider:webdav"],
  "permissions": ["net:*", "keychain:read"],
  "contributes": {
    "storageProviders": [{ "scheme": "webdav", "label": "WebDAV" }],
    "commands": [{ "id": "webdav.sync", "title": "Sync now" }]
  },
  "main": "./dist/index.js"
}
```

Six contribution points: commands & menus, views & panels, block renderers, syntax & parsing, storage providers, AI providers.

## Roadmap

| Phase | Scope | Status |
|---|---|---|
| M0 | Foundation: scaffold + IR types + commands/transactions | Done (13 tests) |
| M1 | Kernel: incremental parsing + source maps + dual-view sync | Incremental parsing & source maps done ([report](./M1-技术验证报告.md), Chinese); cursor-sync validation passed, WYSIWYG stays ([report](./M2-光标同步验证报告.md), Chinese) |
| M2 | UI: minimal writing shell + drawers + dual modes | React shell done: focus/manage modes, drawers, four-tab panel, command palette (⌘P), light/dark theme. ProseMirror + CodeMirror 6 live dual-view sync (⌘1 source / ⌘2 WYSIWYG), undo unified in DocumentStore (⌘Z / ⌘⇧Z), IME composition never pollutes content or undo history. ([notes](./M2-反向序列化说明.md), Chinese) |
| M3 | Plugin runtime: manifest + loading + contribution points | Strict manifest validation + dynamic ESM loading + six contribution-point registries; lifecycle / permission gating / private storage / failure rollback implemented, with a `word-count` sample plugin wired into UI. ([notes](./M3-插件运行时说明.md), Chinese) |
| M4 | Official plugins: WebDAV + DeepSeek Q&A | VFS abstraction + WebDAV provider + ETag offline sync (conflicts preserved as copies); IR semantic chunking + vector retrieval + OpenAI-compatible AIProvider; both official plugins and config panel wired in. ([notes](./M4-官方插件说明.md), Chinese) |
| M4.5 | Workspace: real documents, autosave, live outline | Document list with create / switch / two-step delete, a separate undo stack per document, title derived from the first heading, debounced autosave with reload recovery, outline built from the IR and clickable in both views, ⌘N / ⌘S wired, and a ProseMirror base keymap (Enter / Backspace / Mod-B / Mod-I). ([notes](./M4.5-文档工作区说明.md), Chinese) |
| M5 | Three-platform packaging + CI + auto-update | Not started |
| M6 | 10-user beta polish → public release | Not started |

## Design Principles

1. **The IR is the single source of truth**; every view is a projection of it. The IR never crosses IPC, avoiding AST serialization on the Rust side.
2. **Storage and AI are always plugins**; host code knows no concrete cloud drive or model.
3. **Local-first**: fully functional offline; CRDT merges when back online.
4. **Contracts first**: humans review core types; AI produces the boilerplate.

## License

MIT
