import { afterEach, describe, expect, it, vi } from "vitest";
import { parseMarkdown } from "./parser/markdown";
import type { DocumentStore } from "./store";
import { TitleRenamer, type RenameAutosave } from "./title-rename";
import { Workspace, type WorkspaceDoc } from "./workspace";
import { slugifyTitle, type FileWorkspaceBackend } from "./workspace-fs";

const ROOT = "/docs";
const OLD = `${ROOT}/Old.md`;

function doc(id: string, source: string): WorkspaceDoc {
  return {
    id,
    title: "Placeholder",
    source,
    savedSource: source,
    createdAt: 1000,
    updatedAt: 1000,
  };
}

function typeSource(store: DocumentStore, source: string): void {
  const { ir } = parseMarkdown({ source });
  store.apply([{ type: "replaceDocument", children: ir.children, source }]);
}

/** Implements only the methods needed for renaming; the rest are left empty. */
function fakeFiles(options: { fail?: boolean; sameName?: boolean } = {}) {
  const renamed: Array<[string, string]> = [];
  const files = {
    kind: "files",
    root: ROOT,
    trashDir: `${ROOT}/.vellink-trash`,
    pathFor: (title: string) => `${ROOT}/${slugifyTitle(title)}.md`,
    newPath: async (title: string) => `${ROOT}/${slugifyTitle(title)}.md`,
    async pathForTitle(title: string, keep?: string) {
      if (options.sameName && keep) return keep;
      const target = `${ROOT}/${slugifyTitle(title)}.md`;
      // Matches production: a case-only difference isn't a rename
      if (keep && target.toLowerCase() === keep.toLowerCase()) return keep;
      return target;
    },
    async rename(from: string, to: string) {
      if (options.fail) throw new Error("target file already exists");
      renamed.push([from, to]);
    },
    async load() {
      return null;
    },
    async save() {
      return undefined;
    },
    async remove() {
      return undefined;
    },
    async listMeta() {
      return [];
    },
    async read() {
      return "";
    },
  } satisfies FileWorkspaceBackend;
  return { files, renamed };
}

function fakeAutosave(): RenameAutosave & { calls: string[] } {
  const calls: string[] = [];
  return {
    calls,
    schedule: (target) => calls.push(`schedule:${target.id}`),
    flush: async (id) => {
      calls.push(`flush:${id ?? "*"}`);
    },
    cancel: (id) => calls.push(`cancel:${id}`),
  };
}

/** Mimics the App: on every workspace change, hand the current doc to the renamer to observe. */
function observeActive(renamer: TitleRenamer, workspace: Workspace): void {
  const summary = workspace.summaries().find((item) => item.id === workspace.activeId);
  if (summary) renamer.observe(summary.id, summary.uid, summary.title, summary.dirty);
}

