import { describe, expect, it } from "vitest";
import { FileChangeDetector, type FileStamp } from "./file-changes";

function stamp(path: string, modified: number, size = 10): FileStamp {
  return { path, modified, size };
}

describe("FileChangeDetector", () => {
  it("首次见到文件只记基线，不产出变更", () => {
    const detector = new FileChangeDetector();

    const first = detector.diff([stamp("/a.md", 100), stamp("/b.md", 100)]);
    expect(first.candidates).toEqual([]);
    expect(first.present).toEqual(["/a.md", "/b.md"]);
  });

  it("mtime 或大小变了才算变化", () => {
    let clock = 0;
    const detector = new FileChangeDetector({ now: () => clock });
    detector.diff([stamp("/a.md", 100, 10)]);

    expect(detector.diff([stamp("/a.md", 100, 10)]).candidates).toEqual([]);
    expect(detector.diff([stamp("/a.md", 200, 10)]).candidates).toHaveLength(1);
    expect(detector.diff([stamp("/a.md", 200, 20)]).candidates).toHaveLength(1);
  });

  it("自己刚写过的文件在宽限期内不算外部改动", () => {
    let clock = 1000;
    const detector = new FileChangeDetector({ now: () => clock, graceMs: 500 });
    detector.diff([stamp("/a.md", 100)]);

    detector.markOwn("/a.md");
    expect(detector.diff([stamp("/a.md", 150)]).candidates).toEqual([]);

    // 宽限期过后，外部再改就正常上报
    clock += 600;
    expect(detector.diff([stamp("/a.md", 200)]).candidates).toHaveLength(1);
  });

  it("新增文件在基线之后出现时算变化，缺失的文件从 present 里消失", () => {
    const detector = new FileChangeDetector();
    detector.diff([stamp("/a.md", 100)]);

    const next = detector.diff([stamp("/a.md", 100), stamp("/b.md", 120)]);
    expect(next.present).toEqual(["/a.md", "/b.md"]);

    // 被删掉的文件不再出现在 present（调用方据此判断文档消失）
    expect(detector.diff([stamp("/b.md", 120)]).present).toEqual(["/b.md"]);
  });

  it("rebaseline 清掉历史：旧文件重新出现也不会被当成变化", () => {
    const detector = new FileChangeDetector();
    detector.diff([stamp("/a.md", 100)]);
    detector.rebaseline([stamp("/a.md", 999)]);

    expect(detector.diff([stamp("/a.md", 999)]).candidates).toEqual([]);
    expect(detector.diff([stamp("/a.md", 1000)]).candidates).toHaveLength(1);
  });
});
