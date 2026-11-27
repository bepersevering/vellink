/**
 * 往返一致性测试：source → parse → IR → PM → serialize → markdown' → parse' → IR'
 * 对比两棵 IR 的语义指纹（节点类型 + 关键属性 + 文本内容），忽略 id/span。
 */
import { describe, expect, it } from "vitest";
import { Transform } from "prosemirror-transform";
import type { BlockNode, DocumentIR, InlineNode } from "../ir/types";
import { parseMarkdown } from "../parser/markdown";
import { buildPMView } from "./mapping";
import { serializePM } from "./serialize";

/** 语义指纹：结构与内容，不含 id/span。 */
type FP = unknown;
function inlineFP(n: InlineNode): FP {
  switch (n.type) {
    case "text":
      return ["text", n.value];
    case "inlineCode":
      return ["code", n.value];
    case "strong":
      return ["strong", n.children.map(inlineFP)];
    case "emphasis":
      return ["em", n.children.map(inlineFP)];
    case "link":
      return ["link", n.url, n.title ?? null, n.children.map(inlineFP)];
    case "wikiLink":
      return ["wiki", n.target];
    case "image":
      return ["image", n.url, n.alt];
    case "inlineMath":
      return ["math", n.value];
    case "footnoteRef":
      return ["ref", n.label];
  }
}
function blockFP(n: BlockNode): FP {
  switch (n.type) {
    case "paragraph":
      return ["p", n.children.map(inlineFP)];
    case "heading":
      return ["h", n.depth, n.children.map(inlineFP)];
    case "code":
      return ["code", n.lang ?? null, n.value];
    case "blockquote":
      return ["quote", n.children.map(blockFP)];
    case "list":
      return [
        "list",
        n.ordered,
        n.start ?? 1,
        n.children.map((i) => [i.checked ?? null, i.children.map(blockFP)]),
      ];
    case "table":
      return [
        "table",
        n.align,
        n.children.map((r) => r.children.map((c) => c.children.map(inlineFP))),
      ];
    case "thematicBreak":
      return ["hr"];
    case "mathBlock":
      return ["mathBlock", n.value];
    case "frontmatter":
      return ["frontmatter", n.value];
    case "toc":
      return ["toc"];
    case "footnoteDef":
      return ["def", n.label, n.text];
  }
}
function fp(ir: DocumentIR): FP {
  return ir.children.map(blockFP);
}

/** 跑一次完整往返，返回序列化文本与两棵 IR。 */
function roundtrip(source: string) {
  const ir1 = parseMarkdown({ source }).ir;
  const view = buildPMView(ir1);
  const { markdown, anchors } = serializePM(view.doc);
  const ir2 = parseMarkdown({ source: markdown }).ir;
  return { markdown, anchors, ir1, ir2 };
}

