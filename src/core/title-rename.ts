/**
 * Title rename → file rename.
 *
 * Filenames come from the first H1 by default, so changing the title should rename the file too;
 * otherwise the folder keeps names like `Untitled.md` that have nothing to do with the content.
 *
 * Three real-world issues that must be handled:
 * 1. **Titles change character by character**: typing `# Note` yields `N`, `No`, `Not`... in turn, so
 *    changes must be debounced and the disk touched only after typing stops.
 * 2. **Rename must flush to disk first**: if there are unsaved in-memory changes, write back to the old path
 *    first; otherwise the file may not exist on disk yet (new document) and `rename` fails outright.
 * 3. **The id is the path**: after renaming, Workspace must swap the id while preserving the undo stack, see
 *    `Workspace.rekey`.
 */

import type { Workspace, WorkspaceDoc } from "./workspace";
import type { FileWorkspaceBackend } from "./workspace-fs";

/** Only these three Autosave methods are used; tests can pass a minimal stub. */
export interface RenameAutosave {
  schedule(doc: WorkspaceDoc): void;
  flush(id?: string): Promise<void>;
  cancel(id: string): void;
}

export interface TitleRenamerDeps {
  files: FileWorkspaceBackend;
  workspace: Workspace;
  autosave: RenameAutosave;
  /**
   * Called just before touching the disk (before the actual rename).
   *
   * Callers use it for two things: marking both paths as "ours", and invalidating any in-progress
   * external change scan — otherwise the scan would see "old path still there, new path missing" and
   * mistake the just-renamed document for one deleted externally.
   */
  beforeRename?: (from: string, to: string) => void;
  onError?: (error: unknown, from: string, to: string) => void;
}

interface PendingRename {
  id: string;
  uid: string;
  title: string;
}

export class TitleRenamer {
  private readonly baseline = new Map<string, string>();
  private pending: PendingRename | null = null;
  private timer: ReturnType<typeof setTimeout> | null = null;
  private running = false;

  constructor(
    private readonly deps: TitleRenamerDeps,
    private readonly delay = 900,
  ) {}

  /**
   * Observe the current document.
   *
   * - On first sight of a uid, only record the baseline: whatever the file is called on disk at startup
   *   stands; don't batch-rename the user's files just because a title differs from its filename.
   * - `local` means the title change came from the editor. If an external tool changed the H1, only update
   *   the baseline; don't rename the user's file ourselves — that filename may be in use by another tool.
   */
  observe(id: string, uid: string, title: string, local = true): void {
    const base = this.baseline.get(uid);
    if (base === undefined) {
      this.baseline.set(uid, title);
      return;
    }

    if (base === title) {
      // Title changed back to the original: discard the queued rename
      this.dropPending(uid);
      return;
    }

    // Already queued for this title: keep the plan (dirty becoming false after a flush shouldn't cancel it)
    if (this.pending && this.pending.uid === uid && this.pending.title === title) return;

    if (!local) {
      this.baseline.set(uid, title);
      this.dropPending(uid);
      return;
    }

    this.pending = { id, uid, title };
    this.clearTimer();
    this.timer = setTimeout(() => void this.fire(), this.delay);
  }

  /** Discard the pending rename (document deleted, changing directory, etc.). */
  cancel(id?: string): void {
    if (id && this.pending && this.pending.id !== id) return;
    this.clearTimer();
    this.pending = null;
  }

  /** Execute the pending rename immediately (call before save / directory change so it isn't lost in the debounce window). */
  async flush(): Promise<void> {
    this.clearTimer();
    await this.fire();
  }

  dispose(): void {
    this.clearTimer();
    this.pending = null;
    this.baseline.clear();
  }

  private clearTimer(): void {
    if (this.timer) clearTimeout(this.timer);
    this.timer = null;
  }

  /** Clear the queued rename; when a uid is passed, clear only that document's. */
  private dropPending(uid?: string): void {
    if (uid && this.pending && this.pending.uid !== uid) return;
    this.clearTimer();
    this.pending = null;
  }

  private async fire(): Promise<void> {
    const job = this.pending;
    this.pending = null;
    if (!job) return;
    // A previous rename is in progress: put the job back and retry after it finishes, don't rename the same doc concurrently
    if (this.running) {
      this.pending = job;
      return;
    }

    const doc = this.deps.workspace.get(job.id);
    if (!doc) return;

    this.running = true;
    try {
      const target = await this.deps.files.pathForTitle(job.title, job.id);
      if (target === job.id) {
        // The filename is already this title (e.g. identical after case or punctuation normalization)
        this.baseline.set(job.uid, job.title);
        return;
      }
      // Flush to disk before renaming: a new document hasn't been written yet, so there's no source file on disk to move.
      // Must call schedule explicitly — flush alone is a no-op if nothing is pending right now.
      if (doc.source !== doc.savedSource) {
        this.deps.autosave.schedule(doc);
        await this.deps.autosave.flush(job.id);
      }

      this.deps.beforeRename?.(job.id, target);
      await this.deps.files.rename(job.id, target);
      this.deps.workspace.rekey(job.id, target);

      const moved = this.deps.workspace.get(target);
      if (moved && moved.source !== moved.savedSource) this.deps.autosave.schedule(moved);
      this.baseline.set(job.uid, job.title);
    } catch (error) {
      // Record as baseline: otherwise every keystroke retries the same failure and floods the screen with toasts
      this.baseline.set(job.uid, job.title);
      this.deps.onError?.(error, job.id, job.title);
    } finally {
      this.running = false;
      if (this.pending) {
        this.clearTimer();
        this.timer = setTimeout(() => void this.fire(), 0);
      }
    }
  }
}
