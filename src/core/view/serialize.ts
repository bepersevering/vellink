/**
 * PM → Markdown 反向序列化。
 *
 * 设计原则：
 * 1. 全量序列化：WYSIWYG 每次改动把整棵 PM doc 重新序列化为规范 markdown。
 *    O(n) 但对常见文档足够快；增量 step 反向更新留到性能剖面证明必要时再做。
 * 2. 语义往返：markdown 写法多样，只保证重新解析后 IR 语义等价，不保证字节级相同。
 * 3. 序列化同时产出新锚点（PM pos ↔ 新源码偏移），使光标映射在序列化后立即恢复。
 *
 * pos 来源：不手工推算 PM 位置，而是用 doc.descendants 收集文本节点的真实 pos。
 * 这是 ProseMirror 的权威坐标，避免节点嵌套/leaf/空节点导致的偏移误差。
 */

import type { Mark, Node as PMNode } from "prosemirror-model";
import { M } from "./schema";

/** 序列化后 PM 文本节点 ↔ 新 markdown 偏移的锚点。 */
export interface SerializeAnchor {
  pmFrom: number;
  sourceFrom: number;
  length: number;
}

export interface SerializeResult {
  markdown: string;
  anchors: readonly SerializeAnchor[];
}

/** 输出缓冲区：维护当前 markdown 偏移与行首状态，提供锚点记录。 */
class Writer {
  private parts: string[] = [];
  private pos = 0;
  private atLineStart = true;
  readonly anchors: SerializeAnchor[] = [];
  /** 供 emitText 查 PM 文本节点真实 pos 的映射。 */
  private posOf: (node: PMNode) => number;
  /** 续行前缀：文本内每个换行后自动插入（blockquote 多行需要每行带 >）。 */
  private linePrefix = "";
  /** 刚输出了以空格结尾的前缀，下一个 emit 吞掉一个前导空格（避免 ">  文本"）。 */
  private swallowSpace = false;
  /** 派生子 writer 时共享同一个 posOf（锚点 pmFrom 必须指向真实 PM 坐标）。 */
  private constructor(posOf: (node: PMNode) => number) {
    this.posOf = posOf;
  }

  static create(posOf: (node: PMNode) => number): Writer {
    return new Writer(posOf);
  }

  /** 派生一个共享 posOf 的独立 writer，用于表格单元格内联输出。 */
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

  /** 内部物理写入，不走前缀逻辑（前缀由 emit 统一注入）。 */
  private raw(s: string): void {
    if (!s) return;
    this.parts.push(s);
    this.pos += s.length;
  }

  emit(s: string): void {
    if (!s) return;
    // 前缀自带空格时吞掉文本的第一个前导空格，避免 ">  文本" 双空格
    if (this.swallowSpace) {
      this.swallowSpace = false;
      if (s[0] === " ") s = s.slice(1);
      if (!s) return;
    }
    // 在换行之后插入续行前缀；末尾换行不插（下一个 emit 会触发）
    if (this.linePrefix && this.linePrefix.endsWith(" ")) {
      let out = "";
      for (let i = 0; i < s.length; i++) {
        out += s[i];
        if (s[i] === "\n" && i < s.length - 1) {
          out += this.linePrefix;
          // 吞掉续行文本的前导空格
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

  /** 行首补前缀。 */
  prefix(p: string): void {
    if (this.atLineStart && p) {
      this.raw(p);
      this.swallowSpace = p.endsWith(" ");
    }
  }

  /** 输出 PM 文本节点内容（可能带转义），记录锚点。 */
  emitText(node: PMNode, output: string): void {
    const pmFrom = this.posOf(node);
    const sourceFrom = this.pos;
    this.emit(output);
    // length 用实际写入长度（含续行前缀注入），保证锚点覆盖真实输出区间。
    // 转义区/前缀字符会造成 PM 侧插值轻微偏差，属可接受降级（见文档）。
    this.anchors.push({ pmFrom, sourceFrom, length: this.pos - sourceFrom });
  }

  toString(): string {
    return this.parts.join("");
  }
}

/**
 * 行内转义：保守策略，只转义会真正破坏结构的字符。
 * 正则是全局的，反斜杠优先——避免把已有的转义序列二次转义时顺序错乱。
 */
function escapeInline(text: string): string {
  return text.replace(/([\\*_`])/g, "\\$1");
}

/** 代码块围栏：若内容含更长的反引号串，升级围栏长度避免提前闭合。 */
function fenceFor(value: string): string {
  const runs = value.match(/`{3,}/g);
  const longest = runs ? Math.max(...runs.map((r) => r.length)) : 0;
  return "`".repeat(Math.max(3, longest + 1));
}

/** 判断一组 marks 是否含某类型。 */
const hasMark = (marks: readonly Mark[], type: Mark["type"]) =>
  marks.some((m) => m.type === type);

/** 行内内容 → markdown。按连续相同 mark 分组，避免每个文本片段各包一层。 */
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
        // 与图片同理：atom 没有 textContent，必须从 attrs 还原 `$...$`
        w.emit(`$${String(node.attrs.value ?? "")}$`);
      } else if (node.type.name === "image") {
        // atom 没有 textContent，必须从 attrs 还原，否则任何一次编辑都会把图吞掉
        const src = String(node.attrs.src ?? "");
        const alt = String(node.attrs.alt ?? "").replace(/[\[\]\\]/g, "\\$&");
        const title = node.attrs.title
          ? ` "${String(node.attrs.title).replace(/"/g, '\\"')}"`
          : "";
        w.emit(`![${alt}](${src}${title})`);
      } else if (node.isText) {
        w.emitText(node, code ? node.text ?? "" : escapeInline(node.text ?? ""));
      } else {
        // inline 容器理论上不存在（strong/em 是 mark），兜底不丢字
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

/** 一段块序列 → markdown，块之间空一行。 */
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

/** 单块 → markdown。 */
function blockToMarkdown(node: PMNode, w: Writer, prefix: string): void {
  switch (node.type.name) {
    case "paragraph":
      w.prefix(prefix);
      if (node.content.size > 0) {
        inlineToMarkdown(node, w);
        w.emit("\n");
      } else {
        // 空段落：只保留前缀行，避免块塌陷
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
      // 代码块内容整段作为一个锚点，用第一个文本节点定位 PM pos
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
       * 输出一行表格：逐单元格渲染一次，拿到文本与锚点，按真实写入位置平移锚点。
       * 锚点含 "| " 与 " | " 分隔符的偏移，因此光标映射精确。
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

      // 对齐分隔行
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
 * 把 ProseMirror 文档序列化为规范 markdown，并产出新锚点。
 */
export function serializePM(doc: PMNode): SerializeResult {
  // 一次性收集所有文本节点的真实 PM pos（权威坐标）
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
