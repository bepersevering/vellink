import { afterEach, describe, expect, it, vi } from "vitest";
import { parseMarkdown } from "./parser/markdown";
import type { DocumentStore } from "./store";
import { Workspace, type WorkspaceDoc } from "./workspace";
import {
  Autosave,
  createMemoryWorkspaceBackend,
  type SaveState,
} from "./workspace-storage";

function doc(id: string, source: string, savedSource = source): WorkspaceDoc {
  return {
    id,
    title: "占位",
    source,
    savedSource,
    createdAt: 1000,
    updatedAt: 1000,
  };
}

/** 模拟一次编辑器提交：整篇替换。 */
function typeSource(store: DocumentStore, source: string): void {
  const { ir } = parseMarkdown({ source });
  store.apply([{ type: "replaceDocument", children: ir.children, source }]);
}

describe("Workspace", () => {
  it("新建文档：置顶、设为当前、标题写进正文一级标题", () => {
    const workspace = new Workspace([doc("a", "# A\n\n正文")], {
      now: () => 2000,
      idFactory: () => "b",
    });

    const created = workspace.create("新文档");

    expect(created.id).toBe("b");
    expect(workspace.activeId).toBe("b");
    expect(created.source).toBe("# 新文档\n\n");
    expect(workspace.summaries().map((item) => item.id)).toEqual(["b", "a"]);
  });

  it("重名新建自动加序号", () => {
    const workspace = new Workspace([], { idFactory: (() => {
      let n = 0;
      return () => `id-${++n}`;
    })() });

    workspace.create("笔记");
    expect(workspace.create("笔记").title).toBe("笔记 2");
    expect(workspace.create("笔记").title).toBe("笔记 3");
  });

  it("编辑器写入后同步 source、标题与 dirty", () => {
    const workspace = new Workspace([doc("a", "# 旧标题\n\n正文")], { now: () => 3000 });
    const store = workspace.store("a");
    expect(store).not.toBeNull();

    typeSource(store!, "# 新标题\n\n改过的正文");

    const summary = workspace.summaries()[0];
    expect(summary.title).toBe("新标题");
    expect(summary.dirty).toBe(true);
    expect(summary.updatedAt).toBe(3000);
    expect(workspace.get("a")?.source).toContain("改过的正文");
  });

  it("markSaved 清除 dirty，再编辑重新变脏", () => {
    const workspace = new Workspace([doc("a", "# A\n\n正文")]);
    const store = workspace.store("a")!;
    typeSource(store, "# A\n\n第二段");

    workspace.markSaved("a");
    expect(workspace.summaries()[0].dirty).toBe(false);

    typeSource(store, "# A\n\n第三段");
    expect(workspace.summaries()[0].dirty).toBe(true);
  });

  it("多文档各自持有撤销栈，且同时存在不撞命令注册", () => {
    const workspace = new Workspace([doc("a", "# A\n\nA1"), doc("b", "# B\n\nB1")]);
    const storeA = workspace.store("a")!;
    const storeB = workspace.store("b")!;

    typeSource(storeA, "# A\n\nA2");
    typeSource(storeB, "# B\n\nB2");

    expect(storeA.undo()).toBe(true);
    expect(workspace.get("a")?.source).toContain("A1");
    expect(workspace.get("b")?.source).toContain("B2");
    expect(storeB.canUndo()).toBe(true);
  });

  it("删除文档：保留至少一篇，删当前文档时切换邻居", () => {
    const workspace = new Workspace([doc("a", "# A"), doc("b", "# B")]);

    expect(workspace.remove("a")).toBe(true);
    expect(workspace.activeId).toBe("b");
    expect(workspace.remove("b")).toBe(false);
    expect(workspace.summaries()).toHaveLength(1);
  });

  it("订阅在编辑时触发，退订后停止", () => {
    const workspace = new Workspace([doc("a", "# A")]);
    const listener = vi.fn();
    const off = workspace.subscribe(listener);
    const store = workspace.store("a")!;

    typeSource(store, "# A\n\n新内容");
    expect(listener).toHaveBeenCalled();

    off();
    listener.mockClear();
    typeSource(store, "# A\n\n更新的内容");
    expect(listener).not.toHaveBeenCalled();
  });
});

describe("Workspace persistence", () => {
  it("内存后端可完整往返，且落盘后 savedSource 对齐", async () => {
    const backend = createMemoryWorkspaceBackend();
    const workspace = new Workspace([]);
    const created = workspace.create("持久化");
    workspace.markSaved(created.id);
    await backend.save(workspace.get(created.id)!);

    const reloaded = await backend.load();
    expect(reloaded).toHaveLength(1);
    expect(reloaded![0].source).toContain("# 持久化");
    expect(reloaded![0].savedSource).toBe(reloaded![0].source);
  });

  it("首次启动返回 null，用于区分是否需要写入种子", async () => {
    const backend = createMemoryWorkspaceBackend();
    expect(await backend.load()).toBeNull();
    await backend.save(doc("x", "# X"));
    expect(await backend.load()).not.toBeNull();
  });

  it("删除后索引与正文一起消失", async () => {
    const backend = createMemoryWorkspaceBackend();
    await backend.save(doc("x", "# X"));
    await backend.remove("x");
    expect(await backend.load()).toEqual([]);
  });
});

describe("Autosave", () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it("连续输入只在停手后落盘一次", async () => {
    vi.useFakeTimers();
    const backend = createMemoryWorkspaceBackend();
    const saved = vi.fn();
    const autosave = new Autosave(backend, { onSaved: saved }, 800);
    const target = doc("a", "# A\n\n1");

    autosave.schedule({ ...target, source: "# A\n\n12" });
    await vi.advanceTimersByTimeAsync(300);
    autosave.schedule({ ...target, source: "# A\n\n123" });
    await vi.advanceTimersByTimeAsync(300);
    expect(saved).not.toHaveBeenCalled();

    await vi.advanceTimersByTimeAsync(900);
    expect(saved).toHaveBeenCalledTimes(1);
    expect(saved).toHaveBeenCalledWith("a", "# A\n\n123");
    expect(backend.docs.get("a")?.source).toBe("# A\n\n123");
  });

  it("flush 立即写入并上报状态", async () => {
    const backend = createMemoryWorkspaceBackend();
    const states: SaveState[] = [];
    const autosave = new Autosave(backend, {
      onState: (_id, state) => states.push(state),
    });

    autosave.schedule(doc("a", "# A\n\n即时"));
    await autosave.flush("a");

    expect(backend.docs.get("a")?.source).toBe("# A\n\n即时");
    expect(states).toEqual(["saving", "idle"]);
    autosave.dispose();
  });

  it("写入失败上报 error 且不丢 pending 之后的调度", async () => {
    const failing = {
      load: async () => null,
      save: async () => {
        throw new Error("quota");
      },
      remove: async () => undefined,
    };
    const states: SaveState[] = [];
    const errors: unknown[] = [];
    const autosave = new Autosave(failing, {
      onState: (_id, state) => states.push(state),
      onError: (_id, error) => errors.push(error),
    });

    autosave.schedule(doc("a", "# A"));
    await autosave.flush();
    expect(states).toEqual(["saving", "error"]);
    expect(errors).toHaveLength(1);
  });
});
