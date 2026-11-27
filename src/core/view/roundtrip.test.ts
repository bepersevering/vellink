/**
 * Core feasibility check for cursor sync: source offset ↔ PM pos round-trip consistency.
 *
 * Acceptance criteria:
 * - Visible text regions (characters covered by anchors): round-trip must be 100% exact
 * - Marker character regions (#, **, backticks, etc.): snapping is allowed, but must be
 *   stable (two round-trips give the same result)
 * - Any visible character that fails to round-trip → dual-view sync is unusable, drop WYSIWYG
 *   per the contingency plan
 */
import { describe, expect, it } from "vitest";
import { parseMarkdown } from "../parser/markdown";
import {
  buildPMView,
  pmToSource,
  sourceToPM,
  validateAnchors,
  type PMView,
} from "./mapping";

const DOC = `# Title One

This is the first paragraph, with **bold**, *italic*, \`inline code\`, [link](https://example.com) and [[wiki link]].

## Title Two

- List item one
- [x] Completed task

> Quote block

\`\`\`ts
const x = 1;
\`\`\`

| A | B |
|---|---|
| 1 | 2 |
`;

/** Set of source characters covered by anchors (visible text regions). */
function visibleOffsets(view: PMView): Set<number> {
  const set = new Set<number>();
  for (const a of view.anchors)
    for (let i = a.sourceFrom; i < a.sourceFrom + a.length; i++) set.add(i);
  return set;
}

describe("Cursor round-trip consistency", () => {
  const ir = parseMarkdown({ source: DOC }).ir;
  const view = buildPMView(ir);

  it("matches text anchors character by character with the source", () => {
    const errors = validateAnchors(view, DOC);
    if (errors.length) console.log("Anchor errors:\n" + errors.slice(0, 20).join("\n"));
    expect(errors).toEqual([]);
  });

  it("round-trips every visible character exactly: offset → pmPos → offset", () => {
    const visible = visibleOffsets(view);
    const errors: string[] = [];
    for (const offset of visible) {
      const pm = sourceToPM(view, offset);
      const back = pmToSource(view, pm);
      if (back !== offset) {
        errors.push(
          `offset ${offset} (${JSON.stringify(DOC[offset])}) → pm ${pm} → ${back}`,
        );
      }
    }
    if (errors.length)
      console.log(`Round-trip failed ${errors.length}/${visible.size}:\n` + errors.slice(0, 20).join("\n"));
    expect(errors).toEqual([]);
    console.log(`All ${visible.size} visible text characters round-trip exactly ✓`);
  });

  it("keeps snapping stable for marker characters (unchanged after two round-trips)", () => {
    const visible = visibleOffsets(view);
    const unstable: string[] = [];
    for (let offset = 0; offset < DOC.length; offset++) {
      if (visible.has(offset)) continue;
      const pm1 = sourceToPM(view, offset);
      const back = pmToSource(view, pm1);
      const pm2 = sourceToPM(view, back);
      if (pm1 !== pm2) unstable.push(`offset ${offset}: pm ${pm1} → src ${back} → pm ${pm2}`);
    }
    if (unstable.length)
      console.log(`Unstable snapping at ${unstable.length} positions:\n` + unstable.slice(0, 20).join("\n"));
    expect(unstable).toEqual([]);
  });

  it("doesn't shift the cursor inside inline marks: bold / italic / code / link", () => {
    const probes = ["bold", "italic", "inline code", "link", "wiki link", "Title One", "const x"];
    for (const word of probes) {
      const start = DOC.indexOf(word);
      expect(start).toBeGreaterThanOrEqual(0);
      for (let i = 0; i < word.length; i++) {
        const offset = start + i;
        const pm = sourceToPM(view, offset);
        expect(pmToSource(view, pm)).toBe(offset);
      }
    }
  });

  it("keeps the cursor exact at the first character of each block and snaps markers stably", () => {
    // Visible text characters at block starts must round-trip exactly
    const visibleFirst = [
      DOC.indexOf("Title One"),
      DOC.indexOf("Title Two"),
      DOC.indexOf("List item one"),
      DOC.indexOf("Quote block"),
      DOC.indexOf("const x"),
      DOC.indexOf("| A | B") + 2, // The A in the table's first cell
    ];
    for (const offset of visibleFirst) {
      expect(offset).toBeGreaterThanOrEqual(0);
      const pm = sourceToPM(view, offset);
      expect(pm).toBeGreaterThanOrEqual(1);
      expect(pm).toBeLessThanOrEqual(view.doc.content.size);
      expect(pmToSource(view, pm)).toBe(offset);
    }

    // Marker characters (e.g. ##, -, >) have no PM cursor position; just require snapping into a legal range
    for (const marker of [DOC.indexOf("## Title Two"), DOC.indexOf("- List"), DOC.indexOf("> Quote")]) {
      const pm = sourceToPM(view, marker);
      expect(pm).toBeGreaterThanOrEqual(1);
      expect(pm).toBeLessThanOrEqual(view.doc.content.size);
    }
  });

  it("maps every text position on the PM side back into a legal source range", () => {
    for (let pos = 1; pos <= view.doc.content.size; pos++) {
      const src = pmToSource(view, pos);
      expect(src).toBeGreaterThanOrEqual(0);
      expect(src).toBeLessThanOrEqual(DOC.length);
    }
  });
});
