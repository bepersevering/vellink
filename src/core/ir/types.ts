/**
 * DocumentIR — Vellink 文档的唯一真源表示。
 *
 * 设计约束（宪法级，改动前必须评审）：
 * 1. IR 是唯一真源，源码视图与所见即所得视图都只是它的投影。
 * 2. 每个节点带双向 source map（offset），可在 IR 节点 <-> 源文件位置间映射。
 * 3. IR 只在 JS 侧存在，禁止跨 Tauri IPC 序列化传输（会炸延迟）。
 * 4. 节点不可变：所有修改通过 Transaction/op 产生新树，不原地改。
 */

/** 源文件位置映射：offset 为 UTF-16 码元偏移，与 CodeMirror/JS string 一致。 */
export interface SourceSpan {
  /** 节点在源文本中的起始偏移（含） */
  start: number;
  /** 节点在源文本中的结束偏移（不含） */
  end: number;
}

/** 所有节点的公共字段。 */
interface NodeBase {
  /** 节点唯一 ID，跨事务稳定，用于 source map 与视图增量更新 */
  id: string;
  span: SourceSpan;
}

/* ------------------------------ 行内节点 ------------------------------ */

export interface TextNode extends NodeBase {
  type: "text";
  value: string;
}

export interface EmphasisNode extends NodeBase {
  type: "emphasis";
  children: InlineNode[];
}

export interface StrongNode extends NodeBase {
  type: "strong";
  children: InlineNode[];
}

export interface InlineCodeNode extends NodeBase {
  type: "inlineCode";
  value: string;
}

export interface LinkNode extends NodeBase {
  type: "link";
  url: string;
  title?: string;
  children: InlineNode[];
}

/** [[双向链接]] — Vellink 知识图谱的原子单位 */
export interface WikiLinkNode extends NodeBase {
  type: "wikiLink";
  target: string;
}

export interface ImageNode extends NodeBase {
  type: "image";
  url: string;
  alt: string;
}

/** 行内公式 `$...$`：value 不含两侧美元符，渲染时由 KaTeX 出 HTML。 */
export interface InlineMathNode extends NodeBase {
  type: "inlineMath";
  value: string;
}

/** 块级公式 `$$...$$`：独占一段，value 不含两侧 `$$`。 */
export interface MathBlockNode extends NodeBase {
  type: "mathBlock";
  value: string;
}

/** YAML frontmatter：文档顶部的 `--- ... ---`，不参与正文排版。 */
export interface FrontmatterNode extends NodeBase {
  type: "frontmatter";
  value: string;
}

/** `[TOC]` 占位符：渲染时展开为标题目录，源码里保持占位符。 */
export interface TocNode extends NodeBase {
  type: "toc";
}

/** 行内脚注引用 `[^1]`。 */
export interface FootnoteRefNode extends NodeBase {
  type: "footnoteRef";
  label: string;
}

/** 脚注定义 `[^1]: 内容`（通常位于文末）。 */
export interface FootnoteDefNode extends NodeBase {
  type: "footnoteDef";
  label: string;
  text: string;
}

export type InlineNode =
  | TextNode
  | EmphasisNode
  | StrongNode
  | InlineCodeNode
  | LinkNode
  | WikiLinkNode
  | ImageNode
  | InlineMathNode
  | FootnoteRefNode;

/* ------------------------------ 块级节点 ------------------------------ */

export interface ParagraphNode extends NodeBase {
  type: "paragraph";
  children: InlineNode[];
}

export interface HeadingNode extends NodeBase {
  type: "heading";
  depth: 1 | 2 | 3 | 4 | 5 | 6;
  children: InlineNode[];
}

export interface CodeNode extends NodeBase {
  type: "code";
  lang?: string;
  value: string;
}

export interface BlockquoteNode extends NodeBase {
  type: "blockquote";
  children: BlockNode[];
}

export interface ListItemNode extends NodeBase {
  type: "listItem";
  checked?: boolean;
  children: BlockNode[];
}

export interface ListNode extends NodeBase {
  type: "list";
  ordered: boolean;
  start?: number;
  children: ListItemNode[];
}

export interface TableNode extends NodeBase {
  type: "table";
  align: Array<"left" | "center" | "right" | null>;
  children: TableRowNode[];
}

export interface TableRowNode extends NodeBase {
  type: "tableRow";
  children: TableCellNode[];
}

export interface TableCellNode extends NodeBase {
  type: "tableCell";
  children: InlineNode[];
}

export interface ThematicBreakNode extends NodeBase {
  type: "thematicBreak";
}

export type BlockNode =
  | ParagraphNode
  | HeadingNode
  | CodeNode
  | BlockquoteNode
  | ListNode
  | TableNode
  | ThematicBreakNode
  | MathBlockNode
  | FrontmatterNode
  | TocNode
  | FootnoteDefNode;

/** 完整文档 IR：块节点树 + 源文本快照 + 版本。 */
export interface DocumentIR {
  /** 根块节点列表 */
  children: BlockNode[];
  /** 生成该 IR 的源文本快照（用于 offset 校验与序列化对照） */
  source: string;
  /** 单调递增版本，事务提交时 +1 */
  version: number;
}

/* ------------------------------ 工具函数 ------------------------------ */

/** 深度优先遍历所有块节点。 */
export function walkBlocks(
  nodes: BlockNode[],
  visit: (node: BlockNode) => void,
): void {
  for (const node of nodes) {
    visit(node);
    if (node.type === "blockquote") walkBlocks(node.children, visit);
    else if (node.type === "list")
      for (const item of node.children) walkBlocks(item.children, visit);
    // table 的子节点是 tableRow/tableCell，属于表格内部结构，
    // 其内容是行内节点，由 walkInline 负责，不在此处递归。
  }
}

/** 深度优先遍历块节点下的所有行内节点。 */
export function walkInline(
  node: BlockNode,
  visit: (node: InlineNode) => void,
): void {
  const walk = (nodes: InlineNode[]) => {
    for (const n of nodes) {
      visit(n);
      if (
        n.type === "emphasis" ||
        n.type === "strong" ||
        n.type === "link"
      )
        walk(n.children);
    }
  };
  switch (node.type) {
    case "paragraph":
    case "heading":
      walk(node.children);
      break;
    case "table":
      for (const row of node.children)
        for (const cell of row.children) walk(cell.children);
      break;
    case "blockquote":
      for (const child of node.children) walkInline(child, visit);
      break;
    case "list":
      for (const item of node.children)
        for (const child of item.children) walkInline(child, visit);
      break;
    default:
      break;
  }
}

/** 按 ID 查找块节点（深度优先）。 */
export function findBlockById(
  nodes: BlockNode[],
  id: string,
): BlockNode | undefined {
  for (const node of nodes) {
    if (node.id === id) return node;
    if (node.type === "blockquote") {
      const hit = findBlockById(node.children, id);
      if (hit) return hit;
    } else if (node.type === "list") {
      for (const item of node.children) {
        const hit = findBlockById(item.children, id);
        if (hit) return hit;
      }
    }
  }
  return undefined;
}

/** 创建空文档。 */
export function emptyDocument(): DocumentIR {
  return { children: [], source: "", version: 0 };
}
