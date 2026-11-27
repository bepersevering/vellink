import { describe, expect, it } from "vitest";
import {
  createFileWorkspaceBackend,
  slugifyTitle,
  type FileBackendDeps,
  type FileEntry,
} from "./workspace-fs";

const ROOT = "/docs";

/** In-memory "disk" whose interface mirrors the Tauri commands, so tests run in node. */
function fakeDisk(initial: Record<string, { content: string; modified: number }> = {}) {
  const store = new Map(Object.entries(initial));
  const trashed: Array<{ path: string; dir: string }> = [];
  let clock = 2000;

  const deps: FileBackendDeps = {
    async list(root) {
      return [...store.entries()]
        .filter(([path]) => path.startsWith(`${root}/`))
        .map<FileEntry>(([path, file]) => ({
          path,
          name: path.split("/").pop() ?? "",
          size: file.content.length,
          modified: file.modified,
        }))
        .sort((a, b) => b.modified - a.modified);
    },
    async read(path) {
      const file = store.get(path);
      if (!file) throw new Error(`no such file: ${path}`);
      return file.content;
    },
    async write(path, contents) {
      clock += 1;
      const file = { content: contents, modified: clock };
      store.set(path, file);
      return {
        path,
        name: path.split("/").pop() ?? "",
        size: contents.length,
        modified: file.modified,
      };
    },
    async trash(path, dir) {
      trashed.push({ path, dir });
      store.delete(path);
      return `${dir}/trashed.md`;
    },
    async rename(from, to) {
      const file = store.get(from);
      if (!file) throw new Error(`no such file: ${from}`);
      if (store.has(to)) throw new Error(`target file already exists: ${to}`);
      clock += 1;
      store.delete(from);
      store.set(to, { content: file.content, modified: clock });
      return {
        path: to,
        name: to.split("/").pop() ?? "",
        size: file.content.length,
        modified: clock,
      };
    },
  };

  return { deps, store, trashed };
}

describe("slugifyTitle", () => {
  it("preserves CJK characters, replaces filesystem-illegal characters", () => {
    expect(slugifyTitle("如何建立自己的知识体系")).toBe("如何建立自己的知识体系");
    expect(slugifyTitle('a/b:c*d?e"f<g>h|i')).toBe("a-b-c-d-e-f-g-h-i");
  });

  it("collapses spaces into hyphens and strips leading/trailing dots and hyphens", () => {
    expect(slugifyTitle("  Hello   World  ")).toBe("Hello-World");
    expect(slugifyTitle("..hidden..")).toBe("hidden");
  });

  it("falls back for empty titles and truncates long ones", () => {
    expect(slugifyTitle("   ")).toBe("untitled");
    expect(slugifyTitle("x".repeat(200)).length).toBeLessThanOrEqual(60);
  });
});

