import { describe, expect, it } from "vitest";
import { findOrphanAssets, referencedAssets } from "./orphan-assets";

describe("orphan image detection", () => {
  it("collects .vellink-assets references from source", () => {
    const refs = referencedAssets(
      "![A](.vellink-assets/a.png) and ![B](.vellink-assets/b.jpg \"title\")",
    );
    expect([...refs].sort()).toEqual(["a.png", "b.jpg"]);
  });

  it("keeps an asset referenced in any document", () => {
    const orphans = findOrphanAssets(
      ["![A](.vellink-assets/a.png)", "plain body text"],
      ["a.png", "b.png", "c.jpg"],
    );
    expect(orphans).toEqual(["b.png", "c.jpg"]);
  });

  it("treats all assets as orphans when there are no documents", () => {
    expect(findOrphanAssets([], ["a.png"])).toEqual(["a.png"]);
  });

  it("external links and data URIs don't affect detection", () => {
    const orphans = findOrphanAssets(
      ["![external](https://x.com/a.png) ![inline](data:image/png;base64,AAA)"],
      ["local.png"],
    );
    expect(orphans).toEqual(["local.png"]);
  });
});
