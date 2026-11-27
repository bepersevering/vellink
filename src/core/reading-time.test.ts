import { describe, expect, it } from "vitest";
import { readingMinutes } from "./reading-time";

describe("阅读时长估算", () => {
  it("空文档与短文档按 1 分钟", () => {
    expect(readingMinutes("")).toBe(1);
    expect(readingMinutes("一句话")).toBe(1);
  });

  it("中文按 400 字/分钟", () => {
    expect(readingMinutes("中".repeat(400))).toBe(1);
    expect(readingMinutes("中".repeat(401))).toBe(2);
    expect(readingMinutes("中".repeat(1200))).toBe(3);
  });

  it("英文按 200 词/分钟", () => {
    expect(readingMinutes("word ".repeat(200))).toBe(1);
    expect(readingMinutes("word ".repeat(201))).toBe(2);
  });

  it("中英混排相加", () => {
    expect(readingMinutes("中".repeat(200) + "word ".repeat(100))).toBe(1);
    expect(readingMinutes("中".repeat(400) + "word ".repeat(200))).toBe(2);
  });

  it("标点与空白不计时", () => {
    expect(readingMinutes("，。！  \n\t".repeat(100))).toBe(1);
  });
});
