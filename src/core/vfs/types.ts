/**
 * VFS — 文档存储的统一抽象。
 *
 * 约束：
 * 1. 所有路径是「以 / 开头的 POSIX 风格相对路径」，不允许 ..、协议、查询串。
 * 2. Provider 不碰凭据明文：认证信息由 CredentialStore 按 service/account 提供。
 * 3. watch 用轮询/长连接都可以，必须返回 dispose 供插件收尾。
 */

export type VfsPath = `/${string}`;

export interface VfsStat {
  path: VfsPath;
  isDirectory: boolean;
  /** WebDAV ETag / 本地版本号；用于条件写入与增量同步 */
  etag?: string;
  size?: number;
  modifiedAt?: number;
}

export interface VfsFile extends VfsStat {
  content: string;
}

export interface VfsListResult {
  entries: VfsStat[];
  /** 目录本身的 etag，用于检测新增/删除 */
  etag?: string;
}

export interface WriteOptions {
  /** 提供时带 If-Match，服务端 ETag 不一致则拒绝（防止覆盖他人改动） */
  etag?: string;
}

export interface VfsProvider {
  readonly id: string;
  stat(path: VfsPath): Promise<VfsStat>;
  read(path: VfsPath): Promise<VfsFile>;
  write(path: VfsPath, content: string, options?: WriteOptions): Promise<VfsStat>;
  list(path: VfsPath): Promise<VfsListResult>;
  delete(path: VfsPath): Promise<void>;
  mkdir(path: VfsPath): Promise<void>;
  watch(path: VfsPath, onChange: (stat: VfsStat) => void, intervalMs?: number): () => void;
}

export class VfsError extends Error {
  constructor(
    public readonly path: string,
    message: string,
    public readonly status?: number,
  ) {
    super(`${path}: ${message}`);
    this.name = "VfsError";
  }
}

/** 统一路径：补前导 /、折叠重复斜杠、拒绝路径穿越与远程 URL。 */
export function normalizePath(input: string): VfsPath {
  if (/^[a-zA-Z][a-zA-Z0-9+.-]*:/.test(input) || input.includes("?") || input.includes("#"))
    throw new VfsError(input, "路径不能包含协议、查询串或片段");
  const segments = input.split("/").filter((s) => s.length > 0 && s !== ".");
  if (segments.includes("..")) throw new VfsError(input, "路径不允许 ..");
  return `/${segments.join("/")}` as VfsPath;
}

/** 拼接父目录与文件名（文件名内 / 会被拒绝）。 */
export function joinPath(parent: VfsPath, name: string): VfsPath {
  if (!name || name.includes("/")) throw new VfsError(name, "文件名不能为空或包含 /");
  return normalizePath(`${parent}/${name}`);
}

export function dirname(path: VfsPath): VfsPath {
  const segments = path.split("/").filter(Boolean);
  segments.pop();
  return `/${segments.join("/")}` as VfsPath;
}

export function basename(path: VfsPath): string {
  return path.split("/").filter(Boolean).pop() ?? "";
}
