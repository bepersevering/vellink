/**
 * Workspace — 多文档权威状态。
 *
 * 每个文档持有自己的 DocumentStore（独立撤销栈），工作区订阅 store 通知，
 * 把「编辑器 / 插件写入 / 撤销」统一折算成 source + dirty + title。
 * 标题不单独存储：永远由首个一级标题派生，避免标题与正文两处真源。
 *
 * 这里不做持久化，也不碰 React：落盘与自动保存在 workspace-storage，
 * 订阅在 UI 层，核心因此可以在 node 环境里直接单测。
 */

import { createRegistry } from "./command/registry";
import { docTitle } from "./outline";
import { parseMarkdown } from "./parser/markdown";
import { DocumentStore } from "./store";

export interface WorkspaceDoc {
  id: string;
  /** 由 src 派生的显示标题，不单独编辑。 */
  title: string;
  source: string;
  /** 最后一次落盘的源码；与 source 不同即 dirty。 */
  savedSource: string;
  createdAt: number;
  updatedAt: number;
}

/** 给 UI 的只读摘要，不含正文。 */
export interface DocSummary {
  id: string;
  title: string;
  dirty: boolean;
  updatedAt: number;
}

/** 磁盘上读到的一篇文档快照，用于校正工作区。 */
export interface ExternalFile {
  id: string;
  source: string;
  updatedAt: number;
}

export interface WorkspaceOptions {
  now?: () => number;
  /** 新文档的 id 生成器；文件后端用它把 id 绑成文件路径。 */
  idFactory?: (title: string) => string;
  /** 没有标题且内容为空时的兜底名。 */
  fallbackTitle?: string;
}

/** 新建文档的初始正文：一级标题 + 空行，方便直接开写。 */
export function newDocumentSource(title: string): string {
  return `# ${title}\n\n`;
}

let counter = 0;

function defaultId(): string {
  counter += 1;
  return `doc-${Date.now().toString(36)}-${counter.toString(36)}`;
}

export class Workspace {
  private readonly docs: WorkspaceDoc[];
  private active: string | null;
  private readonly stores = new Map<string, DocumentStore>();
  private readonly unsubscribes = new Map<string, () => void>();
  private readonly listeners = new Set<() => void>();
  private readonly now: () => number;
  private readonly idFactory: (title: string) => string;
  private readonly fallbackTitle: string;

  constructor(initial: WorkspaceDoc[] = [], options: WorkspaceOptions = {}) {
    this.docs = initial.map((doc) => ({ ...doc }));
    this.active = this.docs[0]?.id ?? null;
    this.now = options.now ?? (() => Date.now());
    this.idFactory = options.idFactory ?? defaultId;
    this.fallbackTitle = options.fallbackTitle ?? "Untitled";
  }

  /* ------------------------------ 读取 ------------------------------ */

  summaries(): DocSummary[] {
    return this.docs.map((doc) => ({
      id: doc.id,
      title: doc.title,
      dirty: doc.source !== doc.savedSource,
      updatedAt: doc.updatedAt,
    }));
  }

  get(id: string): WorkspaceDoc | undefined {
    return this.docs.find((doc) => doc.id === id);
  }

  get activeId(): string | null {
    return this.active;
  }

  activeDoc(): WorkspaceDoc | null {
    return this.active ? (this.get(this.active) ?? null) : null;
  }

  /* ------------------------------ 变更 ------------------------------ */

  setActive(id: string): boolean {
    if (!this.get(id) || this.active === id) return false;
    this.active = id;
    this.notify();
    return true;
  }

  /**
   * 新建文档。
   *
   * `id` 由调用方给时以它为准（文件后端把 id 绑成 .md 路径），否则走 idFactory。
   */
  create(title?: string, id?: string): WorkspaceDoc {
    const name = this.uniqueTitle(title ?? this.fallbackTitle);
    const timestamp = this.now();
    const doc: WorkspaceDoc = {
      id: id ?? this.idFactory(name),
      title: name,
      source: newDocumentSource(name),
      savedSource: "",
      createdAt: timestamp,
      updatedAt: timestamp,
    };
    this.docs.unshift(doc);
    this.active = doc.id;
    this.notify();
    return doc;
  }

  /** 删除文档：始终保留至少一篇，删掉当前文档时自动切到第一篇。 */
  remove(id: string): boolean {
    if (this.docs.length <= 1) return false;
    const index = this.docs.findIndex((doc) => doc.id === id);
    if (index === -1) return false;

    this.disposeStore(id);
    this.docs.splice(index, 1);
    if (this.active === id) {
      this.active = this.docs[Math.min(index, this.docs.length - 1)].id;
    }
    this.notify();
    return true;
  }

