/**
 * Markdown 源码列表缩进（纯函数部分）。
 *
 * Tab 在列表项前加两个空格，Shift+Tab 减两个；只认 `- ` / `* ` / `+ ` /
 * `1. ` 这类列表标记，普通段落保持原样（由 CodeMirror 的默认 Tab 处理）。
 */

const LIST_MARK = /^(\s*)(([-*+]|\d+\.)\s+)/;

/** 返回缩进后的行文本；不是列表项则返回 null（调用方走默认行为）。 */
export function indentListLine(line: string, outdent: boolean): string | null {
  const m = LIST_MARK.exec(line);
  if (!m) return null;
  const spaces = m[1];
  if (outdent) {
    if (!spaces) return null;
    return spaces.slice(2) + line.slice(spaces.length);
  }
  return "  " + line;
}
