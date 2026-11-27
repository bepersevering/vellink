/**
 * IR semantic chunking — split by heading level into searchable passages.
 *
 * Strategy:
 * 1. Each heading starts a new chunk, with the heading path (# / ##) as metadata;
 * 2. Text before the first heading becomes its own chunk; consecutive short paragraphs are
 *    merged into one chunk and split when they exceed maxChars, so vector search contexts are
 *    neither too fragmented nor too long;
 * 3. Code blocks keep their full language tag; tables are linearized row by row.
 */

import type { BlockNode, DocumentIR, InlineNode } from "../ir/types";

export interface DocChunk {
  id: string;
  /** Heading path, e.g. ["Architecture", "IR"] */
  headings: string[];
  text: string;
  /** Offset in the source document, for jumping back after a search */
  start: number;
  end: number;
}

function inlineText(nodes: InlineNode[]): string {
  return nodes
    .map((node) => {
      switch (node.type) {
        case "text":
        case "inlineCode":
          return node.value;
        case "wikiLink":
          return `[[${node.target}]]`;
        case "inlineMath":
          return `$${node.value}$`;
        case "footnoteRef":
          return `[^${node.label}]`;
        case "image":
          return `![${node.alt}](${node.url})`;
        case "link":
          return `${inlineText(node.children)}(${node.url})`;
        default:
          return inlineText(node.children);
      }
    })
    .join("");
}

function blockText(node: BlockNode): string {
  switch (node.type) {
    case "heading":
      return `${"#".repeat(node.depth)} ${inlineText(node.children)}`;
    case "paragraph":
      return inlineText(node.children);
    case "code":
      return `\`\`\`${node.lang ?? ""}\n${node.value}\n\`\`\``;
    case "mathBlock":
      return `$$${node.value}$$`;
    case "frontmatter":
      return `---\n${node.value}\n---`;
    case "toc":
      return "[TOC]";
    case "footnoteDef":
      return `[^${node.label}]: ${node.text}`;
    case "blockquote":
      return node.children.map(blockText).join("\n");
    case "list":
      return node.children
        .map((item) =>
          item.children
            .map(blockText)
            .map((line, i) => `${i === 0 ? `- ${item.checked === true ? "[x] " : item.checked === false ? "[ ] " : ""}` : "  "}${line}`)
            .join("\n"),
        )
        .join("\n");
    case "table":
      return node.children
        .map((row) => `| ${row.children.map((cell) => inlineText(cell.children)).join(" | ")} |`)
        .join("\n");
    case "thematicBreak":
      return "---";
  }
}

/** Render inline nodes as plain text (for heading paths), stripping Markdown decorations. */
export function plainText(nodes: InlineNode[]): string {
  return inlineText(nodes).replace(/\[\[([^\]]+)\]\]/g, "$1").trim();
}

interface Piece {
  text: string;
  start: number;
  end: number;
}

/** When a single block exceeds maxChars, prefer sentence/newline breaks and remap offsets proportionally. */
function splitPiece(node: BlockNode, maxChars: number): Piece[] {
  const text = blockText(node);
  const spanLength = Math.max(1, node.span.end - node.span.start);
  const offsetAt = (index: number) =>
    node.span.start + Math.round((index / Math.max(1, text.length)) * spanLength);
  if (text.length <= maxChars) return [{ text, start: node.span.start, end: node.span.end }];

  const pieces: Piece[] = [];
  let cursor = 0;
  while (cursor < text.length) {
    let stop = Math.min(cursor + maxChars, text.length);
    if (stop < text.length) {
      // Look for a natural break after the first 60% to avoid cutting a sentence in half
      const lower = cursor + Math.floor(maxChars * 0.6);
      for (let i = stop; i >= lower; i--) {
        if (text[i - 1] === "\n" || /[。！？；.!?;]/.test(text[i - 1])) {
          stop = i;
          break;
        }
      }
    }
    const segment = text.slice(cursor, stop).trim();
    if (segment) pieces.push({ text: segment, start: offsetAt(cursor), end: offsetAt(stop) });
    cursor = stop;
  }
  return pieces;
}

export function chunkDocument(ir: DocumentIR, maxChars = 1200): DocChunk[] {
  const chunks: DocChunk[] = [];
  const headings: string[] = [];
  let buffer: Piece[] = [];

  const flush = () => {
    if (!buffer.length) return;
    const text = buffer.map((piece) => piece.text).join("\n\n").trim();
    if (text)
      chunks.push({
        id: `chunk-${chunks.length}`,
        headings: [...headings],
        text,
        start: buffer[0].start,
        end: buffer[buffer.length - 1].end,
      });
    buffer = [];
  };

  const bufferedLength = () => buffer.reduce((sum, piece) => sum + piece.text.length, 0);

  for (const node of ir.children) {
    if (node.type === "heading") {
      flush();
      while (headings.length >= node.depth) headings.pop();
      headings.push(plainText(node.children));
      buffer.push({ text: blockText(node), start: node.span.start, end: node.span.end });
      continue;
    }

    for (const piece of splitPiece(node, maxChars)) {
      if (buffer.length && bufferedLength() + piece.text.length > maxChars) flush();
      buffer.push(piece);
    }
  }
  flush();
  return chunks;
}
