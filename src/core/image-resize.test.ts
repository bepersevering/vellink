import { describe, expect, it } from "vitest";
import { fitWithin, needsResize } from "./image-resize";

describe("图片等比缩放", () => {
  it("按最长边等比缩小", () => {
    expect(fitWithin({ width: 4000, height: 2000 }, 2048)).toEqual({
      width: 2048,
      height: 1024,
    });
    expect(fitWithin({ width: 2000, height: 4000 }, 1000)).toEqual({
      width: 500,
      height: 1000,
    });
  });

  it("小图不放大", () => {
    expect(fitWithin({ width: 100, height: 80 }, 2048)).toEqual({ width: 100, height: 80 });
  });

  it("0 表示关闭压缩", () => {
    expect(fitWithin({ width: 4000, height: 3000 }, 0)).toEqual({ width: 4000, height: 3000 });
    expect(needsResize({ width: 4000, height: 3000 }, 0)).toBe(false);
  });

  it("需要缩放时才报 true", () => {
    expect(needsResize({ width: 4000, height: 2000 }, 2048)).toBe(true);
    expect(needsResize({ width: 1900, height: 1000 }, 2048)).toBe(false);
  });

  it("极小尺寸仍保留至少 1 像素", () => {
    const size = fitWithin({ width: 10000, height: 1 }, 1);
    expect(size.width).toBe(1);
    expect(size.height).toBeGreaterThanOrEqual(1);
  });
});
