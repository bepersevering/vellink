/**
 * Markdown → DocumentIR 增量解析器。
 *
 * 技术决策（M1 探针实证，2026-11-26）：
 * - 选 @lezer/markdown 而非 tree-sitter：CodeMirror 6 原生用 Lezer，双视图同步时
 *   不会有两套 parser / 两棵语法树 / 两套 source map。且 tree-sitter-markdown npm 包
 *   只有 C 源码无 WASM，本机无 emscripten，硬走要引入额外工具链。
 * - 增量探针数据：3390 字文本改 1 字，全量 10-160ms，增量 1.5-2ms。
 * - 关键约束：增量解析后 Lezer 子树对象引用 **不复用**，所以 IR 节点 ID 必须靠
 *   结构指纹复用，不能靠对象身份。
 */

import { parser as lezerParser, GFM } from "@lezer/markdown";
import { TreeFragment, type SyntaxNode } from "@lezer/common";
import type {
  BlockNode,
  DocumentIR,
  InlineNode,
  SourceSpan,
} from "../ir/types";

/** 开启 GFM：表格 / 任务列表 / 删除线 / 自动链接。注意 GFM 本身是数组，直接传入。 */
export const mdParser = lezerParser.configure(GFM);

/** 编辑描述，与 Lezer 的 Change 结构同构（自己定义避免依赖其内部类型导出）。 */
export interface Change {
  fromA: number;
  toA: number;
  fromB: number;
  toB: number;
}

export interface ParseInput {
  source: string;
  /** 上次解析产出的片段，传入即启用增量解析；不传则全量。 */
  fragments?: readonly TreeFragment[];
  /** 相对上次 source 的编辑列表，与 fragments 配套。 */
  changes?: readonly Change[];
  /** 上一次的 IR，用于复用未变节点 ID。 */
  previous?: DocumentIR;
}

export interface ParseResult {
  ir: DocumentIR;
  /** 保存下来供下次增量解析使用。 */
  fragments: readonly TreeFragment[];
}

/* --------------------------- 稳定 ID 生成 --------------------------- */

/** FNV-1a 32 位哈希，用于结构指纹。纯函数、无依赖。 */
function hash(str: string): string {
  let h = 0x811c9dc5;
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return (h >>> 0).toString(36);
}

/**
 * 节点结构指纹：类型 + 自身内容 + 子节点指纹摘要。
 * 不包含绝对 span，因此插入文本导致后续节点偏移平移时，未变节点指纹保持不变。
 */
function fingerprint(
  type: string,
  own: string,
  children: readonly string[] = [],
): string {
  return `${type}:${hash(own + "|" + children.join(","))}`;
}

/** 从旧 IR 收集 指纹 → 可用 ID 队列。 */
function collectOldIds(ir: DocumentIR | undefined): Map<string, string[]> {
  const map = new Map<string, string[]>();
  if (!ir) return map;
  const add = (fp: string, id: string) => {
    const q = map.get(fp);
    if (q) q.push(id);
    else map.set(fp, [id]);
  };
  const inlineFp = (n: InlineNode): string => {
    const kids = "children" in n ? n.children.map(inlineFp) : [];
    switch (n.type) {
      case "text":
      case "inlineCode":
        return fingerprint(n.type, n.value);
      case "wikiLink":
        return fingerprint(n.type, n.target);
      case "image":
        return fingerprint(n.type, n.url + n.alt);
      case "link":
        return fingerprint(n.type, n.url + (n.title ?? ""), kids);
      default:
        return fingerprint(n.type, "", kids);
    }
  };
  const blockFp = (n: BlockNode): string => {
    const kids: string[] = [];
    if ("children" in n) {
      if (n.type === "table") {
        for (const row of n.children)
          for (const cell of row.children) kids.push(...cell.children.map(inlineFp));
      } else if (n.type === "list") {
        for (const item of n.children)
          for (const child of item.children) kids.push(blockFp(child));
      } else {
        for (const child of n.children) {
          kids.push(
            isBlock(child) ? blockFp(child) : inlineFp(child as InlineNode),
          );
        }
      }
    }
    switch (n.type) {
      case "code":
        return fingerprint(n.type, (n.lang ?? "") + n.value);
      case "thematicBreak":
        return fingerprint(n.type, "");
      case "heading":
        return fingerprint(n.type, String(n.depth), kids);
      case "table":
        return fingerprint(n.type, n.align.join(","), kids);
      case "list":
        return fingerprint(n.type, String(n.ordered) + (n.start ?? ""), kids);
      default:
        return fingerprint(n.type, "", kids);
    }
  };
  for (const b of ir.children) add(blockFp(b), b.id);
  return map;
}

