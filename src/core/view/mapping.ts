/**
 * sourceOffset ↔ ProseMirror pos 双向映射。
 *
 * 核心难点：markdown 源码里的标记字符（#、**、`、`[]() 等）在 PM 里是节点类型或
 * mark，不占文本内容。因此：
 * - 可见文本区：offset ↔ pos 严格线性一一对应（必须 100% 精确）
 * - 标记字符区：没有对应 PM 光标位，吸附到最近的可见文本边界（必须稳定）
 *
 * 实现策略：IR → PM 构建过程中给每个文本片段记录 source span，构建后遍历 PM 树
 * 收集 (pmFrom, sourceFrom, length) 锚点。映射时先找锚点，再线性插值。
 */

import { type Node as PMNode } from "prosemirror-model";
import type { BlockNode, DocumentIR, InlineNode, SourceSpan } from "../ir/types";
import { T, M, vellinkSchema } from "./schema";

/** 一个 PM 文本节点与它在源码中对应片段的锚点。 */
export interface TextAnchor {
  /** PM 文档中的起始位置 */
  pmFrom: number;
  /** 源码中的起始偏移 */
  sourceFrom: number;
  /** 文本长度（UTF-16 码元，两边一致） */
  length: number;
}

/** 构建产物：PM 文档 + 双向映射能力。 */
export interface PMView {
  doc: PMNode;
  anchors: readonly TextAnchor[];
}

/** IR 行内节点 → PM inline 节点数组，同时把 source span 记录在 WeakMap 上。 */
function inlineToPM(
  nodes: InlineNode[],
  spans: WeakMap<PMNode, SourceSpan>,
): PMNode[] {
  const out: PMNode[] = [];
  for (const n of nodes) {
    let node: PMNode;
    switch (n.type) {
      case "text":
        node = vellinkSchema.text(n.value);
        spans.set(node, n.span);
        out.push(node);
        break;
      case "inlineCode":
        node = vellinkSchema.text(n.value, [M.code.create()]);
        // value 去掉了反引号，span 要相应收缩到内容区
        spans.set(node, {
          start: n.span.start + 1,
          end: n.span.end - 1,
        });
        out.push(node);
        break;
      case "strong":
      case "emphasis":
      case "link": {
        // .mark() 会克隆节点，WeakMap 的 key 必须转移到新对象，否则 span 丢失
        const mark =
          n.type === "strong"
            ? M.strong.create()
            : n.type === "emphasis"
              ? M.em.create()
              : M.link.create({ href: n.url, title: n.title ?? null });
        for (const child of inlineToPM(n.children, spans)) {
          const span = spans.get(child);
          const marked = child.mark([mark, ...child.marks]);
          if (span) spans.set(marked, span);
          out.push(marked);
        }
        break;
      }
      case "wikiLink":
        node = vellinkSchema.text(n.target, [M.wikiLink.create({ target: n.target })]);
        // wikiLink 的 span 已含外层 [[ ]]，PM 只显示 target 文本，收缩两端各 2 字符
        spans.set(node, { start: n.span.start + 2, end: n.span.end - 2 });
        out.push(node);
        break;
      case "image":
        // 图片是 atom，PM 里用文本 alt 占位，映射回源码 span
        node = vellinkSchema.text(n.alt || n.url);
        spans.set(node, n.span);
        out.push(node);
        break;
    }
  }
  return out;
}

/** 单个块 → PM 节点。 */
function blockToPM(
  node: BlockNode,
  spans: WeakMap<PMNode, SourceSpan>,
  source: string,
): PMNode | null {
  switch (node.type) {
    case "heading":
      return T.heading.create({ level: node.depth }, inlineToPM(node.children, spans));
    case "paragraph":
      // 空段落必须有一个空 text 节点占位，否则 PM pos 会塌陷
      return T.paragraph.create(null, inlineToPM(node.children, spans));
    case "code": {
      const t = vellinkSchema.text(node.value);
      // value 去掉了围栏，用 source 反查内容区精确起点（对格式变体鲁棒）
      const contentStart = node.value
        ? source.indexOf(node.value, node.span.start)
        : node.span.start;
      const start = contentStart >= 0 ? contentStart : node.span.start;
      spans.set(t, { start, end: start + node.value.length });
      return T.codeBlock.create({ lang: node.lang ?? null }, [t]);
    }
    case "blockquote":
      return T.blockquote.create(
        null,
        node.children.map((c) => blockToPM(c, spans, source)!).filter(Boolean),
      );
    case "list": {
      const items = node.children.map((item) => {
        const blocks = item.children.map((c) => blockToPM(c, spans, source)!).filter(Boolean);
        // PM listItem 要求首块是 paragraph
        if (blocks.length && blocks[0].type !== T.paragraph)
          blocks.unshift(T.paragraph.create(null, []));
        return T.listItem.create({ checked: item.checked ?? null }, blocks.length ? blocks : [T.paragraph.create(null, [])]);
      });
      return node.ordered
        ? T.orderedList.create({ start: node.start ?? 1 }, items)
        : T.bulletList.create(null, items);
    }
    case "table":
      return T.table.create(
        { align: node.align },
        node.children.map((row) =>
          T.tableRow.create(
            null,
            row.children.map((cell) =>
              T.tableCell.create(null, inlineToPM(cell.children, spans)),
            ),
          ),
        ),
      );
    case "thematicBreak":
      return T.horizontalRule.create();
  }
}

