import { describe, expect, it } from "vitest";
import { Workspace, type WorkspaceDoc } from "./workspace";
import { createMemoryWorkspaceBackend, createLocalWorkspaceBackend } from "./workspace-storage";

function doc(id: string): WorkspaceDoc {
  return { id, title: id, source: `# ${id}\n`, savedSource: `# ${id}\n`, createdAt: 1, updatedAt: 1 };
}

function storageStub(initial: Record<string, string> = {}): Storage {
  const map = new Map(Object.entries(initial));
  return {
    get length() { return map.size; },
    clear: () => map.clear(),
    getItem: (k: string) => map.get(k) ?? null,
    key: (i: number) => [...map.keys()][i] ?? null,
    removeItem: (k: string) => map.delete(k),
    setItem: (k: string, v: string) => { map.set(k, v); },
  };
}

describe("workspace reordering", () => {
  it("reorders by the given ids without disturbing stores or the active item", () => {
    const w = new Workspace([doc("a"), doc("b"), doc("c")]);
    const store = w.store("a");
    w.setActive("b");
    w.reorder(["c", "a", "b"]);
    expect(w.summaries().map((d) => d.id)).toEqual(["c", "a", "b"]);
    expect(w.store("a")).toBe(store);
    expect(w.activeId).toBe("b");
  });

  it("appends missing ids in their original order and keeps duplicates only once", () => {
    const w = new Workspace([doc("a"), doc("b"), doc("c")]);
    w.reorder(["c", "c", "a"]);
    expect(w.summaries().map((d) => d.id)).toEqual(["c", "a", "b"]);
  });

  it("doesn't notify when the order is unchanged", () => {
    const w = new Workspace([doc("a"), doc("b")]);
    let n = 0;
    w.subscribe(() => { n += 1; });
    w.reorder(["a", "b"]);
    expect(n).toBe(0);
    w.reorder(["b", "a"]);
    expect(n).toBe(1);
  });
});

describe("order persistence", () => {
  it("keeps the new order after reorder and load with the browser backend", async () => {
    const storage = storageStub();
    const backend = createLocalWorkspaceBackend(storage);
    await backend.save(doc("a"));
    await backend.save(doc("b"));
    await backend.save(doc("c"));
    // The initial order is just a baseline; this test cares about the reordered result
    const before = (await backend.load())?.map((d) => d.id);
    expect(before?.sort()).toEqual(["a", "b", "c"]);

    await backend.reorder!(["a", "c", "b"]);
    expect((await backend.load())?.map((d) => d.id)).toEqual(["a", "c", "b"]);
  });

  it("doesn't move an existing document to the front when it's saved again", async () => {
    const storage = storageStub();
    const backend = createLocalWorkspaceBackend(storage);
    await backend.save(doc("a"));
    await backend.save(doc("b"));
    await backend.reorder!(["a", "b"]);
    await backend.save({ ...doc("b"), source: "# b edited\n" });
    expect((await backend.load())?.map((d) => d.id)).toEqual(["a", "b"]);
  });

  it("doesn't lose ids omitted from reorder", async () => {
    const backend = createMemoryWorkspaceBackend([doc("a"), doc("b"), doc("c")]);
    await backend.reorder!(["c"]);
    expect((await backend.load())?.map((d) => d.id)).toEqual(["c", "a", "b"]);
  });
});
