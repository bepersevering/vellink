import { describe, expect, it } from "vitest";
import { highlightHtml, tokenize } from "./code-highlight";
import { parseMarkdown } from "../parser/markdown";
import { renderBody } from "../export/html";

describe("代码分词", () => {
  it("识别关键字、字符串、数字、行注释", () => {
    const tokens = tokenize('const x = 42; // 注释\nlet s = "hi";', "js");
    expect(tokens.filter((t) => t.kind === "keyword").map((t) => t.text)).toEqual([
      "const",
      "let",
    ]);
    expect(tokens.find((t) => t.kind === "number")?.text).toBe("42");
    expect(tokens.find((t) => t.kind === "string")?.text).toBe('"hi"');
    expect(tokens.find((t) => t.kind === "comment")?.text).toBe("// 注释");
  });

  it("块注释可跨行", () => {
    const tokens = tokenize("a /* 跨\n行 */ b", "rust");
    expect(tokens.find((t) => t.kind === "comment")?.text).toBe("/* 跨\n行 */");
    expect(tokens.at(-1)?.text).toBe(" b");
  });

  it("Python 用 # 而不是 // 作行注释", () => {
    const tokens = tokenize("# note\nx = 1", "python");
    expect(tokens[0]).toEqual({ kind: "comment", text: "# note" });
    expect(tokens.some((t) => t.kind === "keyword" && t.text === "x")).toBe(false);
  });

  it("无语言时仍按通用关键字表着色，不退化成单色", () => {
    const tokens = tokenize('const x = "a"', "");
    expect(tokens.some((t) => t.kind === "keyword" && t.text === "const")).toBe(true);
    expect(tokens.some((t) => t.kind === "string")).toBe(true);
  });

  it("转义引号不提前结束字符串", () => {
    const tokens = tokenize('"a\\"b" + 1', "js");
    expect(tokens.find((t) => t.kind === "string")?.text).toBe('"a\\"b"');
  });

  it("所有字符都归属某个 token，不丢内容", () => {
    for (const code of ["", "abc", "a/*x*/b", "const s='中文'; # 注", "`tpl ${x}`"]) {
      const joined = tokenize(code, "js").map((t) => t.text).join("");
      expect(joined).toBe(code);
    }
  });
});

describe("着色 HTML", () => {
  it("输出带 class 的 span，且转义 HTML 元字符", () => {
    const html = highlightHtml('const s = "<script>";', "js");
    expect(html).toContain('<span class="kw">const</span>');
    expect(html).toContain('<span class="st">"&lt;script&gt;"</span>');
    expect(html).not.toContain("<script>");
  });

  it("导出 HTML 的代码块带高亮 class", () => {
    const { ir } = parseMarkdown({
      source: "```js\nconst x = 1;\n```",
    });
    const html = renderBody(ir);
    expect(html).toContain('<span class="kw">const</span>');
    expect(html).toContain('<span class="nu">1</span>');
    expect(html).toContain("language-js");
  });

  it("未标注语言的代码块也着色，并保持 HTML 转义", () => {
    const { ir } = parseMarkdown({ source: "```\nconst x = 1;\n```" });
    const html = renderBody(ir);
    expect(html).toContain('class="kw"');
    expect(html).toContain("x = ");
  });
});
