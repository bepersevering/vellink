import { describe, expect, it } from "vitest";
import {
  createFileWorkspaceBackend,
  slugifyTitle,
  type FileBackendDeps,
  type FileEntry,
} from "./workspace-fs";

const ROOT = "/docs";

/** 内存里的「磁盘」，接口与 Tauri 命令一致，方便在 node 里跑。 */
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
      if (!file) throw new Error(`没有这个文件: ${path}`);
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
  };

  return { deps, store, trashed };
}

describe("slugifyTitle", () => {
  it("保留中日韩文字，替换文件系统非法字符", () => {
    expect(slugifyTitle("如何建立自己的知识体系")).toBe("如何建立自己的知识体系");
    expect(slugifyTitle('a/b:c*d?e"f<g>h|i')).toBe("a-b-c-d-e-f-g-h-i");
  });

  it("空格折叠成连字符，去掉首尾的点和连字符", () => {
    expect(slugifyTitle("  Hello   World  ")).toBe("Hello-World");
    expect(slugifyTitle("..hidden..")).toBe("hidden");
  });

  it("空标题回退到默认名，超长截断", () => {
    expect(slugifyTitle("   ")).toBe("untitled");
    expect(slugifyTitle("x".repeat(200)).length).toBeLessThanOrEqual(60);
  });
});

describe("文件后端", () => {
  it("load：id 是绝对路径，标题取首个一级标题，内容即已保存版本", async () => {
    const disk = fakeDisk({
      [`${ROOT}/a.md`]: { content: "# Alpha\n\n正文", modified: 100 },
      [`${ROOT}/notes/b.md`]: { content: "# Beta\n\n正文", modified: 300 },
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

  it("load：单篇读失败不影响其它文档", async () => {
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

  it("newPath：避开目录里已有文件名，pathFor 不去重", async () => {
    const disk = fakeDisk({
      [`${ROOT}/未命名文档.md`]: { content: "# 未命名文档", modified: 1 },
    });
    const backend = createFileWorkspaceBackend(ROOT, disk.deps);

    expect(await backend.newPath("未命名文档")).toBe(`${ROOT}/未命名文档-2.md`);
    expect(await backend.newPath("全新标题")).toBe(`${ROOT}/全新标题.md`);
    expect(backend.pathFor("未命名文档")).toBe(`${ROOT}/未命名文档.md`);
  });

  it("连按两次新建不会拿到同一个路径", async () => {
    const disk = fakeDisk({});
    const backend = createFileWorkspaceBackend(ROOT, disk.deps);

    const [first, second] = await Promise.all([
      backend.newPath("未命名文档"),
      backend.newPath("未命名文档"),
    ]);

    expect(first).not.toBe(second);
    expect([first, second]).toEqual([
      `${ROOT}/未命名文档.md`,
      `${ROOT}/未命名文档-2.md`,
    ]);
  });

  it("save 写回同一个文件，remove 移到回收目录而不是删除", async () => {
    const disk = fakeDisk({ [`${ROOT}/a.md`]: { content: "# A", modified: 1 } });
    const backend = createFileWorkspaceBackend(ROOT, disk.deps);
    const [doc] = (await backend.load())!;

    await backend.save({ ...doc, source: "# A\n\n改过了" });
    expect(disk.store.get(`${ROOT}/a.md`)?.content).toBe("# A\n\n改过了");

    await backend.remove(doc.id);
    expect(disk.trashed).toEqual([
      { path: `${ROOT}/a.md`, dir: `${ROOT}/.vellink-trash` },
    ]);
    expect(backend.trashDir).toBe(`${ROOT}/.vellink-trash`);
  });

  it("listMeta 只列举不读内容，供轮询增量对比", async () => {
    const disk = fakeDisk({ [`${ROOT}/a.md`]: { content: "# A", modified: 7 } });
    const backend = createFileWorkspaceBackend(ROOT, disk.deps);

    const entries = await backend.listMeta();
    expect(entries).toHaveLength(1);
    expect(entries[0].modified).toBe(7);
    expect(await backend.read(entries[0].path)).toBe("# A");
  });
});
