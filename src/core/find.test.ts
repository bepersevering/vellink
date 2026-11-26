/** 查找替换的纯逻辑：命中、词边界、正则、零宽、替换展开。 */
import { describe, expect, it } from "vitest";
import {
  expandReplacement,
  findMatches,
  replaceMatches,
} from "./find";

const at = (text: string, query: string, options = {}) =>
  findMatches(text, query, options).matches.map((m) => [m.from, m.to]);

describe("findMatches", () => {
  it("空查询没有任何命中，也不算错误", () => {
    expect(findMatches("abc", "")).toEqual({ matches: [], truncated: false, error: null });
  });

  it("默认不区分大小写，保留原始偏移", () => {
    expect(at("Foo foo FOO", "foo")).toEqual([
      [0, 3],
      [4, 7],
      [8, 11],
    ]);
  });

  it("区分大小写时只命中完全一致的写法", () => {
    expect(at("Foo foo FOO", "foo", { caseSensitive: true })).toEqual([[4, 7]]);
  });

  it("查询里的正则元字符按字面量处理", () => {
    expect(at("a.b axb", "a.b")).toEqual([[0, 3]]);
    expect(at("f(x) = 1", "(x)")).toEqual([[1, 4]]);
  });

  it("正则模式支持捕获组，替换时可回填", () => {
    const { matches } = findMatches("v1.2 and v3.4", "v(\\d+)\\.(\\d+)", { regex: true });
    expect(matches).toHaveLength(2);
    expect(matches[0].groups).toEqual(["1", "2"]);
    expect(expandReplacement("$2-$1", matches[0])).toBe("2-1");
  });

  it("非法正则只报错，不抛异常", () => {
    const result = findMatches("abc", "([", { regex: true });
    expect(result.error).toBe("regex");
    expect(result.matches).toEqual([]);
  });

  it("完整单词：不命中单词内部", () => {
    expect(at("cat concat cats cat", "cat", { wholeWord: true })).toEqual([
      [0, 3],
      [16, 19],
    ]);
  });

  it("零宽命中不会死循环", () => {
    const { matches } = findMatches("abc", "^", { regex: true });
    expect(matches.length).toBe(1);
    expect(matches[0].from).toBe(0);
  });

  it("超过上限时截断并标记", () => {
    const result = findMatches("aaaa", "a", { limit: 2 });
    expect(result.matches).toHaveLength(2);
    expect(result.truncated).toBe(true);
  });

  it("中文文本按子串命中", () => {
    expect(at("世界模型与农业保险", "模型")).toEqual([[2, 4]]);
  });
});

describe("expandReplacement", () => {
  const match = { text: "bold", groups: ["b"] };

  it("支持 $$ / $& / $1", () => {
    expect(expandReplacement("$&-$&", match)).toBe("bold-bold");
    expect(expandReplacement("$$", match)).toBe("$");
    expect(expandReplacement("<$1>", match)).toBe("<b>");
  });

  it("超出的组号原样保留", () => {
    expect(expandReplacement("$3", match)).toBe("$3");
  });
});

describe("replaceMatches", () => {
  it("从后往前替换，偏移不串位", () => {
    const { matches } = findMatches("a a a", "a");
    expect(replaceMatches("a a a", matches, "bb")).toBe("bb bb bb");
  });

  it("只替换传入的命中（替换当前一处）", () => {
    const { matches } = findMatches("a a a", "a");
    expect(replaceMatches("a a a", [matches[1]], "X")).toBe("a X a");
  });

  it("替换成空串即删除", () => {
    const { matches } = findMatches("keep--drop", "--");
    expect(replaceMatches("keep--drop", matches, "")).toBe("keepdrop");
  });
});