function isBlock(n: BlockNode | InlineNode): n is BlockNode {
  return (
    n.type === "paragraph" ||
    n.type === "heading" ||
    n.type === "code" ||
    n.type === "blockquote" ||
    n.type === "list" ||
    n.type === "table" ||
    n.type === "thematicBreak"
  );
}

/** ID 分配器：优先复用旧 ID，否则生成新的确定性 ID。 */
class IdAllocator {
  private seq = 0;
  constructor(private readonly oldIds: Map<string, string[]>) {}

  next(fp: string): string {
    const queue = this.oldIds.get(fp);
    if (queue && queue.length) return queue.shift()!;
    return `n-${hash(fp)}-${this.seq++}`;
  }
}

/* --------------------------- 语法树 → IR --------------------------- */

/** 读取节点的源文本切片。 */
function textOf(node: SyntaxNode, source: string): string {
  return source.slice(node.from, node.to);
}

/** 取某节点的直接子节点。 */
function childrenOf(node: SyntaxNode): SyntaxNode[] {
  const out: SyntaxNode[] = [];
  for (let c = node.firstChild; c; c = c.nextSibling) out.push(c);
  return out;
}

/** 该语法节点是否只是标记符号（不作为 IR 内容节点）。 */
function isMark(name: string): boolean {
  return (
    name === "HeaderMark" ||
    name === "QuoteMark" ||
    name === "ListMark" ||
    name === "EmphasisMark" ||
    name === "CodeMark" ||
    name === "LinkMark" ||
    name === "TaskMarker" ||
    name === "TableDelimiter"
  );
}

/**
 * 解析行内节点。Lezer 中普通文本不是独立节点，而是标记节点之间的"空隙"，
 * 因此按子节点边界切出文本片段，生成 TextNode。
 */
function parseInline(
  parent: SyntaxNode,
  source: string,
  ids: IdAllocator,
): InlineNode[] {
  const out: InlineNode[] = [];
  let cursor = parent.from;

  const pushText = (from: number, to: number) => {
    if (to <= from) return;
    const value = source.slice(from, to);
    out.push({ type: "text", id: ids.next(fingerprint("text", value)), span: { start: from, end: to }, value });
  };

  for (const child of childrenOf(parent)) {
    // [[双链]]：Lezer 的内层 Link 不含外层方括号，这里一并吞掉，
    // 避免外层 [ ] 被当成普通文本重复输出。
    const isWiki =
      child.name === "Link" &&
      source[child.from - 1] === "[" &&
      source[child.to] === "]" &&
      !childrenOf(child).some((c) => c.name === "URL");

    const textEnd = isWiki ? child.from - 1 : child.from;
    const advanceTo = isWiki ? child.to + 1 : child.to;

    if (isMark(child.name)) {
      pushText(cursor, child.from);
      cursor = child.to;
      continue;
    }
    pushText(cursor, textEnd);
    const node = mapInline(child, source, ids);
    if (node) out.push(node);
    cursor = advanceTo;
  }
  pushText(cursor, parent.to);
  return out;
}

