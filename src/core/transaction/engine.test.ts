import { describe, it, expect } from "vitest";
import { emptyDocument, type BlockNode, type ParagraphNode } from "../ir/types";
import { commit, undo } from "./engine";

function para(id: string, text: string): ParagraphNode {
  return {
    id,
    type: "paragraph",
    span: { start: 0, end: text.length },
    children: [
      {
        id: `${id}_t`,
        type: "text",
        value: text,
        span: { start: 0, end: text.length },
      },
    ],
  };
}

describe("transaction engine", () => {
  it("insert adds the new node and increments the version", () => {
    const doc = emptyDocument();
    const node = para("p1", "hello");
    const result = commit(doc, [{ type: "insert", at: 0, nodes: [node] }]);

    expect(result.document.children).toHaveLength(1);
    expect(result.document.children[0].id).toBe("p1");
    expect(result.document.version).toBe(1);
    expect(doc.children).toHaveLength(0); // the original document is immutable
  });

  it("insert → undo restores the original state", () => {
    const doc = emptyDocument();
    const node = para("p1", "hello");
    const { document: after, transaction } = commit(doc, [
      { type: "insert", at: 0, nodes: [node] },
    ]);
    const restored = undo(after, transaction);

    expect(restored.children).toEqual([]);
    // content matches the initial state (at the id structure level)
    expect(restored.version).toBe(2);
  });

  it("delete → undo restores the deleted nodes unchanged", () => {
    const a = para("a", "A");
    const b = para("b", "B");
    const doc = { ...emptyDocument(), children: [a, b] as BlockNode[] };

    const { document: after, transaction } = commit(doc, [
      { type: "delete", at: 0, count: 1 },
    ]);
    expect(after.children.map((n) => n.id)).toEqual(["b"]);

    const restored = undo(after, transaction);
    expect(restored.children.map((n) => n.id)).toEqual(["a", "b"]);
  });

  it("a transaction with multiple ops is fully reverted by a single undo", () => {
    const a = para("a", "A");
    const doc = emptyDocument();
    const { document: after, transaction } = commit(doc, [
      { type: "insert", at: 0, nodes: [a] },
      { type: "insert", at: 1, nodes: [para("b", "B"), para("c", "C")] },
    ]);
    expect(after.children).toHaveLength(3);

    const restored = undo(after, transaction);
    expect(restored.children).toHaveLength(0);
  });

  it("replace's inverse restores the replaced node", () => {
    const a = para("a", "A");
    const b = para("b", "B");
    const doc = { ...emptyDocument(), children: [a] as BlockNode[] };

    const { document: after, transaction } = commit(doc, [
      { type: "replace", at: 0, count: 1, nodes: [b] },
    ]);
    expect(after.children[0].id).toBe("b");

    const restored = undo(after, transaction);
    expect(restored.children[0].id).toBe("a");
  });
});
