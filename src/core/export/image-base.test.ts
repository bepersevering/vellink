import { describe, expect, it } from "vitest";
import { resolveImageBase } from "./image-base";
import { parseMarkdown } from "../parser/markdown";
import { renderHtmlDocument } from "./html";

describe("图片路径 base", () => {
  it("只改相对路径", () => {
    expect(resolveImageBase("shot.png", "/images")).toBe("/images/shot.png");
    expect(resolveImageBase("./shot.png", "/images")).toBe("/images/shot.png");
    expect(resolveImageBase("https://x.com/a.png", "/images")).toBe("https://x.com/a.png");
    expect(resolveImageBase("data:image/png;base64,AAA", "/images")).toBe("data:image/png;base64,AAA");
    expect(resolveImageBase("#anchor", "/images")).toBe("#anchor");
  });

  it("空 base 不改路径", () => {
    expect(resolveImageBase("a.png", "")).toBe("a.png");
  });

  it("去掉 base 末尾斜杠", () => {
    expect(resolveImageBase("a.png", "/images/")).toBe("/images/a.png");
  });

  it("导出 HTML 应用 base", () => {
    const ir = parseMarkdown({ source: "![图](shot.png)" }).ir;
    const html = renderHtmlDocument(ir, { title: "x", imageBase: "/images" });
    expect(html).toContain('src="/images/shot.png"');
  });
});
