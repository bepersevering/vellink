/**
 * Block reuse correctness: ensure "skipping the mapping" never causes wrong content or shifted IDs.
 * This is the safety net for the performance optimization — a wrong reuse decision means the user sees stale content.
 */
import { describe, expect, it } from "vitest";
import { parseMarkdown, unshiftOffset, type Change } from "./markdown";
import { validateSpans } from "./sourcemap";
import { walkBlocks } from "../ir/types";

const DOC = `# Title

First paragraph content.

Second paragraph content.

Third paragraph content.

\`\`\`js
const a = 1;
\`\`\`
`;

/** Insert `text` at `pos` in the old source, returning the new source and change. */
function insert(pos: number, text: string) {
  return {
    source: DOC.slice(0, pos) + text + DOC.slice(pos),
    change: { fromA: pos, toA: pos, fromB: pos, toB: pos + text.length } as Change,
  };
}

function ids(ir: ReturnType<typeof parseMarkdown>["ir"]): string[] {
  const out: string[] = [];
  walkBlocks(ir.children, (b) => out.push(b.id));
  return out;
}

describe("block reuse correctness", () => {
  it("reverse offset mapping: null inside the inserted region, correct shift outside", () => {
    const c: Change = { fromA: 10, toA: 10, fromB: 10, toB: 15 };
    expect(unshiftOffset(5, [c])).toBe(5);
    expect(unshiftOffset(12, [c])).toBeNull(); // inserted region
    expect(unshiftOffset(20, [c])).toBe(15);
  });

  it("append at end of document: all old blocks reused with identical IDs and content", () => {
    const first = parseMarkdown({ source: DOC });
    const { source, change } = insert(DOC.length, "\nNew paragraph.");
    const second = parseMarkdown({
      source,
      fragments: first.fragments,
      changes: [change],
      previous: first.ir,
    });

    // One paragraph was added, but the original blocks should be fully reused
    expect(second.ir.children).toHaveLength(first.ir.children.length + 1);
    expect(ids(second.ir).slice(0, first.ir.children.length)).toEqual(
      ids(first.ir),
    );
    expect(validateSpans(second.ir)).toEqual([]);
  });

  it("insert between blocks: later blocks shift their spans but keep their IDs", () => {
    const first = parseMarkdown({ source: DOC });
    const at = DOC.indexOf("Second paragraph content");
    // Insert at the blank line before the second paragraph (after the first paragraph ends)
    const { source, change } = insert(at - 1, "Inserted paragraph.\n\n");
    const second = parseMarkdown({
      source,
      fragments: first.fragments,
      changes: [change],
      previous: first.ir,
    });

    expect(validateSpans(second.ir)).toEqual([]);
    const secondOld = first.ir.children.find((b) => b.type === "paragraph" && b.span.start === at)!;
    const secondNew = second.ir.children.find(
      (b) => b.type === "paragraph" && source.slice(b.span.start, b.span.end).includes("Second paragraph content"),
    )!;
    expect(secondNew.id).toBe(secondOld.id);
    expect(secondNew.span.start).toBe(secondOld.span.start + change.toB - change.fromB);
  });

  it("in-block edit: only that block's ID changes, others unaffected", () => {
    const first = parseMarkdown({ source: DOC });
    const at = DOC.indexOf("Second paragraph") + 1;
    const newSource = DOC.slice(0, at) + "X" + DOC.slice(at + 1);
    const change: Change = { fromA: at, toA: at + 1, fromB: at, toB: at + 1 };
    const second = parseMarkdown({
      source: newSource,
      fragments: first.fragments,
      changes: [change],
      previous: first.ir,
    });

    const oldIds = ids(first.ir);
    const newIds = ids(second.ir);
    expect(newIds).toHaveLength(oldIds.length);
    // Only the second paragraph block's ID changed
    const changed = newIds.filter((id, i) => id !== oldIds[i]);
    expect(changed).toHaveLength(1);
    expect(validateSpans(second.ir)).toEqual([]);
  });

  it("IR stays consistent with a full parse after multiple consecutive edits", () => {
    let state = parseMarkdown({ source: DOC });
    let source = DOC;

    for (const [pos, text] of [
      [DOC.indexOf("First paragraph") + 2, "Edited"],
      [DOC.indexOf("const") + 6, "X"],
      [DOC.length, "\nTail."],
    ] as const) {
      const newSource = source.slice(0, pos) + text + source.slice(pos + 1);
      state = parseMarkdown({
        source: newSource,
        fragments: state.fragments,
        changes: [{ fromA: pos, toA: pos + 1, fromB: pos, toB: pos + text.length }],
        previous: state.ir,
      });
      source = newSource;
    }

    const full = parseMarkdown({ source });
    expect(state.ir.children.map((b) => b.type)).toEqual(
      full.ir.children.map((b) => b.type),
    );
    // Sliced source text of every block must match (no semantic content lost)
    for (let i = 0; i < state.ir.children.length; i++) {
      const a = state.ir.children[i];
      const b = full.ir.children[i];
      expect(source.slice(a.span.start, a.span.end)).toBe(
        source.slice(b.span.start, b.span.end),
      );
    }
    expect(validateSpans(state.ir)).toEqual([]);
  });
});
