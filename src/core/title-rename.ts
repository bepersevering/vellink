/**
 * 标题改名 → 文件重命名。
 *
 * 文件名默认由首个一级标题派生，改标题就应当跟着改名，否则文件夹里会一直是
 * `Untitled.md` 这种和内容无关的名字。
 *
 * 三个必须处理的现实问题：
 * 1. **标题是逐字符变的**：输入 `# 笔记` 会依次得到 `笔`、`笔记`…，所以观察
 *    到变化后要防抖，停手才动磁盘。
 * 2. **改名要先落盘**：内存里有未保存改动时先写回旧路径，否则磁盘上可能还没有
 *    这个文件（新建文档），`rename` 会直接失败。
 * 3. **id 就是路径**：改名后必须让 Workspace 换 id 并保留撤销栈，见
 *    `Workspace.rekey`。
 */

import type { Workspace, WorkspaceDoc } from "./workspace";
import type { FileWorkspaceBackend } from "./workspace-fs";

/** 只用到 Autosave 的这三个方法，测试里可以传精简替身。 */
export interface RenameAutosave {
  schedule(doc: WorkspaceDoc): void;
  flush(id?: string): Promise<void>;
  cancel(id: string): void;
}

export interface TitleRenamerDeps {
  files: FileWorkspaceBackend;
  workspace: Workspace;
  autosave: RenameAutosave;
  /**
   * 即将动磁盘时调用（还没 rename）。
   *
   * 调用方用它做两件事：把这两条路径标记成「自己改的」，以及让进行中的
   * 外部变更扫描作废——否则扫描会看到「旧路径还在、新路径没有」，把刚改名的
   * 文档当成被外部删掉。
   */
  beforeRename?: (from: string, to: string) => void;
  onError?: (error: unknown, from: string, to: string) => void;
}

interface PendingRename {
  id: string;
  uid: string;
  title: string;
}

export class TitleRenamer {
  private readonly baseline = new Map<string, string>();
  private pending: PendingRename | null = null;
  private timer: ReturnType<typeof setTimeout> | null = null;
  private running = false;

  constructor(
    private readonly deps: TitleRenamerDeps,
    private readonly delay = 900,
  ) {}

  /**
   * 观察当前文档。
   *
   * - 第一次见到某个 uid 只记基线：启动时磁盘上的文件叫什么就是什么，
   *   不能因为标题和文件名不一致就把用户的文件批量改名。
   * - `local` 表示这次标题变化来自编辑器。外部工具改了 H1 只更新基线，
   *   不擅自重命名用户的文件——那个文件名可能是别的工具正在用的。
   */
  observe(id: string, uid: string, title: string, local = true): void {
    const base = this.baseline.get(uid);
    if (base === undefined) {
      this.baseline.set(uid, title);
      return;
    }

    if (base === title) {
      // 标题改回原样：放弃排队中的改名
      this.dropPending(uid);
      return;
    }

    // 已经为这个标题排着队：保持原计划（落盘后 dirty 变 false 不该取消它）
    if (this.pending && this.pending.uid === uid && this.pending.title === title) return;

    if (!local) {
      this.baseline.set(uid, title);
      this.dropPending(uid);
      return;
    }

    this.pending = { id, uid, title };
    this.clearTimer();
    this.timer = setTimeout(() => void this.fire(), this.delay);
  }

  /** 放弃待执行的改名（文档被删、正在换目录等）。 */
  cancel(id?: string): void {
    if (id && this.pending && this.pending.id !== id) return;
    this.clearTimer();
    this.pending = null;
  }

  /** 立刻执行待执行的改名（保存 / 换目录前调，避免丢在防抖窗口里）。 */
  async flush(): Promise<void> {
    this.clearTimer();
    await this.fire();
  }

  dispose(): void {
    this.clearTimer();
    this.pending = null;
    this.baseline.clear();
  }

  private clearTimer(): void {
    if (this.timer) clearTimeout(this.timer);
    this.timer = null;
  }

  /** 清掉排队中的改名；传 uid 时只清那篇文档的。 */
  private dropPending(uid?: string): void {
    if (uid && this.pending && this.pending.uid !== uid) return;
    this.clearTimer();
    this.pending = null;
  }

  private async fire(): Promise<void> {
    const job = this.pending;
    this.pending = null;
    if (!job) return;
    // 正在改上一个：放回去，等它结束后再跑，不并发改同一篇
    if (this.running) {
      this.pending = job;
      return;
    }

    const doc = this.deps.workspace.get(job.id);
    if (!doc) return;

    this.running = true;
    try {
      const target = await this.deps.files.pathForTitle(job.title, job.id);
      if (target === job.id) {
        // 文件名已经就是这个标题了（例如大小写或标点归一后相同）
        this.baseline.set(job.uid, job.title);
        return;
      }
      // 先落盘再改名：新建文档还没写过盘，磁盘上没有源文件可移动。
      // 必须显式 schedule —— 只 flush 的话，若这时恰好没有待写任务就是空操作。
      if (doc.source !== doc.savedSource) {
        this.deps.autosave.schedule(doc);
        await this.deps.autosave.flush(job.id);
      }

      this.deps.beforeRename?.(job.id, target);
      await this.deps.files.rename(job.id, target);
      this.deps.workspace.rekey(job.id, target);

      const moved = this.deps.workspace.get(target);
      if (moved && moved.source !== moved.savedSource) this.deps.autosave.schedule(moved);
      this.baseline.set(job.uid, job.title);
    } catch (error) {
      // 记成基线：否则每次输入都会重试同一个失败，弹一屏 toast
      this.baseline.set(job.uid, job.title);
      this.deps.onError?.(error, job.id, job.title);
    } finally {
      this.running = false;
      if (this.pending) {
        this.clearTimer();
        this.timer = setTimeout(() => void this.fire(), 0);
      }
    }
  }
}
