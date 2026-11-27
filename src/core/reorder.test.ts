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

describe("工作区重排", () => {
  it("按给定 ids 重排，store / 激活项不受影响", () => {
    const w = new Workspace([doc("a"), doc("b"), doc("c")]);
    const store = w.store("a");
    w.setActive("b");
    w.reorder(["c", "a", "b"]);
    expect(w.summaries().map((d) => d.id)).toEqual(["c", "a", "b"]);
    expect(w.store("a")).toBe(store);
    expect(w.activeId).toBe("b");
  });

  it("缺失的 id 按原顺序补在末尾，重复 id 只出现一次", () => {
    const w = new Workspace([doc("a"), doc("b"), doc("c")]);
    w.reorder(["c", "c", "a"]);
    expect(w.summaries().map((d) => d.id)).toEqual(["c", "a", "b"]);
  });

  it("相同顺序不通知", () => {
    const w = new Workspace([doc("a"), doc("b")]);
    let n = 0;
    w.subscribe(() => { n += 1; });
    w.reorder(["a", "b"]);
    expect(n).toBe(0);
    w.reorder(["b", "a"]);
    expect(n).toBe(1);
  });
});

describe("顺序持久化", () => {
  it("浏览器后端 reorder 后 load 保持新顺序", async () => {
    const storage = storageStub();
    const backend = createLocalWorkspaceBackend(storage);
    await backend.save(doc("a"));
    await backend.save(doc("b"));
    await backend.save(doc("c"));
    // 初始顺序只作基线，重排后的顺序才是本测试关心的
    const before = (await backend.load())?.map((d) => d.id);
    expect(before?.sort()).toEqual(["a", "b", "c"]);

    await backend.reorder!(["a", "c", "b"]);
    expect((await backend.load())?.map((d) => d.id)).toEqual(["a", "c", "b"]);
  });

  it("已存在文档再次 save 不把它顶到最前", async () => {
    const storage = storageStub();
    const backend = createLocalWorkspaceBackend(storage);
    await backend.save(doc("a"));
    await backend.save(doc("b"));
    await backend.reorder!(["a", "b"]);
    await backend.save({ ...doc("b"), source: "# b 改\n" });
    expect((await backend.load())?.map((d) => d.id)).toEqual(["a", "b"]);
  });

  it("reorder 漏掉的 id 不丢", async () => {
    const backend = createMemoryWorkspaceBackend([doc("a"), doc("b"), doc("c")]);
    await backend.reorder!(["c"]);
    expect((await backend.load())?.map((d) => d.id)).toEqual(["c", "a", "b"]);
  });
});
