/**
 * 真磁盘集成测试：用 node:fs 实现 FileBackendDeps，跑「改标题 → 改名」全链路。
 *
 * 单测里的假磁盘只看逻辑，这里验证的是与真实文件系统的约定：文件名里的中文、
 * rename 的覆盖语义、落盘后再改名不会丢内容。
 */

import { mkdtemp, readdir, readFile, rename, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { parseMarkdown } from "./parser/markdown";
import { TitleRenamer } from "./title-rename";
import { Workspace } from "./workspace";
import { Autosave } from "./workspace-storage";
import { createFileWorkspaceBackend, type FileBackendDeps, type FileEntry } from "./workspace-fs";

/** 与 src-tauri/src/fs.rs 对齐：递归、跳过隐藏目录、只认 .md。 */
function nodeDisk(): FileBackendDeps {
  const entryOf = async (path: string): Promise<FileEntry> => {
    const info = await stat(path);
    return {
      path,
      name: basename(path),
      size: info.size,
      modified: Math.round(info.mtimeMs),
    };
  };

  const walk = async (dir: string): Promise<FileEntry[]> => {
    const items = await readdir(dir, { withFileTypes: true });
    const out: FileEntry[] = [];
    for (const item of items) {
      if (item.name.startsWith(".")) continue;
      const full = join(dir, item.name);
      if (item.isDirectory()) out.push(...(await walk(full)));
      else if (item.name.endsWith(".md")) out.push(await entryOf(full));
    }
    return out;
  };

  return {
    list: (root) => walk(root),
    read: (path) => readFile(path, "utf8"),
    async write(path, contents) {
      await writeFile(path, contents, "utf8");
      return entryOf(path);
    },
    async trash(path, trashDir) {
      const { mkdir } = await import("node:fs/promises");
      await mkdir(trashDir, { recursive: true });
      const target = join(trashDir, `${Date.now()}-${basename(path)}`);
      await rename(path, target);
      return target;
    },
    async rename(from, to) {
      await rename(from, to);
      return entryOf(to);
    },
  };
}

let dir = "";

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), "vellink-fs-"));
});

afterEach(async () => {
  await rm(dir, { recursive: true, force: true });
});

describe("本地文件后端（真磁盘）", () => {
  it("改标题：文件被改名、内容不丢、id 跟着变", async () => {
    await writeFile(join(dir, "旧标题.md"), "# 旧标题\n\n正文\n", "utf8");

    const backend = createFileWorkspaceBackend(dir, nodeDisk());
    const workspace = new Workspace((await backend.load())!);
    const autosave = new Autosave(backend, {
      onSaved: (id, source) => workspace.markSaved(id, source),
    });
    const renamer = new TitleRenamer({ files: backend, workspace, autosave });

    const observe = () => {
      const summary = workspace.summaries()[0];
      renamer.observe(summary.id, summary.uid, summary.title, summary.dirty);
    };

    observe(); // 基线

    const store = workspace.store(join(dir, "旧标题.md"))!;
    const { ir } = parseMarkdown({ source: "# 新标题\n\n改过的正文\n" });
    store.apply([{ type: "replaceDocument", children: ir.children, source: "# 新标题\n\n改过的正文\n" }]);
    observe();

    // flush 走的就是「先落盘再改名」那条路径
    await renamer.flush();

    const files = (await readdir(dir)).filter((name) => name.endsWith(".md"));
    expect(files).toEqual(["新标题.md"]);
    expect(await readFile(join(dir, "新标题.md"), "utf8")).toBe("# 新标题\n\n改过的正文\n");
    expect(workspace.summaries()[0].id).toBe(join(dir, "新标题.md"));
    expect(workspace.summaries()[0].dirty).toBe(false);

    autosave.dispose();
    renamer.dispose();
  });

  it("新建文档还只在内存里时改标题：落盘与改名串起来仍然得到一个正确文件", async () => {
    const backend = createFileWorkspaceBackend(dir, nodeDisk());
    const workspace = new Workspace([]);
    const autosave = new Autosave(backend, {
      onSaved: (id, source) => workspace.markSaved(id, source),
    });
    const renamer = new TitleRenamer({ files: backend, workspace, autosave });

    const path = await backend.newPath("未命名文档");
    workspace.create("未命名文档", path);

    const observe = () => {
      const summary = workspace.summaries()[0];
      renamer.observe(summary.id, summary.uid, summary.title, summary.dirty);
    };
    observe();

    // 从来没有落过盘：磁盘上没有「未命名文档.md」
    expect(await readdir(dir)).toEqual([]);

    const store = workspace.store(path)!;
    const { ir } = parseMarkdown({ source: "# 真正的名字\n\n第一段\n" });
    store.apply([{ type: "replaceDocument", children: ir.children, source: "# 真正的名字\n\n第一段\n" }]);
    observe();
    await renamer.flush();

    expect((await readdir(dir)).filter((name) => name.endsWith(".md"))).toEqual([
      "真正的名字.md",
    ]);
    expect(await readFile(join(dir, "真正的名字.md"), "utf8")).toBe("# 真正的名字\n\n第一段\n");
    // 旧路径不该留下空文件
    expect(await readdir(dir)).not.toContain("未命名文档.md");

    autosave.dispose();
    renamer.dispose();
  });

  it("外部改了 H1：不重命名，文件按外部内容重载", async () => {
    await writeFile(join(dir, "旧标题.md"), "# 旧标题\n\n正文\n", "utf8");

    const backend = createFileWorkspaceBackend(dir, nodeDisk());
    const workspace = new Workspace((await backend.load())!);
    const autosave = new Autosave(backend, {});
    const renamer = new TitleRenamer({ files: backend, workspace, autosave });

    const observe = () => {
      const summary = workspace.summaries()[0];
      renamer.observe(summary.id, summary.uid, summary.title, summary.dirty);
    };
    observe();

    // 模拟外部工具改写（不经过编辑器，因此不是 dirty）
    await writeFile(join(dir, "旧标题.md"), "# 别人改的标题\n\n正文\n", "utf8");
    workspace.syncExternal(
      [{ id: join(dir, "旧标题.md"), source: "# 别人改的标题\n\n正文\n", updatedAt: Date.now() }],
      [join(dir, "旧标题.md")],
    );
    observe();
    await renamer.flush();

    expect((await readdir(dir)).filter((name) => name.endsWith(".md"))).toEqual(["旧标题.md"]);
    expect(workspace.summaries()[0].title).toBe("别人改的标题");

    autosave.dispose();
    renamer.dispose();
  });
});