describe("TitleRenamer", () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it("renames the file after debounce, swaps the id for the new path but keeps uid and undo stack", async () => {
    vi.useFakeTimers();
    const workspace = new Workspace([doc(OLD, "# Old\n\nBody")], { now: () => 2000 });
    const store = workspace.store(OLD)!;
    const { files, renamed } = fakeFiles();
    const autosave = fakeAutosave();
    const renamer = new TitleRenamer({ files, workspace, autosave }, 900);
    const uid = workspace.summaries()[0].uid;

    observeActive(renamer, workspace); // Record the baseline only
    expect(renamed).toEqual([]);

    typeSource(store, "# New\n\nBody");
    observeActive(renamer, workspace);
    // Still in the debounce window, disk untouched
    expect(renamed).toEqual([]);

    await vi.advanceTimersByTimeAsync(900);

    expect(renamed).toEqual([[OLD, `${ROOT}/New.md`]]);
    // Write the body to the old path first, then queue the new id after renaming (the fake doesn't write back savedSource)
    expect(autosave.calls).toEqual([
      `schedule:${OLD}`,
      `flush:${OLD}`,
      `schedule:${ROOT}/New.md`,
    ]);
    expect(workspace.summaries()[0].id).toBe(`${ROOT}/New.md`);
    expect(workspace.summaries()[0].uid).toBe(uid);
    // Undo history follows along: renaming isn't the same as switching documents
    expect(workspace.store(`${ROOT}/New.md`)).toBe(store);
    expect(store.canUndo()).toBe(true);
    renamer.dispose();
  });

  it("cancels a pending rename when the title is changed back to the original", async () => {
    vi.useFakeTimers();
    const workspace = new Workspace([doc(OLD, "# Old\n\nBody")]);
    const store = workspace.store(OLD)!;
    const { files, renamed } = fakeFiles();
    const renamer = new TitleRenamer({ files, workspace, autosave: fakeAutosave() }, 900);

    observeActive(renamer, workspace);
    typeSource(store, "# Temp\n\nBody");
    observeActive(renamer, workspace);
    typeSource(store, "# Old\n\nBody");
    observeActive(renamer, workspace);

    await vi.advanceTimersByTimeAsync(1200);
    expect(renamed).toEqual([]);
    renamer.dispose();
  });

  it("doesn't touch the disk when the file name already matches the title", async () => {
    vi.useFakeTimers();
    const workspace = new Workspace([doc(OLD, "# Old\n\nBody")]);
    const store = workspace.store(OLD)!;
    const { files, renamed } = fakeFiles({ sameName: true });
    const renamer = new TitleRenamer({ files, workspace, autosave: fakeAutosave() }, 900);

    observeActive(renamer, workspace);
    typeSource(store, "# Another\n\nBody");
    observeActive(renamer, workspace);

    await vi.advanceTimersByTimeAsync(1000);
    expect(renamed).toEqual([]);
    expect(workspace.summaries()[0].id).toBe(OLD);
    renamer.dispose();
  });

  it("doesn't rename the user's file on an external title change, but a later local change still works", async () => {
    vi.useFakeTimers();
    const workspace = new Workspace([doc(OLD, "# Old\n\nBody")], { now: () => 5000 });
    const { files, renamed } = fakeFiles();
    const renamer = new TitleRenamer({ files, workspace, autosave: fakeAutosave() }, 900);

    observeActive(renamer, workspace);
    // Another editor changed the H1: the file belongs to that tool now, don't touch its name
    workspace.syncExternal(
      [{ id: OLD, source: "# External\n\nBody", updatedAt: 4000 }],
      [OLD],
    );
    observeActive(renamer, workspace);
    await vi.advanceTimersByTimeAsync(1000);

    expect(renamed).toEqual([]);
    expect(workspace.summaries()[0].id).toBe(OLD);

    // The baseline has caught up with the external title: only a local change means "the user wants to rename"
    typeSource(workspace.store(OLD)!, "# Local\n\nBody");
    observeActive(renamer, workspace);
    await vi.advanceTimersByTimeAsync(1000);
    expect(renamed).toEqual([[OLD, `${ROOT}/Local.md`]]);
    renamer.dispose();
  });

  it("doesn't cancel a just-queued rename when dirty becomes false after a flush", async () => {
    vi.useFakeTimers();
    const workspace = new Workspace([doc(OLD, "# Old\n\nBody")]);
    const store = workspace.store(OLD)!;
    const { files, renamed } = fakeFiles();
    const renamer = new TitleRenamer({ files, workspace, autosave: fakeAutosave() }, 900);

    observeActive(renamer, workspace);
    typeSource(store, "# New\n\nBody");
    observeActive(renamer, workspace);
    // The 700ms autosave clears dirty before the 900ms rename fires
    workspace.markSaved(OLD);
    observeActive(renamer, workspace);

    await vi.advanceTimersByTimeAsync(1000);
    expect(renamed).toEqual([[OLD, `${ROOT}/New.md`]]);
    renamer.dispose();
  });

  it("reports a failed rename once, keeps the id, and doesn't retry the same title", async () => {
    vi.useFakeTimers();
    const workspace = new Workspace([doc(OLD, "# Old\n\nBody")]);
    const store = workspace.store(OLD)!;
    const { files } = fakeFiles({ fail: true });
    const errors: unknown[] = [];
    const renamer = new TitleRenamer(
      {
        files,
        workspace,
        autosave: fakeAutosave(),
        onError: (error) => errors.push(error),
      },
      900,
    );

    observeActive(renamer, workspace);
    typeSource(store, "# New\n\nBody");
    observeActive(renamer, workspace);
    await vi.advanceTimersByTimeAsync(1000);

    expect(errors).toHaveLength(1);
    expect(workspace.summaries()[0].id).toBe(OLD);

    // The title didn't change again: shouldn't keep retrying the same failure
    observeActive(renamer, workspace);
    await vi.advanceTimersByTimeAsync(1000);
    expect(errors).toHaveLength(1);
    renamer.dispose();
  });

  it("calls beforeRename before touching disk, to mark the change as self-inflicted", async () => {
    vi.useFakeTimers();
    const workspace = new Workspace([doc(OLD, "# Old\n\nBody")]);
    const store = workspace.store(OLD)!;
    const { files } = fakeFiles();
    const seen: Array<[string, string]> = [];
    const renamer = new TitleRenamer(
      {
        files,
        workspace,
        autosave: fakeAutosave(),
        beforeRename: (from, to) => seen.push([from, to]),
      },
      900,
    );

    observeActive(renamer, workspace);
    typeSource(store, "# New\n\nBody");
    observeActive(renamer, workspace);
    await vi.advanceTimersByTimeAsync(1000);

    expect(seen).toEqual([[OLD, `${ROOT}/New.md`]]);
    renamer.dispose();
  });

  it("flush applies a pending rename immediately (used on ⌘S / directory change)", async () => {
    const workspace = new Workspace([doc(OLD, "# Old\n\nBody")]);
    const store = workspace.store(OLD)!;
    const { files, renamed } = fakeFiles();
    const renamer = new TitleRenamer({ files, workspace, autosave: fakeAutosave() }, 900);

    observeActive(renamer, workspace);
    typeSource(store, "# Rename\n\nBody");
    observeActive(renamer, workspace);

    await renamer.flush();
    expect(renamed).toEqual([[OLD, `${ROOT}/Rename.md`]]);
    renamer.dispose();
  });
});
