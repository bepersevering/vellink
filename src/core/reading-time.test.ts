import { describe, expect, it } from "vitest";
import { readingMinutes } from "./reading-time";

describe("reading-time estimation", () => {
  it("counts empty and short documents as 1 minute", () => {
    expect(readingMinutes("")).toBe(1);
    expect(readingMinutes("a short sentence")).toBe(1);
  });

  it("counts CJK characters at 400 chars/min", () => {
    expect(readingMinutes("中".repeat(400))).toBe(1);
    expect(readingMinutes("中".repeat(401))).toBe(2);
    expect(readingMinutes("中".repeat(1200))).toBe(3);
  });

  it("counts English words at 200 words/min", () => {
    expect(readingMinutes("word ".repeat(200))).toBe(1);
    expect(readingMinutes("word ".repeat(201))).toBe(2);
  });

  it("adds up mixed CJK and English text", () => {
    expect(readingMinutes("中".repeat(200) + "word ".repeat(100))).toBe(1);
    expect(readingMinutes("中".repeat(400) + "word ".repeat(200))).toBe(2);
  });

  it("doesn't count punctuation or whitespace", () => {
    expect(readingMinutes(",.!  \n\t".repeat(100))).toBe(1);
  });
});
