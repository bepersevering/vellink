/**
 * PM → Markdown reverse serialization.
 *
 * Design principles:
 * 1. Full serialization: on every WYSIWYG change, re-serialize the entire PM doc into
 *    canonical markdown. O(n), but fast enough for typical documents; incremental step
 *    reverse-updates can wait until a performance profile shows they're needed.
 * 2. Semantic round-trip: markdown has many spellings, so we only guarantee the IR is
 *    semantically equivalent after re-parsing, not byte-for-byte identical.
 * 3. Serialization also produces fresh anchors (PM pos ↔ new source offsets), so cursor
 *    mapping is restored immediately after serialization.
 *
 * Source of pos: rather than compute PM positions by hand, collect the real positions of
 * text nodes with doc.descendants. These are ProseMirror's authoritative coordinates and
 * avoid offset errors caused by nested / leaf / empty nodes.
 */

import type { Mark, Node as PMNode } from "prosemirror-model";
import { M } from "./schema";

/** Anchor mapping a PM text node ↔ its new markdown offset after serialization. */
export interface SerializeAnchor {
  pmFrom: number;
  sourceFrom: number;
  length: number;
}

export interface SerializeResult {
  markdown: string;
  anchors: readonly SerializeAnchor[];
}

/** Output buffer: tracks the current markdown offset and line-start state, and records anchors. */
class Writer {
  private parts: string[] = [];
  private pos = 0;
  private atLineStart = true;
  readonly anchors: SerializeAnchor[] = [];
  /** Map used by emitText to look up the real pos of a PM text node. */
  private posOf: (node: PMNode) => number;
  /** Continuation prefix inserted after every newline within text (multi-line blockquotes need > on each line). */
  private linePrefix = "";
  /** A prefix ending in a space was just emitted; the next emit swallows one leading space (avoid ">  text"). */
  private swallowSpace = false;
  /** Derived child writers share the same posOf (an anchor's pmFrom must point to a real PM coordinate). */
  private constructor(posOf: (node: PMNode) => number) {
    this.posOf = posOf;
  }

  static create(posOf: (node: PMNode) => number): Writer {
    return new Writer(posOf);
  }

  /** Derive an independent writer sharing the same posOf, used for inline output in table cells. */
  child(): Writer {
    return new Writer(this.posOf);
  }

  get offset() {
    return this.pos;
  }
  get lineStart() {
    return this.atLineStart;
  }

  setLinePrefix(p: string): void {
    this.linePrefix = p;
  }

  /** Internal physical write, bypassing prefix logic (prefixes are injected uniformly by emit). */
  private raw(s: string): void {
    if (!s) return;
    this.parts.push(s);
    this.pos += s.length;
  }

  emit(s: string): void {
    if (!s) return;
    // When the prefix already ends in a space, swallow the text's first leading space to avoid ">  text" double spacing
    if (this.swallowSpace) {
      this.swallowSpace = false;
      if (s[0] === " ") s = s.slice(1);
      if (!s) return;
    }
    // Insert the continuation prefix after newlines; don't insert after a trailing newline
    // (the next emit will trigger it)
    if (this.linePrefix && this.linePrefix.endsWith(" ")) {
      let out = "";
      for (let i = 0; i < s.length; i++) {
        out += s[i];
        if (s[i] === "\n" && i < s.length - 1) {
          out += this.linePrefix;
          // Swallow the continuation text's leading space
          if (s[i + 1] === " ") i++;
          else this.swallowSpace = false;
        }
      }
      s = out;
    } else if (this.linePrefix) {
      let out = "";
      for (let i = 0; i < s.length; i++) {
        out += s[i];
        if (s[i] === "\n" && i < s.length - 1) out += this.linePrefix;
      }
      s = out;
    }
    this.raw(s);
    this.atLineStart = s.endsWith("\n");
  }

  /** Add the prefix at line start. */
  prefix(p: string): void {
    if (this.atLineStart && p) {
      this.raw(p);
      this.swallowSpace = p.endsWith(" ");
    }
  }

  /** Emit a PM text node's content (possibly escaped) and record an anchor. */
  emitText(node: PMNode, output: string): void {
    const pmFrom = this.posOf(node);
    const sourceFrom = this.pos;
    this.emit(output);
    // Use the actually written length (including injected continuation prefixes) so the
    // anchor covers the real output range. Escaped regions / prefix characters cause slight
    // PM-side interpolation drift, an acceptable degradation (see docs).
    this.anchors.push({ pmFrom, sourceFrom, length: this.pos - sourceFrom });
  }

  toString(): string {
    return this.parts.join("");
  }
}

/**
 * Inline escaping: a conservative strategy, escaping only characters that would actually
 * break the structure. The regex is global and backslashes come first — this avoids
 * mixed-up ordering when double-escaping existing escape sequences.
 */
