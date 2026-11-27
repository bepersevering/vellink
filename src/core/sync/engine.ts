/**
 * Sync engine — local-first with ETag conditional writes.
 *
 * Strategy (deliberately simple and explainable, not a CRDT):
 * - Local write: immediately persist to the local VFS and enqueue in the outbox, using the
 *   remote ETag observed at read time as the base.
 * - Online sync: base equals the remote ETag → upload; remote missing → create;
 *   ETag differs but remote content equals local → treat as already synced; otherwise write a
 *   `.conflict-<timestamp>.md` copy, keep the local version, leave the remote untouched — never
 *   overwrite silently.
 * - Tracked file with no outbox entry: remote ETag changed → pull it down.
 *
 * CRDTs and vector indexes such as Yjs / sqlite-vec are interface placeholders in M4; this
 * engine can be replaced later without changing the plugin API.
 */

import {
  VfsError,
  dirname,
  normalizePath,
  type VfsPath,
  type VfsProvider,
} from "../vfs/types";

export interface SyncEntry {
  path: VfsPath;
  /** Remote ETag seen at the last successful sync */
  baseEtag?: string;
  /** Content hash from the last successful sync (to detect whether a remote change is just an echo) */
  baseHash: string;
}

export type SyncAction =
  | { type: "upload"; path: VfsPath }
  | { type: "download"; path: VfsPath }
  | { type: "noop"; path: VfsPath; reason: string }
  | { type: "conflict"; path: VfsPath; conflictPath: VfsPath };

export interface SyncReport {
  actions: SyncAction[];
  pending: number;
}

/** 32-bit FNV-1a for content fingerprints; cryptographic strength is not required. */
export function hashContent(content: string): string {
  let hash = 0x811c9dc5;
  for (let i = 0; i < content.length; i++) {
    hash ^= content.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193);
  }
  return (hash >>> 0).toString(16).padStart(8, "0");
}

interface OutboxItem {
  content: string;
  baseEtag?: string;
}

export class SyncEngine {
  private readonly outbox = new Map<VfsPath, OutboxItem>();
  private readonly tracked = new Map<VfsPath, SyncEntry>();

  constructor(
    private readonly local: VfsProvider,
    private readonly remote: VfsProvider,
  ) {}

  /** Offline edit entry point: write locally now, push to the remote once back online. */
  async queue(path: VfsPath, content: string): Promise<void> {
    const clean = normalizePath(path);
    const before = this.tracked.get(clean);
    // The local VFS is single-writer; the remote ETag is only for PUT If-Match, not a local conditional-write credential.
    await this.local.write(clean, content);
    this.outbox.set(clean, { content, ...(before?.baseEtag ? { baseEtag: before.baseEtag } : {}) });
  }

  /** Remember the remote baseline; the caller invokes this per file after the first connection. */
  track(path: VfsPath, etag: string | undefined, content: string): void {
    this.tracked.set(normalizePath(path), {
      path: normalizePath(path),
      ...(etag ? { baseEtag: etag } : {}),
      baseHash: hashContent(content),
    });
  }

  isTracked(path: VfsPath): boolean {
    return this.tracked.has(normalizePath(path));
  }

  get pending(): number {
    return this.outbox.size;
  }

  async sync(): Promise<SyncReport> {
    const actions: SyncAction[] = [];

    for (const [path, item] of [...this.outbox]) {
      let remoteEtag: string | undefined;
      try {
        remoteEtag = (await this.remote.stat(path)).etag;
      } catch (error) {
        if (!(error instanceof VfsError) || error.status !== 404) {
          actions.push({ type: "noop", path, reason: "remote temporarily unreachable; keeping pending" });
          continue;
        }
      }

      if (remoteEtag === undefined) {
        await this.remote.write(path, item.content);
        const stat = await this.remote.stat(path);
        this.track(path, stat.etag, item.content);
        actions.push({ type: "upload", path });
        this.outbox.delete(path);
        continue;
      }

      if (item.baseEtag && remoteEtag !== item.baseEtag) {
        const remote = await this.remote.read(path);
        if (hashContent(remote.content) === hashContent(item.content)) {
          this.track(path, remoteEtag, item.content);
          this.outbox.delete(path);
          actions.push({ type: "noop", path, reason: "remote content matches local" });
          continue;
        }
        const conflictPath = this.conflictPath(path);
        await this.local.write(conflictPath, item.content);
        actions.push({ type: "conflict", path, conflictPath });
        this.track(path, remoteEtag, remote.content);
        await this.local.write(path, remote.content);
        this.outbox.delete(path);
        continue;
      }

      const stat = await this.remote.write(path, item.content, { etag: remoteEtag });
      this.track(path, stat.etag, item.content);
      actions.push({ type: "upload", path });
      this.outbox.delete(path);
    }

    for (const [path, entry] of this.tracked) {
      if (this.outbox.has(path)) continue;
      let remoteEtag: string | undefined;
      try {
        remoteEtag = (await this.remote.stat(path)).etag;
      } catch {
        continue;
      }
      if (!remoteEtag || remoteEtag === entry.baseEtag) continue;
      const remote = await this.remote.read(path);
      if (hashContent(remote.content) === entry.baseHash) {
        this.track(path, remoteEtag, remote.content);
        continue;
      }
      await this.local.write(path, remote.content);
      this.track(path, remoteEtag, remote.content);
      actions.push({ type: "download", path });
    }

    return { actions, pending: this.outbox.size };
  }

  private conflictPath(path: VfsPath): VfsPath {
    const parent = dirname(path);
    const name = path.split("/").filter(Boolean).pop() ?? "untitled.md";
    const dot = name.lastIndexOf(".");
    const base = dot > 0 ? name.slice(0, dot) : name;
    const ext = dot > 0 ? name.slice(dot) : ".md";
    return normalizePath(`${parent}/${base}.conflict-${Date.now()}${ext}`);
  }
}
