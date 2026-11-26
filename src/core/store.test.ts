import { describe, it, expect, beforeEach, vi } from "vitest";
import { DocumentStore } from "./store";
import { emptyDocument, type ParagraphNode } from "./ir/types";
import { bus } from "./event/bus";
import { commands } from "./command/registry";

function para(id: string, text: string): ParagraphNode {
  return {
    id,
    type: "paragraph",
    span: { start: 0, end: text.length },
    children: [
      {
        id: `${id}_t`,
        type: "text",
        value: text,
        span: { start: 0, end: text.length },
      },
    ],
  };
}

describe("M0 验收闭环：改 IR → 事件通知 → 撤销恢复", () => {
  beforeEach(() => {
    bus.clear();
    commands.clear();
  });

  it("应用 op 时事件总线收到 document:changed，且带版本号", () => {
    const store = new DocumentStore(emptyDocument());
    const handler = vi.fn();
    bus.on("document:changed", handler);

    store.apply([{ type: "insert", at: 0, nodes: [para("p1", "hello")] }]);

    expect(handler).toHaveBeenCalledTimes(1);
    expect(handler.mock.calls[0][0]).toMatchObject({
      type: "document:changed",
      version: 1,
    });
  });

  it("撤销后文档恢复为空，且再次广播事件", () => {
    const store = new DocumentStore(emptyDocument());
    const handler = vi.fn();
    bus.on("document:changed", handler);

    store.apply([{ type: "insert", at: 0, nodes: [para("p1", "hello")] }]);
    expect(store.getDocument().children).toHaveLength(1);

    const ok = store.undo();
    expect(ok).toBe(true);
    expect(store.getDocument().children).toHaveLength(0);
    expect(handler).toHaveBeenCalledTimes(2);
  });

  it("doc.undo 命令可调用，且无历史时返回 false", async () => {
    const store = new DocumentStore(emptyDocument());
    expect(await commands.run("doc.undo")).toBe(false);

    store.apply([{ type: "insert", at: 0, nodes: [para("p1", "x")] }]);
    expect(store.canUndo()).toBe(true);
    expect(await commands.run("doc.undo")).toBe(true);
    expect(store.getDocument().children).toHaveLength(0);
  });

  it("命令搜索按标题与 id 匹配", () => {
    new DocumentStore(emptyDocument());
    expect(commands.search("undo").map((c) => c.id)).toContain("doc.undo");
    expect(commands.search("撤销").map((c) => c.id)).toContain("doc.undo");
  });
});

describe("撤销栈统一：双视图提交 + redo + 连续输入合并", () => {
  beforeEach(() => {
    bus.clear();
    commands.clear();
  });

  const makeIR = (text: string, version = 0) => ({
    children: [para("p1", text)],
    source: text,
    version,
  });

  it("replaceDocument 原子替换 IR 与 source，undo 完整恢复", () => {
    const store = new DocumentStore(makeIR("原文"));
    store.apply([
      { type: "replaceDocument", children: makeIR("改后").children, source: "改后" },
    ]);

    expect(store.getDocument().source).toBe("改后");
    expect(store.canUndo()).toBe(true);

    expect(store.undo()).toBe(true);
    expect(store.getDocument().source).toBe("原文");
    expect(store.getDocument().children[0]).toMatchObject({ type: "paragraph" });
  });

  it("redo 重放最近撤销的事务，且可再次 undo", () => {
    const store = new DocumentStore(makeIR("原文"));
    store.apply([
      { type: "replaceDocument", children: makeIR("改后").children, source: "改后" },
    ]);

    expect(store.undo()).toBe(true);
    expect(store.canRedo()).toBe(true);
    expect(store.redo()).toBe(true);
    expect(store.getDocument().source).toBe("改后");

    expect(store.undo()).toBe(true);
    expect(store.getDocument().source).toBe("原文");
  });

  it("撤销后产生新编辑，redo 分支失效", () => {
    const store = new DocumentStore(makeIR("原文"));
    store.apply([
      { type: "replaceDocument", children: makeIR("A").children, source: "A" },
    ]);
    store.undo();
    expect(store.canRedo()).toBe(true);

    store.apply([
      { type: "replaceDocument", children: makeIR("B").children, source: "B" },
    ]);
    expect(store.canRedo()).toBe(false);
    expect(store.redo()).toBe(false);
  });

  it("同 mergeKey 的连续输入合并为一个撤销点", () => {
    const store = new DocumentStore(makeIR(""));
    for (const text of ["你", "你好", "你好世", "你好世界"]) {
      store.apply(
        [{ type: "replaceDocument", children: makeIR(text).children, source: text }],
        { mergeKey: "wysiwyg" },
      );
    }

    expect(store.getDocument().source).toBe("你好世界");
    expect(store.undo()).toBe(true);
    expect(store.getDocument().source).toBe("");
    expect(store.undo()).toBe(false);
  });

  it("不同 mergeKey 保留各自撤销点", () => {
    const store = new DocumentStore(makeIR(""));
    store.apply(
      [{ type: "replaceDocument", children: makeIR("WYSIWYG").children, source: "WYSIWYG" }],
      { mergeKey: "wysiwyg" },
    );
    store.apply(
      [{ type: "replaceDocument", children: makeIR("源码").children, source: "源码" }],
      { mergeKey: "source" },
    );

    store.undo();
    expect(store.getDocument().source).toBe("WYSIWYG");
    store.undo();
    expect(store.getDocument().source).toBe("");
  });

  it("dispose 后命令注销，允许重建 store（StrictMode 双挂载安全）", () => {
    const first = new DocumentStore(emptyDocument());
    first.dispose();
    expect(() => new DocumentStore(emptyDocument())).not.toThrow();
    expect(commands.get("doc.undo")).toBeDefined();
  });

  it("doc.redo 命令可用", async () => {
    const store = new DocumentStore(makeIR("原文"));
    store.apply([
      { type: "replaceDocument", children: makeIR("改后").children, source: "改后" },
    ]);
    store.undo();

    expect(await commands.run("doc.redo")).toBe(true);
    expect(store.getDocument().source).toBe("改后");
  });
});
