/** Pure find/replace logic: matching, word boundaries, regex, zero-width, and replacement expansion. */
import { describe, expect, it } from "vitest";
import {
  expandReplacement,
  findMatches,
  replaceMatches,
} from "./find";

const at = (text: string, query: string, options = {}) =>
  findMatches(text, query, options).matches.map((m) => [m.from, m.to]);

describe("findMatches", () => {
  it("returns no matches and no error for an empty query", () => {
    expect(findMatches("abc", "")).toEqual({ matches: [], truncated: false, error: null });
  });

  it("is case-insensitive by default and preserves original offsets", () => {
    expect(at("Foo foo FOO", "foo")).toEqual([
      [0, 3],
      [4, 7],
      [8, 11],
    ]);
  });

  it("matches only the exact spelling in case-sensitive mode", () => {
    expect(at("Foo foo FOO", "foo", { caseSensitive: true })).toEqual([[4, 7]]);
  });

  it("treats regex metacharacters in the query literally", () => {
    expect(at("a.b axb", "a.b")).toEqual([[0, 3]]);
    expect(at("f(x) = 1", "(x)")).toEqual([[1, 4]]);
  });

  it("supports capture groups in regex mode for replacement substitution", () => {
    const { matches } = findMatches("v1.2 and v3.4", "v(\\d+)\\.(\\d+)", { regex: true });
    expect(matches).toHaveLength(2);
    expect(matches[0].groups).toEqual(["1", "2"]);
    expect(expandReplacement("$2-$1", matches[0])).toBe("2-1");
  });

  it("reports an error for invalid regex instead of throwing", () => {
    const result = findMatches("abc", "([", { regex: true });
    expect(result.error).toBe("regex");
    expect(result.matches).toEqual([]);
  });

  it("doesn't match inside words in whole-word mode", () => {
    expect(at("cat concat cats cat", "cat", { wholeWord: true })).toEqual([
      [0, 3],
      [16, 19],
    ]);
  });

  it("doesn't loop forever on zero-width matches", () => {
    const { matches } = findMatches("abc", "^", { regex: true });
    expect(matches.length).toBe(1);
    expect(matches[0].from).toBe(0);
  });

  it("truncates and flags results over the limit", () => {
    const result = findMatches("aaaa", "a", { limit: 2 });
    expect(result.matches).toHaveLength(2);
    expect(result.truncated).toBe(true);
  });

  it("matches substrings in plain text", () => {
    expect(at("world model and crop insurance", "model")).toEqual([[6, 11]]);
  });
});

describe("expandReplacement", () => {
  const match = { text: "bold", groups: ["b"] };

  it("supports $$ / $& / $1", () => {
    expect(expandReplacement("$&-$&", match)).toBe("bold-bold");
    expect(expandReplacement("$$", match)).toBe("$");
    expect(expandReplacement("<$1>", match)).toBe("<b>");
  });

  it("keeps out-of-range group numbers verbatim", () => {
    expect(expandReplacement("$3", match)).toBe("$3");
  });
});

describe("replaceMatches", () => {
  it("replaces from the end so offsets stay valid", () => {
    const { matches } = findMatches("a a a", "a");
    expect(replaceMatches("a a a", matches, "bb")).toBe("bb bb bb");
  });

  it("replaces only the supplied matches (replace current occurrence)", () => {
    const { matches } = findMatches("a a a", "a");
    expect(replaceMatches("a a a", [matches[1]], "X")).toBe("a X a");
  });

  it("deletes a match when replacing with an empty string", () => {
    const { matches } = findMatches("keep--drop", "--");
    expect(replaceMatches("keep--drop", matches, "")).toBe("keepdrop");
  });
});
