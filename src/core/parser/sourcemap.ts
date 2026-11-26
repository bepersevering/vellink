/**
 * 双向 source map：源码偏移 ↔ IR 节点。
 *
 * 用途：
 * - 光标定位：编辑器 offset → 所在 IR 节点，供命令/插件上下文使用。
 * - AI 改写回跳：AI 改了某节点 → 拿到 span.end → 光标跳回原位。
 * - 增量更新：脏区 offset 范围 → 找出受影响的节点。
 *
 * 约定：offset 为 UTF-16 码元偏移，与 JS string / CodeMirror 一致。
 * span 为 [start, end)，半开区间；边界 offset 归属于开始于该位置的节点。
 */

import {
  walkBlocks,
  walkInline,
  type BlockNode,
  type DocumentIR,
  type InlineNode,
  type SourceSpan,
} from "../ir/types";

/** offset 命中的节点结果，从外到内。 */
export interface NodeAtOffset {
  /** 所在的顶层/嵌套块节点 */
  block: BlockNode;
  /** 所在的行内节点（若在行内标记内部） */
  inline?: InlineNode;
  /** 最具体的节点（inline 优先，否则 block） */
  deepest: BlockNode | InlineNode;
  span: SourceSpan;
}

function contains(span: SourceSpan, offset: number): boolean {
  // [start, end)；文档末尾 offset === length 时归属最后一个节点
  return offset >= span.start && offset < span.end;
}

/**
 * 查找给定 offset 所在的最深 IR 节点。
 * 找不到（offset 越界或落在节点间空隙）返回 undefined。
 */
export function nodeAtOffset(
  ir: DocumentIR,
  offset: number,
): NodeAtOffset | undefined {
  let hit: NodeAtOffset | undefined;

  const visitBlock = (block: BlockNode): boolean => {
    if (!contains(block.span, offset)) return false;

    // 容器块：先递归子节点，命中更深节点则停止
    if (block.type === "blockquote") {
      for (const child of block.children) if (visitBlock(child)) return true;
    } else if (block.type === "list") {
      for (const item of block.children)
        for (const child of item.children) if (visitBlock(child)) return true;
    } else if (block.type !== "code" && block.type !== "thematicBreak") {
      // 找光标所在的语义行内节点：标记层级最深的非 text 节点。
      // 排除 text 是因为纯文本片段永远比它的 strong/emphasis 父节点更窄，
      // 但调用方（命令、AI 上下文、光标回跳）关心的是"光标在粗体里"，不是"在某个字符串里"。
      let deepestInline: InlineNode | undefined;
      const visitInline = (n: InlineNode) => {
        if (n.type === "text" || !contains(n.span, offset)) return;
        if (
          !deepestInline ||
          n.span.end - n.span.start <=
            deepestInline.span.end - deepestInline.span.start
        )
          deepestInline = n;
      };
      walkInline(block, visitInline);
      if (deepestInline) {
        hit = {
          block,
          inline: deepestInline,
          deepest: deepestInline,
          span: deepestInline.span,
        };
        return true;
      }
    }

    hit = { block, deepest: block, span: block.span };
    return true;
  };

  for (const block of ir.children) if (visitBlock(block)) break;
  return hit;
}

/** 查找给定 id 的块节点及其 span。 */
export function blockById(
  ir: DocumentIR,
  id: string,
): { node: BlockNode; span: SourceSpan } | undefined {
  let found: BlockNode | undefined;
  walkBlocks(ir.children, (n) => {
    if (n.id === id) found = n;
  });
  return found ? { node: found, span: found.span } : undefined;
}

/** 查找给定 id 的任意节点（块或行内）及其 span。 */
export function nodeById(
  ir: DocumentIR,
  id: string,
): { node: BlockNode | InlineNode; span: SourceSpan } | undefined {
  const block = blockById(ir, id);
  if (block) return block;

  for (const top of ir.children) {
    let found: InlineNode | undefined;
    walkInline(top, (n) => {
      if (n.id === id) found = n;
    });
    if (found) return { node: found, span: found.span };
  }
  return undefined;
}

/**
 * 找出与 [from, to) 脏区相交的所有块节点。
 * 用于增量解析后定位需要重绘的视图区域。
 */
export function blocksInRange(
  ir: DocumentIR,
  from: number,
  to: number,
): BlockNode[] {
  const out: BlockNode[] = [];
  const intersects = (s: SourceSpan) => s.start < to && s.end > from;
  walkBlocks(ir.children, (n) => {
    if (intersects(n.span)) out.push(n);
  });
  return out;
}

/**
 * 光标偏移在编辑后的平移：AI 或插件改了 [from, to) → [from, to+inserted)，
 * 计算原光标 offset 的新位置。用于"AI 改写后光标跟着走"。
 */
export function shiftOffset(
  offset: number,
  edit: { from: number; to: number; inserted: number },
): number {
  const delta = edit.inserted - (edit.to - edit.from);
  if (offset <= edit.from) return offset;
  if (offset >= edit.to) return offset + delta;
  // 光标落在被替换区间内部：移到替换后区间末尾
  return edit.from + edit.inserted;
}

/** 校验 IR 中所有 span 是否落在源文本范围内（诊断工具）。 */
export function validateSpans(ir: DocumentIR): string[] {
  const errors: string[] = [];
  const check = (span: SourceSpan, label: string) => {
    if (span.start < 0 || span.end > ir.source.length || span.start >= span.end) {
      errors.push(`${label}: span [${span.start},${span.end}) 越界 (源长 ${ir.source.length})`);
    }
  };
  walkBlocks(ir.children, (b) => {
    check(b.span, `block ${b.type}#${b.id}`);
    if (b.type !== "code" && b.type !== "thematicBreak")
      walkInline(b, (i) => check(i.span, `inline ${i.type}#${i.id}`));
  });
  return errors;
}
