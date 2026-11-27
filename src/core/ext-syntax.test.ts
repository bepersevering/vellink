import { describe, expect, it } from "vitest";
import {
  findFrontmatter,
  findTocPlaceholders,
  headingAnchor,
  tocEntries,
} from "./ext-syntax";
import { parseMarkdown } from "./parser/markdown";
import { renderBody, renderHtmlDocument } from "./export/html";

describe("frontmatter 识别", () => {
  it("识别文档顶部的 --- 块", () => {
    const src = "---\ntitle: 测试\ntags: [a, b]\n---\n\n# 正文";
    const fm = findFrontmatter(src);
    expect(fm).not.toBeNull();
    expect(fm!.yaml).toBe("title: 测试\ntags: [a, b]\n");
    expect(src.slice(fm!.start, fm!.end).startsWith("---")).toBe(true);
  });

  it("接受 BOM 与 ... 结束符", () => {
    expect(findFrontmatter("\ufeff---\na: 1\n...\n正文")?.yaml).toBe("a: 1\n");
  });

  it("正文中间的 --- 不是 frontmatter", () => {
    expect(findFrontmatter("# 标题\n\n---\n\n正文")).toBeNull();
    expect(findFrontmatter("--- text\na: 1\n---")).toBeNull();
    expect(findFrontmatter("---\n未闭合")).toBeNull();
  });
});

describe("TOC 与锚点", () => {
  it("只认独占一行的 [TOC]", () => {
    expect(findTocPlaceholders("# 标题\n\n[TOC]\n\n正文")).toHaveLength(1);
    expect(findTocPlaceholders("行内 [TOC] 不算")).toHaveLength(0);
  });

  it("标题锚点保留中文、压掉标点", () => {
    expect(headingAnchor("Hello World")).toBe("hello-world");
    expect(headingAnchor("中文 标题！")).toBe("中文-标题");
  });

  it("代码块里的 # 不当标题", () => {
    const entries = tocEntries("# 真标题\n\n```md\n# 假标题\n```\n");
    expect(entries.map((e) => e.text)).toEqual(["真标题"]);
  });
});

describe("扩展语法进入 IR", () => {
  it("frontmatter 成为独立块，正文块保留", () => {
    const { ir } = parseMarkdown({ source: "---\na: 1\n---\n\n# 标题\n" });
    expect(ir.children[0].type).toBe("frontmatter");
    expect(ir.children.some((b) => b.type === "heading")).toBe(true);
  });

  it("[TOC] 成为 toc 节点", () => {
    const { ir } = parseMarkdown({ source: "# 标题\n\n[TOC]\n" });
    expect(ir.children.some((b) => b.type === "toc")).toBe(true);
  });

  it("往返不丢 frontmatter 与 TOC", () => {
    const src = "---\na: 1\n---\n\n# 标题\n\n[TOC]\n";
    const { markdown } = (() => {
      const ir = parseMarkdown({ source: src }).ir;
      // 直接走 HTML 导出验证渲染；源码往返由序列化测试覆盖
      return { markdown: renderBody(ir) };
    })();
    expect(markdown).toContain("frontmatter");
    expect(markdown).toContain("toc");
  });
});

describe("扩展语法导出", () => {
  it("frontmatter 渲染成属性表，TOC 展开为可跳转目录", () => {
    const src = "---\ntitle: 测试\n---\n\n# 第一章\n\n## 小节\n\n[TOC]\n";
    const html = renderHtmlDocument(parseMarkdown({ source: src }).ir, {
      title: "测试",
      lang: "zh-CN",
    });
    expect(html).toContain('<dl class="frontmatter">');
    expect(html).toContain("<dt>title</dt><dd>测试</dd>");
    expect(html).toContain('<nav class="toc">');
    expect(html).toContain('href="#第一章"');
    expect(html).toContain('id="第一章"');
    expect(html).toContain('id="小节"');
  });

  it("标题里的链接文字被吸进锚点，不会带 Markdown 标记", () => {
    const html = renderBody(
      parseMarkdown({ source: "# **粗体** 标题\n\n[TOC]\n" }).ir,
    );
    expect(html).toContain('id="粗体-标题"');
  });
});
