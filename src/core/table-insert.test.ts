import { describe, expect, it } from "vitest";
import { buildTable, MAX_TABLE_COLS, MAX_TABLE_ROWS } from "./table-insert";
import { parseMarkdown } from "./parser/markdown";

describe("快速插入表格", () => {
  it("生成表头 + 分隔行 + 指定行数", () => {
    const table = buildTable(4, 3);
    const lines = table.split("\n");
    expect(lines).toHaveLength(4);
    expect(lines[0]).toBe("| 列 | 列 | 列 |");
    expect(lines[1]).toBe("| --- | --- | --- |");
    expect(lines[2]).toMatch(/^\|.*\|.*\|.*\|$/);
  });

  it("生成的表格能被解析器识别为 table 节点", () => {
    const { ir } = parseMarkdown({ source: buildTable(3, 2) });
    expect(ir.children[0].type).toBe("table");
    if (ir.children[0].type !== "table") return;
    expect(ir.children[0].children).toHaveLength(2); // 分隔行不算节点：表头 + 1 数据行
  });

  it("非法输入被夹回合法范围", () => {
    expect(buildTable(0, 0).split("\n")).toHaveLength(3);
    expect(buildTable(999, 999).split("\n")[0].split("|").length - 2).toBe(MAX_TABLE_COLS);
    expect(buildTable(999, 2).split("\n")).toHaveLength(MAX_TABLE_ROWS);
  });

  it("NaN 不产生空表", () => {
    const table = buildTable(NaN, NaN);
    expect(table.split("\n")).toHaveLength(3);
    expect(table).toContain("列");
  });
});
