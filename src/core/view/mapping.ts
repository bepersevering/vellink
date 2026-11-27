/**
 * Bidirectional mapping between sourceOffset and ProseMirror pos.
 *
 * The core difficulty: Markdown marker characters (#, **, `, []() etc.) become node types
 * or marks in PM and don't occupy text content. Therefore:
 * - Visible text regions: offset ↔ pos is strictly linear and one-to-one (must be 100% precise)
 * - Marker regions: there's no corresponding PM cursor position, so snap to the nearest
 *   visible text boundary (must be stable)
 *
 * Strategy: while building IR → PM, record the source span of every text fragment, then walk
 * the PM tree to collect (pmFrom, sourceFrom, length) anchors. Mapping finds the nearest anchor
 * first and interpolates linearly from there.
 */

import { type Node as PMNode } from "prosemirror-model";
import type { BlockNode, DocumentIR, InlineNode, SourceSpan } from "../ir/types";
import { T, M, vellinkSchema } from "./schema";

/** An anchor between a PM text node and its corresponding source fragment. */
export interface TextAnchor {
  /** Start position in the PM document */
  pmFrom: number;
  /** Start offset in the source */
  sourceFrom: number;
  /** Text length in UTF-16 code units, consistent on both sides */
  length: number;
}

/** Build result: a PM document plus bidirectional mapping capability. */
export interface PMView {
  doc: PMNode;
  anchors: readonly TextAnchor[];
}

/** IR inline nodes → an array of PM inline nodes, recording source spans in a WeakMap along the way. */
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
        // value has the backticks stripped, so shrink the span to the content region
        spans.set(node, {
          start: n.span.start + 1,
          end: n.span.end - 1,
        });
        out.push(node);
        break;
      case "strong":
      case "emphasis":
      case "link": {
        // .mark() clones nodes, so transfer the WeakMap key to the new object or the span is lost
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
        // The wikiLink span already includes the outer [[ ]]; PM shows only the target text, so trim 2 chars at each end
        spans.set(node, { start: n.span.start + 2, end: n.span.end - 2 });
        out.push(node);
        break;
      case "image":
        // The atom node maps as a whole to the `![alt](url)` span in the source
        node = T.image.create({
          src: n.url,
          alt: n.alt,
          title: n.title ?? null,
          width: n.width ?? null,
          height: n.height ?? null,
        });
        spans.set(node, n.span);
        out.push(node);
        break;
      case "footnoteRef":
        node = T.footnoteRef.create({ label: n.label });
        spans.set(node, n.span);
        out.push(node);
        break;
      case "inlineMath":
        node = T.inlineMath.create({ value: n.value });
        spans.set(node, n.span);
        out.push(node);
        break;
    }
  }
  return out;
}

/** A single block → PM node. */
function blockToPM(
  node: BlockNode,
  spans: WeakMap<PMNode, SourceSpan>,
  source: string,
): PMNode | null {
  switch (node.type) {
    case "heading":
      return T.heading.create({ level: node.depth }, inlineToPM(node.children, spans));
    case "paragraph":
      // An empty paragraph needs an empty text placeholder, otherwise PM positions collapse
      return T.paragraph.create(null, inlineToPM(node.children, spans));
    case "code": {
      // Mermaid fences become a dedicated atom; the source is still a plain code block
      if ((node.lang ?? "").toLowerCase() === "mermaid") {
        const m = vellinkSchema.nodes.mermaidBlock.create({ code: node.value });
        spans.set(m, node.span);
        return m;
      }
      const t = vellinkSchema.text(node.value);
      // value has the fences stripped; look up the exact content start in source (robust to format variants)
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
        // PM listItem requires its first child to be a paragraph
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
    case "mathBlock":
      return T.mathBlock.create({ value: node.value });
    case "frontmatter":
      return T.frontmatter.create({ value: node.value });
    case "toc":
      return T.toc.create();
    case "footnoteDef":
      return T.footnoteDef.create({ label: node.label, text: node.text });
  }
}

/**
 * Build the PM document plus text anchors from the IR.
 *
 * Note: a code node's value has its fences stripped in markdown.ts, while its source span still
 * includes them, so we look up the content start in the source text here to keep mapping exact.
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

/** Snapping strategy: an offset in a marker region maps to the nearest visible text boundary. */
export function sourceToPM(view: PMView, offset: number): number {
  const { anchors } = view;
  if (!anchors.length) return 1;

  // Exact hit: the offset falls inside a text anchor (half-open; boundary belongs to the next anchor)
  for (const a of anchors) {
    if (offset >= a.sourceFrom && offset < a.sourceFrom + a.length)
      return a.pmFrom + (offset - a.sourceFrom);
  }
  // End-of-document offset === source.length maps to the last anchor's right boundary
  const last = anchors[anchors.length - 1];
  if (offset === last.sourceFrom + last.length) return last.pmFrom + last.length;

  // Marker region: find the nearest anchor boundary (sourceFrom or sourceFrom + length)
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
 * PM pos → source offset.
 *
 * Key point: adjacent text nodes share a boundary pos on the PM side (the end of one equals the
 * start of the next), but that pos corresponds to two different offsets in the source (marker
 * characters vs visible characters). Use ProseMirror cursor semantics — pos means "position
 * before the node", so boundaries are consistently assigned to the following anchor.
 */
export function pmToSource(view: PMView, pos: number): number {
  const { anchors } = view;
  if (!anchors.length) return 0;

  // First pass: prefer anchor starts [pmFrom, pmFrom + length); boundaries belong to the next anchor
  for (const a of anchors) {
    if (pos >= a.pmFrom && pos < a.pmFrom + a.length)
      return a.sourceFrom + (pos - a.pmFrom);
  }
  // Second pass: the very end of the document can only match the last anchor's right boundary
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

/** Diagnostics: check whether text anchors correspond character-for-character to the source. */
export function validateAnchors(view: PMView, source: string): string[] {
  const errors: string[] = [];
  for (const a of view.anchors) {
    const srcText = source.slice(a.sourceFrom, a.sourceFrom + a.length);
    const pmText = view.doc.textBetween(a.pmFrom, a.pmFrom + a.length, "");
    if (srcText !== pmText)
      errors.push(
        `anchor [${a.sourceFrom},${a.sourceFrom + a.length}) ↔ [${a.pmFrom},${a.pmFrom + a.length}): ` +
          `source ${JSON.stringify(srcText)} vs PM ${JSON.stringify(pmText)}`,
      );
  }
  return errors;
}
