/**
 * 启动时决定「文档存哪儿」。
 *
 * 桌面端：读写一个真实的本地文件夹（默认 `~/Documents/Vellink`，可切换）。
 * 浏览器：退回 localStorage，功能一致，只是数据留在浏览器里。
 *
 * 选择结果记在 localStorage，下次启动直接沿用；切换目录 = 写新值后重载页面，
 * 这样工作区、撤销栈、插件都按新目录重新构建，不会出现半切换状态。
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
  /** 文件后端专有；浏览器下为 null。 */
  files: FileWorkspaceBackend | null;
  root: string | null;
  /** 首次使用该目录：可以写入种子文档。 */
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
    // 隐私模式下写不进去：本次会话仍然可用，只是下次要重新选目录
  }
}

export async function resolveWorkspaceEnv(): Promise<WorkspaceEnv> {
  if (!isDesktop()) {
    return {
      kind: "browser",
      backend: createLocalWorkspaceBackend(),
      files: null,
      root: null,
      // 浏览器里 localStorage 为空就是首次使用，同样给两篇种子
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
    // 目录不可用（权限、只读盘）时不能让应用起不来：退回浏览器存储并保留数据
    console.warn("[vellink] 本地目录不可用，退回浏览器存储", error);
    return {
      kind: "browser",
      backend: createLocalWorkspaceBackend(),
      files: null,
      root: null,
      fresh: false,
    };
  }
}
