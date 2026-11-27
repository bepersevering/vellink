/**
 * 数学公式的识别与切分（纯函数，无 KaTeX 依赖）。
 *
 * Lezer markdown 不认识 `$...$`，它会整段落在 TextNode 里。与其改语法，
 * 不如在解析出文本后做一次切分：把 `$...$` 换成 inlineMath 原子节点，
 * `$$...$$` 换成 mathBlock。这样源码视图里的 `$` 原样保留，往返不丢。
 *
 * 边界规则（照常见 Markdown 数学扩展）：
 * - `$x$` 行内；`$$x$$` 块级，可以跨行。
 * -  opening `$` 后面紧跟空白不算公式（`price $ 5`）。
 * - 反斜杠转义的 `\$` 不是公式边界。
 * - 闭合符前紧跟反斜杠、或闭合符后紧跟数字（`$20` 的 `$`）不算。
 */

export interface MathSpan {
  start: number;
  end: number;
  /** 公式内容，不含两侧分隔符。 */
  value: string;
  block: boolean;
}

/** 该位置的 `$` 是否被反斜杠转义。 */
function escaped(source: string, at: number): boolean {
  let slashes = 0;
  for (let i = at - 1; i >= 0 && source[i] === "\\"; i--) slashes++;
  return slashes % 2 === 1;
}

/** 从 `at` 开始找匹配的闭合分隔符，返回结束偏移（不含）与内容。 */
function closing(
  source: string,
  at: number,
  delim: string,
): { end: number; value: string } | null {
  const contentStart = at + delim.length;
  for (let i = contentStart; i <= source.length - delim.length; i++) {
    if (source.slice(i, i + delim.length) !== delim) continue;
    if (escaped(source, i)) continue;
    const value = source.slice(contentStart, i);
    if (!value.trim()) return null;
    // 内容里含裸 $ 说明这个 opening 不是公式开头（如 `cost $5 and $x$`），
    // 放弃它，让调用方从下一个 $ 重新尝试。
    if (/(^|[^\\])\$/.test(value)) return null;
    // 闭合符前紧跟空白 → 不是边界，继续找下一个闭合符
    if (/\s$/.test(value)) continue;
    // 闭合符后紧跟数字：更像货币符号而不是公式（`cost $5`）
    if (/[0-9]/.test(source[i + delim.length] ?? "")) continue;
    return { end: i + delim.length, value };
  }
  return null;
}

/** 扫一段源码，找出所有公式片段（互不重叠，按位置升序）。 */
export function findMath(source: string): MathSpan[] {
  const out: MathSpan[] = [];
  for (let i = 0; i < source.length; i++) {
    if (source[i] !== "$" || escaped(source, i)) continue;
    const block = source.slice(i, i + 2) === "$$";
    const delim = block ? "$$" : "$";
    // opening 后紧跟空白 → 不是公式
    if (/\s/.test(source[i + delim.length] ?? "")) continue;
    const found = closing(source, i, delim);
    if (!found) continue;
    out.push({ start: i, end: found.end, value: found.value, block });
    i = found.end - 1;
  }
  return out;
}

/**
 * 把一段纯文本按公式切成「文本 / 公式」片段。
 * `text` 的 span 是绝对偏移，调用方据此建 TextNode / InlineMathNode。
 */
export type MathChunk =
  | { kind: "text"; start: number; end: number; value: string }
  | { kind: "math"; start: number; end: number; value: string; block: boolean };

export function splitMath(source: string, from: number, to: number): MathChunk[] {
  const slice = source.slice(from, to);
  const hits = findMath(slice).filter((h) => h.start + from >= from && h.end + from <= to);
  if (!hits.length) return [{ kind: "text", start: from, end: to, value: slice }];

  const chunks: MathChunk[] = [];
  let cursor = 0;
  for (const hit of hits) {
    if (hit.start > cursor) {
      chunks.push({
        kind: "text",
        start: from + cursor,
        end: from + hit.start,
        value: slice.slice(cursor, hit.start),
      });
    }
    chunks.push({
      kind: "math",
      start: from + hit.start,
      end: from + hit.end,
      value: hit.value,
      block: hit.block,
    });
    cursor = hit.end;
  }
  if (cursor < slice.length) {
    chunks.push({
      kind: "text",
      start: from + cursor,
      end: to,
      value: slice.slice(cursor),
    });
  }
  return chunks;
}

/**
 * 块级公式独占一段：一段去掉首尾空白后若整个被 `$$...$$` 覆盖，
 * 则返回公式内容，否则 null。调用方在 mapBlock 里优先判这个。
 */
export function standaloneMathBlock(source: string, from: number, to: number): MathSpan | null {
  const raw = source.slice(from, to);
  const lead = raw.length - raw.trimStart().length;
  const trail = raw.length - raw.trimEnd().length;
  const start = from + lead;
  const end = to - trail;
  if (!raw.trim().startsWith("$$")) return null;
  const found = closing(source, start, "$$");
  if (!found || found.end !== end) return null;
  return { start, end, value: found.value, block: true };
}
