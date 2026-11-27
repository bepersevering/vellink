/**
 * Workspace 持久化 + 自动保存。
 *
 * 存储后端只认「整篇文档」，不做增量 diff：Markdown 单篇体量小，
 * 整存整取换来的是任何时刻断电都有一份完整快照，且后端只需实现三个方法，
 * 后续换 Tauri 文件系统 / WebDAV 时不用改上层。
 *
 * 浏览器侧用 localStorage：桌面版接入 Tauri fs 后，这里换成目录读写即可。
 */

import type { WorkspaceDoc } from "./workspace";

export interface WorkspaceBackend {
  /** 首次启动（无索引）返回 null，由调用方决定是否写入种子文档。 */
  load(): Promise<WorkspaceDoc[] | null>;
  save(doc: WorkspaceDoc): Promise<void>;
  remove(id: string): Promise<void>;
  /** 重排顺序；不支持的后端（文件目录）可以省略。 */
  reorder?(ids: string[]): Promise<void>;
}

const INDEX_KEY = "vellink:workspace:v1";
const DOC_PREFIX = "vellink:workspace:v1:doc:";

interface IndexEntry {
  id: string;
  title: string;
  createdAt: number;
  updatedAt: number;
}

function safeStorage(): Storage | null {
  try {
    const storage = globalThis.localStorage;
    if (!storage) return null;
    return storage;
  } catch {
    return null;
  }
}

function parseIndex(raw: string | null): IndexEntry[] | null {
  if (!raw) return null;
  try {
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return null;
    return parsed.filter((entry): entry is IndexEntry =>
      Boolean(entry) &&
      typeof (entry as IndexEntry).id === "string" &&
      typeof (entry as IndexEntry).createdAt === "number",
    );
  } catch {
    return null;
  }
}

/** localStorage 后端；不可用时退化为内存，功能不崩但重启即失。 */
export function createLocalWorkspaceBackend(storageArg?: Storage | null): WorkspaceBackend {
  const storage = storageArg === undefined ? safeStorage() : storageArg;
  if (!storage) return createMemoryWorkspaceBackend();

  const readIndex = (): IndexEntry[] => parseIndex(storage.getItem(INDEX_KEY)) ?? [];
  const writeIndex = (entries: IndexEntry[]) => {
    storage.setItem(INDEX_KEY, JSON.stringify(entries));
  };

  return {
    async load() {
      const index = parseIndex(storage.getItem(INDEX_KEY));
      if (!index) return null;
      const docs: WorkspaceDoc[] = [];
      for (const entry of index) {
        const raw = storage.getItem(DOC_PREFIX + entry.id);
        if (!raw) continue;
        try {
          const stored = JSON.parse(raw) as Partial<WorkspaceDoc>;
          if (typeof stored.source !== "string") continue;
          docs.push({
            id: entry.id,
            title: typeof stored.title === "string" ? stored.title : entry.title,
            source: stored.source,
            // 落盘的内容就是已保存版本
            savedSource: stored.source,
            createdAt: stored.createdAt ?? entry.createdAt,
            updatedAt: stored.updatedAt ?? entry.updatedAt,
          });
        } catch {
          // 单篇损坏不影响其它文档启动
        }
      }
      return docs;
    },

    async save(doc) {
      storage.setItem(
        DOC_PREFIX + doc.id,
        JSON.stringify({
          id: doc.id,
          title: doc.title,
          source: doc.source,
          createdAt: doc.createdAt,
          updatedAt: doc.updatedAt,
        }),
      );
      // 已有文档原地更新条目：自动保存不该悄悄把正在写的那篇顶到最前面，
      // 否则用户手动排好的顺序会被每次敲键打乱。新文档才插到开头。
      const index = readIndex();
      const entry = {
        id: doc.id,
        title: doc.title,
        createdAt: doc.createdAt,
        updatedAt: doc.updatedAt,
      };
      const at = index.findIndex((e) => e.id === doc.id);
      if (at === -1) index.unshift(entry);
      else index[at] = { ...index[at], ...entry };
      writeIndex(index);
    },

    async remove(id) {
      storage.removeItem(DOC_PREFIX + id);
      writeIndex(readIndex().filter((entry) => entry.id !== id));
    },

    async reorder(ids) {
      const index = readIndex();
      const byId = new Map(index.map((entry) => [entry.id, entry]));
      const ordered = ids.map((id) => byId.get(id)).filter((e): e is IndexEntry => Boolean(e));
      // 没被 drag 到的文档按原顺序补在后面，不丢数据
      const seen = new Set(ordered.map((e) => e.id));
      writeIndex([...ordered, ...index.filter((e) => !seen.has(e.id))]);
    },
  };
}

