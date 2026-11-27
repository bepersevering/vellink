import { describe, expect, it } from "vitest";
import { findRelativeImages, rewriteImagePaths } from "./import-images";

describe("Migrating images on import", () => {
  it("recognizes relative-path images, ignoring external links and data URIs", () => {
    const src = [
      "![local](./shot.png)",
      "![titled](images/a.jpg \"title\")",
      "![external](https://example.com/x.png)",
      "![inline](data:image/png;base64,AAA)",
      "![escaping](../secret.png)",
    ].join("\n");
    const refs = findRelativeImages(src);
    expect(refs.map((r) => r.path)).toEqual(["./shot.png", "images/a.jpg"]);
    expect(refs[0].fileName).toBe("shot.png");
    expect(refs[1].title.trim()).toBe('"title")');
  });

  it("rewrites paths while preserving alt and title", () => {
    const src = "![image](./shot.png \"description\") tail";
    const refs = findRelativeImages(src);
    const out = rewriteImagePaths(src, refs, () => ".vellink-assets/shot-a1b2.png");
    expect(out).toBe('![image](.vellink-assets/shot-a1b2.png "description") tail');
  });

  it("keeps the original reference for unreadable images", () => {
    const src = "![image](./missing.png)";
    const out = rewriteImagePaths(src, findRelativeImages(src), () => null);
    expect(out).toBe(src);
  });

  it("replaces multiple references one by one without breaking offsets", () => {
    const src = "![A](a.png) middle ![B](b.jpg)";
    const out = rewriteImagePaths(src, findRelativeImages(src), (r) => `assets/${r.fileName}`);
    expect(out).toBe("![A](assets/a.png) middle ![B](assets/b.jpg)");
  });
});
