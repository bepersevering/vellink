import { describe, expect, it } from "vitest";
import {
  isMarkdownFileName,
  normalizeImportedText,
  planImports,
  titleFromFileName,
} from "./import-docs";
import { Workspace } from "./workspace";

describe("导入 Markdown 的纯函数", () => {
  it("只收 .md / .markdown，且拒绝伪装扩展名", () => {
    expect(isMarkdownFileName("note.md")).toBe(true);
    expect(isMarkdownFileName("note.markdown")).toBe(true);
    expect(isMarkdownFileName("NOTE.MD")).toBe(true);
    expect(isMarkdownFileName("dir/note.md")).toBe(true);
    expect(isMarkdownFileName("note.md.exe")).toBe(false);
    expect(isMarkdownFileName("note.md ")).toBe(false);
    expect(isMarkdownFileName("note.txt")).toBe(false);
    expect(isMarkdownFileName("md")).toBe(false);
  });

  it("文件名派生标题：去扩展名、去控制字符、空名回退", () => {
    expect(titleFromFileName("我的笔记.md", "未命名")).toBe("我的笔记");
    expect(titleFromFileName("dir/a b.markdown", "未命名")).toBe("a b");
    expect(titleFromFileName("  .md", "未命名")).toBe("未命名");
    expect(titleFromFileName("a\u0001b.md", "未命名")).toBe("a b");
  });

  it("归一 BOM 与 CRLF / 孤立 CR", () => {
    expect(normalizeImportedText("\ufeff# 标题\r\n\r\n正文\r一行")).toBe(
      "# 标题\n\n正文\n一行",
    );
    expect(normalizeImportedText("plain\ntext")).toBe("plain\ntext");
  });

  it("标题来自正文 H1，同批重名和已有重名都加后缀", () => {
    const plan = planImports(
      [
        { name: "a.md", text: "# Alpha\n\n1" },
        { name: "a.md", text: "# Alpha\n\n2" },
        { name: "notes.txt", text: "skip" },
        { name: "a.markdown", text: "# Alpha\n\n3" },
        { name: "no-heading.md", text: "正文没有标题" },
      ],
      ["Alpha"],
      "未命名",
    );
    expect(plan.items.map((item) => item.title)).toEqual([
      "Alpha 2",
      "Alpha 3",
      "Alpha 4",
      "正文没有标题",
    ]);
    expect(plan.items.map((item) => item.text)).toEqual([
      "# Alpha\n\n1",
      "# Alpha\n\n2",
      "# Alpha\n\n3",
      "正文没有标题",
    ]);
    expect(plan.skipped).toEqual([{ name: "notes.txt", reason: "extension" }]);
  });

  it("调用方可提供 id；不提供时留空由默认生成器决定", () => {
    const withIds = planImports(
      [{ name: "x.md", text: "" }],
      [],
      "未命名",
      () => "/workspace/x.md",
    );
    expect(withIds.items[0].id).toBe("/workspace/x.md");

    const withoutIds = planImports([{ name: "x.md", text: "" }], [], "未命名");
    expect(withoutIds.items[0].id).toBeUndefined();
  });

  it("id 撞车时加后缀，避免两篇文档指向同一文件", () => {
    const plan = planImports(
      [
        { name: "a.md", text: "1" },
        { name: "b.md", text: "2" },
      ],
      [],
      "未命名",
      () => "/workspace/same.md",
    );
    expect(plan.items[0].id).toBe("/workspace/same.md");
    expect(plan.items[1].id).toBe("/workspace/same.md.1.md");
  });
});

describe("Workspace.importDocs", () => {
  it("加入的文档保留原始源码，不套新建文档的标题模板", () => {
    const workspace = new Workspace([], { now: () => 1000 });
    const added = workspace.importDocs([
      { title: "导入篇", source: "# 自己的标题\n\n正文", saved: true },
    ]);
    expect(added).toHaveLength(1);
    expect(workspace.get(added[0].id)?.source).toBe("# 自己的标题\n\n正文");
    expect(workspace.summaries()[0].dirty).toBe(false);
    expect(workspace.activeId).toBe(added[0].id);
  });

  it("saved:false 的文档标脏，交给自动保存落盘", () => {
    const workspace = new Workspace([], { now: () => 1000 });
    const added = workspace.importDocs([{ title: "A", source: "正文" }]);
    expect(workspace.summaries()[0].dirty).toBe(true);
    expect(workspace.get(added[0].id)?.savedSource).toBe("");
  });

  it("批量导入一次通知，标题互不冲突", () => {
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

  it("空列表不改状态也不通知", () => {
    const workspace = new Workspace([], { now: () => 1000 });
    let notifications = 0;
    workspace.subscribe(() => (notifications += 1));
    expect(workspace.importDocs([])).toEqual([]);
    expect(notifications).toBe(0);
  });
});
