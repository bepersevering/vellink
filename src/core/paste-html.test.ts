import { describe, expect, it } from "vitest";
import { parseHTML } from "linkedom";
import { htmlToMarkdown } from "./paste-html";

function convert(html: string) {
  const { document } = parseHTML("<!doctype html><html><body></body></html>");
  return htmlToMarkdown(html, document as unknown as Document);
}

describe("web copy → Markdown", () => {
  it("headings, paragraphs, bold/italic, inline code, links", () => {
    const { markdown } = convert(
      "<h1>Title</h1><p>This is <strong>bold</strong> and <em>italic</em>, plus <code>x = 1</code>." +
        '<p>See <a href="https://example.com">this link</a></p>',
    );
    expect(markdown).toContain("# Title");
    expect(markdown).toContain("**bold**");
    expect(markdown).toContain("*italic*");
    expect(markdown).toContain("`x = 1`");
    expect(markdown).toContain("[this link](https://example.com)");
  });

  it("lists (ordered / unordered)", () => {
    const { markdown } = convert(
      "<ul><li>first</li><li>second<ul><li>nested</li></ul></li></ul>" +
        "<ol><li>one</li><li>two</li></ol>",
    );
    expect(markdown).toContain("- first");
    expect(markdown).toContain("- second");
    expect(markdown).toContain("1. one");
    expect(markdown).toContain("2. two");
  });

  it("code blocks keep their language and verbatim content", () => {
    const { markdown } = convert(
      '<pre><code class="language-js">const x = 1;\nif (x) return;</code></pre>',
    );
    expect(markdown).toContain("```js");
    expect(markdown).toContain("const x = 1;\nif (x) return;");
    expect(markdown).toContain("```");
  });

  it("blockquotes and tables", () => {
    const { markdown } = convert(
      "<blockquote><p>quoted text</p></blockquote>" +
        "<table><tr><th>A</th><th>B</th></tr><tr><td>1</td><td>2</td></tr></table>",
    );
    expect(markdown).toContain("> quoted text");
    expect(markdown).toContain("| A | B |");
    expect(markdown).toContain("| 1 | 2 |");
  });

  it("collects image URLs; data URIs and javascript links are dropped", () => {
    const { markdown, images } = convert(
      '<p><img src="https://example.com/a.png" alt="image"></p>' +
        '<img src="data:image/png;base64,AAA">' +
        '<a href="javascript:alert(1)">danger</a>',
    );
    expect(images).toEqual(["https://example.com/a.png"]);
    expect(markdown).toContain("![image](https://example.com/a.png)");
    expect(markdown).not.toContain("data:image");
    expect(markdown).toContain("danger");
    expect(markdown).not.toContain("javascript:");
  });

  it("keeps script / style content out of the body", () => {
    const { markdown } = convert(
      "<style>.a{color:red}</style><script>alert(1)</script><p>body text</p>",
    );
    expect(markdown).toBe("body text");
  });

  it("escapes Markdown special characters so they aren't mistaken for syntax", () => {
    const { markdown } = convert("<p>price * 5 [brackets] backslash\\ end</p>");
    expect(markdown).toContain("\\*");
    expect(markdown).toContain("\\[brackets\\]");
  });

  it("collapses consecutive blank lines", () => {
    const { markdown } = convert("<p>A</p><p></p><p></p><p>B</p>");
    expect(markdown).toBe("A\n\nB");
  });

  it("returns an empty string for empty HTML", () => {
    expect(convert("").markdown).toBe("");
    expect(convert("<div></div>").markdown).toBe("");
  });
});
