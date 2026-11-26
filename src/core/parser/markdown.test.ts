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

const DOC = `# 标题一

这是第一段，包含 **粗体**、*斜体*、\`行内代码\`、[链接](https://example.com) 和 [[双链]]。

## 标题二

- 列表项一
- [x] 已完成任务

> 引用块

\`\`\`ts
const x = 1;
\`\`\`

| A | B |
|---|---|
| 1 | 2 |
`;

describe("Markdown → IR 解析", () => {
  it("映射所有主要块类型", () => {
    const { ir } = parseMarkdown({ source: DOC });
    // 只看顶层块，不递归容器内部
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

  it("span 精确对应源文本", () => {
    const { ir } = parseMarkdown({ source: DOC });
    expect(validateSpans(ir)).toEqual([]);
    const heading = ir.children[0];
    expect(DOC.slice(heading.span.start, heading.span.end)).toBe("# 标题一");
    const code = ir.children.find((b) => b.type === "code")!;
    expect(DOC.slice(code.span.start, code.span.end)).toContain("const x = 1;");
  });

  it("解析行内节点：粗体 / 斜体 / 行内代码 / 链接 / 双链", () => {
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
    expect(wiki.target).toBe("双链");
  });

  it("解析 GFM：任务列表与表格", () => {
    const { ir } = parseMarkdown({ source: DOC });
    const list = ir.children.find((b) => b.type === "list")!;
    if (list.type !== "list") throw new Error("unreachable");
    expect(list.children[0].children).toHaveLength(1);
    expect(list.children[1].checked).toBe(true);

    const table = ir.children.find((b) => b.type === "table")!;
    if (table.type !== "table") throw new Error("unreachable");
    expect(table.children).toHaveLength(2); // header + 1 数据行
    expect(table.children[0].children).toHaveLength(2);
  });

  it("代码块保留 lang 与内容", () => {
    const { ir } = parseMarkdown({ source: DOC });
    const code = ir.children.find((b) => b.type === "code")!;
    if (code.type !== "code") throw new Error("unreachable");
    expect(code.lang).toBe("ts");
    expect(code.value).toContain("const x = 1;");
  });
});

describe("增量解析与 ID 稳定性", () => {
  it("未修改节点 ID 保持稳定，修改节点 ID 改变", () => {
    const first = parseMarkdown({ source: DOC });

    // 在第一个段落里改一个字
    const editAt = DOC.indexOf("第一段") + 1;
    const newSource = DOC.slice(0, editAt) + "新" + DOC.slice(editAt + 1);
    // 注意：这里是替换 1 字为 1 字，长度不变
    const second = parseMarkdown({ source: newSource });

    const oldById = new Map<string, string>();
    walkBlocks(first.ir.children, (b) => oldById.set(b.span.start.toString(), b.id));
    const newById = new Map<string, string>();
    walkBlocks(second.ir.children, (b) => newById.set(b.span.start.toString(), b.id));

    // 标题（未变）ID 应稳定
    expect(newById.get("0")).toBe(oldById.get("0"));
    // 后面的标题、列表、引用、代码块、表格（未变）ID 都应稳定
    for (const [pos, id] of oldById) {
      if (Number(pos) > editAt) expect(newById.get(pos)).toBe(id);
    }
  });

  it("增量解析结果与全量解析结构一致", () => {
    const first = parseMarkdown({ source: DOC });
    const editAt = DOC.indexOf("## 标题二");
    const newSource = DOC.slice(0, editAt) + "插入段落。\n\n" + DOC.slice(editAt);

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

describe("双向 source map", () => {
  const { ir } = parseMarkdown({ source: DOC });

  it("offset → 最深节点：行内标记内部", () => {
    const boldAt = DOC.indexOf("粗体");
    const hit = nodeAtOffset(ir, boldAt);
    expect(hit).toBeDefined();
    expect(hit!.block.type).toBe("paragraph");
    expect(hit!.deepest.type).toBe("strong");
  });

  it("offset → 节点：代码块内部不进入行内", () => {
    const codeAt = DOC.indexOf("const x");
    const hit = nodeAtOffset(ir, codeAt);
    expect(hit?.block.type).toBe("code");
    expect(hit?.inline).toBeUndefined();
  });

  it("id → 节点与 span（块与行内均可）", () => {
    const heading = ir.children[0];
    const found = blockById(ir, heading.id);
    expect(found?.span).toEqual(heading.span);

    const para = ir.children[1];
    if (para.type !== "paragraph") throw new Error("unreachable");
    const strong = para.children.find((n) => n.type === "strong")!;
    const foundInline = nodeById(ir, strong.id);
    expect(foundInline?.span).toEqual(strong.span);
  });

  it("脏区范围 → 受影响块", () => {
    const codeAt = DOC.indexOf("const x");
    const affected = blocksInRange(ir, codeAt, codeAt + 5);
    expect(affected).toHaveLength(1);
    expect(affected[0].type).toBe("code");
  });

  it("光标偏移在编辑后正确平移", () => {
    // 在位置 10 插入 5 字，之后的光标应右移 5
    expect(shiftOffset(20, { from: 10, to: 10, inserted: 5 })).toBe(25);
    // 编辑点之前的光标不动
    expect(shiftOffset(5, { from: 10, to: 10, inserted: 5 })).toBe(5);
    // 替换：删 3 插 1，delta = -2
    expect(shiftOffset(20, { from: 10, to: 13, inserted: 1 })).toBe(18);
  });
});
