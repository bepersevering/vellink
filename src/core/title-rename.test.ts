import { afterEach, describe, expect, it, vi } from "vitest";
import { parseMarkdown } from "./parser/markdown";
import type { DocumentStore } from "./store";
import { TitleRenamer, type RenameAutosave } from "./title-rename";
import { Workspace, type WorkspaceDoc } from "./workspace";
import { slugifyTitle, type FileWorkspaceBackend } from "./workspace-fs";

const ROOT = "/docs";
const OLD = `${ROOT}/旧标题.md`;

function doc(id: string, source: string): WorkspaceDoc {
  return {
    id,
    title: "占位",
    source,
    savedSource: source,
    createdAt: 1000,
    updatedAt: 1000,
  };
}

function typeSource(store: DocumentStore, source: string): void {
  const { ir } = parseMarkdown({ source });
  store.apply([{ type: "replaceDocument", children: ir.children, source }]);
}

/** 只实现重命名需要的那几个方法，其余留空。 */
function fakeFiles(options: { fail?: boolean; sameName?: boolean } = {}) {
  const renamed: Array<[string, string]> = [];
  const files = {
    kind: "files",
    root: ROOT,
    trashDir: `${ROOT}/.vellink-trash`,
    pathFor: (title: string) => `${ROOT}/${slugifyTitle(title)}.md`,
    newPath: async (title: string) => `${ROOT}/${slugifyTitle(title)}.md`,
    async pathForTitle(title: string, keep?: string) {
      if (options.sameName && keep) return keep;
      const target = `${ROOT}/${slugifyTitle(title)}.md`;
      // 与生产实现一致：只差大小写不算改名
      if (keep && target.toLowerCase() === keep.toLowerCase()) return keep;
      return target;
    },
    async rename(from: string, to: string) {
      if (options.fail) throw new Error("目标文件已存在");
      renamed.push([from, to]);
    },
    async load() {
      return null;
    },
    async save() {
      return undefined;
    },
    async remove() {
      return undefined;
    },
    async listMeta() {
      return [];
    },
    async read() {
      return "";
    },
  } satisfies FileWorkspaceBackend;
  return { files, renamed };
}

function fakeAutosave(): RenameAutosave & { calls: string[] } {
  const calls: string[] = [];
  return {
    calls,
    schedule: (target) => calls.push(`schedule:${target.id}`),
    flush: async (id) => {
      calls.push(`flush:${id ?? "*"}`);
    },
    cancel: (id) => calls.push(`cancel:${id}`),
  };
}

/** 模拟 App 的行为：每次工作区变化就把当前文档交给 renamer 观察。 */
function observeActive(renamer: TitleRenamer, workspace: Workspace): void {
  const summary = workspace.summaries().find((item) => item.id === workspace.activeId);
  if (summary) renamer.observe(summary.id, summary.uid, summary.title, summary.dirty);
}

