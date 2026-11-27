import { describe, expect, it } from "vitest";
import {
  isMarkdownFileName,
  normalizeImportedText,
  planImports,
  titleFromFileName,
} from "./import-docs";
import { Workspace } from "./workspace";

describe("Pure functions for importing Markdown", () => {
  it("accepts only .md / .markdown and rejects disguised extensions", () => {
    expect(isMarkdownFileName("note.md")).toBe(true);
    expect(isMarkdownFileName("note.markdown")).toBe(true);
    expect(isMarkdownFileName("NOTE.MD")).toBe(true);
    expect(isMarkdownFileName("dir/note.md")).toBe(true);
    expect(isMarkdownFileName("note.md.exe")).toBe(false);
    expect(isMarkdownFileName("note.md ")).toBe(false);
    expect(isMarkdownFileName("note.txt")).toBe(false);
    expect(isMarkdownFileName("md")).toBe(false);
  });

  it("derives a title from the file name: strip extension and control characters, fall back when empty", () => {
    expect(titleFromFileName("My Notes.md", "Untitled")).toBe("My Notes");
    expect(titleFromFileName("dir/a b.markdown", "Untitled")).toBe("a b");
    expect(titleFromFileName("  .md", "Untitled")).toBe("Untitled");
    expect(titleFromFileName("a\u0001b.md", "Untitled")).toBe("a b");
  });

  it("normalizes BOM and CRLF / isolated CR", () => {
    expect(normalizeImportedText("\ufeff# Title\r\n\r\nBody\rLine")).toBe(
      "# Title\n\nBody\nLine",
    );
    expect(normalizeImportedText("plain\ntext")).toBe("plain\ntext");
  });

  it("takes the title from the body H1, adding a suffix for duplicates within the batch and already existing", () => {
    const plan = planImports(
      [
        { name: "a.md", text: "# Alpha\n\n1" },
        { name: "a.md", text: "# Alpha\n\n2" },
        { name: "notes.txt", text: "skip" },
        { name: "a.markdown", text: "# Alpha\n\n3" },
        { name: "no-heading.md", text: "No heading in body" },
      ],
      ["Alpha"],
      "Untitled",
    );
    expect(plan.items.map((item) => item.title)).toEqual([
      "Alpha 2",
      "Alpha 3",
      "Alpha 4",
      "No heading in body",
    ]);
    expect(plan.items.map((item) => item.text)).toEqual([
      "# Alpha\n\n1",
      "# Alpha\n\n2",
      "# Alpha\n\n3",
      "No heading in body",
    ]);
    expect(plan.skipped).toEqual([{ name: "notes.txt", reason: "extension" }]);
  });

  it("lets the caller provide ids; when omitted, leaves them empty for the default generator", () => {
    const withIds = planImports(
      [{ name: "x.md", text: "" }],
      [],
      "Untitled",
      () => "/workspace/x.md",
    );
    expect(withIds.items[0].id).toBe("/workspace/x.md");

    const withoutIds = planImports([{ name: "x.md", text: "" }], [], "Untitled");
    expect(withoutIds.items[0].id).toBeUndefined();
  });

  it("adds a suffix on id collisions so two documents don't point to the same file", () => {
    const plan = planImports(
      [
        { name: "a.md", text: "1" },
        { name: "b.md", text: "2" },
      ],
      [],
      "Untitled",
      () => "/workspace/same.md",
    );
    expect(plan.items[0].id).toBe("/workspace/same.md");
    expect(plan.items[1].id).toBe("/workspace/same.md.1.md");
  });
});

describe("Workspace.importDocs", () => {
  it("keeps the original source of imported docs and doesn't apply the new-doc title template", () => {
    const workspace = new Workspace([], { now: () => 1000 });
    const added = workspace.importDocs([
      { title: "Imported", source: "# My Own Title\n\nBody", saved: true },
    ]);
    expect(added).toHaveLength(1);
    expect(workspace.get(added[0].id)?.source).toBe("# My Own Title\n\nBody");
    expect(workspace.summaries()[0].dirty).toBe(false);
    expect(workspace.activeId).toBe(added[0].id);
  });

  it("marks saved:false docs dirty and leaves them to autosave to flush", () => {
    const workspace = new Workspace([], { now: () => 1000 });
    const added = workspace.importDocs([{ title: "A", source: "Body" }]);
    expect(workspace.summaries()[0].dirty).toBe(true);
    expect(workspace.get(added[0].id)?.savedSource).toBe("");
  });

  it("notifies once for a batch import and keeps titles from colliding", () => {
    const workspace = new Workspace([], { now: () => 1000 });
    let notifications = 0;
    workspace.subscribe(() => (notifications += 1));
    workspace.importDocs([
      { title: "A", source: "1", saved: true },
      { title: "A", source: "2", saved: true },
      { title: "A", source: "3", saved: true },
    ]);
    expect(notifications).toBe(1);
    expect(workspace.summaries().map((doc) => doc.title).sort()).toEqual([
      "A",
      "A 2",
      "A 3",
    ]);
  });

  it("leaves state unchanged and sends no notification for an empty list", () => {
    const workspace = new Workspace([], { now: () => 1000 });
    let notifications = 0;
    workspace.subscribe(() => (notifications += 1));
    expect(workspace.importDocs([])).toEqual([]);
    expect(notifications).toBe(0);
  });
});
