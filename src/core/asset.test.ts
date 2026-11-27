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

describe("图片格式", () => {
  it("只认四种位图，SVG 不收（它能带脚本）", () => {
    expect(imageExtension("image/png")).toBe("png");
    expect(imageExtension("IMAGE/JPEG")).toBe("jpg");
    expect(imageExtension("image/webp")).toBe("webp");
    expect(imageExtension("image/svg+xml")).toBeNull();
    expect(isImageType("image/gif")).toBe(true);
    expect(isImageType("application/pdf")).toBe(false);
    expect(mimeFromAssetPath(`${ASSET_DIR}/shot-a1b2.png`)).toBe("image/png");
  });
});

describe("资产命名", () => {
  it("非 ASCII 与空格压成 ASCII slug，避免破坏 Markdown 目标地址", () => {
    expect(slugify("My  Shot (1).png")).toBe("my-shot-1");
    expect(slugify("我的截图.png")).toBe("image");
    expect(slugify("...")).toBe("image");
  });

  it("同一张图得到同一个名字，不同内容不会撞名", () => {
    const a = new Uint8Array([1, 2, 3, 4]);
    const b = new Uint8Array([4, 3, 2, 1]);
    const n1 = assetName("截图.png", "image/png", a);
    expect(n1).toBe(assetName("截图.png", "image/png", a));
    expect(n1).not.toBe(assetName("截图.png", "image/png", b));
    expect(n1).toMatch(/^wode-[0-9a-f]{8}\.png$|^[a-z0-9-]+-[0-9a-f]{8}\.png$/);
    expect(assetName("x.png", "image/svg+xml", a)).toBeNull();
  });

  it("相对路径固定在资源目录里，不认 ..", () => {
    expect(assetRelativePath("a.png")).toBe(".vellink-assets/a.png");
    expect(isAssetPath(".vellink-assets/a.png")).toBe(true);
    expect(isAssetPath(".vellink-assets/../../secret.png")).toBe(false);
    expect(isAssetPath("https://example.com/a.png")).toBe(false);
  });
});

describe("Markdown 图片", () => {
  it("alt 里的括号与反斜杠被转义", () => {
    expect(imageMarkdown("a[b]\\c", ".vellink-assets/x.png")).toBe(
      "![a\\[b\\]\\\\c](.vellink-assets/x.png)",
    );
  });

  it("data URI 分块编码，不因大数组栈溢出", () => {
    expect(dataUriOf(new Uint8Array([104, 105]), "image/png")).toBe(
      "data:image/png;base64,aGk=",
    );
    const big = new Uint8Array(100_000).fill(65);
    expect(dataUriOf(big, "image/png").startsWith("data:image/png;base64,")).toBe(true);
  });
});

describe("导出内嵌", () => {
  const source = [
    "# 图",
    "",
    "![本地](.vellink-assets/shot-a1b2c3d4.png)",
    "![外链](https://example.com/a.png)",
    "![没找到](.vellink-assets/missing.png)",
  ].join("\n");

  it("只替换能读到的本地资产，其余保持原样", async () => {
    const out = await inlineLocalImages(source, async (path) =>
      path.includes("shot") ? "data:image/png;base64,AAAA" : null,
    );
    expect(out).toContain("![本地](data:image/png;base64,AAAA)");
    expect(out).toContain("![外链](https://example.com/a.png)");
    expect(out).toContain("![没找到](.vellink-assets/missing.png)");
  });

  it("没有本地图片时不改一个字符", async () => {
    const plain = "# 无图\n\n正文\n";
    expect(await inlineLocalImages(plain, async () => "unused")).toBe(plain);
  });

  it("多张图按顺序替换，下标不串位", async () => {
    const two = "![a](.vellink-assets/a.png) ![b](.vellink-assets/b.png)";
    const out = await inlineLocalImages(two, async (p) =>
      p.endsWith("a.png") ? "data:image/png;base64,AA==" : "data:image/png;base64,BB==",
    );
    expect(out).toBe(
      "![a](data:image/png;base64,AA==) ![b](data:image/png;base64,BB==)",
    );
  });
});

describe("图片尺寸语法", () => {
  it("解析 =WxH 后缀", () => {
    expect(parseImageSize("shot.png =300x200")).toEqual({
      url: "shot.png",
      width: 300,
      height: 200,
    });
    expect(parseImageSize("shot.png")).toEqual({ url: "shot.png" });
    expect(parseImageSize("shot.png =0x1")).toEqual({ url: "shot.png =0x1" });
  });
});
