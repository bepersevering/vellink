import { describe, expect, it } from "vitest";
import { buildExport, clampRange, fileNameFor } from "./index";
import { docCss, escapeHtml, safeUrl, renderHtmlDocument } from "./html";
import { parseMarkdown } from "../parser/markdown";

const SAMPLE = `# 标题

第一段有 **粗体** 与 \`行内代码\`，还有一个 [链接](https://example.com "说明")。

## 小标题

- 甲
- [x] 乙

| 左 | 右 |
|:--|--:|
| 1 | 2 |

> 引用

\`\`\`js
const a = 1 < 2;
\`\`\`

---
`;

function htmlOf(source: string): string {
  const { ir } = parseMarkdown({ source });
  return renderHtmlDocument(ir, { title: "标题" });
}

describe("导出文件名", () => {
  it("标题里的非法字符换成连字符，正文文字保留", () => {
    expect(fileNameFor('a/b:c*?"<>|d', "md")).toBe("a-b-c-d.md");
    expect(fileNameFor("周报 2026-11", "html")).toBe("周报 2026-11.html");
  });

  it("没有标题时给一个稳定的兜底名", () => {
    expect(fileNameFor("", "md")).toBe("untitled.md");
    expect(fileNameFor("   ", "pdf")).toBe("untitled.pdf");
  });

  it("首尾的点与空格去掉（Windows 不允许以点结尾）", () => {
    expect(fileNameFor("  ..周报.. ", "md")).toBe("周报.md");
  });

  it("超长标题截断，仍保留扩展名", () => {
    const name = fileNameFor("长".repeat(200), "md");
    expect(name.endsWith(".md")).toBe(true);
    expect(name.length).toBeLessThanOrEqual(83);
  });
});

describe("导出范围", () => {
  it("区间夹到源码范围内，反着给也能纠正", () => {
    expect(clampRange("abcdef", { from: 4, to: 2 })).toEqual({ from: 2, to: 4 });
    expect(clampRange("abcdef", { from: -5, to: 99 })).toEqual({ from: 0, to: 6 });
  });

  it("空区间视为没选区", () => {
    expect(clampRange("abcdef", { from: 3, to: 3 })).toBeNull();
    expect(clampRange("abcdef", null)).toBeNull();
  });

  it("选区导出带后缀，不会和整篇导出撞名", () => {
    const base = { title: "周报", source: "# 周报\n\n第一段\n" } as const;
    const all = buildExport({ ...base, format: "markdown" });
    const part = buildExport({
      ...base,
      format: "markdown",
      range: { from: 5, to: 8 },
      selectionSuffix: " · 摘录",
    });
    expect(all.fileName).toBe("周报.md");
    expect(part.fileName).toBe("周报 · 摘录.md");
  });

  it("选区落在空白上退回整篇时，也不带后缀（它导的确实是整篇）", () => {
    const payload = buildExport({
      format: "markdown",
      title: "周报",
      source: "# 周报\n\n\n\n正文\n",
      range: { from: 4, to: 6 },
      selectionSuffix: " · 摘录",
    });
    expect(payload.fileName).toBe("周报.md");
  });
});

describe("Markdown 导出", () => {
  it("整篇原样导出，末尾规范化成单个换行", () => {
    const payload = buildExport({
      format: "markdown",
      title: "标题",
      source: "# a\n\nb\n\n\n",
    });
    expect(payload.contents).toBe("# a\n\nb\n");
    expect(payload.fileName).toBe("标题.md");
    expect(payload.mime).toContain("text/markdown");
  });

  it("选区只导那一段，不做重新序列化", () => {
    const payload = buildExport({
      format: "markdown",
      title: "标题",
      source: "# a\n\n第一段\n\n第二段\n",
      range: { from: 5, to: 8 },
    });
    expect(payload.contents).toBe("第一段\n");
  });

  it("选区落在空白上时退回整篇，而不是给个空文件", () => {
    const source = "# a\n\n\n\nb\n";
    const payload = buildExport({
      format: "markdown",
      title: "标题",
      source,
      range: { from: 4, to: 6 },
    });
    expect(payload.contents).toBe(source);
  });
});

