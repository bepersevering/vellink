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
