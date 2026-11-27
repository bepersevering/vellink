/**
 * Editing scenario: after typing in WYSIWYG, does the cursor follow correctly and map back to source?
 *
 * This verifies the real difficulty of dual-view synchronization:
 * - after a PM transaction, the cursor position follows via Mapping
 * - whether the followed PM pos maps back to a semantically correct source offset
 * - whether inserting the same text in source view yields the same offset
 *
 * If this fails, "cursor sync while editing" is not viable and we must fall back to source + preview.
 */
import { describe, expect, it } from "vitest";
import { EditorState, TextSelection } from "prosemirror-state";
import { Transform } from "prosemirror-transform";
import { parseMarkdown } from "../parser/markdown";
import { buildPMView, pmToSource, sourceToPM } from "./mapping";

const DOC = `# Title

This is the first paragraph of text, with more content after it.

This is the second paragraph of text.
`;

function setup(source: string) {
  const ir = parseMarkdown({ source }).ir;
  const view = buildPMView(ir);
  const state = EditorState.create({ doc: view.doc });
  return { view, state, ir };
}

describe("cursor following after edits", () => {
  it("insert text in PM: the cursor maps to the correct position", () => {
    const { view, state } = setup(DOC);
    const insertAt = DOC.indexOf("after it");
    const pmPos = sourceToPM(view, insertAt);

    const tr = new Transform(state.doc);
    tr.insert(pmPos, state.schema.text("New"));
    // The cursor should follow to just after the inserted text
    const mappedPos = tr.mapping.map(pmPos);

    expect(mappedPos).toBe(pmPos + 3);
    // The edited document should contain the new text (content edit is correct)
    expect(tr.doc.textBetween(pmPos, pmPos + 3)).toBe("New");
  });

  it("after insertion the cursor maps back to a semantically correct source offset", () => {
    const { view, state } = setup(DOC);
    const insertAt = DOC.indexOf("after it");
    const pmPos = sourceToPM(view, insertAt);

    const tr = new Transform(state.doc);
    tr.insert(pmPos, state.schema.text("New"));
    const mappedPos = tr.mapping.map(pmPos);
    const mappedSourceOffset = pmToSource(view, mappedPos);

    // The old view's mapping doesn't know the new text, but the cursor should land near the insertion point.
    // Key point: the pre-edit source offset at insertAt plus the inserted length = cursor position in the new source
    expect(mappedSourceOffset).toBe(insertAt + 3);
  });

  it("delete: the cursor mapping shrinks correctly", () => {
    const { view, state } = setup(DOC);
    const start = DOC.indexOf("after it");
    const pmFrom = sourceToPM(view, start);
    const pmTo = sourceToPM(view, start + "after it".length); // delete the phrase

    const tr = new Transform(state.doc);
    tr.delete(pmFrom, pmTo);
    const mappedPos = tr.mapping.map(pmTo);

    expect(mappedPos).toBe(pmFrom);
    expect(tr.doc.textContent).not.toContain("after it");
  });

  it("edit across a mark boundary: the cursor doesn't jump to the wrong node", () => {
    const rich = `# Title

This is **bold** and \`code\` at the end.`;
    const { view, state } = setup(rich);
    const boldStart = rich.indexOf("bold");
    // Put the cursor inside the mark; at a boundary, marks() belongs to the previous node per PM semantics
    const pmPos = sourceToPM(view, boldStart + 1);

    const tr = new Transform(state.doc);
    // A real editor's insertText inherits marks at the cursor; add the mark manually here to simulate that
    const marksAtCursor = state.doc.resolve(pmPos).marks();
    tr.insert(pmPos, state.schema.text("X", marksAtCursor));
    const mapped = tr.mapping.map(pmPos);
    const nodeAfter = tr.doc.resolve(mapped).marks().map((m) => m.type.name);
    expect(nodeAfter).toContain("strong");
  });

  it("selection level: TextSelection remains valid after editing", () => {
    const { view, state } = setup(DOC);
    const insertAt = DOC.indexOf("first paragraph");
    const pmPos = sourceToPM(view, insertAt);
    const nextPos = sourceToPM(view, insertAt + "first paragraph".length);

    const withSel = state.apply(
      state.tr.setSelection(TextSelection.create(state.doc, pmPos, nextPos)),
    );
    const tr = new Transform(withSel.doc);
    tr.insert(withSel.selection.from, state.schema.text("Replaced"));
    const mappedFrom = tr.mapping.map(withSel.selection.from);
    const mappedTo = tr.mapping.map(withSel.selection.to);
    // Key check: both selection ends remain valid and ordered after mapping, and map back to a source range
    expect(mappedFrom).toBeLessThanOrEqual(mappedTo);
    expect(mappedTo).toBeLessThanOrEqual(tr.doc.content.size);
    // The replacement text exists in the document (the edit itself is correct)
    expect(tr.doc.textContent).toContain("Replaced");
    // Both ends mapped back to source offsets should be in range and ordered
    const srcFrom = pmToSource(view, mappedFrom);
    const srcTo = pmToSource(view, mappedTo);
    expect(srcFrom).toBeLessThanOrEqual(srcTo);
    expect(srcFrom).toBeGreaterThanOrEqual(0);
    expect(srcTo).toBeLessThanOrEqual(DOC.length);
  });
});