describe("File backend", () => {
  it("load: id is the absolute path, title comes from the first H1, content is the saved version", async () => {
    const disk = fakeDisk({
      [`${ROOT}/a.md`]: { content: "# Alpha\n\nBody text", modified: 100 },
      [`${ROOT}/notes/b.md`]: { content: "# Beta\n\nBody text", modified: 300 },
    });
    const backend = createFileWorkspaceBackend(ROOT, disk.deps);

    const docs = (await backend.load())!;

    expect(docs.map((doc) => doc.id)).toEqual([
      `${ROOT}/notes/b.md`,
      `${ROOT}/a.md`,
    ]);
    expect(docs[0].title).toBe("Beta");
    expect(docs[0].savedSource).toBe(docs[0].source);
    expect(docs[0].updatedAt).toBe(300);
  });

  it("load: one failed read doesn't affect other documents", async () => {
    const disk = fakeDisk({ [`${ROOT}/ok.md`]: { content: "# OK", modified: 1 } });
    const backend = createFileWorkspaceBackend(ROOT, {
      ...disk.deps,
      read: async (path) => {
        if (path.endsWith("broken.md")) throw new Error("permission denied");
        return disk.deps.read(path);
      },
      list: async () => [
        { path: `${ROOT}/ok.md`, name: "ok.md", size: 4, modified: 1 },
        { path: `${ROOT}/broken.md`, name: "broken.md", size: 0, modified: 2 },
      ],
    });

    const docs = (await backend.load())!;
    expect(docs.map((doc) => doc.id)).toEqual([`${ROOT}/ok.md`]);
  });

  it("newPath: avoids existing filenames in the directory, pathFor doesn't deduplicate", async () => {
    const disk = fakeDisk({
      [`${ROOT}/Untitled.md`]: { content: "# Untitled", modified: 1 },
    });
    const backend = createFileWorkspaceBackend(ROOT, disk.deps);

    expect(await backend.newPath("Untitled")).toBe(`${ROOT}/Untitled-2.md`);
    expect(await backend.newPath("Fresh")).toBe(`${ROOT}/Fresh.md`);
    expect(backend.pathFor("Untitled")).toBe(`${ROOT}/Untitled.md`);
  });

  it("two rapid creates don't get the same path", async () => {
    const disk = fakeDisk({});
    const backend = createFileWorkspaceBackend(ROOT, disk.deps);

    const [first, second] = await Promise.all([
      backend.newPath("Untitled"),
      backend.newPath("Untitled"),
    ]);

    expect(first).not.toBe(second);
    expect([first, second]).toEqual([
      `${ROOT}/Untitled.md`,
      `${ROOT}/Untitled-2.md`,
    ]);
  });

  it("save writes back to the same file, remove moves to trash instead of deleting", async () => {
    const disk = fakeDisk({ [`${ROOT}/a.md`]: { content: "# A", modified: 1 } });
    const backend = createFileWorkspaceBackend(ROOT, disk.deps);
    const [doc] = (await backend.load())!;

    await backend.save({ ...doc, source: "# A\n\nEdited" });
    expect(disk.store.get(`${ROOT}/a.md`)?.content).toBe("# A\n\nEdited");

    await backend.remove(doc.id);
    expect(disk.trashed).toEqual([
      { path: `${ROOT}/a.md`, dir: `${ROOT}/.vellink-trash` },
    ]);
    expect(backend.trashDir).toBe(`${ROOT}/.vellink-trash`);
  });

  it("listMeta lists metadata only, for incremental polling diffs", async () => {
    const disk = fakeDisk({ [`${ROOT}/a.md`]: { content: "# A", modified: 7 } });
    const backend = createFileWorkspaceBackend(ROOT, disk.deps);

    const entries = await backend.listMeta();
    expect(entries).toHaveLength(1);
    expect(entries[0].modified).toBe(7);
    expect(await backend.read(entries[0].path)).toBe("# A");
  });

  it("pathForTitle: returns itself when the title is unchanged, otherwise picks a non-conflicting name in the same directory", async () => {
    const disk = fakeDisk({
      [`${ROOT}/notes/a.md`]: { content: "# A", modified: 1 },
      [`${ROOT}/notes/NewTitle.md`]: { content: "# Someone else took this name", modified: 2 },
    });
    const backend = createFileWorkspaceBackend(ROOT, disk.deps);

    // Title is still A: the filename already matches, no rename needed
    expect(await backend.pathForTitle("A", `${ROOT}/notes/a.md`)).toBe(
      `${ROOT}/notes/a.md`,
    );
    // Switch to "NewTitle": already taken in this directory, so append a number
    expect(await backend.pathForTitle("NewTitle", `${ROOT}/notes/a.md`)).toBe(
      `${ROOT}/notes/NewTitle-2.md`,
    );
    // Keep the original subdirectory; don't move the file to the root
    expect(await backend.pathForTitle("Elsewhere", `${ROOT}/notes/a.md`)).toBe(
      `${ROOT}/notes/Elsewhere.md`,
    );
  });

  it("rename: the new path becomes the id, content unchanged", async () => {
    const disk = fakeDisk({ [`${ROOT}/a.md`]: { content: "# Old", modified: 1 } });
    const backend = createFileWorkspaceBackend(ROOT, disk.deps);

    await backend.rename(`${ROOT}/a.md`, `${ROOT}/NewName.md`);

    expect(disk.store.has(`${ROOT}/a.md`)).toBe(false);
    expect(disk.store.get(`${ROOT}/NewName.md`)?.content).toBe("# Old");
    const listed = await backend.listMeta();
    expect(listed.map((entry) => entry.path)).toEqual([`${ROOT}/NewName.md`]);
  });

  it("after rename, the new name can be created again immediately (no reservation leak)", async () => {
    const disk = fakeDisk({ [`${ROOT}/a.md`]: { content: "# A", modified: 1 } });
    const backend = createFileWorkspaceBackend(ROOT, disk.deps);

    const target = await backend.pathForTitle("B", `${ROOT}/a.md`);
    await backend.rename(`${ROOT}/a.md`, target);

    expect(await backend.newPath("B")).toBe(`${ROOT}/B-2.md`);
  });
});
