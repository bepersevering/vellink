/**
 * 脚注识别（纯函数）。
 *
 * Lezer 不认识 `[^1]` 与 `[^1]: 内容`。策略同数学公式：在源码层识别，
 * 行内引用切成 atom，文末定义行截成 footnote 块。两者靠 label 配对。
 *
 * 规则：
 * - 定义必须在行首（允许缩进 ≤3），格式 `[^label]: 内容`；
 * - 引用是行内 `[^label]`，不含冒号；
 * - label 只允许字母数字、中文、`-` `_`，避免与链接语法混淆。
 */

export interface FootnoteRef {
  start: number;
  end: number;
  label: string;
}

export interface FootnoteDef {
  start: number;
  end: number;
  label: string;
  /** 冒号后的内容（不含行尾换行）。 */
  text: string;
}

export interface Footnotes {
  refs: FootnoteRef[];
  defs: FootnoteDef[];
}

const LABEL = "[\\w\\u4e00-\\u9fff-]+";

/** 扫全文找出脚注引用与定义。 */
export function findFootnotes(source: string): Footnotes {
  const refs: FootnoteRef[] = [];
  const defs: FootnoteDef[] = [];
  const re = new RegExp(`\\[\\^(${LABEL})\\](:?)`, "g");
  let m: RegExpExecArray | null;

  // 先标出围栏代码块的行范围，避免把里面的 [^1] 当脚注
  const fenced = new Array<boolean>(source.length).fill(false);
  let inFence = false;
  let lineStart = 0;
  while (lineStart <= source.length) {
    const lineEnd = source.indexOf("\n", lineStart);
    const stop = lineEnd === -1 ? source.length : lineEnd;
    const line = source.slice(lineStart, stop);
    if (/^\s*(```|~~~)/.test(line)) {
      inFence = !inFence;
    } else if (inFence) {
      fenced.fill(true, lineStart, stop + 1);
    }
    if (lineEnd === -1) break;
    lineStart = lineEnd + 1;
  }

  while ((m = re.exec(source)) !== null) {
    const start = m.index;
    if (fenced[start]) continue;
    // 转义的 \[ 不算
    if (source[start - 1] === "\\") continue;

    const end = start + m[0].length;
    if (m[2] === ":") {
      // 定义必须在行首（最多 3 个空格）
      const bol = source.lastIndexOf("\n", start - 1) + 1;
      if (source.slice(bol, start).trim() !== "") continue;
      const lineEnd = source.indexOf("\n", end);
      const stop = lineEnd === -1 ? source.length : lineEnd;
      defs.push({ start, end: stop, label: m[1], text: source.slice(end, stop).trim() });
    } else {
      refs.push({ start, end, label: m[1] });
    }
  }
  return { refs, defs };
}

/** 把一段文本按脚注引用切成文本 / 引用片段（绝对偏移）。 */
export type FootnoteChunk =
  | { kind: "text"; start: number; end: number; value: string }
  | { kind: "ref"; start: number; end: number; label: string };

export function splitFootnoteRefs(
  source: string,
  from: number,
  to: number,
  refs: readonly FootnoteRef[],
): FootnoteChunk[] {
  const hits = refs.filter((r) => r.start >= from && r.end <= to);
  if (!hits.length) return [{ kind: "text", start: from, end: to, value: source.slice(from, to) }];
  const out: FootnoteChunk[] = [];
  let cursor = from;
  for (const hit of hits) {
    if (hit.start > cursor) {
      out.push({
        kind: "text",
        start: cursor,
        end: hit.start,
        value: source.slice(cursor, hit.start),
      });
    }
    out.push({ kind: "ref", start: hit.start, end: hit.end, label: hit.label });
    cursor = hit.end;
  }
  if (cursor < to) out.push({ kind: "text", start: cursor, end: to, value: source.slice(cursor, to) });
  return out;
}
