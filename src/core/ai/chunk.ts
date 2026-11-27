/**
 * IR 语义切片 — 按标题层级切成可检索的段落。
 *
 * 策略：
 * 1. 每个 heading 开一个新 chunk，标题路径（# / ##）作为元数据；
 * 2. heading 之前的引言单独成 chunk；连续小段落合并到同一 chunk，
 *    超过 maxChars 则切分，避免向量检索时上下文过碎或过长；
 * 3. 代码块保留完整语言标记，表格按行文本化。
 */

import type { BlockNode, DocumentIR, InlineNode } from "../ir/types";

export interface DocChunk {
  id: string;
  /** 标题路径，如 ["架构", "IR"] */
  headings: string[];
  text: string;
  /** 起点在源文档的 offset，便于检索后回跳 */
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

/** 把行内文本渲染为纯文本（标题路径用），去掉 Markdown 装饰。 */
export function plainText(nodes: InlineNode[]): string {
  return inlineText(nodes).replace(/\[\[([^\]]+)\]\]/g, "$1").trim();
}

interface Piece {
  text: string;
  start: number;
  end: number;
}

/** 单个块超过 maxChars 时按句号/换行优先切开，offset 按字符比例回映射。 */
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
      // 在前 60% 之后寻找自然断点，避免把句子拦腰截断
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
