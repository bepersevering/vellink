import { describe, expect, it } from "vitest";
import { highlightHtml, tokenize } from "./code-highlight";
import { parseMarkdown } from "../parser/markdown";
import { renderBody } from "../export/html";

describe("Code tokenization", () => {
  it("recognizes keywords, strings, numbers and line comments", () => {
    const tokens = tokenize('const x = 42; // comment\nlet s = "hi";', "js");
    expect(tokens.filter((t) => t.kind === "keyword").map((t) => t.text)).toEqual([
      "const",
      "let",
    ]);
    expect(tokens.find((t) => t.kind === "number")?.text).toBe("42");
    expect(tokens.find((t) => t.kind === "string")?.text).toBe('"hi"');
    expect(tokens.find((t) => t.kind === "comment")?.text).toBe("// comment");
  });

  it("allows block comments to span lines", () => {
    const tokens = tokenize("a /* cross\nline */ b", "rust");
    expect(tokens.find((t) => t.kind === "comment")?.text).toBe("/* cross\nline */");
    expect(tokens.at(-1)?.text).toBe(" b");
  });

  it("uses # rather than // for line comments in Python", () => {
    const tokens = tokenize("# note\nx = 1", "python");
    expect(tokens[0]).toEqual({ kind: "comment", text: "# note" });
    expect(tokens.some((t) => t.kind === "keyword" && t.text === "x")).toBe(false);
  });

  it("still highlights via the common keyword list when no language is given", () => {
    const tokens = tokenize('const x = "a"', "");
    expect(tokens.some((t) => t.kind === "keyword" && t.text === "const")).toBe(true);
    expect(tokens.some((t) => t.kind === "string")).toBe(true);
  });

  it("doesn't end a string early on an escaped quote", () => {
    const tokens = tokenize('"a\\"b" + 1', "js");
    expect(tokens.find((t) => t.kind === "string")?.text).toBe('"a\\"b"');
  });

  it("assigns every character to a token without losing content", () => {
    for (const code of ["", "abc", "a/*x*/b", "const s='text'; # note", "`tpl ${x}`"]) {
      const joined = tokenize(code, "js").map((t) => t.text).join("");
      expect(joined).toBe(code);
    }
  });
});

describe("Highlighted HTML", () => {
  it("emits classed spans and escapes HTML metacharacters", () => {
    const html = highlightHtml('const s = "<script>";', "js");
    expect(html).toContain('<span class="kw">const</span>');
    expect(html).toContain('<span class="st">"&lt;script&gt;"</span>');
    expect(html).not.toContain("<script>");
  });

  it("gives code blocks in exported HTML a highlight class", () => {
    const { ir } = parseMarkdown({
      source: "```js\nconst x = 1;\n```",
    });
    const html = renderBody(ir);
    expect(html).toContain('<span class="kw">const</span>');
    expect(html).toContain('<span class="nu">1</span>');
    expect(html).toContain("language-js");
  });

  it("highlights code blocks with no language tag while keeping HTML escaping", () => {
    const { ir } = parseMarkdown({ source: "```\nconst x = 1;\n```" });
    const html = renderBody(ir);
    expect(html).toContain('class="kw"');
    expect(html).toContain("x = ");
  });
});
