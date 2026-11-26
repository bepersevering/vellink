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

  it("rekey：换 id 保留 uid、撤销栈与激活状态，编辑继续回灌", () => {
    const workspace = new Workspace([doc("a", "# A\n\n正文")]);
    const store = workspace.store("a")!;
    const uid = workspace.summaries()[0].uid;
    typeSource(store, "# A\n\n改过");

    expect(workspace.rekey("a", "/docs/A.md")).toBe(true);

    expect(workspace.activeId).toBe("/docs/A.md");
    expect(workspace.get("a")).toBeUndefined();
    expect(workspace.summaries()[0]).toMatchObject({ id: "/docs/A.md", uid, dirty: true });
    // 同一个 store（撤销历史还在），换 id 不等于换文档
    expect(workspace.store("/docs/A.md")).toBe(store);
    expect(store.canUndo()).toBe(true);

    // 订阅回调绑的是文档对象而不是 id：改名后继续编辑仍能回灌
    typeSource(store, "# A\n\n再改一次");
    expect(workspace.get("/docs/A.md")?.source).toContain("再改一次");

    // 落盘也认新 id
    workspace.markSaved("/docs/A.md");
    expect(workspace.summaries()[0].dirty).toBe(false);
  });

  it("rekey 拒绝空改与已占用的 id", () => {
    const workspace = new Workspace([doc("a", "# A"), doc("b", "# B")]);

    expect(workspace.rekey("a", "a")).toBe(false);
    expect(workspace.rekey("a", "b")).toBe(false);
    expect(workspace.rekey("missing", "c")).toBe(false);
    expect(workspace.summaries().map((item) => item.id)).toEqual(["a", "b"]);
    expect(workspace.activeId).toBe("a");
  });
});

describe("Workspace 外部变更校正", () => {
  it("磁盘新增的文件进入列表顶部", () => {
    const workspace = new Workspace([doc("a", "# A")], { now: () => 5000 });

    const result = workspace.syncExternal(
      [{ id: "b", source: "# B\n\n来自磁盘", updatedAt: 4000 }],
      ["a", "b"],
    );

    expect(result.added).toEqual(["b"]);
    expect(workspace.summaries().map((item) => item.id)).toEqual(["b", "a"]);
    expect(workspace.get("b")?.title).toBe("B");
  });

  it("磁盘内容变了就覆盖，并重置该文档的撤销栈", () => {
    const workspace = new Workspace([doc("a", "# A\n\n旧")]);
    const store = workspace.store("a")!;
    typeSource(store, "# A\n\n本地改的");

    // 先让本地改动落盘，模拟「已保存 → 外部又改了」
    workspace.markSaved("a");
    const result = workspace.syncExternal(
      [{ id: "a", source: "# A\n\n外部改的", updatedAt: 9000 }],
      ["a"],
    );

    expect(result.updated).toEqual(["a"]);
    expect(workspace.get("a")?.source).toBe("# A\n\n外部改的");
    expect(workspace.summaries()[0].dirty).toBe(false);
    // 视图拿到的也是新内容，且旧历史已作废
    expect(store.getDocument().source).toBe("# A\n\n外部改的");
    expect(store.canUndo()).toBe(false);
  });

  it("有未保存改动的文档不被磁盘覆盖", () => {
    const workspace = new Workspace([doc("a", "# A\n\n旧")]);
    const store = workspace.store("a")!;
    typeSource(store, "# A\n\n正在写");

    const result = workspace.syncExternal(
      [{ id: "a", source: "# A\n\n外部改的", updatedAt: 9000 }],
      ["a"],
    );

    expect(result.updated).toEqual([]);
    expect(workspace.get("a")?.source).toBe("# A\n\n正在写");
    expect(workspace.summaries()[0].dirty).toBe(true);
  });

  it("磁盘上消失的文件被移除，但至少保留一篇", () => {
    const workspace = new Workspace([doc("a", "# A"), doc("b", "# B")]);

    const result = workspace.syncExternal([], ["a"]);
    expect(result.removed).toEqual(["b"]);
    expect(workspace.summaries()).toHaveLength(1);

    // 只剩一篇时不再移除
    expect(workspace.syncExternal([], []).removed).toEqual([]);
    expect(workspace.summaries()).toHaveLength(1);
  });

  it("只传变化项时，未提及的文档不会被当成删除", () => {
    const workspace = new Workspace([doc("a", "# A"), doc("b", "# B")]);

    workspace.syncExternal([{ id: "a", source: "# A", updatedAt: 2000 }], ["a", "b"]);

    expect(workspace.summaries().map((item) => item.id)).toEqual(["a", "b"]);
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

  it("删除后取消待写，不会把文件又写回来", async () => {
    vi.useFakeTimers();
    const backend = createMemoryWorkspaceBackend();
    const autosave = new Autosave(backend, {}, 800);
    autosave.schedule(doc("a", "# A\n\n还没写完"));

    autosave.cancel("a");
    await vi.advanceTimersByTimeAsync(1000);

    expect(backend.docs.has("a")).toBe(false);
    autosave.dispose();
  });

  it("同一篇文档的写入串行，flush 返回时磁盘已是最后内容", async () => {
    const written: string[] = [];
    let active = 0;
    let maxActive = 0;
    const slow = {
      load: async () => null,
      save: async (target: WorkspaceDoc) => {
        active += 1;
        maxActive = Math.max(maxActive, active);
        await new Promise((resolve) => setTimeout(resolve, 5));
        written.push(target.source);
        active -= 1;
      },
      remove: async () => undefined,
    };
    const autosave = new Autosave(slow, {}, 800);

    autosave.schedule(doc("a", "# A\n\n第一版"));
    const first = autosave.flush("a");
    // 第一次还没写完就又改了：第二次 flush 必须排在它后面
    autosave.schedule(doc("a", "# A\n\n第二版"));
    const second = autosave.flush("a");
    await Promise.all([first, second]);

    expect(maxActive).toBe(1);
    expect(written[written.length - 1]).toBe("# A\n\n第二版");
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
