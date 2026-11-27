import { describe, expect, it } from "vitest";
import { parseHTML } from "linkedom";
import { applyCustomCss, currentCustomCss, sanitizeCss } from "./custom-css";

function doc() {
  const { document } = parseHTML("<!doctype html><html><head></head><body></body></html>");
  return document as unknown as Document;
}

describe("自定义 CSS", () => {
  it("去掉 @import 与外链 url，保留 data URI", () => {
    const css = sanitizeCss(
      '@import url("https://evil.com/x.css"); body { background: url(http://tracker/x.png); } img { src: url(data:image/png;base64,AAA); }',
    );
    expect(css).not.toContain("@import");
    expect(css).not.toContain("http://tracker");
    expect(css).toContain("data:image/png;base64,AAA");
  });

  it("注入样式并幂等", () => {
    const d = doc();
    expect(applyCustomCss(d, "body { color: red; }")).toBe(true);
    expect(applyCustomCss(d, "body { color: red; }")).toBe(false);
    expect(currentCustomCss(d)).toBe("body { color: red; }");
  });

  it("换内容会更新，空串移除", () => {
    const d = doc();
    applyCustomCss(d, "body { color: red; }");
    expect(applyCustomCss(d, "body { color: blue; }")).toBe(true);
    expect(currentCustomCss(d)).toContain("blue");
    expect(applyCustomCss(d, "")).toBe(true);
    expect(currentCustomCss(d)).toBe("");
  });
});
