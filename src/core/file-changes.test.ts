import { describe, expect, it } from "vitest";
import { FileChangeDetector, type FileStamp } from "./file-changes";

function stamp(path: string, modified: number, size = 10): FileStamp {
  return { path, modified, size };
}

describe("FileChangeDetector", () => {
  it("first sight of a file only records a baseline, no changes produced", () => {
    const detector = new FileChangeDetector();

    const first = detector.diff([stamp("/a.md", 100), stamp("/b.md", 100)]);
    expect(first.candidates).toEqual([]);
    expect(first.present).toEqual(["/a.md", "/b.md"]);
  });

  it("only a changed mtime or size counts as a change", () => {
    let clock = 0;
    const detector = new FileChangeDetector({ now: () => clock });
    detector.diff([stamp("/a.md", 100, 10)]);

    expect(detector.diff([stamp("/a.md", 100, 10)]).candidates).toEqual([]);
    expect(detector.diff([stamp("/a.md", 200, 10)]).candidates).toHaveLength(1);
    expect(detector.diff([stamp("/a.md", 200, 20)]).candidates).toHaveLength(1);
  });

  it("files just written by us are not treated as external changes within the grace period", () => {
    let clock = 1000;
    const detector = new FileChangeDetector({ now: () => clock, graceMs: 500 });
    detector.diff([stamp("/a.md", 100)]);

    detector.markOwn("/a.md");
    expect(detector.diff([stamp("/a.md", 150)]).candidates).toEqual([]);

    // After the grace period, external changes are reported normally
    clock += 600;
    expect(detector.diff([stamp("/a.md", 200)]).candidates).toHaveLength(1);
  });

  it("new files appearing after the baseline count as changes; missing files disappear from present", () => {
    const detector = new FileChangeDetector();
    detector.diff([stamp("/a.md", 100)]);

    const next = detector.diff([stamp("/a.md", 100), stamp("/b.md", 120)]);
    expect(next.present).toEqual(["/a.md", "/b.md"]);

    // Deleted files no longer appear in present (callers use this to detect document disappearance)
    expect(detector.diff([stamp("/b.md", 120)]).present).toEqual(["/b.md"]);
  });

  it("rebaseline clears history: reappearing old files are not treated as changes", () => {
    const detector = new FileChangeDetector();
    detector.diff([stamp("/a.md", 100)]);
    detector.rebaseline([stamp("/a.md", 999)]);

    expect(detector.diff([stamp("/a.md", 999)]).candidates).toEqual([]);
    expect(detector.diff([stamp("/a.md", 1000)]).candidates).toHaveLength(1);
  });
});
