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
import { findMatches } from "./find";
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
  /**
   * 与 `id` 相对的稳定标识：文件后端改标题会重命名文件，`id`（路径）随之变化，
   * 但 `uid` 不变。React 用它做 key，改名时编辑器不会被重建、光标和焦点不丢。
   */
  uid: string;
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

/** 全库搜索的一条结果。 */
export interface NoteMatch {
  id: string;
  title: string;
  /** 命中在源码里的偏移；标题命中时是标题文字的位置。 */
  offset: number;
  /** 命中长度，跳转时用来选中这段文字。 */
  length: number;
  /** 命中词前后的片段（换行已压平）。 */
  snippet: string;
  /** 这次命中来自标题而不是正文。 */
  inTitle: boolean;
}

export interface SearchOptions {
  /** 最多返回多少条。 */
  limit?: number;
  /** 同一篇文档最多取几条，避免一篇长文占满列表。 */
  perDoc?: number;
}

/** 截一段命中上下文：换行压成空格，两端按需加省略号。 */
function snippetAround(source: string, from: number, to: number, radius = 26): string {
  const start = Math.max(0, from - radius);
  const end = Math.min(source.length, to + radius);
  const body = source
    .slice(start, end)
    .replace(/\s+/g, " ")
    // 片段多半从某个标题刚结束的位置开始，开头的 ### 只是噪音
    .replace(/^…?#{1,6}\s*/, "")
    .trim();
  return `${start > 0 ? "…" : ""}${body}${end < source.length ? "…" : ""}`;
}

/**
 * 文档开头的一句正文（跳过标题行）。
 *
 * 标题命中时列表里再显示一遍标题等于浪费一行，给一句正文更有信息量。
 */
function leadSentence(source: string, max = 64): string {
  const body = source
    .split("\n")
    .filter((line) => !/^\s*#{1,6}\s/.test(line))
    .join(" ")
    .replace(/\s+/g, " ")
    .trim();
  return body.length > max ? `${body.slice(0, max)}…` : body;
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
  /** 文档 → 稳定 uid；改 id（重命名文件）时一起搬过去。 */
  private readonly uids = new Map<string, number>();
  private uidSeq = 0;
  private readonly listeners = new Set<() => void>();
  private readonly now: () => number;
  private readonly idFactory: (title: string) => string;
  private readonly fallbackTitle: string;

  constructor(initial: WorkspaceDoc[] = [], options: WorkspaceOptions = {}) {
    this.docs = initial.map((doc) => ({ ...doc }));
    for (const doc of this.docs) this.uids.set(doc.id, ++this.uidSeq);
    this.active = this.docs[0]?.id ?? null;
    this.now = options.now ?? (() => Date.now());
    this.idFactory = options.idFactory ?? defaultId;
    this.fallbackTitle = options.fallbackTitle ?? "Untitled";
  }

  /* ------------------------------ 读取 ------------------------------ */

  summaries(): DocSummary[] {
    return this.docs.map((doc) => ({
      id: doc.id,
      uid: `uid-${this.uids.get(doc.id) ?? 0}`,
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

  /**
   * 全库搜索：标题 + 正文。
   *
   * 只搜源码（唯一真源），不分词：中文按子串、英文不区分大小写，与编辑器内的
   * 查找共用同一套规则。返回的 `offset` 就是源码偏移，可直接交给编辑器定位。
   * 标题命中排在正文命中之前——那通常是「用户要找的就是这篇」。
   */
  search(query: string, options: SearchOptions = {}): NoteMatch[] {
    const q = query.trim();
    if (!q) return [];
    const limit = options.limit ?? 10;
    const perDoc = options.perDoc ?? 2;
    const needle = q.toLowerCase();

    const titleHits: NoteMatch[] = [];
    const bodyHits: NoteMatch[] = [];

    for (const doc of this.docs) {
      if (doc.title.toLowerCase().includes(needle)) {
        // 跳到标题本身，而不是文档第一个字符（那里通常只是 `# `）
        const at = doc.source.toLowerCase().indexOf(doc.title.toLowerCase());
        titleHits.push({
          id: doc.id,
          title: doc.title,
          offset: Math.max(0, at),
          length: at >= 0 ? doc.title.length : 0,
          snippet: leadSentence(doc.source),
          inTitle: true,
        });
      }
      const { matches } = findMatches(doc.source, q, { limit: perDoc });
      for (const match of matches) {
        bodyHits.push({
          id: doc.id,
          title: doc.title,
          offset: match.from,
          length: match.to - match.from,
          snippet: snippetAround(doc.source, match.from, match.to),
          inTitle: false,
        });
      }
    }

    return [...titleHits, ...bodyHits].slice(0, limit);
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
    this.uids.set(doc.id, ++this.uidSeq);
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
    this.uids.delete(id);
    this.docs.splice(index, 1);
    if (this.active === id) {
      this.active = this.docs[Math.min(index, this.docs.length - 1)].id;
    }
    this.notify();
    return true;
  }

  /**
   * 换一个 id（文件后端 = 磁盘文件重命名）。
   *
   * id 是路径，改标题就变了；但撤销栈、uid、激活状态都得跟着走，否则改名
   * 等于把这篇文档的编辑上下文整体丢掉。目标 id 已被占用时返回 false。
   */
  rekey(oldId: string, nextId: string): boolean {
    if (oldId === nextId) return false;
    const doc = this.get(oldId);
    if (!doc || this.get(nextId)) return false;

    doc.id = nextId;

    const uid = this.uids.get(oldId);
    this.uids.delete(oldId);
    if (uid !== undefined) this.uids.set(nextId, uid);

    const store = this.stores.get(oldId);
    if (store) {
      this.stores.delete(oldId);
      this.stores.set(nextId, store);
    }
    const unsubscribe = this.unsubscribes.get(oldId);
    if (unsubscribe) {
      this.unsubscribes.delete(oldId);
      this.unsubscribes.set(nextId, unsubscribe);
    }
    if (this.active === oldId) this.active = nextId;

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
        this.uids.set(file.id, ++this.uidSeq);
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
    // 捕获文档对象而不是 id：重命名后 id 会变，靠 id 再查就查不到了
    this.unsubscribes.set(
      id,
      store.subscribe(() => {
        const { source } = store.getDocument();
        if (source === doc.source) return;
        doc.source = source;
        doc.title = docTitle(source, this.fallbackTitle);
        doc.updatedAt = this.now();
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
