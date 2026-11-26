/** WYSIWYG 可见文本投影：命中能换算回 PM 区间，跨块命中被拒绝。 */
import { describe, expect, it } from "vitest";
import { parseMarkdown } from "./parser/markdown";
import { buildPMView } from "./view/mapping";
import { buildPMTextMap, locateInPM } from "./find-pm";
import { findMatches } from "./find";

const docOf = (source: string) =>
  buildPMView(parseMarkdown({ source }).ir).doc;

/** 在源码里搜 `query`，返回第一处命中对应的 PM 文本（查不到返回 null）。 */
function pmTextOfHit(source: string, query: string): string | null {
  const doc = docOf(source);
  const map = buildPMTextMap(doc);
  const { matches } = findMatches(map.text, query);
  if (matches.length === 0) return null;
  const range = locateInPM(map, matches[0].from, matches[0].to);
  if (!range) return null;
  return doc.textBetween(range.from, range.to);
}

describe("buildPMTextMap", () => {
  it("块之间补一个换行，避免跨段落拼出假命中", () => {
    const map = buildPMTextMap(docOf("# Title\n\npara one\n\npara two\n"));
    expect(map.text).toBe("Title\npara one\npara two");
  });

  it("空文档得到空文本", () => {
    const map = buildPMTextMap(docOf(""));
    expect(map.text).toBe("");
    expect(map.segments).toEqual([]);
  });
});

describe("locateInPM", () => {
  it("普通段落里的命中精确对应", () => {
    expect(pmTextOfHit("hello world\n", "world")).toBe("world");
  });

  it("被 mark 切成多个文本节点的命中也能跨节点定位", () => {
    expect(pmTextOfHit("a **bold** tail\n", "bold")).toBe("bold");
  });

  it("中文命中对应", () => {
    expect(pmTextOfHit("# 农业保险\n\n遥感定损\n", "遥感")).toBe("遥感");
  });

  it("代码块里的文本可命中", () => {
    expect(pmTextOfHit("```ts\nconst answer = 42\n```\n", "answer")).toBe("answer");
  });

  it("跨段落的命中返回 null（不在 WYSIWYG 里硬塞近似位置）", () => {
    const doc = docOf("alpha\n\nbeta\n");
    const map = buildPMTextMap(doc);
    const from = map.text.indexOf("alpha");
    const to = map.text.indexOf("beta") + 4;
    expect(map.text.slice(from, to)).toBe("alpha\nbeta");
    expect(locateInPM(map, from, to)).toBeNull();
  });

  it("区间非法时返回 null，不返回负长度", () => {
    const map = buildPMTextMap(docOf("abc\n"));
    expect(locateInPM(map, 2, 2)).toBeNull();
    expect(locateInPM(map, 0, 99)).toBeNull();
  });
});