/**
 * 从 IR 构建 PM 文档 + 文本锚点。
 *
 * 注意：code 节点的 value 在 markdown.ts 里已去掉围栏，source span 仍含围栏，
 * 因此这里用 source 文本反查内容区起点，保证映射精确。
 */
export function buildPMView(ir: DocumentIR): PMView {
  const spans = new WeakMap<PMNode, SourceSpan>();
  const blocks = ir.children
    .map((b) => blockToPM(b, spans, ir.source))
    .filter((n): n is PMNode => n !== null);
  const doc = blocks.length ? T.doc.create(null, blocks) : T.doc.create(null, [T.paragraph.create()]);

  const anchors: TextAnchor[] = [];
  doc.descendants((node, pos) => {
    if (!node.isText) return;
    const span = spans.get(node);
    if (!span) return;
    anchors.push({ pmFrom: pos, sourceFrom: span.start, length: span.end - span.start });
  });

  return { doc, anchors };
}

/** 吸附策略：标记字符区的 offset 归到最近的可见文本边界。 */
export function sourceToPM(view: PMView, offset: number): number {
  const { anchors } = view;
  if (!anchors.length) return 1;

  // 精确命中：offset 落在某文本锚点内（左闭右开，边界归后一个锚点）
  for (const a of anchors) {
    if (offset >= a.sourceFrom && offset < a.sourceFrom + a.length)
      return a.pmFrom + (offset - a.sourceFrom);
  }
  // 文档末尾 offset === source.length 归最后一个锚点的右边界
  const last = anchors[anchors.length - 1];
  if (offset === last.sourceFrom + last.length) return last.pmFrom + last.length;

  // 标记区：找最近的锚点边界（sourceFrom 或 sourceFrom+length）
  let best: { dist: number; pm: number } | null = null;
  for (const a of anchors) {
    for (const [src, pm] of [
      [a.sourceFrom, a.pmFrom],
      [a.sourceFrom + a.length, a.pmFrom + a.length],
    ] as const) {
      const dist = Math.abs(offset - src);
      if (!best || dist < best.dist) best = { dist, pm };
    }
  }
  return best?.pm ?? 1;
}

/**
 * PM pos → source offset。
 *
 * 关键：相邻文本节点在 PM 侧共享边界 pos（前一个的末端 == 后一个的起点），
 * 但该 pos 在源码侧对应两个不同 offset（标记字符 vs 可见字符）。
 * 采用 ProseMirror 光标语义——pos 表示"节点之前的位置"，边界统一归给后一个锚点。
 */
export function pmToSource(view: PMView, pos: number): number {
  const { anchors } = view;
  if (!anchors.length) return 0;

  // 第一轮：优先匹配锚点起点 [pmFrom, pmFrom+length)，边界归后一个锚点
  for (const a of anchors) {
    if (pos >= a.pmFrom && pos < a.pmFrom + a.length)
      return a.sourceFrom + (pos - a.pmFrom);
  }
  // 第二轮：文档最末端 pos 只能匹配最后一个锚点的右边界
  for (const a of anchors) {
    if (pos === a.pmFrom + a.length) return a.sourceFrom + a.length;
  }

  let best: { dist: number; src: number } | null = null;
  for (const a of anchors) {
    for (const [src, pm] of [
      [a.sourceFrom, a.pmFrom],
      [a.sourceFrom + a.length, a.pmFrom + a.length],
    ] as const) {
      const dist = Math.abs(pos - pm);
      if (!best || dist < best.dist) best = { dist, src };
    }
  }
  return best?.src ?? 0;
}

/** 诊断：文本锚点是否与源文本逐字对应。 */
export function validateAnchors(view: PMView, source: string): string[] {
  const errors: string[] = [];
  for (const a of view.anchors) {
    const srcText = source.slice(a.sourceFrom, a.sourceFrom + a.length);
    const pmText = view.doc.textBetween(a.pmFrom, a.pmFrom + a.length, "");
    if (srcText !== pmText)
      errors.push(
        `锚点 [${a.sourceFrom},${a.sourceFrom + a.length}) ↔ [${a.pmFrom},${a.pmFrom + a.length}): ` +
          `源码 ${JSON.stringify(srcText)} vs PM ${JSON.stringify(pmText)}`,
      );
  }
  return errors;
}
