/**
 * 扩展语法的纯函数：frontmatter / TOC 占位符 / 标题锚点。
 *
 * 这些语法 Lezer 都不认识（或只认识一半），但都能在源码层精确识别，
 * 所以用后处理切片而不是改语法树——和数学公式同一策略，不动增量 source map。
 */

export interface Frontmatter {
  start: number;
  end: number;
  /** YAML 原文（不含两侧 --- 行）。 */
  yaml: string;
}

/**
 * 识别文档开头的 YAML frontmatter：必须以 `---` 独占首行（允许 BOM），
 * 以另一行 `---` 或 `...` 结束。中间的 `---` 只在行首才算。
 */
export function findFrontmatter(source: string): Frontmatter | null {
  let at = source.charCodeAt(0) === 0xfeff ? 1 : 0;
  if (source.slice(at, at + 3) !== "---") return null;
  const firstEnd = source.indexOf("\n", at + 3);
  if (firstEnd === -1) return null;
  if (source.slice(at + 3, firstEnd).trim() !== "") return null;

  let cursor = firstEnd + 1;
  while (cursor < source.length) {
    const lineEnd = source.indexOf("\n", cursor);
    const stop = lineEnd === -1 ? source.length : lineEnd;
    const line = source.slice(cursor, stop).trim();
    if (line === "---" || line === "...") {
      return {
        start: at,
        end: stop,
        yaml: source.slice(firstEnd + 1, cursor),
      };
    }
    cursor = lineEnd === -1 ? source.length : lineEnd + 1;
  }
  return null;
}

/** 一行 `[TOC]`（允许前后空白）的位置。 */
export function findTocPlaceholders(source: string): { start: number; end: number }[] {
  const out: { start: number; end: number }[] = [];
  let cursor = 0;
  while (cursor < source.length) {
    const lineEnd = source.indexOf("\n", cursor);
    const stop = lineEnd === -1 ? source.length : lineEnd;
    if (/^\s*\[TOC\]\s*$/i.test(source.slice(cursor, stop))) {
      out.push({ start: cursor, end: stop });
    }
    cursor = lineEnd === -1 ? source.length : lineEnd + 1;
  }
  return out;
}

/** 把标题文字转成锚点 id：小写、非字母数字压成 `-`，中文保留。 */
export function headingAnchor(text: string): string {
  return text
    .trim()
    .toLowerCase()
    .replace(/[\s`*_~[\]()#]+/g, "-")
    .replace(/[^a-z0-9\u4e00-\u9fff\-]/g, "")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "");
}

/** 解析 `[文字](#锚点)` 形式的站内链接；不是锚点则返回 null。 */
export function anchorTarget(url: string): string | null {
  const m = /^#(.*)$/.exec(url.trim());
  return m ? decodeURIComponent(m[1]) : null;
}

/** 从 Markdown 源码提取标题列表（含层级与锚点），供 TOC 展开。 */
export function tocEntries(source: string): { depth: number; text: string; anchor: string }[] {
  const out: { depth: number; text: string; anchor: string }[] = [];
  let cursor = 0;
  let inFence = false;
  while (cursor < source.length) {
    const lineEnd = source.indexOf("\n", cursor);
    const stop = lineEnd === -1 ? source.length : lineEnd;
    const line = source.slice(cursor, stop);
    if (/^\s*(```|~~~)/.test(line)) inFence = !inFence;
    if (!inFence) {
      const m = /^(#{1,6})\s+(.+?)\s*#*\s*$/.exec(line);
      if (m) {
        const text = m[2];
        out.push({ depth: m[1].length, text, anchor: headingAnchor(text) });
      }
    }
    cursor = lineEnd === -1 ? source.length : lineEnd + 1;
  }
  return out;
}
