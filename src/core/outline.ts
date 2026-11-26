/**
 * 大纲与标题：从 IR 直接派生，不维护第二份状态。
 *
 * 文档标题 = 首个一级标题，退化为首个任意级标题，再退化为首个非空行。
 * 大纲条目只取顶层标题（列表/引用里的标题不进大纲），并附带源码偏移，
 * 供编辑器做「点击跳转」——跳转走 source map，因此两种视图都能定位。
 */

import type { BlockNode, InlineNode } from "./ir/types";
import { parseMarkdown } from "./parser/markdown";

export interface OutlineEntry {
  /** 标题块 ID，跨增量解析稳定。 */
  id: string;
  label: string;
  /** 归一化到 1–3 级，6 级标题在面板里按 3 级缩进显示。 */
  level: 1 | 2 | 3;
  /** 标题行在源码中的起始偏移（UTF-16）。 */
  offset: number;
  /** 真实标题深度，用于标题取值与调试。 */
  depth: number;
}

/** 拼接行内节点的纯文本（去掉强调/链接标记，保留可见文字）。 */
export function inlineText(nodes: InlineNode[]): string {
  let out = "";
  for (const node of nodes) {
    switch (node.type) {
      case "text":
      case "inlineCode":
        out += node.value;
        break;
      case "emphasis":
      case "strong":
      case "link":
        out += inlineText(node.children);
        break;
      case "wikiLink":
        out += node.target;
        break;
      case "image":
        out += node.alt;
        break;
    }
  }
  return out;
}

function headingLabel(block: BlockNode): string {
  if (block.type !== "heading") return "";
  return inlineText(block.children).replace(/\s+/g, " ").trim();
}

/** 顶层标题 → 大纲条目，按出现顺序。 */
export function buildOutline(source: string): OutlineEntry[] {
  const { ir } = parseMarkdown({ source });
  const entries: OutlineEntry[] = [];
  for (const block of ir.children) {
    if (block.type !== "heading") continue;
    const label = headingLabel(block);
    if (!label) continue;
    entries.push({
      id: block.id,
      label,
      level: Math.min(block.depth, 3) as 1 | 2 | 3,
      offset: block.span.start,
      depth: block.depth,
    });
  }
  return entries;
}

/** 文档标题：一级标题 → 任意标题 → 首个非空行 → fallback。 */
export function docTitle(source: string, fallback = "Untitled"): string {
  const headings = buildOutline(source);
  const h1 = headings.find((entry) => entry.depth === 1);
  if (h1) return h1.label;
  if (headings.length > 0) return headings[0].label;
  const firstLine = source
    .split("\n")
    .map((line) => line.trim())
    .find((line) => line.length > 0);
  if (!firstLine) return fallback;
  return firstLine.replace(/^#+\s*/, "").slice(0, 80);
}
