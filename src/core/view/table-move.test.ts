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

describe("Table row and column moves", () => {
  it("locates the table and row/column at the cursor", () => {
    const { doc, node } = table();
    // Text start inside the first header cell
    const loc = tableLocation(doc, 3);
    expect(loc?.table).toBe(node);
    expect(loc?.rowIndex).toBe(0);
    expect(loc?.colIndex).toBe(0);
  });

  it("moves a row down and changes the content order", () => {
    const { node } = table();
    const next = moveRow(node, 1, 1)!;
    expect(next.childCount).toBe(3);
    expect(next.child(1).textContent).toBe("34");
    expect(next.child(2).textContent).toBe("12");
  });

  it("the first row can't move up and the last row can't move down", () => {
    const { node } = table();
    expect(moveRow(node, 0, -1)).toBeNull();
    expect(moveRow(node, 2, 1)).toBeNull();
  });

  it("moves a column right and updates every row", () => {
    const { node } = table();
    const next = moveColumn(node, 0, 1)!;
    expect(next.child(0).textContent).toBe("BA");
    expect(next.child(2).textContent).toBe("43");
  });

  it("the last column can't move further right", () => {
    const { node } = table();
    expect(moveColumn(node, 1, 1)).toBeNull();
  });

  it("a table produced by the command still serializes to Markdown", () => {
    const { doc, node } = table();
    const state = EditorState.create({ doc, selection: TextSelection.create(doc, 8) });
    let next: unknown = null;
    expect(moveTableCell("row", 1)(state, (tr) => { next = tr; })).toBe(true);
    const edited = state.apply(next as never);
    const { markdown } = serializePM(edited.doc);
    expect(markdown).toContain("| 3 | 4 |");
    expect(markdown).toContain("| 1 | 2 |");
    // The header stays put
    expect(markdown.indexOf("| A | B |")).toBeLessThan(markdown.indexOf("| 3 | 4 |"));
    void node;
  });

  it("the command returns false when not inside a table", () => {
    const doc = buildPMView(parseMarkdown({ source: "Plain paragraph" }).ir).doc;
    const state = EditorState.create({ doc, selection: TextSelection.create(doc, 2) });
    expect(moveTableCell("row", 1)(state, () => {})).toBe(false);
  });
});
