/** WYSIWYG visible-text projection: hits map back to PM ranges; cross-block hits are rejected. */
import { describe, expect, it } from "vitest";
import { parseMarkdown } from "./parser/markdown";
import { buildPMView } from "./view/mapping";
import { buildPMTextMap, locateInPM } from "./find-pm";
import { findMatches } from "./find";

const docOf = (source: string) =>
  buildPMView(parseMarkdown({ source }).ir).doc;

/** Search `query` in the source and return the PM text of the first hit (null if not found). */
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
  it("inserts a newline between blocks so fake cross-paragraph hits can't form", () => {
    const map = buildPMTextMap(docOf("# Title\n\npara one\n\npara two\n"));
    expect(map.text).toBe("Title\npara one\npara two");
  });

  it("produces empty text for an empty document", () => {
    const map = buildPMTextMap(docOf(""));
    expect(map.text).toBe("");
    expect(map.segments).toEqual([]);
  });
});

describe("locateInPM", () => {
  it("maps hits in normal paragraphs exactly", () => {
    expect(pmTextOfHit("hello world\n", "world")).toBe("world");
  });

  it("locates hits split across multiple text nodes by marks", () => {
    expect(pmTextOfHit("a **bold** tail\n", "bold")).toBe("bold");
  });

  it("maps multi-word phrase hits inside headings", () => {
    expect(pmTextOfHit("# Crop Insurance\n\nRemote Sensing Assessment\n", "Remote Sensing")).toBe("Remote Sensing");
  });

  it("finds text inside code blocks", () => {
    expect(pmTextOfHit("```ts\nconst answer = 42\n```\n", "answer")).toBe("answer");
  });

  it("returns null for cross-paragraph hits (no fake approximate position in WYSIWYG)", () => {
    const doc = docOf("alpha\n\nbeta\n");
    const map = buildPMTextMap(doc);
    const from = map.text.indexOf("alpha");
    const to = map.text.indexOf("beta") + 4;
    expect(map.text.slice(from, to)).toBe("alpha\nbeta");
    expect(locateInPM(map, from, to)).toBeNull();
  });

  it("returns null for invalid ranges, never a negative-length range", () => {
    const map = buildPMTextMap(docOf("abc\n"));
    expect(locateInPM(map, 2, 2)).toBeNull();
    expect(locateInPM(map, 0, 99)).toBeNull();
  });
});