describe("HTML 导出", () => {
  it("是完整的独立文档：doctype、charset、内联样式", () => {
    const html = htmlOf(SAMPLE);
    expect(html.startsWith("<!doctype html>")).toBe(true);
    expect(html).toContain('<meta charset="utf-8">');
    expect(html).toContain("<title>标题</title>");
    expect(html).toContain("<style>");
    // 不引任何外部资源
    expect(html).not.toContain("<script");
    expect(html).not.toContain("http-equiv");
  });

  it("标题、粗体、行内代码、链接都成标签", () => {
    const html = htmlOf(SAMPLE);
    expect(html).toContain('<h1 id="标题">标题</h1>');
    expect(html).toContain('<h2 id="小标题">小标题</h2>');
    expect(html).toContain("<strong>粗体</strong>");
    expect(html).toContain("<code>行内代码</code>");
    expect(html).toContain('<a href="https://example.com" title="说明" rel="noopener">链接</a>');
  });

  it("代码块被转义且着色，不会把 < 当成标签", () => {
    const html = htmlOf(SAMPLE);
    // 着色只套 span，所有文本仍走 HTML 转义
    expect(html).toContain('class="language-js"');
    expect(html).toContain('<span class="kw">const</span> a = <span class="nu">1</span> &lt; <span class="nu">2</span>;');
    expect(html).not.toContain("< 2;");
  });

  it("任务列表带禁用复选框，普通列表项不塞 <p>", () => {
    const html = htmlOf(SAMPLE);
    expect(html).toContain('<li class="task"><input type="checkbox" disabled checked> 乙</li>');
    expect(html).toContain("<li>甲</li>");
  });

  it("表格首行进 thead，对齐方式落到单元格上", () => {
    const html = htmlOf(SAMPLE);
    expect(html).toContain('<thead><tr><th style="text-align:left">左</th><th style="text-align:right">右</th></tr></thead>');
    expect(html).toContain('<tbody><tr><td style="text-align:left">1</td><td style="text-align:right">2</td></tr></tbody>');
  });

  it("引用与分隔线", () => {
    const html = htmlOf(SAMPLE);
    expect(html).toContain("<blockquote>");
    expect(html).toContain("<hr>");
  });

  it("双链导出成可读文本而不是会 404 的链接", () => {
    const html = htmlOf("看看 [[另一篇笔记]]\n");
    expect(html).toContain('<span class="wl">另一篇笔记</span>');
    expect(html).not.toContain("<a");
  });

  it("硬换行还原成 <br>，段内软换行仍是空格", () => {
    const html = htmlOf("第一行  \n第二行\n\n软\n换行\n");
    expect(html).toContain("第一行<br>第二行");
    // 软换行交给 HTML 折叠，不生成 <br>
    expect(html.match(/<br>/g)?.length).toBe(1);
  });

  it("正文里的尖括号与 & 一律转义", () => {
    const html = htmlOf("判断 a < b && c > d 是否成立\n");
    expect(html).toContain("a &lt; b &amp;&amp; c &gt; d");
    expect(escapeHtml('a & b "c"')).toBe("a &amp; b &quot;c&quot;");
  });

  it("裸 HTML 块不在 IR 里：导出与编辑器一致地不显示它", () => {
    // IR 没有 HTML 节点，WYSIWYG 也从不渲染它；导出保持同一语义，
    // 而不是偷偷把一段 markdown 当 HTML 塞进新文件
    const html = htmlOf("<div onclick=\"x()\">hi</div>\n");
    expect(html).not.toContain("<div");
    expect(html).not.toContain("onclick");
  });

  it("选区导出走重新解析：段落仍然成段", () => {
    const payload = buildExport({
      format: "html",
      title: "标题",
      source: "# a\n\n第一段\n\n第二段\n",
      range: { from: 5, to: 8 },
    });
    expect(payload.contents).toContain("<p>第一段</p>");
    expect(payload.contents).not.toContain("第二段");
  });
});

describe("导出里的链接协议", () => {
  it("放行 http(s)/mailto/tel/file 与相对路径", () => {
    expect(safeUrl("https://example.com/a?b=1")).toBe("https://example.com/a?b=1");
    expect(safeUrl("mailto:a@b.c")).toBe("mailto:a@b.c");
    expect(safeUrl("tel:+8610000")).toBe("tel:+8610000");
    expect(safeUrl("file:///tmp/a.md")).toBe("file:///tmp/a.md");
    expect(safeUrl("./images/a.png")).toBe("./images/a.png");
    expect(safeUrl("#小节")).toBe("#小节");
  });

  it("javascript:/data:/vbscript: 一律降到 #，且不残留在文件里", () => {
    expect(safeUrl("javascript:alert(1)")).toBe("#");
    expect(safeUrl(" JavaScript:alert(1)")).toBe("#");
    expect(safeUrl("data:text/html,<script>x</script>")).toBe("#");
    expect(safeUrl("vbscript:msgbox")).toBe("#");
    // 转义解决不了这个问题，所以必须在协议层拦
    const html = htmlOf("[点我](javascript:alert(1))\n");
    expect(html).not.toContain("javascript:");
    expect(html).toContain('<a href="#" rel="noopener">点我</a>');
  });

  it("图片允许内联 data:image，但不允许 data:text/html", () => {
    const ok = htmlOf("![图](data:image/png;base64,iVBORw0KGgo=)\n");
    expect(ok).toContain('src="data:image/png;base64,iVBORw0KGgo="');
    const bad = htmlOf("![图](data:text/html,<script>x</script>)\n");
    expect(bad).not.toContain("data:text/html");
  });
});

describe("PDF 载荷", () => {
  it("只给正文片段和字体排版，打印面板自己套样式", () => {
    const payload = buildExport({ format: "pdf", title: "标题", source: SAMPLE });
    expect(payload.extension).toBe("pdf");
    expect(payload.fileName).toBe("标题.pdf");
    expect(payload.contents).toContain('<h1 id="标题">标题</h1>');
    expect(payload.contents).not.toContain("<html");
    expect(payload.contents).not.toContain("<style");
  });
});

describe("排版样式", () => {
  it("同一份样式可以挂到不同根节点上", () => {
    const standalone = docCss("body");
    const sheet = docCss(".print-sheet", { dark: false });
    expect(standalone).toContain("body p { margin: 0 0 20px; }");
    expect(sheet).toContain(".print-sheet p { margin: 0 0 20px; }");
    expect(sheet).not.toContain("__R__");
    // 打印面板不跟随深色偏好：那会把深色背景带上纸
    expect(sheet).not.toContain("prefers-color-scheme");
    expect(standalone).toContain("prefers-color-scheme");
  });

  it("打印规则里带 @page 与避免断行", () => {
    const css = docCss("body");
    expect(css).toContain("@page");
    expect(css).toContain("page-break-inside: avoid");
  });
});
