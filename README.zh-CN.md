# Vellink

[![CI](https://github.com/bepersevering/vellink/actions/workflows/ci.yml/badge.svg)](https://github.com/bepersevering/vellink/actions/workflows/ci.yml) [![桌面构建](https://github.com/bepersevering/vellink/actions/workflows/build-desktop.yml/badge.svg)](https://github.com/bepersevering/vellink/actions/workflows/build-desktop.yml)

[English](./README.md)

> 一个为写作者设计的 Markdown 编辑器：沉浸无扰的写作界面，加上可扩展的知识管理，一切能力皆可插拔。

Vellink 把两件通常互斥的事放在一起——**写作时界面隐形，管理时信息尽在掌握**。默认只有编辑器和极简工具栏；文件树、大纲、插件、AI 助手、关系图谱都藏在抽屉里，需要时一键展开。更重要的是，云同步、AI 知识库、语法扩展等能力全部以插件形式存在，而不是被写死在内核里。

## 为什么做这个

大多数 Markdown 编辑器都逼你做一次取舍：写得舒服的那些往往闭源、无法扩展，既没有插件系统，也几乎没有知识管理能力；而插件生态丰富的那些，界面永远信息密集，专注是第一个被牺牲的东西。

Vellink 的选择是：**以统一文档模型（IR）为内核，把一切上层能力做成插件**。写作界面干净得像一张白纸，扩展能力交给社区——这两件事在同一个架构下不再矛盾。

## 核心特性

- **双模式**：写作模式界面完全隐形；管理模式展开文件树、大纲、插件面板、AI 助手、关系图谱
- **所见即所得 + 源码双视图**：基于统一文档 IR，两种视图共享光标位置与撤销栈
- **统一文档 IR**：带双向 source map 的 AST，是编辑器、AI 改写、插件、协同的共同底座
- **插件优先**：命令、菜单、视图面板、块渲染器、语法、Provider 六类贡献点，插件用 TypeScript 编写
- **文件始终是你的**：桌面端读写的就是一个普通的 `.md` 文件夹，不锁进数据库；文件名跟随首个一级标题，删除进 `.vellink-trash`，外部改动由文件监听即时回灌
- **本地优先的云同步**：VFS 抽象统一本地与云端，WebDAV / S3 / GitHub / 语雀等均为插件；Yjs 做离线合并
- **AI 知识库**：基于文档结构语义切片，向量检索 + 双向链接图谱召回，AI Provider 可替换（DeepSeek / Ollama / OpenAI 兼容）
- **MCP 双向桥接**：既作为客户端调用外部工具，也作为服务端把文档与检索能力暴露给其他 Agent
- **查找替换**：两种视图都能用，搜的是你真正看见的字（WYSIWYG 搜可见文本、源码视图搜原始 Markdown）；全部命中高亮，替换一处或全部只占一步撤销
- **全库搜索**：命令面板（`⌘P`）边打边搜所有文档的标题与正文，每条命中带上下文片段，回车直接跳到那个词并选中；标题命中排在最前
- **导出**：`⌘E` 导出整篇或选区，Markdown 原样搬运、HTML 单文件自带样式、PDF 走系统打印面板（分页与中文字体交给系统）；桌面端用系统保存对话框 + 原子写，选区导出自动加「摘录」后缀，不会覆盖整篇
- **设置**：`⌘,` 调出面板调正文字号、正文栏宽、主题（浅色 / 深色 / 跟随系统）、自动保存间隔；改完立即生效并保存，标题与代码块随字号等比缩放
- **国际化**：内置英文与简体中文界面，语言包可扩展
- **三平台**：macOS / Windows / Linux

## 快速开始

> 项目处于早期开发阶段（M6.3 设置面板）。当前可运行：React 写作界面 + ProseMirror WYSIWYG / CodeMirror 6 双视图实时同步、桌面端直接读写本地 `.md` 文件夹的多文档工作区（文件名跟随标题、外部改动由文件监听即时回灌）、可安装启停的插件系统、WebDAV 云同步与 AI 知识库问答两个官方插件，macOS / Windows / Linux 三平台签名安装包与就地自动更新，双视图通用的查找替换（`⌘F`），整篇 / 选区导出为 Markdown、HTML、PDF（`⌘E`），以及可调的写作排版与主题（`⌘,`）。

现成安装包在 [Releases](https://github.com/bepersevering/vellink/releases)。装好之后新版本在应用内升级：启动后静默检查一次，也可以按 `⌘U` 或点状态栏右下角的版本号手动检查。

```bash
# 前置：Node.js 20+、Rust 工具链、Xcode Command Line Tools（macOS）
git clone https://github.com/bepersevering/vellink.git
cd vellink
npm install
npm run dev            # 浏览器热更新（快速验收 UI）
npm run tauri dev      # 启动桌面应用
npm test               # 运行核心单测（261 项）
npx tsc --noEmit       # 类型检查
```

架构设计与分阶段开发计划见 [`开发清单.md`](./开发清单.md)。UI 设计基准见 [`ui-prototype.html`](./ui-prototype.html)。

### 持续集成与构建

- **CI**：每次推送到 `main` 或提 PR 自动运行 `npm ci` → 版本号一致性校验 → 单测 → 类型检查 → 前端构建，并对 Rust 壳跑 `cargo check` 与 `cargo test`；`dist/` 作为 artifact 保留 7 天。
- **发布构建**：推送 `v*` 标签后，四台 runner 依次产出 macOS（arm64 / x86_64）、Windows（NSIS + MSI）、Linux（deb + AppImage）安装包，签名更新产物并发布 Release（含 `latest.json`，应用内更新就是读它）。Actions 页手动触发只产出 workflow artifacts。四个平台串行执行，避免并行 job 互相覆盖 `latest.json` 里的平台条目。
- **版本号**：只能用 `npm version patch|minor|major` 升版本，它会同步 `tauri.conf.json`、`Cargo.toml`、`Cargo.lock` 并把改动放进 tag 提交；三处不一致 CI 直接红。
- **工作约定**：每个阶段任务完成后立即 commit + push（**提交信息用英文**），以 CI 绿灯作为验收依据。

## 架构

```
L4  插件层         云存储 · AI 知识库 · 语法 · 界面增强
L3  应用服务       检索 · 同步 · 图谱 · AI 服务总线
L2  扩展运行时     贡献点 · Worker 沙箱 · 权限 · 生命周期
L1  平台内核       IR · 命令 · 事件总线 · 事务
L0  宿主层         Tauri 2 (Rust) · 文件系统 · SQLite · 密钥链
```

技术栈：TypeScript（主）+ Rust（Tauri 宿主壳）、React、ProseMirror（WYSIWYG，已接入）、CodeMirror 6（源码视图，已接入）、Lezer Markdown 解析（两视图同源）、ESM 插件运行时 + 六类贡献点（已接入）、WebDAV VFS + ETag 同步（已接入）、OpenAI 兼容 AIProvider + 内存向量检索（已接入）、OS 密钥链 / SQLite + sqlite-vec / Yjs（Tauri 打包阶段接入）。

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
| M2 | UI：极简写作骨架 + 抽屉 + 双模式 | 骨架已落地为 React 组件：写作/管理模式切换、左右抽屉开合、四标签面板、命令面板（⌘P）、亮暗主题。ProseMirror + CodeMirror 6 双视图实时同步（⌘1 源码 / ⌘2 WYSIWYG），撤销栈统一到 DocumentStore（⌘Z / ⌘⇧Z），IME 组合中间态不污染正文与撤销历史。[说明](./M2-反向序列化说明.md) |
| M3 | 插件运行时：manifest + 加载 + 贡献点 | manifest 严格校验 + ESM 动态加载 + 六类贡献点注册表；生命周期/权限门控/私有存储/失败回滚已实现，附带 `word-count` 示例插件，面板与命令面板已接线。[说明](./M3-插件运行时说明.md) |
| M4 | 官方插件：WebDAV + DeepSeek 问答 | VFS 抽象 + WebDAV Provider + ETag 离线同步（冲突保留副本）；IR 语义切片 + 向量检索 + OpenAI 兼容 AIProvider；两个官方插件及配置面板已接入。[说明](./M4-官方插件说明.md) |
| M4.5 | 文档工作区：多文档 + 自动保存 + 真大纲 | 文档列表可新建/切换/二次确认删除，每篇独立撤销栈；标题由首个一级标题派生；停手 700ms 自动落盘、刷新可恢复；大纲从 IR 现算、双视图可点击跳转；⌘N / ⌘S 已接线，并补齐 ProseMirror 基础键位（回车/退格/加粗/斜体）。[说明](./M4.5-文档工作区说明.md) |
| M4.6 | 本地 Markdown 文件：Tauri fs 后端 | 可选/可切换工作区目录，一篇文档 = 一个真实 `.md` 文件；原子写（临时文件 + rename）、读取时统一 BOM/CRLF、递归列举跳过 `node_modules` 与隐藏目录、删除进 `.vellink-trash`、系统文件夹选择器与「在文件管理器中显示」、4 秒轮询外部改动并在不影响未保存编辑的前提下重载。[说明](./M4.6-本地文件后端说明.md) |
| M4.7 | 文件名跟随标题 + 实时监听 | 改标题停手 900ms 就把磁盘文件改名（原子、重名自动加序号、撤销栈与光标不丢）；只有本地编辑才改名，外部工具改 H1 不会被反向覆盖。基于 `notify` 的递归目录监听取代 4 秒轮询（200ms 事件合并、自写抑制、陈旧扫描作废、30 秒兜底）。[说明](./M4.7-文件名跟随与实时监听说明.md) |
| M5 | 三平台打包 + CI + 自动更新 | macOS（dmg/app，双架构）、Windows（NSIS/MSI）、Linux（deb/AppImage）签名安装包，推 tag 自动发布到 Releases。应用内更新：启动 4 秒后静默检查（6 小时节流）、显示下载进度、验签后安装、重启生效；`⌘U` / 状态栏版本号 / 命令面板可手动检查。版本号只写 `package.json`，`npm version` 自动同步另外三处，CI 强制校验。[说明](./M5-三平台打包与自动更新说明.md) |
| M6.1 | 双视图查找替换 | `⌘F` 打开紧凑浮层：WYSIWYG 搜可见文本（按块切开，不会把两段拼成一个假命中），源码视图搜原始 Markdown，两套坐标绝不混用。全部命中高亮、当前一处选中并滚进视野，`Enter` / `Shift+Enter` 逐处跳，支持区分大小写与正则，替换一处 / 全部只占一步撤销。命令面板（`⌘P`）同时搜索全库标题与正文，带片段与跳转定位。[说明](./M6.1-查找替换说明.md) |
| M6.2 | 导出 Markdown / HTML / PDF | `⌘E` 面板选格式与范围（整篇 / 选区）。Markdown 原样搬运源码；HTML 单文件、样式内联、与编辑器同一套排版；PDF 挂打印专用 DOM 后调系统打印面板，用户选「存储为 PDF」。桌面端系统保存对话框 + Rust 原子写（只接受 `.md/.html`），浏览器端退回下载。选区导出重新解析源码（不切 DOM），文件名加 ` · 摘录` 避免覆盖整篇；链接与图片按协议白名单过滤，`javascript:` / `data:text/html` 一律降级。[说明](./M6.2-导出说明.md) |
| M6.3 | 设置面板 | `⌘,` / 标题栏齿轮 / 命令面板打开。正文字号 13–22px、栏宽 560–960px、主题浅色 / 深色 / 跟随系统（系统外观一变立刻响应，老用户的 `vellink-theme` 会迁移成显式选择）、自动保存 0.3–3.0 秒（改完排队中的保存立刻按新间隔重排）。改完立即生效并落盘，存储里的坏值一律夹回合法区间。[说明](./M6.3-设置面板说明.md) |
| M6 | 10 人试用打磨 → 公开发布 | 进行中 |

## 设计原则

1. **IR 是唯一真源**，所有视图都是它的投影；IR 不跨 IPC 传输，避免在 Rust 侧序列化 AST
2. **存储与 AI 一律插件化**，宿主代码不认识任何具体云盘或模型
3. **本地优先**，离线可完整工作，联网后由 CRDT 合并
4. **接口契约先行**，核心类型由人把关，样板实现交给 AI

## 许可证

MIT