  /** 落盘成功后调用：把当前源码标记为已保存。 */
  markSaved(id: string, source?: string): void {
    const doc = this.get(id);
    if (!doc) return;
    const saved = source ?? doc.source;
    if (doc.savedSource === saved) return;
    doc.savedSource = saved;
    this.notify();
  }

  /**
   * 用磁盘快照校正工作区（外部编辑、git pull、同步盘写入都会走到这里）。
   *
   * - 磁盘有、内存没有：新增文档
   * - 磁盘内容变了、内存没有未保存改动：覆盖并清空该文档的撤销栈
   * - 内存有、磁盘已不存在且没有未保存改动：移除
   *
   * 脏文档一律以内存为准：宁可和磁盘暂时不一致，也不能吞掉正在写的内容。
   * `presentIds` 传磁盘上当前全部文档 id，避免「只传变化项」时误判删除。
   */
  syncExternal(
    files: ExternalFile[],
    presentIds: string[],
  ): { added: string[]; updated: string[]; removed: string[] } {
    const added: string[] = [];
    const updated: string[] = [];
    const removed: string[] = [];

    for (const file of files) {
      const existing = this.get(file.id);
      if (!existing) {
        this.docs.unshift({
          id: file.id,
          title: docTitle(file.source, this.fallbackTitle),
          source: file.source,
          savedSource: file.source,
          createdAt: file.updatedAt,
          updatedAt: file.updatedAt,
        });
        added.push(file.id);
        continue;
      }
      if (existing.source !== existing.savedSource) continue;
      if (existing.source === file.source) {
        if (file.updatedAt > existing.updatedAt) existing.updatedAt = file.updatedAt;
        continue;
      }
      existing.source = file.source;
      existing.savedSource = file.source;
      existing.title = docTitle(file.source, this.fallbackTitle);
      existing.updatedAt = file.updatedAt;
      // 已创建的 store 手里还是旧树，重置后编辑器才会回灌新内容
      this.stores.get(file.id)?.reset(parseMarkdown({ source: file.source }).ir);
      updated.push(file.id);
    }

    const present = new Set(presentIds);
    for (const doc of [...this.docs]) {
      if (present.has(doc.id)) continue;
      if (doc.source !== doc.savedSource) continue;
      if (this.remove(doc.id)) removed.push(doc.id);
    }

    if (added.length > 0 || updated.length > 0 || removed.length > 0) this.notify();
    return { added, updated, removed };
  }

  /* ------------------------------ 撤销权威 ------------------------------ */

  /**
   * 取（并懒创建）文档的 DocumentStore。
   *
   * 每个 store 用独立的 CommandRegistry：多文档同时存在时，全局注册表里
   * 只该有一份 doc.undo，否则第二个文档一创建就撞 "already registered"。
   */
  store(id: string): DocumentStore | null {
    const doc = this.get(id);
    if (!doc) return null;
    const existing = this.stores.get(id);
    if (existing) return existing;

    const store = new DocumentStore(
      parseMarkdown({ source: doc.source }).ir,
      createRegistry(),
    );
    this.stores.set(id, store);
    this.unsubscribes.set(
      id,
      store.subscribe(() => {
        const current = this.get(id);
        if (!current) return;
        const { source } = store.getDocument();
        if (source === current.source) return;
        current.source = source;
        current.title = docTitle(source, this.fallbackTitle);
        current.updatedAt = this.now();
        this.notify();
      }),
    );
    return store;
  }

  /* ------------------------------ 订阅 ------------------------------ */

  subscribe(listener: () => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  dispose(): void {
    for (const id of [...this.stores.keys()]) this.disposeStore(id);
    this.listeners.clear();
  }

  private disposeStore(id: string): void {
    this.unsubscribes.get(id)?.();
    this.unsubscribes.delete(id);
    this.stores.get(id)?.dispose();
    this.stores.delete(id);
  }

  private uniqueTitle(base: string): string {
    const trimmed = base.trim() || this.fallbackTitle;
    const taken = new Set(this.docs.map((doc) => doc.title));
    if (!taken.has(trimmed)) return trimmed;
    let index = 2;
    while (taken.has(`${trimmed} ${index}`)) index += 1;
    return `${trimmed} ${index}`;
  }

  private notify(): void {
    for (const listener of this.listeners) listener();
  }
}
