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
        value: "标题",
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
            value: "引用",
            span: { start: 3, end: 5 },
          },
          {
            id: "inner_w",
            type: "wikiLink",
            target: "第二大脑",
            span: { start: 6, end: 8 },
          },
        ],
      },
    ],
  },
];

describe("IR 工具函数", () => {
  it("emptyDocument 版本为 0 且无子节点", () => {
    const d = emptyDocument();
    expect(d.version).toBe(0);
    expect(d.children).toEqual([]);
  });

  it("walkBlocks 深度优先访问嵌套块", () => {
    const ids: string[] = [];
    walkBlocks(doc(), (n) => ids.push(n.id));
    expect(ids).toEqual(["h1", "quote", "inner"]);
  });

  it("findBlockById 能找到嵌套节点", () => {
    expect(findBlockById(doc(), "inner")?.type).toBe("paragraph");
    expect(findBlockById(doc(), "missing")).toBeUndefined();
  });

  it("walkInline 能访问块内行内节点（含 wikiLink）", () => {
    const types: string[] = [];
    walkInline(doc()[1], (n) => types.push(n.type));
    expect(types).toEqual(["text", "wikiLink"]);
  });
});
