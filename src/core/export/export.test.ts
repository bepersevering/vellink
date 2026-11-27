import { describe, expect, it } from "vitest";
import { buildExport, clampRange, fileNameFor } from "./index";
import { docCss, escapeHtml, safeUrl, renderHtmlDocument } from "./html";
import { parseMarkdown } from "../parser/markdown";

const SAMPLE = `# Title

The first paragraph has **bold** and \`inline code\`, plus a [link](https://example.com "hint").

## Subtitle

- Alpha
- [x] Beta

| Left | Right |
|:--|--:|
| 1 | 2 |

> Quote

\`\`\`js
const a = 1 < 2;
\`\`\`

---
`;

function htmlOf(source: string): string {
  const { ir } = parseMarkdown({ source });
  return renderHtmlDocument(ir, { title: "Title" });
}

describe("Export file names", () => {
  it("replaces illegal characters in the title with hyphens and keeps regular text", () => {
    expect(fileNameFor('a/b:c*?"<>|d', "md")).toBe("a-b-c-d.md");
    expect(fileNameFor("Report 2026-11", "html")).toBe("Report 2026-11.html");
  });

  it("uses a stable fallback when there is no title", () => {
    expect(fileNameFor("", "md")).toBe("untitled.md");
    expect(fileNameFor("   ", "pdf")).toBe("untitled.pdf");
  });

  it("strips leading/trailing dots and spaces (Windows disallows names ending in a dot)", () => {
    expect(fileNameFor("  ..Report.. ", "md")).toBe("Report.md");
  });

  it("truncates overly long titles while keeping the extension", () => {
    const name = fileNameFor("Long".repeat(200), "md");
    expect(name.endsWith(".md")).toBe(true);
    expect(name.length).toBeLessThanOrEqual(83);
  });
});

describe("Export range", () => {
  it("clamps the range to the source and corrects reversed bounds", async () => {
    expect(clampRange("abcdef", { from: 4, to: 2 })).toEqual({ from: 2, to: 4 });
    expect(clampRange("abcdef", { from: -5, to: 99 })).toEqual({ from: 0, to: 6 });
  });

  it("treats an empty range as no selection", async () => {
    expect(clampRange("abcdef", { from: 3, to: 3 })).toBeNull();
    expect(clampRange("abcdef", null)).toBeNull();
  });

  it("gives selection exports a suffix so they don't collide with full exports", async () => {
    const base = { title: "Report", source: "# Report\n\nFirst part\n" } as const;
    const all = await buildExport({ ...base, format: "markdown" });
    const part = await buildExport({
      ...base,
      format: "markdown",
      range: { from: 5, to: 8 },
      selectionSuffix: " · Excerpt",
    });
    expect(all.fileName).toBe("Report.md");
    expect(part.fileName).toBe("Report · Excerpt.md");
  });

  it("drops the suffix when the selection falls on whitespace and falls back to the whole doc", async () => {
    const payload = await buildExport({
      format: "markdown",
      title: "Report",
      source: "# Report\n\n\n\nBody\n",
      range: { from: 8, to: 11 },
      selectionSuffix: " · Excerpt",
    });
    expect(payload.fileName).toBe("Report.md");
  });
});

describe("Markdown export", () => {
  it("exports the whole source verbatim, normalizing the trailing newline to one", async () => {
    const payload = await buildExport({
      format: "markdown",
      title: "Title",
      source: "# a\n\nb\n\n\n",
    });
    expect(payload.contents).toBe("# a\n\nb\n");
    expect(payload.fileName).toBe("Title.md");
    expect(payload.mime).toContain("text/markdown");
  });

  it("exports only the selected part without re-serializing it", async () => {
    const payload = await buildExport({
      format: "markdown",
      title: "Title",
      source: "# a\n\nFirst\n\nSecond\n",
      range: { from: 5, to: 10 },
    });
    expect(payload.contents).toBe("First\n");
  });

  it("falls back to the whole doc when the selection is only whitespace, rather than giving an empty file", async () => {
    const source = "# a\n\n\n\nb\n";
    const payload = await buildExport({
      format: "markdown",
      title: "Title",
      source,
      range: { from: 4, to: 6 },
    });
    expect(payload.contents).toBe(source);
  });
});

