/**
 * Filesystem workspace backend: one document = one real .md file.
 *
 * The only difference from the localStorage backend is the id: here it is the file's absolute
 * path, so "open folder → edit → ⌘S" lands on the same file on disk, visible to git, other
 * editors and sync drives at the same time.
 *
 * Scope:
 * - This module only handles read, write and delete (delete moves to `.vellink-trash/`, it
 *   doesn't really remove the file);
 * - Whether a disk change should overwrite memory is decided by Workspace.syncExternal; this
 *   module only provides metadata listing and path-based reads so the frontend can diff
 *   incrementally.
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

/** A document on disk; `id` equals `path`. */
export interface ExternalFile {
  id: string;
  source: string;
  updatedAt: number;
}

/** Minimal native file I/O surface; tests inject an in-memory implementation, production injects Tauri commands. */
export interface FileBackendDeps {
  list(root: string): Promise<FileEntry[]>;
  read(path: string): Promise<string>;
  write(path: string, contents: string): Promise<FileEntry>;
  /** Move to the trash directory and return the new path. */
  trash(path: string, trashDir: string): Promise<string>;
  /** Rename within the same directory (atomic move); should error if the target already exists. */
  rename(from: string, to: string): Promise<FileEntry>;
}

export interface FileWorkspaceBackend extends WorkspaceBackend {
  readonly kind: "files";
  readonly root: string;
  readonly trashDir: string;
  /** Build a path synchronously (for seed documents; no deduplication). */
  pathFor(title: string): string;
  /** Build a unique path asynchronously (for new documents; avoids existing files in the directory). */
  newPath(title: string): Promise<string>;
  /**
   * Compute a rename target from a title; `keep` is the document's current path (it may resolve
   * back to itself, meaning no rename is needed). Returning `keep` means "the filename already
   * matches this title".
   */
  pathForTitle(title: string, keep?: string): Promise<string>;
  /** Rename a file to `to` (same directory). */
  rename(from: string, to: string): Promise<void>;
  /** List metadata only, for external-change detection. */
  listMeta(): Promise<FileEntry[]>;
  read(id: string): Promise<string>;
}

const FORBIDDEN = /[\\/:*?"<>|]/g;
const CONTROL = /[\u0000-\u001f]/g;
const MAX_SLUG = 60;

/** Title → filename. Preserves CJK characters; only replaces characters filesystems truly reject. */
export function slugifyTitle(title: string, fallback = "untitled"): string {
  const cleaned = title
    .replace(FORBIDDEN, " ")
    .replace(CONTROL, " ")
    .replace(/\s+/g, "-")
    // Leading/trailing . and - can be read as hidden files or CLI flags by the system/user; strip them
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

/** Get the parent directory (`/docs/notes/a.md` → `/docs/notes`). */
export function parentOf(path: string): string {
  const index = path.lastIndexOf("/");
  return index > 0 ? path.slice(0, index) : "/";
}

/** Get the filename (`/docs/a.md` → `a.md`). */
export function fileNameOf(path: string): string {
  const index = path.lastIndexOf("/");
  return index >= 0 ? path.slice(index + 1) : path;
}

export function createFileWorkspaceBackend(
  root: string,
  deps: FileBackendDeps,
): FileWorkspaceBackend {
  const trashDir = joinPath(root, ".vellink-trash");
  const fallbackName = root.split("/").filter(Boolean).pop() ?? "Untitled";
  /** Paths already issued but not yet written: pressing ⌘N twice won't produce the same filename. */
  const reserved = new Set<string>();

  const toDoc = (entry: FileEntry, source: string): WorkspaceDoc => ({
    id: entry.path,
    title: docTitle(source, fallbackName),
    source,
    // Content read from disk is the saved version
    savedSource: source,
    createdAt: entry.modified,
    updatedAt: entry.modified,
  });

  const rootKey = () => root.replace(/[\\/]+$/, "");

  /**
   * Pick a non-conflicting `.md` filename in `dir`.
   *
   * `keep` is the document's current path: it obviously "exists" on disk but doesn't count as a
   * reservation, so when the title is unchanged the calculation returns it as-is (the caller uses
   * this to decide no rename is needed).
   */
  const uniquePathIn = async (
    dir: string,
    title: string,
    keep?: string,
  ): Promise<string> => {
    const entries = await deps.list(root);
    const taken = new Set(
      entries
        .filter((entry) => parentOf(entry.path) === dir)
        .map((entry) => entry.name.toLowerCase()),
    );
    const keepName = keep ? fileNameOf(keep).toLowerCase() : null;
    const base = slugifyTitle(title);
    // Append a number on name collisions, matching Finder / Explorer behavior
    for (let index = 1; index <= 999; index += 1) {
      const name = index === 1 ? `${base}.md` : `${base}-${index}.md`;
      const candidate = joinPath(dir, name);
      // A case-only difference isn't a rename: macOS / Windows filesystems are case-insensitive anyway,
      // and renaming back and forth would just generate a pile of meaningless disk events
      if (candidate.toLowerCase() === keep?.toLowerCase()) return keep!;
      const lower = name.toLowerCase();
      if (taken.has(lower) && lower !== keepName) continue;
      if (reserved.has(candidate)) continue;
      reserved.add(candidate);
      return candidate;
    }
    const fallback = joinPath(dir, `${base}-${Date.now().toString(36)}.md`);
    reserved.add(fallback);
    return fallback;
  };

  return {
    kind: "files",
    root,
    trashDir,

    pathFor(title) {
      return joinPath(root, `${slugifyTitle(title)}.md`);
    },

    newPath(title) {
      return uniquePathIn(rootKey(), title);
    },

    async pathForTitle(title, keep) {
      const dir = keep ? parentOf(keep) : rootKey();
      const target = await uniquePathIn(dir, title, keep);
      // Reserve the chosen path before it hits disk, so two docs in the same second can't claim one name
      if (target !== keep) reserved.add(target);
      return target;
    },

    async rename(from, to) {
      try {
        await deps.rename(from, to);
      } finally {
        reserved.delete(to);
        reserved.delete(from);
      }
    },

    async load() {
      const entries = await deps.list(root);
      const docs = await Promise.all(
        entries.map(async (entry) => {
          try {
            return toDoc(entry, await deps.read(entry.path));
          } catch {
            // A single failed read (permissions, being written) shouldn't bring down the whole workspace
            return null;
          }
        }),
      );
      return docs.filter((doc): doc is WorkspaceDoc => doc !== null);
    },

    async save(doc) {
      await deps.write(doc.id, doc.source);
      // After the write, the path appears in directory listings and the reservation can be released
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
