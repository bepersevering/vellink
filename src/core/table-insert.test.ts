import { describe, expect, it } from "vitest";
import { buildTable, MAX_TABLE_COLS, MAX_TABLE_ROWS } from "./table-insert";
import { parseMarkdown } from "./parser/markdown";

describe("Quick table insertion", () => {
  it("generates a header + delimiter row + the requested number of rows", () => {
    const table = buildTable(4, 3);
    const lines = table.split("\n");
    expect(lines).toHaveLength(4);
    expect(lines[0]).toBe("| Column | Column | Column |");
    expect(lines[1]).toBe("| --- | --- | --- |");
    expect(lines[2]).toMatch(/^\|.*\|.*\|.*\|$/);
  });

  it("generates a table the parser recognizes as a table node", () => {
    const { ir } = parseMarkdown({ source: buildTable(3, 2) });
    expect(ir.children[0].type).toBe("table");
    if (ir.children[0].type !== "table") return;
    expect(ir.children[0].children).toHaveLength(2); // The delimiter row isn't a node: header + 1 data row
  });

  it("clamps invalid input back into the legal range", () => {
    expect(buildTable(0, 0).split("\n")).toHaveLength(3);
    expect(buildTable(999, 999).split("\n")[0].split("|").length - 2).toBe(MAX_TABLE_COLS);
    expect(buildTable(999, 2).split("\n")).toHaveLength(MAX_TABLE_ROWS);
  });

  it("doesn't produce an empty table for NaN", () => {
    const table = buildTable(NaN, NaN);
    expect(table.split("\n")).toHaveLength(3);
    expect(table).toContain("Column");
  });
});
