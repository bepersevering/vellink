import { describe, expect, it } from "vitest";
import { parseHTML } from "linkedom";
import { htmlToMarkdown } from "./paste-html";

function convert(html: string) {
  const { document } = parseHTML("<!doctype html><html><body></body></html>");
  return htmlToMarkdown(html, document as unknown as Document);
}

describe("网页复制 → Markdown", () => {
  it("标题、段落、粗斜体、行内代码、链接", () => {
    const { markdown } = convert(
      "<h1>标题</h1><p>这是 <strong>粗体</strong> 和 <em>斜体</em>，还有 <code>x = 1</code>。" +
        '<p>看 <a href="https://example.com">这里</a></p>',
    );
    expect(markdown).toContain("# 标题");
    expect(markdown).toContain("**粗体**");
    expect(markdown).toContain("*斜体*");
    expect(markdown).toContain("`x = 1`");
    expect(markdown).toContain("[这里](https://example.com)");
  });

  it("列表（有序 / 无序）", () => {
    const { markdown } = convert(
      "<ul><li>甲</li><li>乙<ul><li>嵌套</li></ul></li></ul>" +
        "<ol><li>第一</li><li>第二</li></ol>",
    );
    expect(markdown).toContain("- 甲");
    expect(markdown).toContain("- 乙");
    expect(markdown).toContain("1. 第一");
    expect(markdown).toContain("2. 第二");
  });

  it("代码块保留语言与原文", () => {
    const { markdown } = convert(
      '<pre><code class="language-js">const x = 1;\nif (x) return;</code></pre>',
    );
    expect(markdown).toContain("```js");
    expect(markdown).toContain("const x = 1;\nif (x) return;");
    expect(markdown).toContain("```");
  });

  it("引用与表格", () => {
    const { markdown } = convert(
      "<blockquote><p>引用文字</p></blockquote>" +
        "<table><tr><th>A</th><th>B</th></tr><tr><td>1</td><td>2</td></tr></table>",
    );
    expect(markdown).toContain("> 引用文字");
    expect(markdown).toContain("| A | B |");
    expect(markdown).toContain("| 1 | 2 |");
  });

  it("图片收集 URL，data URI 与 javascript 链接被丢弃", () => {
    const { markdown, images } = convert(
      '<p><img src="https://example.com/a.png" alt="图"></p>' +
        '<img src="data:image/png;base64,AAA">' +
        '<a href="javascript:alert(1)">危险</a>',
    );
    expect(images).toEqual(["https://example.com/a.png"]);
    expect(markdown).toContain("![图](https://example.com/a.png)");
    expect(markdown).not.toContain("data:image");
    expect(markdown).toContain("危险");
    expect(markdown).not.toContain("javascript:");
  });

  it("script / style 内容不进正文", () => {
    const { markdown } = convert(
      "<style>.a{color:red}</style><script>alert(1)</script><p>正文</p>",
    );
    expect(markdown).toBe("正文");
  });

  it("Markdown 特殊字符被转义，不会被误认成语法", () => {
    const { markdown } = convert("<p>价格 * 5 [括号] 反斜杠\\ 结束</p>");
    expect(markdown).toContain("\\*");
    expect(markdown).toContain("\\[括号\\]");
  });

  it("连续空行被压缩", () => {
    const { markdown } = convert("<p>A</p><p></p><p></p><p>B</p>");
    expect(markdown).toBe("A\n\nB");
  });

  it("空 HTML 返回空串", () => {
    expect(convert("").markdown).toBe("");
    expect(convert("<div></div>").markdown).toBe("");
  });
});