function mapInline(node: SyntaxNode, source: string, ids: IdAllocator): InlineNode | null {
  const span: SourceSpan = { start: node.from, end: node.to };
  const name = node.name;

  if (name === "StrongEmphasis" || name === "Emphasis" || name === "Strikethrough") {
    const type = name === "StrongEmphasis" ? "strong" : "emphasis";
    const kids = parseInline(node, source, ids);
    return {
      type,
      id: ids.next(fingerprint(type, "", kids.map((k) => k.id))),
      span,
      children: kids,
    } as InlineNode;
  }

  if (name === "InlineCode") {
    const raw = textOf(node, source);
    let value = raw;
    if (raw.startsWith("`") && raw.endsWith("`")) value = raw.slice(1, -1);
    return { type: "inlineCode", id: ids.next(fingerprint("inlineCode", value)), span, value };
  }

  if (name === "Link" || name === "Image") {
    const kids = childrenOf(node);
    const urlNode = kids.find((c) => c.name === "URL");
    const raw = textOf(node, source);

    // [[双链]]：Lezer 只把内层 [双链] 当 Link（外层括号是纯文本），
    // 因此检查节点前后各一个字符是否构成额外的 [[ ]]。
    if (
      name === "Link" &&
      !urlNode &&
      source[node.from - 1] === "[" &&
      source[node.to] === "]"
    ) {
      const target = raw.slice(1, -1);
      const wikiSpan: SourceSpan = { start: node.from - 1, end: node.to + 1 };
      return {
        type: "wikiLink",
        id: ids.next(fingerprint("wikiLink", target)),
        span: wikiSpan,
        target,
      };
    }
    if (name === "Image") {
      const altNode = kids.find((c) => c.name === "LinkMark");
      void altNode;
      const alt = raw.match(/^!\[([^\]]*)\]/)?.[1] ?? "";
      const url = urlNode ? textOf(urlNode, source) : "";
      return { type: "image", id: ids.next(fingerprint("image", url + alt)), span, url, alt };
    }
    const url = urlNode ? textOf(urlNode, source) : "";
    const children = parseInline(node, source, ids);
    const title = raw.match(/"([^"]*)"\s*\)$/)?.[1];
    return {
      type: "link",
      id: ids.next(fingerprint("link", url + (title ?? ""), children.map((c) => c.id))),
      span,
      url,
      ...(title ? { title } : {}),
      children,
    };
  }

  if (name === "Autolink") {
    const value = textOf(node, source).replace(/^<|>$/g, "");
    return { type: "link", id: ids.next(fingerprint("link", value)), span, url: value, children: [] };
  }

  // 未知行内结构：降级为纯文本，保证不丢内容。
  const value = textOf(node, source);
  return { type: "text", id: ids.next(fingerprint("text", value)), span, value };
}

/** 从标题语法节点名提取层级。 */
function headingDepth(name: string): 1 | 2 | 3 | 4 | 5 | 6 {
  const digit = name.match(/[1-6]$/)?.[0];
  return ((digit ? Number(digit) : 1) as 1 | 2 | 3 | 4 | 5 | 6);
}

