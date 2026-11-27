import { describe, expect, it } from "vitest";
import { buildOutline, docTitle } from "./outline";

describe("buildOutline", () => {
  it("extracts top-level headings, levels and source offsets", () => {
    const source = ["# One", "", "## Two", "", "### Three", "", "Body"].join("\n");
    const outline = buildOutline(source);

    expect(outline.map((item) => [item.level, item.depth, item.label])).toEqual([
      [1, 1, "One"],
      [2, 2, "Two"],
      [3, 3, "Three"],
    ]);
    expect(source.slice(outline[1].offset, outline[1].offset + 2)).toBe("##");
  });

  it("normalizes level 4–6 headings to level 3 in the panel", () => {
    const outline = buildOutline("#### Level Four\n\n##### Level Five");
    expect(outline.map((item) => item.level)).toEqual([3, 3]);
    expect(outline.map((item) => item.depth)).toEqual([4, 5]);
  });

  it("ignores headings inside code blocks, blockquotes and lists", () => {
    const source = [
      "# Real Title",
      "",
      "```md",
      "# Hash in code",
      "```",
      "",
      "> # Heading in a quote",
      "",
      "- ## Heading in a list",
    ].join("\n");

    expect(buildOutline(source).map((item) => item.label)).toEqual(["Real Title"]);
  });

  it("keeps only visible text from emphasis and links in headings", () => {
    const outline = buildOutline("## About **Key Point** and [Link](https://example.com)");
    expect(outline[0].label).toBe("About Key Point and Link");
  });

  it("produces no entry for an empty heading", () => {
    expect(buildOutline("##\n\nBody")).toHaveLength(0);
  });
});

describe("docTitle", () => {
  it("prefers the H1 rather than the first heading encountered", () => {
    expect(docTitle("## Section\n\n# Real Title")).toBe("Real Title");
  });

  it("falls back to the first heading when there is no H1", () => {
    expect(docTitle("## Section\n\nBody")).toBe("Section");
  });

  it("falls back to the first non-empty line when there is no heading", () => {
    expect(docTitle("\n\n  First line of text\n\nSecond line")).toBe("First line of text");
  });

  it("uses the fallback name for a completely empty document", () => {
    expect(docTitle("   \n\n", "Untitled")).toBe("Untitled");
  });
});
