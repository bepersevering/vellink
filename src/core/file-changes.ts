/**
 * 外部变更检测：把磁盘快照折算成「哪些文件需要读回内容」。
 *
 * 监听器（文件系统事件）和兜底轮询都只负责说一句「可能变了」，真正的判定
 * 在这里——按 mtime + size 对比上一次快照，所以一次事件风暴最多读一次文件。
 *
 * 两个必须由外部告诉它的信息：
 * - `markOwn`：本应用刚写过 / 刚改过名的路径。自己写盘也会触发监听事件，
 *   不标记的话每次保存都会把文件重新读一遍、再回灌一次视图。
 * - `rebaseline`：整体重置（改工作区目录、大改动之后），只记基线不产出变更。
 */

/** 判断「变没变」只需要的最小元信息。 */
export interface FileStamp {
  path: string;
  modified: number;
  size: number;
}

export interface ChangeSet {
  /** 新增或内容可能变化的文件，需要读回内容才能知道差异。 */
  candidates: FileStamp[];
  /** 磁盘上当前全部路径，用于判断「内存有、磁盘已删」。 */
  present: string[];
}

export interface FileChangeOptions {
  now?: () => number;
  /** 自己写盘后的静默期；监听事件通常滞后几十到几百毫秒。 */
  graceMs?: number;
}

export class FileChangeDetector {
  private readonly stamps = new Map<string, FileStamp>();
  private readonly own = new Map<string, number>();
  private readonly now: () => number;
  private readonly graceMs: number;

  constructor(options: FileChangeOptions = {}) {
    this.now = options.now ?? (() => Date.now());
    this.graceMs = options.graceMs ?? 2500;
  }

  /** 本应用写入过的路径：宽限期内即使 mtime 变了也不算外部改动。 */
  markOwn(...paths: string[]): void {
    const until = this.now() + this.graceMs;
    for (const path of paths) this.own.set(path, until);
  }

  /** 只记基线，不产出变更（首次加载、改目录、重命名之后都走这里）。 */
  rebaseline(entries: FileStamp[]): void {
    this.stamps.clear();
    for (const entry of entries) this.stamps.set(entry.path, { ...entry });
  }

  diff(entries: FileStamp[]): ChangeSet {
    const now = this.now();
    const candidates: FileStamp[] = [];
    const present: string[] = [];

    for (const entry of entries) {
      present.push(entry.path);
      const previous = this.stamps.get(entry.path);
      this.stamps.set(entry.path, { ...entry });

      // 第一次见到这个文件只记基线：启动时不该把整库文档重读一遍
      if (!previous) continue;
      if (previous.modified === entry.modified && previous.size === entry.size) continue;

      const until = this.own.get(entry.path);
      if (until !== undefined && now < until) continue;

      candidates.push({ ...entry });
    }

    for (const [path, until] of [...this.own]) {
      if (now >= until) this.own.delete(path);
    }

    return { candidates, present };
  }
}
