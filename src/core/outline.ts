/**
 * Outline and title: derived directly from the IR, no second copy of state.
 *
 * Document title = first H1, falling back to the first heading of any level, then to
 * the first non-empty line. Outline entries take only top-level headings (headings inside
 * lists/quotes are excluded) and carry source offsets, so the editor can implement
 * "click to jump" — jumps go through the source map, so both views can locate the spot.
 */

import type { BlockNode, InlineNode } from "./ir/types";
import { parseMarkdown } from "./parser/markdown";

export interface OutlineEntry {
  /** Heading block ID, stable across incremental parses. */
  id: string;
  label: string;
  /** Normalized to levels 1–3; H6 headings are indented as level 3 in the panel. */
  level: 1 | 2 | 3;
  /** Starting offset of the heading line in the source (UTF-16). */
  offset: number;
  /** True heading depth, used for title selection and debugging. */
  depth: number;
}

/** Concatenate the plain text of inline nodes (drop emphasis/link markup, keep visible text). */
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

/** Top-level headings → outline entries, in order of appearance. */
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

/** Document title: H1 → any heading → first non-empty line → fallback. */
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
