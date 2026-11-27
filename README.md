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
- **Your files stay yours**: the desktop app reads and writes a regular folder of `.md` files — nothing is locked in a database; the file name follows the first heading, deletions move to `.vellink-trash`, and a filesystem watcher reloads external edits the moment they land
- **Local-first cloud sync**: the VFS abstraction unifies local and cloud storage; WebDAV / S3 / GitHub / Yuque are all plugins; Yjs handles offline merge
- **AI knowledge base**: structure-aware semantic chunking, vector retrieval + backlink graph recall, swappable AI providers (DeepSeek / Ollama / any OpenAI-compatible endpoint)
- **MCP bridging (planned)**: act as an MCP client calling external tools, and as an MCP server exposing documents and retrieval to other agents
- **Find & replace**: both views search the text you actually see (WYSIWYG text vs raw Markdown), highlight every hit, and replace one or all in a single undo step
- **Search everything**: the command palette (`⌘P`) searches every document's title and body as you type, shows a snippet per hit, and jumps straight to the word — title hits rank first
- **Export**: `⌘E` exports the whole document or just the selection — Markdown stays byte-for-byte as written, HTML is one self-contained styled file, PDF goes through the system print panel so pagination and CJK fonts are the OS's job. Native save dialog + atomic write on desktop; selection exports get an "excerpt" suffix so they never overwrite the full document
- **Settings**: `⌘,` opens a panel for body text size, column width, theme (light / dark / follow system) and autosave interval — applied and saved as you drag, with headings and code blocks scaling along
- **Images**: paste or drop a screenshot into the workspace's `.vellink-assets/`; both views render it, HTML / PDF exports embed the bytes, Markdown exports keep the relative path
- **Import**: `⌘⇧O` imports several `.md` files at once — copied into the workspace on the desktop, into localStorage in the browser; titles come from the first heading, duplicates get a suffix
- **Math**: `$E=mc^2$` and `$$...$$` render as KaTeX in WYSIWYG while the source view keeps the original syntax; exports use self-contained MathML
- **Code highlight**: WYSIWYG code blocks colour keywords, strings, numbers and comments; the source view and HTML exports use the same palette
- **Extended syntax**: YAML frontmatter as a property card, `[TOC]` expanded into a jumpable outline, heading anchors, footnotes
- **Web paste**: content copied from a browser is converted to Markdown on paste (headings, lists, emphasis, links, code, tables, images)
- **i18n**: English and Simplified Chinese UI, extensible locale packs
- **Three platforms**: macOS / Windows / Linux

## Getting Started

| M6.11 | Symbol auto-pair | Source view uses CodeMirror `closeBrackets` for quotes and brackets; WYSIWYG uses a PM plugin so typing `*`, `_` or a backtick over a selection applies bold / italic / inline code. ([checklist](./功能差距清单.md), Chinese) |

