/**
 * ViewBridge acceptance: dual-view sync logic before the UI mounts.
 * No DOM dependency; simulate PM transactions and source input directly to verify source, IR
 * and cursor always stay consistent.
 */
import { describe, expect, it } from "vitest";
import { EditorState, TextSelection } from "prosemirror-state";
import { parseMarkdown } from "../parser/markdown";
import { vellinkSchema } from "./schema";
import { ViewBridge } from "./sync";

const DOC = `# Heading

First paragraph with **bold** and \`code\`.

- List item
`;

function stateOf(bridge: ViewBridge): EditorState {
  return EditorState.create({ doc: bridge.doc, schema: vellinkSchema });
}

describe("ViewBridge · dual-view sync", () => {
  it("init: source, IR and PM doc share the same origin, cursor maps precisely both ways", () => {
    const bridge = new ViewBridge(DOC);
    expect(bridge.source).toBe(DOC);
    expect(bridge.ir.children[0].type).toBe("heading");
    expect(bridge.doc.textContent).toContain("bold");

    const offset = DOC.indexOf("bold");
    const pm = bridge.sourceToPM(offset);
    expect(pm).toBeGreaterThan(0);
    expect(bridge.pmToSource(pm)).toBe(offset);
  });

  it("PM edit: serialize back to source and remap the cursor", () => {
    const bridge = new ViewBridge(DOC);
    const state = stateOf(bridge);
    const insertAt = DOC.indexOf("paragraph") + 9;
    const pmPos = bridge.sourceToPM(insertAt);

    const tr = state.tr.insertText(" added", pmPos);
    tr.setSelection(TextSelection.create(tr.doc, pmPos + 6));
    const next = state.apply(tr);

    const snap = bridge.fromPM(next, true);
    expect(snap.source).toContain("First paragraph added");
    expect(snap.source).not.toBe(DOC);
    expect(bridge.source).toBe(snap.source);
    expect(snap.cursor.source).toBe(snap.source.indexOf(" added") + 6);
    expect(bridge.pmToSource(snap.cursor.pm)).toBe(snap.cursor.source);
  });

  it("selection-only change: don't rewrite source, only update the cursor", () => {
    const bridge = new ViewBridge(DOC);
    const state = stateOf(bridge);
    const target = DOC.indexOf("List item");
    const next = state.apply(
      state.tr.setSelection(
        TextSelection.create(state.doc, bridge.sourceToPM(target)),
      ),
    );

    const snap = bridge.fromPM(next, false);
    expect(snap.source).toBe(DOC);
    expect(snap.cursor.source).toBe(target);
  });

  it("source edit: rebuild PM doc and mapping, cursor lands at the right PM position", () => {
    const bridge = new ViewBridge(DOC);
    const nextSource = DOC.replace("First paragraph", "First paragraph extended");
    const caret = nextSource.indexOf("extended") + 8;

    const { doc, snapshot } = bridge.fromSource(nextSource, caret);
    expect(doc.textContent).toContain("First paragraph extended");
    expect(snapshot.source).toBe(nextSource);
    expect(snapshot.cursor.source).toBe(caret);
    expect(bridge.pmToSource(snapshot.cursor.pm)).toBe(caret);
    expect(bridge.sourceToPM(caret)).toBe(snapshot.cursor.pm);
  });

  it("reset: after undoing back to an old IR, PM doc and mapping roll back too", () => {
    const bridge = new ViewBridge(DOC);
    const edited = DOC.replace("First paragraph", "First paragraph extended");
    bridge.fromSource(edited, edited.indexOf("extended"));

    // The undo stack feeds back a previously saved IR
    const oldIR = parseMarkdown({ source: DOC }).ir;
    bridge.reset(oldIR);

    expect(bridge.source).toBe(DOC);
    expect(bridge.doc.textContent).not.toContain("extended");
    const offset = DOC.indexOf("bold");
    expect(bridge.pmToSource(bridge.sourceToPM(offset))).toBe(offset);
  });

  it("source → PM → source: semantic content survives a round trip", () => {
    const bridge = new ViewBridge(DOC);
    const edited = DOC.replace("- List item", "- [x] List item");
    const { doc } = bridge.fromSource(edited, edited.length);
    const state = EditorState.create({ doc, schema: vellinkSchema });
    const snap = bridge.fromPM(state, true);

    expect(snap.source).toContain("- [x] List item");
    expect(snap.ir.children.some((b) => b.type === "list")).toBe(true);
  });
});
