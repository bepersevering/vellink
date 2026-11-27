import { describe, expect, it } from "vitest";
import { findFootnotes, splitFootnoteRefs } from "./footnote";
import { parseMarkdown } from "./parser/markdown";
import { renderBody } from "./export/html";

describe("footnote recognition", () => {
  it("distinguishes inline references from line-start definitions", () => {
    const src = "Body[^1]more[^note].\n\n[^1]: first note\n[^note]: second note\n";
    const { refs, defs } = findFootnotes(src);
    expect(refs.map((r) => r.label)).toEqual(["1", "note"]);
    expect(defs.map((d) => d.label)).toEqual(["1", "note"]);
    expect(defs[0].text).toBe("first note");
  });

  it("ignores [^1] inside code blocks", () => {
    const { refs, defs } = findFootnotes("```\n[^1]: fake\n```\n\nreal reference[^2]\n");
    expect(refs.map((r) => r.label)).toEqual(["2"]);
    expect(defs).toHaveLength(0);
  });

  it("ignores escaped \\[", () => {
    expect(findFootnotes("escaped \\[^1] not counted").refs).toHaveLength(0);
  });

  it("splits reference fragments with exact spans", () => {
    const src = "before[^a]after";
    const { refs } = findFootnotes(src);
    const chunks = splitFootnoteRefs(src, 0, src.length, refs);
    expect(chunks.map((c) => c.kind)).toEqual(["text", "ref", "text"]);
    expect(chunks[1].kind === "ref" && chunks[1].label).toBe("a");
    expect(src.slice(chunks[1].start, chunks[1].end)).toBe("[^a]");
  });
});

describe("footnotes in IR and export", () => {
  it("references are inline atoms; definitions are separate blocks", () => {
    const src = "Body[^1].\n\n[^1]: explanation text\n";
    const { ir } = parseMarkdown({ source: src });
    const p = ir.children.find((b) => b.type === "paragraph");
    if (!p || p.type !== "paragraph") throw new Error("no paragraph");
    expect(p.children.some((n) => n.type === "footnoteRef")).toBe(true);
    expect(ir.children.some((b) => b.type === "footnoteDef")).toBe(true);
  });

  it("HTML export has superscript references and an end-of-document footnote section", () => {
    const src = "Body[^1].\n\n[^1]: explanation text\n";
    const html = renderBody(parseMarkdown({ source: src }).ir);
    expect(html).toContain('class="fn-ref"');
    expect(html).toContain('href="#fn-1"');
    expect(html).toContain('<section class="footnotes">');
    expect(html).toContain('id="fn-1"');
    expect(html).toContain("explanation text");
  });

  it("emits no footnote section when there are no footnotes", () => {
    const html = renderBody(parseMarkdown({ source: "plain body text" }).ir);
    expect(html).not.toContain("footnotes");
  });
});
