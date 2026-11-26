/**
 * M1 增量解析性能基准（同时作为可复现的测试记录）。
 * 运行：npm test 时在 stdout 输出全量 vs 增量对比数据。
 */
import { describe, it } from "vitest";
import { parseMarkdown, type Change } from "./markdown";

function makeDoc(paragraphs: number): string {
  const parts: string[] = ["# 基准文档\n\n"];
  for (let i = 0; i < paragraphs; i++) {
    parts.push(
      `## 第 ${i} 节\n\n这是第 ${i} 段正文，包含 **粗体**、*斜体*、\`代码\` 和 [链接](https://example.com/${i})。内容足够长以模拟真实文档。\n\n`,
    );
  }
  return parts.join("");
}

function medianMs(fn: () => void, rounds = 20): number {
  for (let i = 0; i < 3; i++) fn(); // 预热
  const times: number[] = [];
  for (let i = 0; i < rounds; i++) {
    const t = performance.now();
    fn();
    times.push(performance.now() - t);
  }
  times.sort((a, b) => a - b);
  return times[Math.floor(times.length / 2)];
}

describe("M1 增量解析性能基准", () => {
  it("全量 vs 增量（文档中段插入 1 字）", () => {
    console.log("\n=== Vellink M1 增量解析基准 ===");
    for (const n of [50, 200, 500]) {
      const source = makeDoc(n);
      const editAt = Math.floor(source.length / 2);
      const newSource = source.slice(0, editAt) + "X" + source.slice(editAt);
      const change: Change = { fromA: editAt, toA: editAt, fromB: editAt, toB: editAt + 1 };

      const full = medianMs(() => void parseMarkdown({ source: newSource }));
      const baseline = parseMarkdown({ source });
      const incr = medianMs(() => {
        parseMarkdown({
          source: newSource,
          fragments: baseline.fragments,
          changes: [change],
          previous: baseline.ir,
        });
      });

      console.log(
        `${String(n).padStart(3)} 节/${String(source.length).padStart(6)} 字符: ` +
          `全量 ${full.toFixed(2).padStart(7)}ms → 增量 ${incr.toFixed(2).padStart(7)}ms ` +
          `= ${(full / incr).toFixed(1)}x`,
      );
    }
    // 纯性能基准：CI 并行负载下给足时间，避免与功能测试混淆
  }, 15000);
});