describe("TitleRenamer", () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it("改标题：防抖后重命名文件，id 换成新路径但 uid 与撤销栈保留", async () => {
    vi.useFakeTimers();
    const workspace = new Workspace([doc(OLD, "# 旧标题\n\n正文")], { now: () => 2000 });
    const store = workspace.store(OLD)!;
    const { files, renamed } = fakeFiles();
    const autosave = fakeAutosave();
    const renamer = new TitleRenamer({ files, workspace, autosave }, 900);
    const uid = workspace.summaries()[0].uid;

    observeActive(renamer, workspace); // 只记基线
    expect(renamed).toEqual([]);

    typeSource(store, "# 新标题\n\n正文");
    observeActive(renamer, workspace);
    // 还在防抖窗口里，磁盘不动
    expect(renamed).toEqual([]);

    await vi.advanceTimersByTimeAsync(900);

    expect(renamed).toEqual([[OLD, `${ROOT}/新标题.md`]]);
    // 先把正文写到旧路径，改完名再给新 id 排队（替身不会回写 savedSource）
    expect(autosave.calls).toEqual([
      `schedule:${OLD}`,
      `flush:${OLD}`,
      `schedule:${ROOT}/新标题.md`,
    ]);
    expect(workspace.summaries()[0].id).toBe(`${ROOT}/新标题.md`);
    expect(workspace.summaries()[0].uid).toBe(uid);
    // 撤销历史跟着走：改名不等于换一篇文档
    expect(workspace.store(`${ROOT}/新标题.md`)).toBe(store);
    expect(store.canUndo()).toBe(true);
    renamer.dispose();
  });

  it("标题改回原名就取消掉待执行的改名", async () => {
    vi.useFakeTimers();
    const workspace = new Workspace([doc(OLD, "# 旧标题\n\n正文")]);
    const store = workspace.store(OLD)!;
    const { files, renamed } = fakeFiles();
    const renamer = new TitleRenamer({ files, workspace, autosave: fakeAutosave() }, 900);

    observeActive(renamer, workspace);
    typeSource(store, "# 临时标题\n\n正文");
    observeActive(renamer, workspace);
    typeSource(store, "# 旧标题\n\n正文");
    observeActive(renamer, workspace);

    await vi.advanceTimersByTimeAsync(1200);
    expect(renamed).toEqual([]);
    renamer.dispose();
  });

  it("文件名已经是这个标题时不做磁盘操作", async () => {
    vi.useFakeTimers();
    const workspace = new Workspace([doc(OLD, "# 旧标题\n\n正文")]);
    const store = workspace.store(OLD)!;
    const { files, renamed } = fakeFiles({ sameName: true });
    const renamer = new TitleRenamer({ files, workspace, autosave: fakeAutosave() }, 900);

    observeActive(renamer, workspace);
    typeSource(store, "# 另一个标题\n\n正文");
    observeActive(renamer, workspace);

    await vi.advanceTimersByTimeAsync(1000);
    expect(renamed).toEqual([]);
    expect(workspace.summaries()[0].id).toBe(OLD);
    renamer.dispose();
  });

  it("外部改了标题不重命名用户的文件，之后本地改标题仍然生效", async () => {
    vi.useFakeTimers();
    const workspace = new Workspace([doc(OLD, "# 旧标题\n\n正文")], { now: () => 5000 });
    const { files, renamed } = fakeFiles();
    const renamer = new TitleRenamer({ files, workspace, autosave: fakeAutosave() }, 900);

    observeActive(renamer, workspace);
    // 别的编辑器把 H1 改了：文件已经在那个工具手里，别去动它的名字
    workspace.syncExternal(
      [{ id: OLD, source: "# 外部标题\n\n正文", updatedAt: 4000 }],
      [OLD],
    );
    observeActive(renamer, workspace);
    await vi.advanceTimersByTimeAsync(1000);

    expect(renamed).toEqual([]);
    expect(workspace.summaries()[0].id).toBe(OLD);

    // 基线已跟上外部标题：本地再改才是「用户要改名」
    typeSource(workspace.store(OLD)!, "# 本地标题\n\n正文");
    observeActive(renamer, workspace);
    await vi.advanceTimersByTimeAsync(1000);
    expect(renamed).toEqual([[OLD, `${ROOT}/本地标题.md`]]);
    renamer.dispose();
  });

  it("落盘后 dirty 变 false 不会取消刚排队的改名", async () => {
    vi.useFakeTimers();
    const workspace = new Workspace([doc(OLD, "# 旧标题\n\n正文")]);
    const store = workspace.store(OLD)!;
    const { files, renamed } = fakeFiles();
    const renamer = new TitleRenamer({ files, workspace, autosave: fakeAutosave() }, 900);

    observeActive(renamer, workspace);
    typeSource(store, "# 新标题\n\n正文");
    observeActive(renamer, workspace);
    // 700ms 的自动保存在 900ms 的重命名之前先把 dirty 清掉
    workspace.markSaved(OLD);
    observeActive(renamer, workspace);

    await vi.advanceTimersByTimeAsync(1000);
    expect(renamed).toEqual([[OLD, `${ROOT}/新标题.md`]]);
    renamer.dispose();
  });

  it("改名失败：上报一次、id 不变，同一个标题不再重试", async () => {
    vi.useFakeTimers();
    const workspace = new Workspace([doc(OLD, "# 旧标题\n\n正文")]);
    const store = workspace.store(OLD)!;
    const { files } = fakeFiles({ fail: true });
    const errors: unknown[] = [];
    const renamer = new TitleRenamer(
      {
        files,
        workspace,
        autosave: fakeAutosave(),
        onError: (error) => errors.push(error),
      },
      900,
    );

    observeActive(renamer, workspace);
    typeSource(store, "# 新标题\n\n正文");
    observeActive(renamer, workspace);
    await vi.advanceTimersByTimeAsync(1000);

    expect(errors).toHaveLength(1);
    expect(workspace.summaries()[0].id).toBe(OLD);

    // 标题没再变：不应该反复重试同一个失败
    observeActive(renamer, workspace);
    await vi.advanceTimersByTimeAsync(1000);
    expect(errors).toHaveLength(1);
    renamer.dispose();
  });

  it("beforeRename 在动磁盘之前被调用，用来标记「自己改的」", async () => {
    vi.useFakeTimers();
    const workspace = new Workspace([doc(OLD, "# 旧标题\n\n正文")]);
    const store = workspace.store(OLD)!;
    const { files } = fakeFiles();
    const seen: Array<[string, string]> = [];
    const renamer = new TitleRenamer(
      {
        files,
        workspace,
        autosave: fakeAutosave(),
        beforeRename: (from, to) => seen.push([from, to]),
      },
      900,
    );

    observeActive(renamer, workspace);
    typeSource(store, "# 新标题\n\n正文");
    observeActive(renamer, workspace);
    await vi.advanceTimersByTimeAsync(1000);

    expect(seen).toEqual([[OLD, `${ROOT}/新标题.md`]]);
    renamer.dispose();
  });

  it("flush 立刻落实待改的名字（⌘S / 换目录时用）", async () => {
    const workspace = new Workspace([doc(OLD, "# 旧标题\n\n正文")]);
    const store = workspace.store(OLD)!;
    const { files, renamed } = fakeFiles();
    const renamer = new TitleRenamer({ files, workspace, autosave: fakeAutosave() }, 900);

    observeActive(renamer, workspace);
    typeSource(store, "# 立即改名\n\n正文");
    observeActive(renamer, workspace);

    await renamer.flush();
    expect(renamed).toEqual([[OLD, `${ROOT}/立即改名.md`]]);
    renamer.dispose();
  });
});
