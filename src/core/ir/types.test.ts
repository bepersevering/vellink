import { describe, it, expect } from "vitest";
import {
  emptyDocument,
  findBlockById,
  walkBlocks,
  walkInline,
  type BlockNode,
} from "./types";

const doc = (): BlockNode[] => [
  {
    id: "h1",
    type: "heading",
    depth: 1,
    span: { start: 0, end: 2 },
    children: [
      {
        id: "h1t",
        type: "text",
        value: "Title",
        span: { start: 0, end: 2 },
      },
    ],
  },
  {
    id: "quote",
    type: "blockquote",
    span: { start: 3, end: 8 },
    children: [
      {
        id: "inner",
        type: "paragraph",
        span: { start: 3, end: 8 },
        children: [
          {
            id: "inner_t",
            type: "text",
            value: "Quote",
            span: { start: 3, end: 5 },
          },
          {
            id: "inner_w",
            type: "wikiLink",
            target: "Second Brain",
            span: { start: 6, end: 8 },
          },
        ],
      },
    ],
  },
];

describe("IR utility functions", () => {
  it("emptyDocument has version 0 and no children", () => {
    const d = emptyDocument();
    expect(d.version).toBe(0);
    expect(d.children).toEqual([]);
  });

  it("walkBlocks visits nested blocks depth-first", () => {
    const ids: string[] = [];
    walkBlocks(doc(), (n) => ids.push(n.id));
    expect(ids).toEqual(["h1", "quote", "inner"]);
  });

  it("findBlockById finds nested nodes", () => {
    expect(findBlockById(doc(), "inner")?.type).toBe("paragraph");
    expect(findBlockById(doc(), "missing")).toBeUndefined();
  });

  it("walkInline visits inline nodes within a block (including wikiLink)", () => {
    const types: string[] = [];
    walkInline(doc()[1], (n) => types.push(n.type));
    expect(types).toEqual(["text", "wikiLink"]);
  });
});