function mapBlock(node: SyntaxNode, source: string, ids: IdAllocator): BlockNode | null {
  const span: SourceSpan = { start: node.from, end: node.to };
  const name = node.name;

  if (/^(ATXHeading|SetextHeading)[1-6]$/.test(name)) {
    const depth = headingDepth(name);
    const kids = parseInline(node, source, ids);
    return {
      type: "heading",
      id: ids.next(fingerprint("heading", String(depth), kids.map((k) => k.id))),
      span,
      depth,
      children: kids,
    };
  }

  if (name === "Paragraph") {
    const kids = parseInline(node, source, ids);
    return {
      type: "paragraph",
      id: ids.next(fingerprint("paragraph", "", kids.map((k) => k.id))),
      span,
      children: kids,
    };
  }

  if (name === "FencedCode" || name === "IndentedCode") {
    const info = childrenOf(node).find((c) => c.name === "CodeInfo");
    const lang = info ? textOf(info, source).trim().split(/\s+/)[0] : undefined;
    const raw = textOf(node, source);
    // 去掉围栏行与结尾围栏，保留正文（含内部换行）。
    let value = raw;
    if (name === "FencedCode") {
      const firstNl = raw.indexOf("\n");
      value = firstNl >= 0 ? raw.slice(firstNl + 1) : "";
      value = value.replace(/\n[`~]{3,}\s*$/, "");
    }
    return {
      type: "code",
      id: ids.next(fingerprint("code", (lang ?? "") + value)),
      span,
      ...(lang ? { lang } : {}),
      value,
    };
  }

  if (name === "Blockquote") {
    const kids = childrenOf(node)
      .filter((c) => c.name !== "QuoteMark")
      .map((c) => mapBlock(c, source, ids))
      .filter((b): b is BlockNode => b !== null);
    return {
      type: "blockquote",
      id: ids.next(fingerprint("blockquote", "", kids.map((k) => k.id))),
      span,
      children: kids,
    };
  }

  if (name === "BulletList" || name === "OrderedList") {
    const items = childrenOf(node)
      .filter((c) => c.name === "ListItem")
      .map((item) => {
        const itemKids = childrenOf(item);
        const task = itemKids.find((c) => c.name === "Task");
        const marker = task ? childrenOf(task).find((c) => c.name === "TaskMarker") : undefined;
        const checked = marker ? /[xX]/.test(textOf(marker, source)) : undefined;
        const blocks = itemKids
          .filter((c) => c.name !== "ListMark" && c.name !== "Task")
          .map((c) => mapBlock(c, source, ids))
          .filter((b): b is BlockNode => b !== null);
        const itemSpan: SourceSpan = { start: item.from, end: item.to };
        return {
          type: "listItem" as const,
          id: ids.next(fingerprint("listItem", checked === undefined ? "" : String(checked), blocks.map((b) => b.id))),
          span: itemSpan,
          ...(checked === undefined ? {} : { checked }),
          children: blocks,
        };
      });
    const ordered = name === "OrderedList";
    const start = ordered ? Number(textOf(node, source).match(/^\s*(\d+)/)?.[1] ?? 1) : undefined;
    return {
      type: "list",
      id: ids.next(fingerprint("list", String(ordered) + (start ?? ""), items.map((i) => i.id))),
      span,
      ordered,
      ...(start && start !== 1 ? { start } : {}),
      children: items,
    };
  }

  if (name === "Table") {
    const rows = childrenOf(node)
      .filter((c) => c.name === "TableHeader" || c.name === "TableRow")
      .map((row) => {
        const cells = childrenOf(row)
          .filter((c) => c.name === "TableCell")
          .map((cell) => {
            const kids = parseInline(cell, source, ids);
            return {
              type: "tableCell" as const,
              id: ids.next(fingerprint("tableCell", "", kids.map((k) => k.id))),
              span: { start: cell.from, end: cell.to } as SourceSpan,
              children: kids,
            };
          });
        return {
          type: "tableRow" as const,
          id: ids.next(fingerprint("tableRow", "", cells.map((c) => c.id))),
          span: { start: row.from, end: row.to } as SourceSpan,
          children: cells,
        };
      });
    // 分隔行的对齐标记：|---|---:|:---:| → [null,right,center]
    // 注意单元格之间的分隔符也叫 TableDelimiter（单个 |），
    // 分隔行是覆盖整行的那个，取跨度最长的。
    const delims = childrenOf(node).filter((c) => c.name === "TableDelimiter");
    const delim = delims.sort((a, b) => b.to - b.from - (a.to - a.from))[0];
    const align: Array<"left" | "center" | "right" | null> = delim
      ? textOf(delim, source)
          .split("|")
          .filter((s) => s.trim())
          .map((s) => {
            const t = s.trim();
            if (t.startsWith(":") && t.endsWith(":")) return "center";
            if (t.endsWith(":")) return "right";
            if (t.startsWith(":")) return "left";
            return null;
          })
      : [];
    return {
      type: "table",
      id: ids.next(fingerprint("table", align.join(","), rows.map((r) => r.id))),
      span,
      align,
      children: rows,
    };
  }

  if (name === "HorizontalRule" || name === "ThematicBreak") {
    return { type: "thematicBreak", id: ids.next(fingerprint("thematicBreak", "")), span };
  }

  return null;
}

/* ------------------------------ 块级复用 ------------------------------ */

/**
 * 把"新文本"的 offset 反向映射回"旧文本"坐标。
 * 落在插入区内部（无法确定对应旧位置）时返回 null。
 */
export function unshiftOffset(
  offset: number,
  changes: readonly Change[],
): number | null {
  const sorted = [...changes].sort((a, b) => a.fromB - b.fromB);
  let result = offset;
  for (const c of sorted) {
    const inserted = c.toB - c.fromB;
    const deleted = c.toA - c.fromA;
    if (result < c.fromB) break;
    if (result < c.toB) return null; // 落在本次插入的内容里 → 脏区
    result -= inserted - deleted;
  }
  return result;
}

/**
 * 对未受编辑影响的顶层块，直接复用旧 IR 子树，只更新 span。
 * 判定依据：新块的 span 反向映射回旧坐标后，与旧块 span 完全一致
 * （意味着源文本逐字未变，类型与子树必然相同）。
 * index 错位的块反向映射不会匹配，自动走重新映射路径，不会误复用。
 */
function reuseUnchangedBlocks(
  syntaxBlocks: SyntaxNode[],
  previous: DocumentIR | undefined,
  changes: readonly Change[] | undefined,
  source: string,
  ids: IdAllocator,
): BlockNode[] {
  if (!previous || !changes || !changes.length) {
    return syntaxBlocks
      .map((n) => mapBlock(n, source, ids))
      .filter((b): b is BlockNode => b !== null);
  }

  // 编辑区间是否与块 span 相交。等长替换时 span 完全不变，
  // 仅靠 unshiftOffset 边界比对会误判为"未变"而复用旧内容——必须显式排除。
  const dirty = (from: number, to: number) =>
    changes.some((c) => c.fromB < to && c.toB > from);

  const out: BlockNode[] = [];
  for (let i = 0; i < syntaxBlocks.length; i++) {
    const node = syntaxBlocks[i];
    const old = previous.children[i];
    const oldStart = unshiftOffset(node.from, changes);
    const oldEnd = unshiftOffset(node.to, changes);

    if (
      old &&
      !dirty(node.from, node.to) &&
      oldStart !== null &&
      oldEnd !== null &&
      old.span.start === oldStart &&
      old.span.end === oldEnd
    ) {
      // 整棵子树未变：复用节点与 id，只更新 span 到新坐标。
      out.push({ ...old, span: { start: node.from, end: node.to } });
    } else {
      const block = mapBlock(node, source, ids);
      if (block) out.push(block);
    }
  }
  return out;
}

/* ------------------------------ 公共 API ------------------------------ */

/**
 * 解析 Markdown 为 DocumentIR。
 *
 * 增量用法：
 * ```ts
 * const first = parseMarkdown({ source: text });
 * const second = parseMarkdown({
 *   source: newText,
 *   fragments: first.fragments,
 *   changes: [{ fromA: p, toA: p, fromB: p, toB: p + 1 }],
 * });
 * ```
 */
export function parseMarkdown(input: ParseInput): ParseResult {
  const { source, fragments, changes, previous } = input;

  let tree;
  if (fragments && fragments.length && changes && changes.length) {
    tree = mdParser.parse(source, TreeFragment.applyChanges(fragments, changes));
  } else if (fragments && fragments.length) {
    tree = mdParser.parse(source, fragments);
  } else {
    tree = mdParser.parse(source);
  }

  const ids = new IdAllocator(collectOldIds(previous));
  const children = reuseUnchangedBlocks(
    childrenOf(tree.topNode),
    previous,
    changes,
    source,
    ids,
  );

  return {
    ir: { children, source, version: (previous?.version ?? 0) + 1 },
    fragments: TreeFragment.addTree(tree),
  };
}
