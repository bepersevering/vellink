import { describe, expect, it } from "vitest";
import { findMath, splitMath, standaloneMathBlock } from "./math";
import { parseMarkdown } from "./parser/markdown";
import { renderBody, renderHtmlDocument } from "./export/html";

describe("公式识别", () => {
  it("行内 $...$ 与块级 $$...$$", () => {
    expect(findMath("能量 $E=mc^2$ 很有名")).toEqual([
      { start: 3, end: 11, value: "E=mc^2", block: false },
    ]);
    expect(findMath("$$x^2$$")[0].block).toBe(true);
  });

  it("转义的 $ 与货币金额不算公式", () => {
    expect(findMath("价格 \\$5 到 \\$10")).toEqual([]);
    expect(findMath("cost $5 and $x$")).toEqual([
      { start: 12, end: 15, value: "x", block: false },
    ]);
  });

  it("空公式和 opening 后紧跟空白都被忽略", () => {
    expect(findMath("$$$")).toEqual([]);
    expect(findMath("$ x$")).toEqual([]);
  });

  it("切分保留前后文本与精确 span", () => {
    const chunks = splitMath("前 $a$ 后", 0, 7);
    expect(chunks).toEqual([
      { kind: "text", start: 0, end: 2, value: "前 " },
      { kind: "math", start: 2, end: 5, value: "a", block: false },
      { kind: "text", start: 5, end: 7, value: " 后" },
    ]);
  });

  it("独占一段的 $$ 才是块级公式", () => {
    expect(standaloneMathBlock("  $$x+1$$  ", 0, 11)?.value).toBe("x+1");
    expect(standaloneMathBlock("前 $$x$$ 后", 0, 9)).toBeNull();
  });
});

describe("公式进入 IR", () => {
  it("行内公式成为 inlineMath 原子，源码 span 准确", () => {
    const src = "公式 $x^2$ 结束";
    const { ir } = parseMarkdown({ source: src });
    const paragraph = ir.children[0];
    if (paragraph.type !== "paragraph") throw new Error("expected paragraph");
    const math = paragraph.children.find((n) => n.type === "inlineMath");
    expect(math).toBeDefined();
    expect(math?.type === "inlineMath" && math.value).toBe("x^2");
    expect(src.slice(math!.span.start, math!.span.end)).toBe("$x^2$");
  });

  it("独占段落的 $$ 成为 mathBlock", () => {
    const { ir } = parseMarkdown({ source: "$$\\frac{a}{b}$$" });
    expect(ir.children[0].type).toBe("mathBlock");
    expect(ir.children[0].type === "mathBlock" && ir.children[0].value).toBe(
      "\\frac{a}{b}",
    );
  });

  it("普通美元符号不是公式", () => {
    const { ir } = parseMarkdown({ source: "价格 $5" });
    const p = ir.children[0];
    if (p.type !== "paragraph") throw new Error("expected paragraph");
    expect(p.children.every((n) => n.type === "text")).toBe(true);
  });
});

describe("公式导出", () => {
  it("导出 HTML 用 MathML，无字体外链，源码不出现在可见文本里", () => {
    const { ir } = parseMarkdown({ source: "行内 $x^2$\n\n$$y_1$$" });
    const html = renderHtmlDocument(ir, { title: "公式", lang: "zh-CN" });
    expect(html).toContain("<math");
    expect(html).toContain("application/x-tex");
    expect(html).toContain("math-block");
    // MathML 路线不该引 KaTeX 的 CSS / 字体
    expect(html).not.toContain("katex.min.css");
    expect(html).not.toContain(".woff");
  });

  it("非法公式不拖垮导出", () => {
    const { ir } = parseMarkdown({ source: "$\\unknown{}$" });
    expect(() => renderBody(ir)).not.toThrow();
  });
});
