import { describe, expect, it } from "vitest";
import { findMath, splitMath, standaloneMathBlock } from "./math";
import { parseMarkdown } from "./parser/markdown";
import { renderBody, renderHtmlDocument } from "./export/html";

describe("math recognition", () => {
  it("inline $...$ and block $$...$$", () => {
    expect(findMath("Energy $E=mc^2$ is famous")).toEqual([
      { start: 7, end: 15, value: "E=mc^2", block: false },
    ]);
    expect(findMath("$$x^2$$")[0].block).toBe(true);
  });

  it("escaped $ and currency amounts aren't math", () => {
    expect(findMath("price \\$5 to \\$10")).toEqual([]);
    expect(findMath("cost $5 and $x$")).toEqual([
      { start: 12, end: 15, value: "x", block: false },
    ]);
  });

  it("ignores empty formulas and whitespace right after the opening delimiter", () => {
    expect(findMath("$$$")).toEqual([]);
    expect(findMath("$ x$")).toEqual([]);
  });

  it("splitting preserves surrounding text and exact spans", () => {
    const chunks = splitMath("before $a$ after", 0, 16);
    expect(chunks).toEqual([
      { kind: "text", start: 0, end: 7, value: "before " },
      { kind: "math", start: 7, end: 10, value: "a", block: false },
      { kind: "text", start: 10, end: 16, value: " after" },
    ]);
  });

  it("only a standalone $$ becomes a block formula", () => {
    expect(standaloneMathBlock("  $$x+1$$  ", 0, 11)?.value).toBe("x+1");
    expect(standaloneMathBlock("before $$x$$ after", 0, 18)).toBeNull();
  });
});

describe("math in IR", () => {
  it("turns inline math into an inlineMath atom with an accurate source span", () => {
    const src = "Formula $x^2$ end";
    const { ir } = parseMarkdown({ source: src });
    const paragraph = ir.children[0];
    if (paragraph.type !== "paragraph") throw new Error("expected paragraph");
    const math = paragraph.children.find((n) => n.type === "inlineMath");
    expect(math).toBeDefined();
    expect(math?.type === "inlineMath" && math.value).toBe("x^2");
    expect(src.slice(math!.span.start, math!.span.end)).toBe("$x^2$");
  });

  it("turns a standalone $$ into a mathBlock", () => {
    const { ir } = parseMarkdown({ source: "$$\\frac{a}{b}$$" });
    expect(ir.children[0].type).toBe("mathBlock");
    expect(ir.children[0].type === "mathBlock" && ir.children[0].value).toBe(
      "\\frac{a}{b}",
    );
  });

  it("treats ordinary dollar signs as plain text", () => {
    const { ir } = parseMarkdown({ source: "Price $5" });
    const p = ir.children[0];
    if (p.type !== "paragraph") throw new Error("expected paragraph");
    expect(p.children.every((n) => n.type === "text")).toBe(true);
  });
});

describe("math export", () => {
  it("uses MathML with no external fonts and keeps raw source out of visible text", () => {
    const { ir } = parseMarkdown({ source: "Inline $x^2$\n\n$$y_1$$" });
    const html = renderHtmlDocument(ir, { title: "Formula", lang: "zh-CN" });
    expect(html).toContain("<math");
    expect(html).toContain("application/x-tex");
    expect(html).toContain("math-block");
    // The MathML path shouldn't pull in KaTeX CSS / fonts
    expect(html).not.toContain("katex.min.css");
    expect(html).not.toContain(".woff");
  });

  it("doesn't let invalid math break export", () => {
    const { ir } = parseMarkdown({ source: "$\\unknown{}$" });
    expect(() => renderBody(ir)).not.toThrow();
  });
});