/** 测试与降级用的内存后端。 */
export function createMemoryWorkspaceBackend(
  initial: WorkspaceDoc[] | null = null,
): WorkspaceBackend & { docs: Map<string, WorkspaceDoc> } {
  const docs = new Map<string, WorkspaceDoc>(
    (initial ?? []).map((doc) => [doc.id, { ...doc }]),
  );
  let seeded = initial !== null;
  return {
    docs,
    async load() {
      if (!seeded) return null;
      return [...docs.values()].map((doc) => ({ ...doc }));
    },
    async save(doc) {
      seeded = true;
      docs.set(doc.id, { ...doc });
    },
    async remove(id) {
      docs.delete(id);
    },
    async reorder(ids) {
      const next = new Map<string, WorkspaceDoc>();
      for (const id of ids) {
        const doc = docs.get(id);
        if (doc) next.set(id, doc);
      }
      for (const [id, doc] of docs) if (!next.has(id)) next.set(id, doc);
      docs.clear();
      for (const [id, doc] of next) docs.set(id, doc);
    },
  };
}

export type SaveState = "idle" | "saving" | "error";

export interface AutosaveHooks {
  /** 每篇文档的保存状态，UI 用来显示「保存中 / 已保存」。 */
  onState?: (id: string, state: SaveState) => void;
  onSaved?: (id: string, source: string) => void;
  onError?: (id: string, error: unknown) => void;
}

/** 防抖自动保存：连续输入只在停手 delay 毫秒后写一次。 */
export class Autosave {
  private readonly timers = new Map<string, ReturnType<typeof setTimeout>>();
  private readonly pending = new Map<string, WorkspaceDoc>();
  /** 正在写盘的那一次；同一篇文档的写入串行，改名/删除前可以等它落地。 */
  private readonly running = new Map<string, Promise<void>>();
  /** 可在运行时改（设置面板的「自动保存间隔」）：所以不是 readonly。 */
  private delay: number;

  constructor(
    private readonly backend: WorkspaceBackend,
    private readonly hooks: AutosaveHooks = {},
    delay = 800,
  ) {
    this.delay = delay;
  }

  /**
   * 改防抖间隔。
   *
   * 已经在等的那几篇要重新排一次：否则改完设置还得再敲几个字才生效，
   * 用户会以为设置没起作用。
   */
  setDelay(ms: number): void {
    if (!Number.isFinite(ms) || ms <= 0 || ms === this.delay) return;
    this.delay = ms;
    for (const doc of [...this.pending.values()]) this.schedule(doc);
  }

  schedule(doc: WorkspaceDoc): void {
    this.pending.set(doc.id, { ...doc });
    const timer = this.timers.get(doc.id);
    if (timer) clearTimeout(timer);
    this.timers.set(
      doc.id,
      setTimeout(() => void this.flush(doc.id), this.delay),
    );
  }

  /** 立即落盘；不传 id 则清空全部待写，并等所有在写的都结束。 */
  async flush(id?: string): Promise<void> {
    const ids = id
      ? [id]
      : [...new Set([...this.pending.keys(), ...this.running.keys()])];
    await Promise.all(ids.map((target) => this.write(target)));
    await Promise.all(ids.map((target) => this.settled(target)));
  }

  /**
   * 等这篇文档正在进行的写入结束。
   *
   * 删除文件前必须先等：否则那次写盘会在文件被移走之后才落盘，
   * 凭空把刚删掉的稿子写回来（与防抖计时器那个坑是同一类）。
   */
  settled(id: string): Promise<void> {
    return this.running.get(id) ?? Promise.resolve();
  }

  /**
   * 取消某篇文档的待写任务。
   *
   * 删除文档时必须先调它：否则防抖计时器在删除之后才触发，
   * 会把刚删掉的文件又写回磁盘（文件后端下就是「删了又自己回来了」）。
   */
  cancel(id: string): void {
    const timer = this.timers.get(id);
    if (timer) clearTimeout(timer);
    this.timers.delete(id);
    this.pending.delete(id);
  }

  dispose(): void {
    for (const timer of this.timers.values()) clearTimeout(timer);
    this.timers.clear();
    this.pending.clear();
    this.running.clear();
  }

  private async write(id: string): Promise<void> {
    const timer = this.timers.get(id);
    if (timer) {
      clearTimeout(timer);
      this.timers.delete(id);
    }
    // 同一篇文档不并发写：等上一次结束，再取最新的快照
    await this.settled(id);

    const doc = this.pending.get(id);
    if (!doc) return;
    this.pending.delete(id);

    const task = this.run(doc);
    this.running.set(id, task);
    try {
      await task;
    } finally {
      if (this.running.get(id) === task) this.running.delete(id);
    }
  }

  private async run(doc: WorkspaceDoc): Promise<void> {
    this.hooks.onState?.(doc.id, "saving");
    try {
      await this.backend.save(doc);
      this.hooks.onState?.(doc.id, "idle");
      this.hooks.onSaved?.(doc.id, doc.source);
    } catch (error) {
      this.hooks.onState?.(doc.id, "error");
      this.hooks.onError?.(doc.id, error);
    }
  }
}
