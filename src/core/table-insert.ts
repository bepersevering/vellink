/**
 * Generate a Markdown table skeleton (pure function).
 *
 * At most 12 columns and 50 rows: bigger tables aren't worth writing by hand, and the
 * limits also prevent a stray keystroke from generating a huge table.
 */

export const MAX_TABLE_COLS = 12;
export const MAX_TABLE_ROWS = 50;

/** Generate an empty table: header + delimiter row + N rows of empty cells. */
export function buildTable(rows: number, cols: number): string {
  // rows is the total number of rows (including the header), leaving at least 1 data row to fill
  const r = Math.max(3, Math.min(MAX_TABLE_ROWS, Math.floor(rows) || 3));
  const c = Math.max(1, Math.min(MAX_TABLE_COLS, Math.floor(cols) || 3));
  const header = `| ${Array.from({ length: c }, () => "Column").join(" | ")} |`;
  const divider = `| ${Array.from({ length: c }, () => "---").join(" | ")} |`;
  const body = Array.from({ length: r - 2 }, () =>
    `| ${Array.from({ length: c }, () => "  ").join(" | ")} |`,
  );
  return [header, divider, ...body].join("\n");
}