Prebuilt installers live on the [Releases](https://github.com/bepersevering/vellink/releases) page. Once installed, new versions arrive in-app: the app checks quietly on launch, and you can force a check with `⌘U` or the version badge in the status bar.

```bash
# Prerequisites: Node.js 20+, Rust toolchain, Xcode Command Line Tools (macOS)
git clone https://github.com/bepersevering/vellink.git
cd vellink
npm install
npm run dev            # browser dev server (quick UI verification)
npm run tauri dev      # desktop app
npm test               # run unit tests (347 tests)
npx tsc --noEmit       # type check
```

Architecture design and the phased plan: [`开发清单.md`](./开发清单.md) (Chinese). UI design baseline: [`ui-prototype.html`](./ui-prototype.html).

### CI & Builds

- **CI**: every push to `main` or PR runs `npm ci` → version consistency check → unit tests → type check → frontend build, plus `cargo check` and `cargo test` of the Rust shell; `dist/` is uploaded as an artifact (7-day retention).
- **Release build**: pushing a `v*` tag builds macOS (arm64 / x86_64), Windows (NSIS + MSI) and Linux (deb + AppImage) on four runners, signs the updater artifacts and publishes a Release with `latest.json`, which is what the in-app updater reads. A manual "Release Build" run only produces workflow artifacts. Builds run one platform at a time so they don't overwrite each other's entry in `latest.json`.
- **Versioning**: `npm version patch|minor|major` is the only way to bump; it syncs `tauri.conf.json`, `Cargo.toml` and `Cargo.lock` and stages them into the tag commit. CI fails if the three disagree.
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
| M4.6 | Local Markdown files: Tauri fs backend | Open or switch a workspace folder; one document = one real `.md` file; atomic write (temp file + rename), BOM/CRLF normalisation on read, recursive listing that skips `node_modules` / hidden dirs, deletion to `.vellink-trash`, folder picker + reveal in file manager, and a 4s poll that reloads externally edited files while never overwriting unsaved local edits. ([notes](./M4.6-本地文件后端说明.md), Chinese) |
| M4.7 | File names follow titles, live watching | Renaming a heading renames the file on disk after a 900ms pause (atomic, collision-suffixed, undo stack and cursor preserved); only local edits count, so an external tool changing the H1 is never overruled. A `notify`-based recursive watcher replaces the 4s poll (200ms event coalescing, self-write suppression, stale-scan guard, 30s fallback). ([notes](./M4.7-文件名跟随与实时监听说明.md), Chinese) |
| M5 | Three-platform packaging + CI + auto-update | Signed installers for macOS (dmg/app, both arches), Windows (NSIS/MSI) and Linux (deb/AppImage), published to Releases by tag. In-app updater: quiet check 4s after launch (6h throttle), progress + signature verification, restart to apply; `⌘U` / status-bar version badge / command palette to check manually. Version numbers come from `package.json` only — `npm version` syncs the other three files and CI enforces it. ([notes](./M5-三平台打包与自动更新说明.md), Chinese) |
| M6.1 | Find & replace across both views | `⌘F` opens a compact bar instead of a browser dialog: WYSIWYG searches visible text (block-aware, never stitches two paragraphs together), the source view searches raw Markdown, cross-view coordinates are never mixed. All hits highlighted, current one selected and scrolled into view, `Enter` / `Shift+Enter` to step, case + regex toggles, replace-one and replace-all commit as a single undo step. The command palette (`⌘P`) now also searches titles and bodies across the whole workspace, with snippets and jump-to-word. ([notes](./M6.1-查找替换说明.md), Chinese) |
| M6.2 | Export Markdown / HTML / PDF | `⌘E` opens a panel for format + scope (whole document or selection). Markdown is the source moved as-is; HTML is one self-contained file sharing the editor's typesetting rules; PDF mounts a print-only DOM and calls the system print panel, where the user picks "Save as PDF". Native save dialog + atomic Rust write (`.md` / `.html` only) on desktop, a plain download in the browser. Selection exports re-parse the source slice instead of cutting DOM, and carry an "excerpt" suffix so they never overwrite a full export; link and image URLs pass a scheme allowlist, so `javascript:` and `data:text/html` are downgraded. ([notes](./M6.2-导出说明.md), Chinese) |
| M6.3 | Settings panel | `⌘,`, the title-bar gear or the command palette. Body text 13–22px, column 560–960px, theme light / dark / follow-system (reacts to OS appearance changes at once; an existing `vellink-theme` choice migrates to an explicit one), autosave 0.3–3.0s (in-flight timers reschedule immediately). Everything applies and persists as you change it, and out-of-range values from storage are clamped back. ([notes](./M6.3-设置面板说明.md), Chinese) |
| M6.4 | Image paste and self-contained export | Screenshots paste or drop straight into `.vellink-assets/` (ASCII slug + content hash, atomic Rust write, extension allowlist) render as a thumbnail in WYSIWYG while the source view keeps the Markdown. Block insertion lands after the current line so a heading is never split, and one undo removes the whole image. HTML / PDF export reads local assets back as data URIs; Markdown keeps relative paths. ([notes](./M6.4-图片粘贴与导出内嵌说明.md), Chinese) |
| M6.5 | Batch Markdown import | `⌘⇧O`, the file-tree upload button or the command palette. The system dialog accepts multiple `.md` files; the desktop writes them atomically into the workspace, the browser hands them to autosave. Titles come from the first heading rather than the file name (otherwise the title jumps on first edit), duplicates within the batch and against existing notes get a suffix, BOM / CRLF are normalized and non-Markdown files are reported as skipped. ([notes](./M6.5-导入Markdown文件说明.md), Chinese) |
| M6.6 | Math formulas | `$...$` and `$$...$$` render through KaTeX: IR carries math atom nodes, WYSIWYG swaps placeholder DOM for rendered output, source view and Markdown export keep the original syntax. HTML / PDF exports use MathML (no external assets), not KaTeX HTML with 60 font files. Includes a per-item feature checklist. ([notes](./M6.6-数学公式说明.md), Chinese · [checklist](./功能差距清单.md)) |
| M6.7 | WYSIWYG code highlight | A dependency-free lexer plus PM Decorations colour keywords, strings, numbers and comments in code blocks. Decorations only wrap text nodes, so the document is untouched and blocks stay editable; HTML exports use the same palette. ([notes](./M6.7-代码高亮说明.md), Chinese) |
| M6.8 | Extended syntax | Top-of-file YAML frontmatter renders as a property card, `[TOC]` expands into a jumpable outline and headings get anchors; source view and Markdown export keep the original syntax, exported HTML carries the same outline. ([checklist](./功能差距清单.md), Chinese) |
| M6.9 | Web paste to Markdown | Clipboard HTML is walked through a DOM and converted to Markdown before insertion, sharing one undo step in both views; plain text and images keep their existing path. Dependency-free converter at runtime, with script/style dropped and `javascript:` links neutralised. ([notes](./M6.9-网页粘贴转Markdown说明.md), Chinese · [checklist](./功能差距清单.md)) |
| M6.10 | Footnotes | `[^1]` renders as a superscript jump; `[^1]: text` definitions collect into an end-of-document notes section in exported HTML. Source view and Markdown export keep the original syntax. Lezer does not know footnotes, so recognition happens at the source layer with IR atoms. ([checklist](./功能差距清单.md), Chinese) |
| M6.11 | Symbol auto-pair | Source view uses CodeMirror `closeBrackets` for quotes and brackets; WYSIWYG uses a PM plugin so typing `*`, `_` or a backtick over a selection applies bold / italic / inline code. ([checklist](./功能差距清单.md), Chinese) |
| M6.12 | Emoji completion | Source view pops a candidate list on `:smi`; WYSIWYG turns `:smile:` into 😄 as you type. Built-in table of common shortcodes (including Chinese), unknown ones stay as text. ([checklist](./功能差距清单.md), Chinese) |
| M6 | 10-user beta polish → public release | In progress |

## Design Principles

1. **The IR is the single source of truth**; every view is a projection of it. The IR never crosses IPC, avoiding AST serialization on the Rust side.
2. **Storage and AI are always plugins**; host code knows no concrete cloud drive or model.
3. **Local-first**: fully functional offline; CRDT merges when back online.
4. **Contracts first**: humans review core types; AI produces the boilerplate.

## License

MIT
