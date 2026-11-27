import { describe, expect, it } from "vitest";
import {
  ASSET_DIR,
  assetName,
  assetRelativePath,
  dataUriOf,
  imageExtension,
  imageMarkdown,
  parseImageSize,
  inlineLocalImages,
  isAssetPath,
  isImageType,
  mimeFromAssetPath,
  slugify,
} from "./asset";

describe("image formats", () => {
  it("accepts only four bitmap formats; SVG is rejected (it can carry scripts)", () => {
    expect(imageExtension("image/png")).toBe("png");
    expect(imageExtension("IMAGE/JPEG")).toBe("jpg");
    expect(imageExtension("image/webp")).toBe("webp");
    expect(imageExtension("image/svg+xml")).toBeNull();
    expect(isImageType("image/gif")).toBe(true);
    expect(isImageType("application/pdf")).toBe(false);
    expect(mimeFromAssetPath(`${ASSET_DIR}/shot-a1b2.png`)).toBe("image/png");
  });
});

describe("asset naming", () => {
  it("collapses non-ASCII characters and spaces into an ASCII slug so Markdown targets stay intact", () => {
    expect(slugify("My  Shot (1).png")).toBe("my-shot-1");
    expect(slugify("我的截图.png")).toBe("image");
    expect(slugify("...")).toBe("image");
  });

  it("the same image gets the same name; different content doesn't collide", () => {
    const a = new Uint8Array([1, 2, 3, 4]);
    const b = new Uint8Array([4, 3, 2, 1]);
    const n1 = assetName("shot.png", "image/png", a);
    expect(n1).toBe(assetName("shot.png", "image/png", a));
    expect(n1).not.toBe(assetName("shot.png", "image/png", b));
    expect(n1).toMatch(/^wode-[0-9a-f]{8}\.png$|^[a-z0-9-]+-[0-9a-f]{8}\.png$/);
    expect(assetName("x.png", "image/svg+xml", a)).toBeNull();
  });

  it("keeps relative paths inside the asset directory; .. is rejected", () => {
    expect(assetRelativePath("a.png")).toBe(".vellink-assets/a.png");
    expect(isAssetPath(".vellink-assets/a.png")).toBe(true);
    expect(isAssetPath(".vellink-assets/../../secret.png")).toBe(false);
    expect(isAssetPath("https://example.com/a.png")).toBe(false);
  });
});

describe("Markdown images", () => {
  it("escapes parentheses and backslashes in alt text", () => {
    expect(imageMarkdown("a[b]\\c", ".vellink-assets/x.png")).toBe(
      "![a\\[b\\]\\\\c](.vellink-assets/x.png)",
    );
  });

  it("encodes data URIs in chunks to avoid stack overflow on large arrays", () => {
    expect(dataUriOf(new Uint8Array([104, 105]), "image/png")).toBe(
      "data:image/png;base64,aGk=",
    );
    const big = new Uint8Array(100_000).fill(65);
    expect(dataUriOf(big, "image/png").startsWith("data:image/png;base64,")).toBe(true);
  });
});

describe("export inlining", () => {
  const source = [
    "# Image",
    "",
    "![local](.vellink-assets/shot-a1b2c3d4.png)",
    "![external](https://example.com/a.png)",
    "![missing](.vellink-assets/missing.png)",
  ].join("\n");

  it("replaces only readable local assets; leaves everything else untouched", async () => {
    const out = await inlineLocalImages(source, async (path) =>
      path.includes("shot") ? "data:image/png;base64,AAAA" : null,
    );
    expect(out).toContain("![local](data:image/png;base64,AAAA)");
    expect(out).toContain("![external](https://example.com/a.png)");
    expect(out).toContain("![missing](.vellink-assets/missing.png)");
  });

  it("doesn't change a single character when there are no local images", async () => {
    const plain = "# No images\n\nBody text\n";
    expect(await inlineLocalImages(plain, async () => "unused")).toBe(plain);
  });

  it("replaces multiple images in order without shifting indices", async () => {
    const two = "![a](.vellink-assets/a.png) ![b](.vellink-assets/b.png)";
    const out = await inlineLocalImages(two, async (p) =>
      p.endsWith("a.png") ? "data:image/png;base64,AA==" : "data:image/png;base64,BB==",
    );
    expect(out).toBe(
      "![a](data:image/png;base64,AA==) ![b](data:image/png;base64,BB==)",
    );
  });
});

describe("image size syntax", () => {
  it("parses the =WxH suffix", () => {
    expect(parseImageSize("shot.png =300x200")).toEqual({
      url: "shot.png",
      width: 300,
      height: 200,
    });
    expect(parseImageSize("shot.png")).toEqual({ url: "shot.png" });
    expect(parseImageSize("shot.png =0x1")).toEqual({ url: "shot.png =0x1" });
  });
});
