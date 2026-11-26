/**
 * 首次启动的种子文档。
 *
 * 只做两件事：让新用户一进来就有内容可读，同时把解析器/视图支持的语法
 * 全部摆在一篇里（标题、引用、列表、任务项、表格、代码、双向链接），
 * 任何一处渲染退化都能立刻看见。
 */

import type { WorkspaceDoc } from "./workspace";

const WELCOME = `# Welcome to Vellink

Vellink is a local-first Markdown editor built around a single document IR. The source view and the WYSIWYG view are two projections of the same tree, so switching between them never rewrites your text.

## Try the basics

- **Cmd/Ctrl + 1** switches to the source view, **Cmd/Ctrl + 2** returns to WYSIWYG
- **Cmd/Ctrl + N** creates a document, **Cmd/Ctrl + S** saves immediately
- **Cmd/Ctrl + P** opens the command palette
- **Cmd/Ctrl + Z** undoes, add **Shift** to redo

## What lands where

| You type | Vellink stores |
| --- | --- |
| A heading | A block node with a stable id |
| A link | Inline node plus source offset |
| A task item | List item with checked state |

> Every edit goes through an invertible op, so undo, plugins, and the AI assistant all share one history.

\`\`\`ts
// The IR is the only source of truth
const { ir } = parseMarkdown({ source });
const view = buildPMView(ir);
\`\`\`

Backlinks use double brackets, for example [[Second Brain]] — the graph panel resolves them later.
`;

const GUIDE = `# 如何建立自己的知识体系

我们每天都在接收大量信息，但真正能沉淀下来的少之又少。**知识体系的价值，不在于存了多少，而在于能否在需要时被重新调用。** 这正是写作与笔记的区别：笔记是记录，写作是思考的压缩。

> 知识不是被拥有的，而是被不断重建的。每一次表达，都是一次重建。

## 从收集到连接

大多数人卡在第一步——收集。收藏夹越来越满，大脑却越来越空。真正的转折点发生在你开始**连接**：把一条新信息和已有认知挂上钩，它才从“信息”变成“知识”。

- **原子化**：一条笔记只讲一件事，能被独立引用
- **用自己的话**：复述过的才真正理解
- **双向链接**：让笔记之间形成网络，而非孤岛

## 一个最小可行流程

不要一开始就设计复杂的分类系统。先用最简单的流程跑起来，让系统随使用自然生长：

\`\`\`ts
// 每日写作的最小闭环
capture  →  随手记下闪念，不分类
connect  →  写入时链接到已有笔记
distill  →  一周后回看，压缩成一段结论
publish  →  把结论写成文章，接受反馈
\`\`\`

这个流程里最容易被跳过的是 \`distill\`。恰恰是它，把散落的记录变成了可复用的判断。

---

### 写在最后

工具会变，方法会变，但有一件事不变：**你必须亲手把想法写成句子**。剩下的，交给时间。
`;

/**
 * 首次启动写入的两篇文档。
 *
 * `idFor` 让文件后端把 id 绑成磁盘路径；不传时用内存 id（浏览器 localStorage 后端）。
 */
export function seedDocuments(
  now: number,
  idFor: (title: string, index: number) => string = defaultSeedId,
): WorkspaceDoc[] {
  return [
    {
      id: idFor("Welcome to Vellink", 0),
      title: "Welcome to Vellink",
      source: WELCOME,
      savedSource: WELCOME,
      createdAt: now,
      updatedAt: now,
    },
    {
      id: idFor("如何建立自己的知识体系", 1),
      title: "如何建立自己的知识体系",
      source: GUIDE,
      savedSource: GUIDE,
      createdAt: now - 1000,
      updatedAt: now - 1000,
    },
  ];
}

function defaultSeedId(_title: string, index: number): string {
  return index === 0 ? "seed-welcome" : "seed-guide";
}

/** 只用于空工作区的兜底文档。 */
export function fallbackDocument(
  now: number,
  id = "doc-fallback",
  title = "Untitled",
): WorkspaceDoc {
  const source = `# ${title}\n\n`;
  return {
    id,
    title,
    source,
    savedSource: source,
    createdAt: now,
    updatedAt: now,
  };
}
