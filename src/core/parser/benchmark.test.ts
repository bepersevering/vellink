/**
 * M1 incremental parsing performance benchmark (also serves as a reproducible test record).
 * Running `npm test` prints full vs incremental comparison data to stdout.
 */
import { describe, it } from "vitest";
import { parseMarkdown, type Change } from "./markdown";

function makeDoc(paragraphs: number): string {
  const parts: string[] = ["# Benchmark Document\n\n"];
  for (let i = 0; i < paragraphs; i++) {
    parts.push(
      `## Section ${i}\n\nThis is paragraph ${i} of body text, containing **bold**, *italic*, \`code\` and [a link](https://example.com/${i}). Long enough to simulate a real document.\n\n`,
    );
  }
  return parts.join("");
}

function medianMs(fn: () => void, rounds = 20): number {
  for (let i = 0; i < 3; i++) fn(); // warm up
  const times: number[] = [];
  for (let i = 0; i < rounds; i++) {
    const t = performance.now();
    fn();
    times.push(performance.now() - t);
  }
  times.sort((a, b) => a - b);
  return times[Math.floor(times.length / 2)];
}

describe("M1 incremental parsing performance benchmark", () => {
  it("full vs incremental (insert one character in the middle of the document)", () => {
    console.log("\n=== Vellink M1 Incremental Parsing Benchmark ===");
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
        `${String(n).padStart(3)} sections/${String(source.length).padStart(6)} chars: ` +
          `full ${full.toFixed(2).padStart(7)}ms → incremental ${incr.toFixed(2).padStart(7)}ms ` +
          `= ${(full / incr).toFixed(1)}x`,
      );
    }
    // Pure performance benchmark: allow ample time under CI parallel load to avoid confusion with functional tests
  }, 15000);
});