function escapeInline(text: string): string {
  return text.replace(/([\\*_`])/g, "\\$1");
}

/** Code fence: if the content contains a longer backtick run, lengthen the fence to avoid premature closing. */
function fenceFor(value: string): string {
  const runs = value.match(/`{3,}/g);
  const longest = runs ? Math.max(...runs.map((r) => r.length)) : 0;
  return "`".repeat(Math.max(3, longest + 1));
}

/** Whether a set of marks contains a given type. */
const hasMark = (marks: readonly Mark[], type: Mark["type"]) =>
  marks.some((m) => m.type === type);

/** Inline content → markdown. Group consecutive identical marks to avoid wrapping every text fragment separately. */
function inlineToMarkdown(parent: PMNode, w: Writer): void {
  interface Span {
    nodes: PMNode[];
    marks: readonly Mark[];
    key: string;
  }
  const spans: Span[] = [];

  parent.forEach((node) => {
    const key =
      node.type.name +
      "|" +
      node.marks.map((m) => `${m.type.name}:${JSON.stringify(m.attrs)}`).join(",");
    const last = spans[spans.length - 1];
    if (last && last.key === key) last.nodes.push(node);
    else spans.push({ nodes: [node], marks: node.marks, key });
  });

  for (const span of spans) {
    const strong = hasMark(span.marks, M.strong);
    const em = hasMark(span.marks, M.em);
    const code = hasMark(span.marks, M.code);
    const link = span.marks.find((m) => m.type === M.link);
    const wiki = span.marks.find((m) => m.type === M.wikiLink);

    if (wiki) w.emit("[[");
    else if (link) w.emit("[");
    if (strong) w.emit("**");
    if (em) w.emit("*");
    if (code) w.emit("`");

    for (const node of span.nodes) {
      if (node.type.name === "hardBreak") {
        w.emit("  \n");
      } else if (node.type.name === "footnoteRef") {
        w.emit(`[^${String(node.attrs.label ?? "")}]`);
      } else if (node.type.name === "inlineMath") {
        // Same as images: an atom has no textContent, so reconstruct `$...$` from attrs
        w.emit(`$${String(node.attrs.value ?? "")}$`);
      } else if (node.type.name === "image") {
        // An atom has no textContent, so reconstruct from attrs or any edit will swallow the image
        const src = String(node.attrs.src ?? "");
        const alt = String(node.attrs.alt ?? "").replace(/[\[\]\\]/g, "\\$&");
        const title = node.attrs.title
          ? ` "${String(node.attrs.title).replace(/"/g, '\\"')}"`
          : "";
        const size = node.attrs.width
          ? ` =${String(node.attrs.width)}x${String(node.attrs.height ?? "")}`
          : "";
        w.emit(`![${alt}](${src}${size}${title})`);
      } else if (node.isText) {
        w.emitText(node, code ? node.text ?? "" : escapeInline(node.text ?? ""));
      } else {
        // Inline containers shouldn't exist in theory (strong/em are marks); fall back so no text is lost
        w.emit(escapeInline(node.textContent));
      }
    }

    if (code) w.emit("`");
    if (em) w.emit("*");
    if (strong) w.emit("**");
    if (wiki) w.emit("]]");
    else if (link) {
      const href = String(link.attrs.href ?? "");
      const title = link.attrs.title
        ? ` "${String(link.attrs.title).replace(/"/g, '\\"')}"`
        : "";
      w.emit(`](${href}${title})`);
    }
  }
}

/** A sequence of blocks → markdown, with a blank line between blocks. */
function blocksToMarkdown(
  blocks: readonly PMNode[],
  w: Writer,
  prefix: string,
): void {
  blocks.forEach((block, i) => {
    if (i > 0) w.emit(prefix.trimEnd() + "\n");
    blockToMarkdown(block, w, prefix);
  });
}

/** Single block → markdown. */
function blockToMarkdown(node: PMNode, w: Writer, prefix: string): void {
  switch (node.type.name) {
    case "paragraph":
      w.prefix(prefix);
      if (node.content.size > 0) {
        inlineToMarkdown(node, w);
        w.emit("\n");
      } else {
        // Empty paragraph: keep only the prefix line to avoid block collapse
        if (prefix) w.emit("\n");
      }
      break;

    case "heading":
      w.prefix(prefix);
      w.emit("#".repeat(Number(node.attrs.level) || 1) + " ");
      inlineToMarkdown(node, w);
      w.emit("\n");
      break;

    case "mermaidBlock": {
      w.prefix(prefix);
      w.emit("```mermaid\n");
      w.emit(String(node.attrs.code ?? ""));
      w.emit("\n```\n");
      break;
    }
    case "codeBlock": {
      w.prefix(prefix);
      const value = node.textContent;
      const fence = fenceFor(value);
      const lang = node.attrs.lang ? String(node.attrs.lang) : "";
      w.emit(`${fence}${lang}\n`);
      // The whole code block body is one anchor, located via its first text node's PM pos
      const textNode = node.firstChild;
      if (textNode && textNode.isText) w.emitText(textNode, value);
      else w.emit(value);
      if (value && !value.endsWith("\n")) w.emit("\n");
      w.emit(`${fence}\n`);
      break;
    }

    case "horizontalRule":
      w.prefix(prefix);
      w.emit("---\n");
      break;

    case "mathBlock":
      w.prefix(prefix);
      w.emit(`$$${String(node.attrs.value ?? "")}$$\n`);
      break;
    case "frontmatter": {
      w.prefix(prefix);
      const yaml = String(node.attrs.value ?? "");
      w.emit(`---\n${yaml}${yaml.endsWith("\n") ? "" : "\n"}---\n`);
      break;
    }
    case "toc":
      w.prefix(prefix);
      w.emit("[TOC]\n");
      break;
    case "footnoteDef":
      w.prefix(prefix);
      w.emit(`[^${String(node.attrs.label ?? "")}]: ${String(node.attrs.text ?? "")}\n`);
      break;

    case "blockquote": {
      const quotePrefix = prefix + "> ";
      w.setLinePrefix(quotePrefix);
      const children: PMNode[] = [];
      node.forEach((c) => children.push(c));
      blocksToMarkdown(children, w, quotePrefix);
      w.setLinePrefix("");
      break;
    }

    case "bulletList":
    case "orderedList": {
      const ordered = node.type.name === "orderedList";
      const start = ordered ? Number(node.attrs.start) || 1 : 1;
      let idx = 0;
      node.forEach((item) => {
        const marker = ordered ? `${start + idx}. ` : "- ";
        const checked = item.attrs.checked;
        const task =
          checked === null || checked === undefined ? "" : checked ? "[x] " : "[ ] ";
        const firstPrefix = prefix + marker + task;
        const restPrefix = prefix + " ".repeat(marker.length + task.length);

        const blocks: PMNode[] = [];
        item.forEach((c) => blocks.push(c));
        blocks.forEach((block, i) => {
          if (i > 0) w.emit(restPrefix.trimEnd() + "\n");
          blockToMarkdown(block, w, i === 0 ? firstPrefix : restPrefix);
        });
        idx++;
      });
      break;
    }

    case "listItem": {
      const blocks: PMNode[] = [];
      node.forEach((c) => blocks.push(c));
      blocksToMarkdown(blocks, w, prefix);
      break;
    }

    case "table": {
      const align = (node.attrs.align ?? []) as Array<
        "left" | "center" | "right" | null
      >;
      const rows: PMNode[] = [];
      node.forEach((row) => rows.push(row));
      if (!rows.length) break;

      /**
       * Emit one table row: render each cell once, get its text and anchors, then shift
       * the anchors by the actual write position. Anchors include the offsets of the
       * "| " and " | " delimiters, so cursor mapping is precise.
       */
      const emitTableRow = (row: PMNode): string[] => {
        const texts: string[] = [];
        w.prefix(prefix);
        w.emit("| ");
        let idx = 0;
        row.forEach((cell) => {
          const tmp = w.child();
          inlineToMarkdown(cell, tmp);
          const base = w.offset;
          for (const a of tmp.anchors)
            w.anchors.push({ ...a, sourceFrom: base + a.sourceFrom });
          const text = tmp.toString();
          texts.push(text);
          w.emit(text);
          if (idx < row.childCount - 1) w.emit(" | ");
          idx++;
        });
        w.emit(" |\n");
        return texts;
      };

      const header = emitTableRow(rows[0]);

      // Alignment delimiter row
      w.prefix(prefix);
      const delim = header.map((_, i) => {
        const a = align[i];
        if (a === "left") return ":---";
        if (a === "center") return ":---:";
        if (a === "right") return "---:";
        return "---";
      });
      w.emit("| " + delim.join(" | ") + " |\n");

      rows.slice(1).forEach(emitTableRow);
      break;
    }

    default:
      w.prefix(prefix);
      w.emit(escapeInline(node.textContent) + "\n");
  }
}

/**
 * Serialize a ProseMirror document to canonical markdown and produce fresh anchors.
 */
export function serializePM(doc: PMNode): SerializeResult {
  // Collect the real PM positions of all text nodes in one pass (authoritative coordinates)
  const posMap = new Map<PMNode, number>();
  doc.descendants((node, pos) => {
    if (node.isText) posMap.set(node, pos);
  });
  const w = Writer.create((node) => posMap.get(node) ?? 0);

  const blocks: PMNode[] = [];
  doc.forEach((block) => blocks.push(block));
  blocksToMarkdown(blocks, w, "");

  let markdown = w.toString();
  if (markdown && !markdown.endsWith("\n")) markdown += "\n";

  return { markdown, anchors: w.anchors };
}
