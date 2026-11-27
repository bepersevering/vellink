import { describe, expect, it } from "vitest";
import { findRelativeImages, rewriteImagePaths } from "./import-images";

describe("导入时搬运图片", () => {
  it("识别相对路径图片，忽略外链与 data URI", () => {
    const src = [
      "![本地](./shot.png)",
      "![带题](images/a.jpg \"标题\")",
      "![外链](https://example.com/x.png)",
      "![内嵌](data:image/png;base64,AAA)",
      "![越界](../secret.png)",
    ].join("\n");
    const refs = findRelativeImages(src);
    expect(refs.map((r) => r.path)).toEqual(["./shot.png", "images/a.jpg"]);
    expect(refs[0].fileName).toBe("shot.png");
    expect(refs[1].title.trim()).toBe('"标题")');
  });

  it("重写路径并保留 alt 与 title", () => {
    const src = "![图](./shot.png \"说明\") 后文";
    const refs = findRelativeImages(src);
    const out = rewriteImagePaths(src, refs, () => ".vellink-assets/shot-a1b2.png");
    expect(out).toBe('![图](.vellink-assets/shot-a1b2.png "说明") 后文');
  });

  it("读不到的图片保留原引用", () => {
    const src = "![图](./missing.png)";
    const out = rewriteImagePaths(src, findRelativeImages(src), () => null);
    expect(out).toBe(src);
  });

  it("多处引用逐个替换，偏移不乱", () => {
    const src = "![A](a.png) 中间 ![B](b.jpg)";
    const out = rewriteImagePaths(src, findRelativeImages(src), (r) => `assets/${r.fileName}`);
    expect(out).toBe("![A](assets/a.png) 中间 ![B](assets/b.jpg)");
  });
});
