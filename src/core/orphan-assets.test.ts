import { describe, expect, it } from "vitest";
import { findOrphanAssets, referencedAssets } from "./orphan-assets";

describe("孤立图片识别", () => {
  it("从源码收集 .vellink-assets 引用", () => {
    const refs = referencedAssets(
      "![A](.vellink-assets/a.png) 与 ![B](.vellink-assets/b.jpg \"题\")",
    );
    expect([...refs].sort()).toEqual(["a.png", "b.jpg"]);
  });

  it("多文档里只要有一处引用就保留", () => {
    const orphans = findOrphanAssets(
      ["![A](.vellink-assets/a.png)", "普通正文"],
      ["a.png", "b.png", "c.jpg"],
    );
    expect(orphans).toEqual(["b.png", "c.jpg"]);
  });

  it("没有文档时全部算孤立", () => {
    expect(findOrphanAssets([], ["a.png"])).toEqual(["a.png"]);
  });

  it("外链与 data URI 不影响判断", () => {
    const orphans = findOrphanAssets(
      ["![外](https://x.com/a.png) ![内](data:image/png;base64,AAA)"],
      ["local.png"],
    );
    expect(orphans).toEqual(["local.png"]);
  });
});
