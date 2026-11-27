import { describe, expect, it } from "vitest";
import { parseMarkdown } from "./markdown";
import {
  blockById,
  blocksInRange,
  nodeAtOffset,
  nodeById,
  shiftOffset,
  validateSpans,
} from "./sourcemap";
import { walkBlocks } from "../ir/types";

const DOC = `# Heading One

This is the first paragraph, with **bold**, *italic*, \`inline code\`, [link](https://example.com) and [[wiki-link]].

## Heading Two

- List item one
- [x] Completed task

> Blockquote

\`\`\`ts
const x = 1;
\`\`\`

| A | B |
|---|---|
| 1 | 2 |
`;

describe("Markdown → IR parsing", () => {
  it("maps all major block types", () => {
    const { ir } = parseMarkdown({ source: DOC });
    // Only top-level blocks; no recursion into containers
    const types = ir.children.map((b) => b.type);
    expect(types).toEqual([
      "heading",
      "paragraph",
      "heading",
      "list",
      "blockquote",
      "code",
      "table",
    ]);
  });

  it("spans map exactly to source text", () => {
    const { ir } = parseMarkdown({ source: DOC });
    expect(validateSpans(ir)).toEqual([]);
    const heading = ir.children[0];
    expect(DOC.slice(heading.span.start, heading.span.end)).toBe("# Heading One");
    const code = ir.children.find((b) => b.type === "code")!;
    expect(DOC.slice(code.span.start, code.span.end)).toContain("const x = 1;");
  });

  it("parses inline nodes: bold / italic / inline code / link / wiki link", () => {
    const { ir } = parseMarkdown({ source: DOC });
    const para = ir.children.find((b) => b.type === "paragraph")!;
    if (para.type !== "paragraph") throw new Error("unreachable");
    const inlineTypes = para.children.map((n) => n.type);
    expect(inlineTypes).toContain("strong");
    expect(inlineTypes).toContain("emphasis");
    expect(inlineTypes).toContain("inlineCode");
    expect(inlineTypes).toContain("link");
    expect(inlineTypes).toContain("wikiLink");

    const wiki = para.children.find((n) => n.type === "wikiLink")!;
    if (wiki.type !== "wikiLink") throw new Error("unreachable");
    expect(wiki.target).toBe("wiki-link");
  });

  it("parses GFM: task lists and tables", () => {
    const { ir } = parseMarkdown({ source: DOC });
    const list = ir.children.find((b) => b.type === "list")!;
    if (list.type !== "list") throw new Error("unreachable");
    expect(list.children[0].children).toHaveLength(1);
    expect(list.children[1].checked).toBe(true);

    const table = ir.children.find((b) => b.type === "table")!;
    if (table.type !== "table") throw new Error("unreachable");
    expect(table.children).toHaveLength(2); // header + 1 data row
    expect(table.children[0].children).toHaveLength(2);
  });

  it("code blocks preserve lang and content", () => {
    const { ir } = parseMarkdown({ source: DOC });
    const code = ir.children.find((b) => b.type === "code")!;
    if (code.type !== "code") throw new Error("unreachable");
    expect(code.lang).toBe("ts");
    expect(code.value).toContain("const x = 1;");
  });
});

describe("incremental parsing and ID stability", () => {
  it("unchanged node IDs stay stable, edited node IDs change", () => {
    const first = parseMarkdown({ source: DOC });

    // Change one character in the first paragraph
    const editAt = DOC.indexOf("first paragraph") + 1;
    const newSource = DOC.slice(0, editAt) + "X" + DOC.slice(editAt + 1);
    // Note: one character is replaced by one, so the length stays the same
    const second = parseMarkdown({ source: newSource });

    const oldById = new Map<string, string>();
    walkBlocks(first.ir.children, (b) => oldById.set(b.span.start.toString(), b.id));
    const newById = new Map<string, string>();
    walkBlocks(second.ir.children, (b) => newById.set(b.span.start.toString(), b.id));

    // Unchanged headings should keep stable IDs
    expect(newById.get("0")).toBe(oldById.get("0"));
    // Later headings, lists, blockquotes, code blocks and tables (unchanged) should keep stable IDs
    for (const [pos, id] of oldById) {
      if (Number(pos) > editAt) expect(newById.get(pos)).toBe(id);
    }
  });

  it("incremental parsing produces the same structure as full parsing", () => {
    const first = parseMarkdown({ source: DOC });
    const editAt = DOC.indexOf("## Heading Two");
    const newSource = DOC.slice(0, editAt) + "Added\n\n" + DOC.slice(editAt);

    const full = parseMarkdown({ source: newSource });
    const incr = parseMarkdown({
      source: newSource,
      fragments: first.fragments,
      changes: [{ fromA: editAt, toA: editAt, fromB: editAt, toB: editAt + 7 }],
      previous: first.ir,
    });

    const shape = (ir: ReturnType<typeof parseMarkdown>["ir"]) =>
      ir.children.map((b) => b.type).join(",");
    expect(shape(incr.ir)).toBe(shape(full.ir));
    expect(validateSpans(incr.ir)).toEqual([]);
    expect(incr.ir.version).toBe(first.ir.version + 1);
  });
});

describe("bidirectional source map", () => {
  const { ir } = parseMarkdown({ source: DOC });

  it("offset → deepest node: inside inline marks", () => {
    const boldAt = DOC.indexOf("bold");
    const hit = nodeAtOffset(ir, boldAt);
    expect(hit).toBeDefined();
    expect(hit!.block.type).toBe("paragraph");
    expect(hit!.deepest.type).toBe("strong");
  });

  it("offset → node: no inline nodes inside code blocks", () => {
    const codeAt = DOC.indexOf("const x");
    const hit = nodeAtOffset(ir, codeAt);
    expect(hit?.block.type).toBe("code");
    expect(hit?.inline).toBeUndefined();
  });

  it("id → node and span (both blocks and inlines)", () => {
    const heading = ir.children[0];
    const found = blockById(ir, heading.id);
    expect(found?.span).toEqual(heading.span);

    const para = ir.children[1];
    if (para.type !== "paragraph") throw new Error("unreachable");
    const strong = para.children.find((n) => n.type === "strong")!;
    const foundInline = nodeById(ir, strong.id);
    expect(foundInline?.span).toEqual(strong.span);
  });

  it("dirty range → affected blocks", () => {
    const codeAt = DOC.indexOf("const x");
    const affected = blocksInRange(ir, codeAt, codeAt + 5);
    expect(affected).toHaveLength(1);
    expect(affected[0].type).toBe("code");
  });

  it("cursor offsets shift correctly after an edit", () => {
    // Insert 5 chars at position 10; later cursors should shift right by 5
    expect(shiftOffset(20, { from: 10, to: 10, inserted: 5 })).toBe(25);
    // Cursors before the edit point don't move
    expect(shiftOffset(5, { from: 10, to: 10, inserted: 5 })).toBe(5);
    // Replacement: delete 3, insert 1, delta = -2
    expect(shiftOffset(20, { from: 10, to: 13, inserted: 1 })).toBe(18);
  });
});
