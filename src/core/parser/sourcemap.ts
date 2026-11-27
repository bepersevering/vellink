/**
 * Bidirectional source map: source offsets ↔ IR nodes.
 *
 * Uses:
 * - Cursor location: editor offset → containing IR node, for command/plugin context.
 * - AI rewrite jump-back: AI changed a node → take span.end → cursor jumps back to its original position.
 * - Incremental updates: dirty-region offset range → find affected nodes.
 *
 * Convention: offsets are UTF-16 code unit offsets, consistent with JS strings / CodeMirror.
 * Spans are [start, end), half-open; a boundary offset belongs to the node starting at that position.
 */

import {
  walkBlocks,
  walkInline,
  type BlockNode,
  type DocumentIR,
  type InlineNode,
  type SourceSpan,
} from "../ir/types";

/** Result node hit by an offset, from outermost to innermost. */
export interface NodeAtOffset {
  /** The containing top-level/nested block node */
  block: BlockNode;
  /** The containing inline node (if inside inline markup) */
  inline?: InlineNode;
  /** The most specific node (inline preferred, otherwise block) */
  deepest: BlockNode | InlineNode;
  span: SourceSpan;
}

function contains(span: SourceSpan, offset: number): boolean {
  // [start, end); an end-of-document offset === length belongs to the last node
  return offset >= span.start && offset < span.end;
}

/**
 * Find the deepest IR node at the given offset.
 * Returns undefined if not found (offset out of range or in a gap between nodes).
 */
export function nodeAtOffset(
  ir: DocumentIR,
  offset: number,
): NodeAtOffset | undefined {
  let hit: NodeAtOffset | undefined;

  const visitBlock = (block: BlockNode): boolean => {
    if (!contains(block.span, offset)) return false;

    // Container block: recurse into children first; stop if a deeper node is hit
    if (block.type === "blockquote") {
      for (const child of block.children) if (visitBlock(child)) return true;
    } else if (block.type === "list") {
      for (const item of block.children)
        for (const child of item.children) if (visitBlock(child)) return true;
    } else if (block.type !== "code" && block.type !== "thematicBreak") {
      // Find the semantic inline node at the cursor: the deepest non-text node.
      // Text is excluded because a plain text span is always narrower than its strong/emphasis parent,
      // while callers (commands, AI context, cursor jump-back) care that "the cursor is in bold", not "in some string".
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

/** Find the block node with the given id and its span. */
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

/** Find any node (block or inline) with the given id and its span. */
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
 * Find all block nodes intersecting the dirty region [from, to).
 * Used after incremental parsing to locate view regions that need repainting.
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
 * Shift a cursor offset after an edit: AI or a plugin changed [from, to) → [from, to+inserted),
 * compute the new position of the original cursor offset. Used to keep the cursor following an "AI rewrite".
 */
export function shiftOffset(
  offset: number,
  edit: { from: number; to: number; inserted: number },
): number {
  const delta = edit.inserted - (edit.to - edit.from);
  if (offset <= edit.from) return offset;
  if (offset >= edit.to) return offset + delta;
  // Cursor inside the replaced range: move to the end of the replacement
  return edit.from + edit.inserted;
}

/** Validate that all spans in the IR fall within the source text (diagnostic tool). */
export function validateSpans(ir: DocumentIR): string[] {
  const errors: string[] = [];
  const check = (span: SourceSpan, label: string) => {
    if (span.start < 0 || span.end > ir.source.length || span.start >= span.end) {
      errors.push(`${label}: span [${span.start},${span.end}) out of bounds (source length ${ir.source.length})`);
    }
  };
  walkBlocks(ir.children, (b) => {
    check(b.span, `block ${b.type}#${b.id}`);
    if (b.type !== "code" && b.type !== "thematicBreak")
      walkInline(b, (i) => check(i.span, `inline ${i.type}#${i.id}`));
  });
  return errors;
}