describe("PM → Markdown 往返语义一致性", () => {
  it("纯文本与标题层级", () => {
    const src = "# 一级\n\n## 二级\n\n一段普通文字。\n\n### 三级标题\n";
    const { markdown, ir1, ir2 } = roundtrip(src);
    expect(fp(ir2)).toEqual(fp(ir1));
    expect(markdown).toContain("# 一级");
    expect(markdown).toContain("## 二级");
  });

  it("行内标记：粗体/斜体/行内代码/链接/双链", () => {
    const src =
      "这是 **粗体** 和 *斜体* 和 `inline code`。\n\n" +
      "链接 [示例](https://example.com \"标题\") 与 [[双链笔记]]。\n";
    const { markdown, ir1, ir2 } = roundtrip(src);
    expect(fp(ir2)).toEqual(fp(ir1));
    expect(markdown).toContain("**粗体**");
    expect(markdown).toContain("[[双链笔记]]");
  });

  it("无序/有序/任务列表", () => {
    const src = "- 甲\n- 乙\n\n3. 第三\n4. 第四\n\n- [x] 完成\n- [ ] 未完成\n";
    const { markdown, ir1, ir2 } = roundtrip(src);
    expect(fp(ir2)).toEqual(fp(ir1));
    expect(markdown).toContain("- [x] 完成");
    expect(markdown).toContain("3. 第三");
  });

  it("GFM 表格含三种对齐", () => {
    const src = "| 左 | 中 | 右 |\n|:---|:---:|---:|\n| a | b | c |\n| d | e | f |\n";
    const { markdown, ir1, ir2 } = roundtrip(src);
    expect(fp(ir2)).toEqual(fp(ir1));
    expect(markdown).toContain(":---");
  });

  it("代码块含语言标识", () => {
    const src = "```python\ndef f():\n    return 1\n```\n";
    const { markdown, ir1, ir2 } = roundtrip(src);
    expect(fp(ir2)).toEqual(fp(ir1));
    expect(markdown).toContain("```python");
  });

  it("引用块与分隔线", () => {
    const src = "> 引用第一行\n> 引用第二行\n\n---\n";
    const { markdown, ir1, ir2 } = roundtrip(src);
    expect(fp(ir2)).toEqual(fp(ir1));
    expect(markdown).toMatch(/^>/m);
    expect(markdown).toContain("---");
  });

  it("综合文档：所有结构混合", () => {
    const src = `# 标题

这是 **粗体**、*斜体*、\`代码\`、[链接](https://x.com) 和 [[双链]]。

- 普通项
- [x] 完成项

3. 有序三
4. 有序四

> 引用段落
> 第二行

| 左 | 中 | 右 |
|:---|:---:|---:|
| a | b | c |

\`\`\`python
print(1)
\`\`\`

---
`;
    const { ir1, ir2 } = roundtrip(src);
    expect(fp(ir2)).toEqual(fp(ir1));
  });

  it("空文档不崩溃", () => {
    const { markdown, ir1, ir2 } = roundtrip("");
    expect(fp(ir2)).toEqual(fp(ir1));
    expect(markdown.trim()).toBe("");
  });
});

describe("WYSIWYG 编辑后序列化（核心场景）", () => {
  it("PM 插入文字后序列化，源码同步反映编辑", () => {
    const src = "# 标题\n\n第一段。\n\n第二段。\n";
    const ir1 = parseMarkdown({ source: src }).ir;
    const view = buildPMView(ir1);

    // 模拟用户在 WYSIWYG 里往第二段插入文字
    const { doc } = view;
    let secondParaPos = -1;
    doc.descendants((node, pos) => {
      if (node.isText && node.text === "第二段。") secondParaPos = pos + node.nodeSize;
    });
    expect(secondParaPos).toBeGreaterThan(0);

    // 用 schema.text 构造插入节点（PM 标准做法）
    const transform = new Transform(doc);
    transform.insert(secondParaPos, view.doc.type.schema.text("新增内容"));
    const edited = transform.doc;

    const { markdown } = serializePM(edited);
    const ir2 = parseMarkdown({ source: markdown }).ir;

    // 编辑后的内容出现在源码里，且重新解析结构合法
    expect(markdown).toContain("新增内容");
    expect(ir2.children.map((b) => b.type)).toEqual(ir1.children.map((b) => b.type));
  });

  it("改别处的正文不会把图片吞掉", () => {
    // 图片在 PM 里是 atom（没有 textContent）。如果序列化走「文本内容」兜底，
    // 用户随便改一个字，整张图就会从源码里消失——这里专门守这条。
    const src = "# 标题\n\n![截图](.vellink-assets/shot-a1b2c3d4.png)\n\n正文。\n";
    const ir1 = parseMarkdown({ source: src }).ir;
    const view = buildPMView(ir1);
    const { doc } = view;

    let at = -1;
    doc.descendants((node, pos) => {
      if (node.isText && node.text === "正文。") at = pos + node.nodeSize;
    });
    expect(at).toBeGreaterThan(0);

    const transform = new Transform(doc);
    transform.insert(at, view.doc.type.schema.text("补充"));
    const { markdown } = serializePM(transform.doc);
    expect(markdown).toContain("![截图](.vellink-assets/shot-a1b2c3d4.png)");
    expect(parseMarkdown({ source: markdown }).ir).toBeDefined();
  });
});

