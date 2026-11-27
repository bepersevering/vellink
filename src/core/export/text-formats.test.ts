import { describe, expect, it } from "vitest";
import { parseMarkdown } from "../parser/markdown";
import { renderLatex, renderMediaWiki } from "./text-formats";
import { buildExport } from ".";

const SOURCE = `# 第一章

正文 **粗体** 与 $x^2$。

- 甲
- 乙

| A | B |
|---|---|
| 1 | 2 |
`;

describe("LaTeX 导出", () => {
  const tex = () => renderLatex(parseMarkdown({ source: SOURCE }).ir, "文档");

  it("带中文模板与标题", () => {
    expect(tex()).toContain("\\usepackage{ctex}");
    expect(tex()).toContain("\\title{文档}");
    expect(tex()).toContain("\\chapter{第一章}");
  });

  it("粗体 / 行内公式 / 列表 / 表格映射", () => {
    const out = tex();
    expect(out).toContain("\\textbf{粗体}");
    expect(out).toContain("$x^2$");
    expect(out).toContain("\\begin{itemize}");
    expect(out).toContain("\\begin{tabular}");
    expect(out).toContain("1 & 2");
  });

  it("特殊字符转义，不破坏编译", () => {
    const out = renderLatex(parseMarkdown({ source: "价格 100% & <tag>" }).ir);
    expect(out).toContain("100\\%");
    expect(out).toContain("\\&");
  });
});

describe("MediaWiki 导出", () => {
  const wiki = () => renderMediaWiki(parseMarkdown({ source: SOURCE }).ir);

  it("标题 / 粗体 / 列表 / 表格映射", () => {
    const out = wiki();
    expect(out).toContain("= 第一章 =");
    expect(out).toContain("'''粗体'''");
    expect(out).toContain("* 甲");
    expect(out).toContain('class="wikitable"');
  });

  it("行内公式用 <math> 标签", () => {
    expect(wiki()).toContain("<math>x^2</math>");
  });
});

describe("格式注册", () => {
  it("导出面板拿得到扩展名与 MIME", async () => {
    for (const [format, ext] of [["latex", "tex"], ["mediawiki", "wiki"]] as const) {
      const payload = await buildExport({ format, title: "标题", source: SOURCE });
      expect(payload.extension).toBe(ext);
      expect(payload.fileName.endsWith(`.${ext}`)).toBe(true);
      expect(typeof payload.contents).toBe("string");
    }
  });
});
