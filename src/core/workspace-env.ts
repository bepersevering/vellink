/**
 * Decide where documents live at startup.
 *
 * Desktop: read/write a real local folder (default `~/Documents/Vellink`, switchable).
 * Browser: fall back to localStorage — same features, but data stays in the browser.
 *
 * The choice is persisted in localStorage and reused on next launch; switching folders writes
 * the new value then reloads, so the workspace, undo stack and plugins are all rebuilt for the
 * new folder and there's no half-switched state.
 */

import { desktopFs, isDesktop } from "./desktop/bridge";
import {
  createFileWorkspaceBackend,
  type FileWorkspaceBackend,
} from "./workspace-fs";
import {
  createLocalWorkspaceBackend,
  type WorkspaceBackend,
} from "./workspace-storage";

export interface WorkspaceEnv {
  kind: "files" | "browser";
  backend: WorkspaceBackend;
  /** File backend only; null in the browser. */
  files: FileWorkspaceBackend | null;
  root: string | null;
  /** First use of this folder: seed documents may be written. */
  fresh: boolean;
}

const ROOT_KEY = "vellink:workspace-root";

function safeGet(key: string): string | null {
  try {
    return globalThis.localStorage?.getItem(key) ?? null;
  } catch {
    return null;
  }
}

export function storedRoot(): string | null {
  const value = safeGet(ROOT_KEY);
  return value && value.trim().length > 0 ? value : null;
}

export function persistRoot(root: string): void {
  try {
    globalThis.localStorage?.setItem(ROOT_KEY, root);
  } catch {
    // Private mode may block writes: the current session still works, but the folder must be picked again next time
  }
}

export async function resolveWorkspaceEnv(): Promise<WorkspaceEnv> {
  if (!isDesktop()) {
    return {
      kind: "browser",
      backend: createLocalWorkspaceBackend(),
      files: null,
      root: null,
      // Empty localStorage in the browser means first use; seed two documents as well
      fresh: true,
    };
  }

  try {
    let root = storedRoot();
    let fresh = false;
    if (!root) {
      root = await desktopFs.defaultRoot();
      fresh = true;
      persistRoot(root);
    }
    await desktopFs.ensureDir(root);
    const files = createFileWorkspaceBackend(root, desktopFs);
    return { kind: "files", backend: files, files, root, fresh };
  } catch (error) {
    // An unusable folder (permissions, read-only disk) must not block startup: fall back to browser storage and keep the data
    console.warn("[vellink] local folder unavailable, falling back to browser storage", error);
    return {
      kind: "browser",
      backend: createLocalWorkspaceBackend(),
      files: null,
      root: null,
      fresh: false,
    };
  }
}
