/**
 * VFS — a unified abstraction over document storage.
 *
 * Constraints:
 * 1. All paths are POSIX-style relative paths starting with `/`; no `..`, protocols, or query strings.
 * 2. Providers never touch plaintext credentials: auth info comes from CredentialStore by service/account.
 * 3. watch may use polling or long connections, but must return a dispose function for plugins to clean up.
 */

export type VfsPath = `/${string}`;

export interface VfsStat {
  path: VfsPath;
  isDirectory: boolean;
  /** WebDAV ETag / local version number; used for conditional writes and incremental sync */
  etag?: string;
  size?: number;
  modifiedAt?: number;
}

export interface VfsFile extends VfsStat {
  content: string;
}

export interface VfsListResult {
  entries: VfsStat[];
  /** ETag of the directory itself, used to detect additions/deletions */
  etag?: string;
}

export interface WriteOptions {
  /** When provided, send If-Match; reject if the server ETag differs (prevents overwriting others' changes) */
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

/** Normalize a path: add a leading /, collapse duplicate slashes, reject traversal and remote URLs. */
export function normalizePath(input: string): VfsPath {
  if (/^[a-zA-Z][a-zA-Z0-9+.-]*:/.test(input) || input.includes("?") || input.includes("#"))
    throw new VfsError(input, "path must not contain a protocol, query string, or fragment");
  const segments = input.split("/").filter((s) => s.length > 0 && s !== ".");
  if (segments.includes("..")) throw new VfsError(input, "path must not contain ..");
  return `/${segments.join("/")}` as VfsPath;
}

/** Join a parent directory and a filename (/ inside the name is rejected). */
export function joinPath(parent: VfsPath, name: string): VfsPath {
  if (!name || name.includes("/")) throw new VfsError(name, "filename must not be empty or contain /");
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
