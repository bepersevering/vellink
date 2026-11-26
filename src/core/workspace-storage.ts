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
export function createLocalWorkspaceBackend(): WorkspaceBackend {
  const storage = safeStorage();
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
      const index = readIndex().filter((entry) => entry.id !== doc.id);
      index.unshift({
        id: doc.id,
        title: doc.title,
        createdAt: doc.createdAt,
        updatedAt: doc.updatedAt,
      });
      writeIndex(index);
    },

    async remove(id) {
      storage.removeItem(DOC_PREFIX + id);
      writeIndex(readIndex().filter((entry) => entry.id !== id));
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
  private readonly delay: number;

  constructor(
    private readonly backend: WorkspaceBackend,
    private readonly hooks: AutosaveHooks = {},
    delay = 800,
  ) {
    this.delay = delay;
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

  /** 立即落盘；不传 id 则清空全部待写。 */
  async flush(id?: string): Promise<void> {
    const ids = id ? [id] : [...this.pending.keys()];
    await Promise.all(ids.map((target) => this.write(target)));
  }

  dispose(): void {
    for (const timer of this.timers.values()) clearTimeout(timer);
    this.timers.clear();
    this.pending.clear();
  }

  private async write(id: string): Promise<void> {
    const timer = this.timers.get(id);
    if (timer) {
      clearTimeout(timer);
      this.timers.delete(id);
    }
    const doc = this.pending.get(id);
    if (!doc) return;
    this.pending.delete(id);

    this.hooks.onState?.(id, "saving");
    try {
      await this.backend.save(doc);
      this.hooks.onState?.(id, "idle");
      this.hooks.onSaved?.(id, doc.source);
    } catch (error) {
      this.hooks.onState?.(id, "error");
      this.hooks.onError?.(id, error);
    }
  }
}
