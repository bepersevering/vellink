# Vellink

> 一个为写作者设计的 Markdown 编辑器：Typora 般的沉浸写作，Obsidian 般的可扩展知识管理，一切能力皆可插拔。

Vellink 把两件通常互斥的事放在一起——**写作时界面隐形，管理时信息尽在掌握**。默认只有编辑器和极简工具栏；文件树、大纲、插件、AI 助手、关系图谱都藏在抽屉里，需要时一键展开。更重要的是，云同步、AI 知识库、语法扩展等能力全部以插件形式存在，而不是被写死在内核里。

## 为什么做这个

Typora 提供了最好的沉浸式写作体验，但它是闭源的，没有插件系统，也几乎没有知识管理能力。Obsidian 有强大的插件生态和双链笔记，但界面永远信息密集，写作时难以专注。

Vellink 的选择是：**以统一文档模型（IR）为内核，把一切上层能力做成插件**。写作体验做到 Typora 的干净，扩展能力交给社区——这两件事在同一个架构下不再矛盾。

## 核心特性

- **双模式**：写作模式界面完全隐形；管理模式展开文件树、大纲、插件面板、AI 助手、关系图谱
- **所见即所得 + 源码双视图**：基于统一文档 IR，两种视图共享光标位置与撤销栈
- **统一文档 IR**：带双向 source map 的 AST，是编辑器、AI 改写、插件、协同的共同底座
- **插件优先**：命令、菜单、视图面板、块渲染器、语法、Provider 六类贡献点，插件用 TypeScript 编写
- **本地优先的云同步**：VFS 抽象统一本地与云端，WebDAV / S3 / GitHub / 语雀等均为插件；Yjs 做离线合并
- **AI 知识库**：基于文档结构语义切片，向量检索 + 双向链接图谱召回，AI Provider 可替换（DeepSeek / Ollama / OpenAI 兼容）
- **MCP 双向桥接**：既作为客户端调用外部工具，也作为服务端把文档与检索能力暴露给其他 Agent
- **三平台**：macOS / Windows / Linux

## 快速开始

> 项目处于早期开发阶段（M2 双视图）。当前可运行：React 写作界面 + ProseMirror WYSIWYG 编辑器 + Markdown 源码视图，两者已通过统一映射实时同步。

```bash
# 前置：Node.js 20+、Rust 工具链、Xcode Command Line Tools（macOS）
git clone https://github.com/bepersevering/vellink.git
cd vellink
npm install
npm run dev            # 浏览器热更新（快速验收 UI）
npm run tauri dev      # 启动桌面应用
npm test               # 运行核心单测（62 项）
npx tsc --noEmit       # 类型检查
```

架构设计与分阶段开发计划见 [`开发清单.md`](./开发清单.md)。UI 设计基准见 [`ui-prototype.html`](./ui-prototype.html)。

## 架构

```
L4  插件层         云存储 · AI 知识库 · 语法 · 界面增强
L3  应用服务       检索 · 同步 · 图谱 · AI 服务总线
L2  扩展运行时     贡献点 · Worker 沙箱 · 权限 · 生命周期
L1  平台内核       IR · 命令 · 事件总线 · 事务
L0  宿主层         Tauri 2 (Rust) · 文件系统 · SQLite · 密钥链
```

技术栈：TypeScript（主）+ Rust（Tauri 宿主壳）、React、ProseMirror（已接入）、Lezer Markdown 解析（已接入）、CodeMirror 6 / Yjs / SQLite + sqlite-vec（后续阶段接入）。

## 插件开发

插件是一个带 `manifest.json` 的 ESM 模块，通过 `contributes` 声明它往宿主里加什么：

```json
{
  "id": "storage.webdav",
  "activationEvents": ["onStorageProvider:webdav"],
  "permissions": ["net:*", "keychain:read"],
  "contributes": {
    "storageProviders": [{ "scheme": "webdav", "label": "WebDAV" }],
    "commands": [{ "id": "webdav.sync", "title": "立即同步" }]
  },
  "main": "./dist/index.js"
}
```

六类贡献点：命令与菜单、视图与面板、块渲染器、语法与解析、存储 Provider、AI Provider。

## 路线图

| 阶段 | 内容 | 状态 |
|---|---|---|
| M0 | 地基：脚手架 + IR 类型 + 命令/事务 | 已完成（13 单测通过） |
| M1 | 内核：增量解析 + source map + 双视图同步 | 增量解析与 source map 已完成（[验证报告](./M1-技术验证报告.md)）；双视图光标同步验证通过，不砍 WYSIWYG（[验证报告](./M2-光标同步验证报告.md)） |
| M2 | UI：Typora 骨架 + 抽屉 + 双模式 | 骨架已落地为 React 组件：写作/管理模式切换、左右抽屉开合、四标签面板、命令面板（⌘P）、亮暗主题。ProseMirror 已挂载到 `data-editor-host`，与 Markdown 源码视图实时双向同步（⌘1 源码 / ⌘2 WYSIWYG），光标位置互通。[说明](./M2-反向序列化说明.md) |
| M3 | 插件运行时：manifest + 加载 + 贡献点 | 待开始 |
| M4 | 官方插件：WebDAV + DeepSeek 问答 | 待开始 |
| M5 | 三平台打包 + CI + 自动更新 | 待开始 |
| M6 | 10 人试用打磨 → 公开发布 | 待开始 |

## 设计原则

1. **IR 是唯一真源**，所有视图都是它的投影；IR 不跨 IPC 传输，避免在 Rust 侧序列化 AST
2. **存储与 AI 一律插件化**，宿主代码不认识任何具体云盘或模型
3. **本地优先**，离线可完整工作，联网后由 CRDT 合并
4. **接口契约先行**，核心类型由人把关，样板实现交给 AI

## 许可证

MIT