describe("HTML export", () => {
  it("is a complete standalone document: doctype, charset, inline styles", () => {
    const html = htmlOf(SAMPLE);
    expect(html.startsWith("<!doctype html>")).toBe(true);
    expect(html).toContain('<meta charset="utf-8">');
    expect(html).toContain("<title>Title</title>");
    expect(html).toContain("<style>");
    // No external resources
    expect(html).not.toContain("<script");
    expect(html).not.toContain("http-equiv");
  });

  it("turns headings, bold, inline code and links into tags", () => {
    const html = htmlOf(SAMPLE);
    expect(html).toContain('<h1 id="title">Title</h1>');
    expect(html).toContain('<h2 id="subtitle">Subtitle</h2>');
    expect(html).toContain("<strong>bold</strong>");
    expect(html).toContain("<code>inline code</code>");
    expect(html).toContain('<a href="https://example.com" title="hint" rel="noopener">link</a>');
  });

  it("escapes and highlights code blocks without treating < as a tag", () => {
    const html = htmlOf(SAMPLE);
    // Highlighting only adds spans; all text still goes through HTML escaping
    expect(html).toContain('class="language-js"');
    expect(html).toContain('<span class="kw">const</span> a = <span class="nu">1</span> &lt; <span class="nu">2</span>;');
    expect(html).not.toContain("< 2;");
  });

  it("gives task lists disabled checkboxes and doesn't wrap plain list items in <p>", () => {
    const html = htmlOf(SAMPLE);
    expect(html).toContain('<li class="task"><input type="checkbox" disabled checked> Beta</li>');
    expect(html).toContain("<li>Alpha</li>");
  });

  it("puts the table header row in thead and applies alignment to cells", () => {
    const html = htmlOf(SAMPLE);
    expect(html).toContain('<thead><tr><th style="text-align:left">Left</th><th style="text-align:right">Right</th></tr></thead>');
    expect(html).toContain('<tbody><tr><td style="text-align:left">1</td><td style="text-align:right">2</td></tr></tbody>');
  });

  it("renders blockquotes and horizontal rules", () => {
    const html = htmlOf(SAMPLE);
    expect(html).toContain("<blockquote>");
    expect(html).toContain("<hr>");
  });

  it("exports wiki links as readable text rather than links that would 404", () => {
    const html = htmlOf("See [[Another Note]]\n");
    expect(html).toContain('<span class="wl">Another Note</span>');
    expect(html).not.toContain("<a");
  });

  it("restores hard breaks as <br> while keeping soft line breaks as spaces", () => {
    const html = htmlOf("Line one  \nLine two\n\nsoft\nbreak\n");
    expect(html).toContain("Line one<br>Line two");
    // Soft breaks are left to HTML collapsing and don't produce <br>
    expect(html.match(/<br>/g)?.length).toBe(1);
  });

  it("always escapes angle brackets and & in the body", () => {
    const html = htmlOf("Check whether a < b && c > d holds\n");
    expect(html).toContain("a &lt; b &amp;&amp; c &gt; d");
    expect(escapeHtml('a & b "c"')).toBe("a &amp; b &quot;c&quot;");
  });

  it("doesn't include raw HTML blocks in the IR: export hides them just as the editor does", async () => {
    // The IR has no HTML node and WYSIWYG never renders it; export keeps the same
    // semantics instead of silently injecting a piece of markdown as HTML into the new file
    const html = htmlOf("<div onclick=\"x()\">hi</div>\n");
    expect(html).not.toContain("<div");
    expect(html).not.toContain("onclick");
  });

  it("re-parses selection exports so paragraphs remain paragraphs", async () => {
    const payload = await buildExport({
      format: "html",
      title: "Title",
      source: "# a\n\nFirst\n\nSecond\n",
      range: { from: 5, to: 10 },
    });
    expect(payload.contents).toContain("<p>First</p>");
    expect(payload.contents).not.toContain("Second");
  });
});

describe("Link protocols in exports", () => {
  it("allows http(s)/mailto/tel/file and relative paths", () => {
    expect(safeUrl("https://example.com/a?b=1")).toBe("https://example.com/a?b=1");
    expect(safeUrl("mailto:a@b.c")).toBe("mailto:a@b.c");
    expect(safeUrl("tel:+8610000")).toBe("tel:+8610000");
    expect(safeUrl("file:///tmp/a.md")).toBe("file:///tmp/a.md");
    expect(safeUrl("./images/a.png")).toBe("./images/a.png");
    expect(safeUrl("#section")).toBe("#section");
  });

  it("downgrades javascript:/data:/vbscript: to # and leaves no residue in the file", () => {
    expect(safeUrl("javascript:alert(1)")).toBe("#");
    expect(safeUrl(" JavaScript:alert(1)")).toBe("#");
    expect(safeUrl("data:text/html,<script>x</script>")).toBe("#");
    expect(safeUrl("vbscript:msgbox")).toBe("#");
    // Escaping can't solve this, so it must be blocked at the protocol level
    const html = htmlOf("[Click me](javascript:alert(1))\n");
    expect(html).not.toContain("javascript:");
    expect(html).toContain('<a href="#" rel="noopener">Click me</a>');
  });

  it("allows inline data:image for images but not data:text/html", async () => {
    const ok = htmlOf("![img](data:image/png;base64,iVBORw0KGgo=)\n");
    expect(ok).toContain('src="data:image/png;base64,iVBORw0KGgo="');
    const bad = htmlOf("![img](data:text/html,<script>x</script>)\n");
    expect(bad).not.toContain("data:text/html");
  });
});

describe("PDF payload", () => {
  it("provides only the body fragment and font styling; the print dialog applies its own styles", async () => {
    const payload = await buildExport({ format: "pdf", title: "Title", source: SAMPLE });
    expect(payload.extension).toBe("pdf");
    expect(payload.fileName).toBe("Title.pdf");
    expect(payload.contents).toContain('<h1 id="title">Title</h1>');
    expect(payload.contents).not.toContain("<html");
    expect(payload.contents).not.toContain("<style");
  });
});

describe("Layout styles", () => {
  it("attaches the same stylesheet to different root nodes", () => {
    const standalone = docCss("body");
    const sheet = docCss(".print-sheet", { dark: false });
    expect(standalone).toContain("body p { margin: 0 0 20px; }");
    expect(sheet).toContain(".print-sheet p { margin: 0 0 20px; }");
    expect(sheet).not.toContain("__R__");
    // The print dialog doesn't follow the dark preference: that would put a dark background on paper
    expect(sheet).not.toContain("prefers-color-scheme");
    expect(standalone).toContain("prefers-color-scheme");
  });

  it("includes @page and break-avoidance in the print rules", () => {
    const css = docCss("body");
    expect(css).toContain("@page");
    expect(css).toContain("page-break-inside: avoid");
  });
});
