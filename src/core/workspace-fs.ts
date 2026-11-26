/**
 * 文件系统工作区后端：一篇文档 = 一个真实的 .md 文件。
 *
 * 与 localStorage 后端的差别只在 id：这里 id 就是文件的绝对路径，所以
 * 「打开文件夹 → 编辑 → ⌘S」落到的就是磁盘上同一个文件，可以被 git、
 * 其它编辑器、同步盘同时看到。
 *
 * 职责边界：
 * - 本模块只管读、写、删（删除是移动到 `.vellink-trash/`，不是真删）；
 * - 「磁盘变了要不要覆盖内存」由 Workspace.syncExternal 决定，本模块只提供
 *   元信息列举与按路径读取，方便前端做增量对比。
 */

import { docTitle } from "./outline";
import type { WorkspaceDoc } from "./workspace";
import type { WorkspaceBackend } from "./workspace-storage";

export interface FileEntry {
  path: string;
  name: string;
  size: number;
  modified: number;
}

/** 磁盘上的一篇文档；`id` 等于 `path`。 */
export interface ExternalFile {
  id: string;
  source: string;
  updatedAt: number;
}

/** 原生文件读写的最小集合；测试里注入内存实现，生产注入 Tauri 命令。 */
export interface FileBackendDeps {
  list(root: string): Promise<FileEntry[]>;
  read(path: string): Promise<string>;
  write(path: string, contents: string): Promise<FileEntry>;
  /** 移到回收目录，返回新路径。 */
  trash(path: string, trashDir: string): Promise<string>;
}

export interface FileWorkspaceBackend extends WorkspaceBackend {
  readonly kind: "files";
  readonly root: string;
  readonly trashDir: string;
  /** 同步拼一个路径（种子文档用；不去重）。 */
  pathFor(title: string): string;
  /** 异步拼一个唯一路径（新建文档用；避开目录里已有文件）。 */
  newPath(title: string): Promise<string>;
  /** 只列举元信息，供轮询对比。 */
  listMeta(): Promise<FileEntry[]>;
  read(id: string): Promise<string>;
}

const FORBIDDEN = /[\\/:*?"<>|]/g;
const CONTROL = /[\u0000-\u001f]/g;
const MAX_SLUG = 60;

/** 标题 → 文件名。保留中日韩文字，只替换文件系统真正不接受的字符。 */
export function slugifyTitle(title: string, fallback = "untitled"): string {
  const cleaned = title
    .replace(FORBIDDEN, " ")
    .replace(CONTROL, " ")
    .replace(/\s+/g, "-")
    // 首尾的 . 与 - 会被系统或用户当成隐藏文件 / 命令行参数，去掉
    .replace(/^[-.]+/, "")
    .replace(/[-.]+$/, "")
    .slice(0, MAX_SLUG)
    .replace(/[-.]+$/, "");
  return cleaned.length > 0 ? cleaned : fallback;
}

function joinPath(root: string, name: string): string {
  const base = root.replace(/[\\/]+$/, "");
  return `${base}/${name}`;
}

function parentOf(path: string): string {
  const index = path.lastIndexOf("/");
  return index > 0 ? path.slice(0, index) : "/";
}

export function createFileWorkspaceBackend(
  root: string,
  deps: FileBackendDeps,
): FileWorkspaceBackend {
  const trashDir = joinPath(root, ".vellink-trash");
  const fallbackName = root.split("/").filter(Boolean).pop() ?? "Untitled";
  /** 已经发出但还没落盘的路径：连按两次 ⌘N 不会拿到同一个文件名。 */
  const reserved = new Set<string>();

  const toDoc = (entry: FileEntry, source: string): WorkspaceDoc => ({
    id: entry.path,
    title: docTitle(source, fallbackName),
    source,
    // 从磁盘读到的内容就是已保存版本
    savedSource: source,
    createdAt: entry.modified,
    updatedAt: entry.modified,
  });

  return {
    kind: "files",
    root,
    trashDir,

    pathFor(title) {
      return joinPath(root, `${slugifyTitle(title)}.md`);
    },

    async newPath(title) {
      const rootKey = root.replace(/[\\/]+$/, "");
      const entries = await deps.list(root);
      const taken = new Set(
        entries
          .filter((entry) => parentOf(entry.path) === rootKey)
          .map((entry) => entry.name.toLowerCase()),
      );
      const base = slugifyTitle(title);
      // 同名就往后加序号，与 Finder / 资源管理器的行为一致
      for (let index = 1; index <= 999; index += 1) {
        const name = index === 1 ? `${base}.md` : `${base}-${index}.md`;
        const candidate = joinPath(rootKey, name);
        if (taken.has(name.toLowerCase()) || reserved.has(candidate)) continue;
        reserved.add(candidate);
        return candidate;
      }
      const fallback = joinPath(rootKey, `${base}-${Date.now().toString(36)}.md`);
      reserved.add(fallback);
      return fallback;
    },

    async load() {
      const entries = await deps.list(root);
      const docs = await Promise.all(
        entries.map(async (entry) => {
          try {
            return toDoc(entry, await deps.read(entry.path));
          } catch {
            // 单篇读失败（权限、正在被写）不应该让整个工作区起不来
            return null;
          }
        }),
      );
      return docs.filter((doc): doc is WorkspaceDoc => doc !== null);
    },

    async save(doc) {
      await deps.write(doc.id, doc.source);
      // 落盘之后磁盘列举里就有了，占用标记可以释放
      reserved.delete(doc.id);
    },

    async remove(id) {
      await deps.trash(id, trashDir);
      reserved.delete(id);
    },

    async listMeta() {
      return deps.list(root);
    },

    read(id) {
      return deps.read(id);
    },
  };
}
