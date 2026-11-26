/** 本地 VFS：离线缓存与单测用的内存实现，接口与 WebDAV Provider 完全一致。 */

import {
  VfsError,
  dirname,
  joinPath,
  normalizePath,
  type VfsFile,
  type VfsListResult,
  type VfsPath,
  type VfsProvider,
  type VfsStat,
  type WriteOptions,
} from "./types";

export class LocalVfs implements VfsProvider {
  readonly id = "local";
  private readonly files = new Map<VfsPath, { content: string; etag: string }>();
  private readonly directories = new Set<VfsPath>(["/"]);
  private version = 0;
  private readonly listeners = new Map<VfsPath, Set<(stat: VfsStat) => void>>();

  async stat(path: VfsPath): Promise<VfsStat> {
    const clean = normalizePath(path);
    const file = this.files.get(clean);
    if (file) return { path: clean, isDirectory: false, etag: file.etag, size: file.content.length };
    if (this.directories.has(clean)) return { path: clean, isDirectory: true };
    throw new VfsError(clean, "路径不存在");
  }

  async read(path: VfsPath): Promise<VfsFile> {
    const clean = normalizePath(path);
    const file = this.files.get(clean);
    if (!file) throw new VfsError(clean, "文件不存在");
    return {
      path: clean,
      isDirectory: false,
      etag: file.etag,
      size: file.content.length,
      content: file.content,
    };
  }

  async write(path: VfsPath, content: string, options: WriteOptions = {}): Promise<VfsStat> {
    const clean = normalizePath(path);
    await this.mkdir(dirname(clean));
    const previous = this.files.get(clean);
    if (options.etag && previous?.etag !== options.etag)
      throw new VfsError(clean, "ETag 不匹配，文件已被修改");
    const etag = `local-${++this.version}`;
    this.files.set(clean, { content, etag });
    this.emit(clean);
    return { path: clean, isDirectory: false, etag, size: content.length };
  }

  async list(path: VfsPath): Promise<VfsListResult> {
    const clean = normalizePath(path);
    if (!this.directories.has(clean)) throw new VfsError(clean, "目录不存在");
    const prefix = clean === "/" ? "/" : `${clean}/`;
    const entries: VfsStat[] = [];
    for (const dir of this.directories) {
      if (dir !== clean && dir.startsWith(prefix) && dir.slice(prefix.length).indexOf("/") === -1)
        entries.push({ path: dir, isDirectory: true });
    }
    for (const [filePath, file] of this.files) {
      if (filePath.startsWith(prefix) && filePath.slice(prefix.length).indexOf("/") === -1)
        entries.push({ path: filePath, isDirectory: false, etag: file.etag, size: file.content.length });
    }
    return { entries };
  }

  async delete(path: VfsPath): Promise<void> {
    const clean = normalizePath(path);
    if (!this.files.delete(clean) && !this.directories.delete(clean))
      throw new VfsError(clean, "路径不存在");
    this.emit(clean);
  }

  async mkdir(path: VfsPath): Promise<void> {
    this.directories.add(normalizePath(path));
  }

  watch(path: VfsPath, onChange: (stat: VfsStat) => void): () => void {
    const clean = normalizePath(path);
    let set = this.listeners.get(clean);
    if (!set) {
      set = new Set();
      this.listeners.set(clean, set);
    }
    set.add(onChange);
    return () => set!.delete(onChange);
  }

  private emit(path: VfsPath): void {
    const notify = (target: VfsPath) => {
      for (const handler of this.listeners.get(target) ?? []) {
        void this.stat(path).then(handler, () => undefined);
      }
    };
    notify(path);
    let parent = dirname(path);
    while (true) {
      notify(parent);
      if (parent === "/") break;
      const next = dirname(parent);
      if (next === parent) break;
      parent = next;
    }
  }

  /** 仅测试用：清空所有数据。 */
  reset(): void {
    this.files.clear();
    this.directories.clear();
    this.directories.add("/");
    this.listeners.clear();
    this.version = 0;
  }
}

export function childOf(parent: VfsPath, name: string): VfsPath {
  return joinPath(parent, name);
}
