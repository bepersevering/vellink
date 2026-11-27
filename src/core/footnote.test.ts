import { describe, expect, it } from "vitest";
import { findFootnotes, splitFootnoteRefs } from "./footnote";
import { parseMarkdown } from "./parser/markdown";
import { renderBody } from "./export/html";

describe("脚注识别", () => {
  it("区分行内引用与行首定义", () => {
    const src = "正文[^1]还有[^note]。\n\n[^1]: 第一条\n[^note]: 第二条\n";
    const { refs, defs } = findFootnotes(src);
    expect(refs.map((r) => r.label)).toEqual(["1", "note"]);
    expect(defs.map((d) => d.label)).toEqual(["1", "note"]);
    expect(defs[0].text).toBe("第一条");
  });

  it("代码块里的 [^1] 不算", () => {
    const { refs, defs } = findFootnotes("```\n[^1]: fake\n```\n\n真引用[^2]\n");
    expect(refs.map((r) => r.label)).toEqual(["2"]);
    expect(defs).toHaveLength(0);
  });

  it("转义的 \\[ 不算", () => {
    expect(findFootnotes("转义 \\[^1] 不算").refs).toHaveLength(0);
  });

  it("切分引用片段保留精确 span", () => {
    const src = "前[^a]后";
    const { refs } = findFootnotes(src);
    const chunks = splitFootnoteRefs(src, 0, src.length, refs);
    expect(chunks.map((c) => c.kind)).toEqual(["text", "ref", "text"]);
    expect(chunks[1].kind === "ref" && chunks[1].label).toBe("a");
    expect(src.slice(chunks[1].start, chunks[1].end)).toBe("[^a]");
  });
});

describe("脚注进入 IR 与导出", () => {
  it("引用是行内 atom，定义是独立块", () => {
    const src = "正文[^1]。\n\n[^1]: 说明文字\n";
    const { ir } = parseMarkdown({ source: src });
    const p = ir.children.find((b) => b.type === "paragraph");
    if (!p || p.type !== "paragraph") throw new Error("no paragraph");
    expect(p.children.some((n) => n.type === "footnoteRef")).toBe(true);
    expect(ir.children.some((b) => b.type === "footnoteDef")).toBe(true);
  });

  it("导出 HTML 有上标引用与文末脚注区", () => {
    const src = "正文[^1]。\n\n[^1]: 说明文字\n";
    const html = renderBody(parseMarkdown({ source: src }).ir);
    expect(html).toContain('class="fn-ref"');
    expect(html).toContain('href="#fn-1"');
    expect(html).toContain('<section class="footnotes">');
    expect(html).toContain('id="fn-1"');
    expect(html).toContain("说明文字");
  });

  it("没有脚注时不产出脚注区", () => {
    const html = renderBody(parseMarkdown({ source: "普通正文" }).ir);
    expect(html).not.toContain("footnotes");
  });
});
