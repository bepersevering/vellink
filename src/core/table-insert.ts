/**
 * 生成 Markdown 表格骨架（纯函数）。
 *
 * 列数上限 12、行数上限 50：再大的表格手写不划算，也避免误输入生成巨表。
 */

export const MAX_TABLE_COLS = 12;
export const MAX_TABLE_ROWS = 50;

/** 生成一张空表格：表头 + 分隔行 + N 行空单元格。 */
export function buildTable(rows: number, cols: number): string {
  // rows 表示总行数（含表头行），至少留 1 行数据可填
  const r = Math.max(3, Math.min(MAX_TABLE_ROWS, Math.floor(rows) || 3));
  const c = Math.max(1, Math.min(MAX_TABLE_COLS, Math.floor(cols) || 3));
  const header = `| ${Array.from({ length: c }, () => "列").join(" | ")} |`;
  const divider = `| ${Array.from({ length: c }, () => "---").join(" | ")} |`;
  const body = Array.from({ length: r - 2 }, () =>
    `| ${Array.from({ length: c }, () => "  ").join(" | ")} |`,
  );
  return [header, divider, ...body].join("\n");
}