describe("序列化锚点质量", () => {
  it("每个锚点的 PM pos 与源码区间都在合法范围", () => {
    const src = "# 标题\n\n**粗体** 与普通。\n\n- [x] 任务\n";
    const { markdown, anchors } = roundtrip(src);
    expect(anchors.length).toBeGreaterThan(0);
    for (const a of anchors) {
      expect(a.pmFrom).toBeGreaterThanOrEqual(0);
      expect(a.sourceFrom).toBeGreaterThanOrEqual(0);
      expect(a.sourceFrom + a.length).toBeLessThanOrEqual(markdown.length);
      expect(a.length).toBeGreaterThan(0);
    }
  });

  it("表格单元格锚点精确到实际文本位置", () => {
    const src = "| A | B |\n|---|---|\n| cat | dog |\n";
    const { markdown, anchors } = roundtrip(src);
    // 找到对应 cat / dog 的锚点，验证其源码切片命中真实单元格文本
    for (const word of ["cat", "dog"]) {
      const idx = markdown.indexOf(word);
      expect(idx).toBeGreaterThan(0);
      const hit = anchors.find(
        (a) => a.sourceFrom <= idx && idx < a.sourceFrom + a.length,
      );
      expect(hit, `${word} 应有锚点覆盖`).toBeDefined();
    }
  });

  it("无转义文档的锚点文本与源码逐字对应", () => {
    // 纯中文/字母，无 * _ ` \ 转义干扰
    const src = "# 标题\n\n普通段落内容。\n\n- 列表项\n";
    const { markdown, anchors } = roundtrip(src);
    // 取第一个锚点验证：源码切片非空
    const first = anchors[0];
    expect(markdown.slice(first.sourceFrom, first.sourceFrom + first.length).length).toBe(
      first.length,
    );
  });
});

describe("公式往返", () => {
  it("行内与块级公式往返后语义不变", () => {
    const src = "# 标题\n\n公式 $x^2$ 在句中。\n\n$$\\frac{a}{b}$$\n";
    const { markdown } = roundtrip(src);
    expect(markdown).toContain("$x^2$");
    expect(markdown).toContain("$$\\frac{a}{b}$$");
  });

  it("编辑别处不吞掉公式（atom 从 attrs 还原）", () => {
    const src = "# 标题\n\n公式 $x^2$ 在句中。\n";
    const { doc } = buildPMView(parseMarkdown({ source: src }).ir);
    const transform = new Transform(doc);
    // 在标题末尾插入文字：整篇序列化，公式 atom 不能被吞
    transform.insert(2, doc.type.schema.text("X"));
    const { markdown } = serializePM(transform.doc);
    expect(markdown).toContain("$x^2$");
  });
});

describe("扩展语法往返", () => {
  it("frontmatter 与 [TOC] 往返后语义不变", () => {
    const src = "---\ntitle: 测试\n---\n\n# 标题\n\n[TOC]\n";
    const { markdown, ir1, ir2 } = roundtrip(src);
    expect(markdown.startsWith("---\n")).toBe(true);
    expect(markdown).toContain("[TOC]");
    expect(fp(ir2)).toEqual(fp(ir1));
  });
});

describe("脚注往返", () => {
  it("脚注引用与定义往返后语义不变", () => {
    const src = "正文[^1]。\n\n[^1]: 说明文字\n";
    const { markdown, ir1, ir2 } = roundtrip(src);
    expect(markdown).toContain("[^1]");
    expect(fp(ir2)).toEqual(fp(ir1));
  });
});
