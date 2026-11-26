/**
 * 同步引擎 — 本地优先 + ETag 条件写入。
 *
 * 策略（够用且可解释，非 CRDT）：
 * - 本地写：立即落本地 VFS，并进 outbox（带读取时的远端 ETag 作为 base）。
 * - 联网 sync：base 与远端 ETag 相同 → 上传；远端不存在 → 新建；
 *   ETag 不同且远端内容 == 本地内容 → 视为已同步；否则写 `.conflict-<timestamp>.md` 副本，
 *   本地版本保留，远端不动，绝不静默覆盖。
 * - 无 outbox 的已跟踪文件：远端 ETag 变化 → 拉回本地。
 *
 * Yjs / sqlite-vec 等 CRDT 与向量索引在 M4 以接口占位，后续可替换本引擎而不改插件 API。
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
  /** 上次成功同步时看到的远端 ETag */
  baseEtag?: string;
  /** 上次成功同步的内容哈希（用于判断远端改动是否只是回声） */
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

/** FNV-1a 32 位，用于内容指纹，不追求密码学强度。 */
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

  /** 断网编辑入口：本地立即写入，远端等联网后再推。 */
  async queue(path: VfsPath, content: string): Promise<void> {
    const clean = normalizePath(path);
    const before = this.tracked.get(clean);
    // 本地 VFS 是单写者，远端 ETag 只用于 PUT 的 If-Match，不能当本地条件写凭据。
    await this.local.write(clean, content);
    this.outbox.set(clean, { content, ...(before?.baseEtag ? { baseEtag: before.baseEtag } : {}) });
  }

  /** 记住远端基线；首次连接后由调用方对每个文件调用。 */
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
          actions.push({ type: "noop", path, reason: "远端暂不可达，保留待发" });
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
          actions.push({ type: "noop", path, reason: "远端内容与本地一致" });
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
