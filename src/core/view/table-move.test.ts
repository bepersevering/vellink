import { describe, expect, it } from "vitest";
import { EditorState, TextSelection } from "prosemirror-state";
import { parseMarkdown } from "../parser/markdown";
import { buildPMView } from "./mapping";
import { moveColumn, moveRow, moveTableCell, tableLocation } from "./table-move";
import { serializePM } from "./serialize";

const SRC = "| A | B |\n|---|---|\n| 1 | 2 |\n| 3 | 4 |\n";

function table() {
  const doc = buildPMView(parseMarkdown({ source: SRC }).ir).doc;
  const node = doc.firstChild!;
  return { doc, node };
}

describe("表格行列移动", () => {
  it("定位光标所在的表格与行列", () => {
    const { doc, node } = table();
    // 表头第一个单元格里的文本起点
    const loc = tableLocation(doc, 3);
    expect(loc?.table).toBe(node);
    expect(loc?.rowIndex).toBe(0);
    expect(loc?.colIndex).toBe(0);
  });

  it("向下移动一行，内容顺序改变", () => {
    const { node } = table();
    const next = moveRow(node, 1, 1)!;
    expect(next.childCount).toBe(3);
    expect(next.child(1).textContent).toBe("34");
    expect(next.child(2).textContent).toBe("12");
  });

  it("首行不能向上移动，末行不能向下移动", () => {
    const { node } = table();
    expect(moveRow(node, 0, -1)).toBeNull();
    expect(moveRow(node, 2, 1)).toBeNull();
  });

  it("向右移动一列，每行都跟着变", () => {
    const { node } = table();
    const next = moveColumn(node, 0, 1)!;
    expect(next.child(0).textContent).toBe("BA");
    expect(next.child(2).textContent).toBe("43");
  });

  it("末列不能继续向右移动", () => {
    const { node } = table();
    expect(moveColumn(node, 1, 1)).toBeNull();
  });

  it("命令产生的表格仍能序列化为 Markdown", () => {
    const { doc, node } = table();
    const state = EditorState.create({ doc, selection: TextSelection.create(doc, 8) });
    let next: unknown = null;
    expect(moveTableCell("row", 1)(state, (tr) => { next = tr; })).toBe(true);
    const edited = state.apply(next as never);
    const { markdown } = serializePM(edited.doc);
    expect(markdown).toContain("| 3 | 4 |");
    expect(markdown).toContain("| 1 | 2 |");
    // 表头不动
    expect(markdown.indexOf("| A | B |")).toBeLessThan(markdown.indexOf("| 3 | 4 |"));
    void node;
  });

  it("不在表格里时命令返回 false", () => {
    const doc = buildPMView(parseMarkdown({ source: "普通段落" }).ir).doc;
    const state = EditorState.create({ doc, selection: TextSelection.create(doc, 2) });
    expect(moveTableCell("row", 1)(state, () => {})).toBe(false);
  });
});
