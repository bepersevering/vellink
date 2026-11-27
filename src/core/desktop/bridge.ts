/**
 * 桌面端原生能力桥。
 *
 * 网页版 / CI 里没有 Tauri 运行时，所以：
 * 1. 每个调用先过 isDesktop() 守卫；
 * 2. `@tauri-apps/api` 一律动态 import，网页构建把它拆成独立 chunk，
 *    既不进主包，也不会在浏览器里因缺少 `__TAURI_INTERNALS__` 抛错。
 */

export interface FsEntry {
  path: string;
  name: string;
  size: number;
  modified: number;
}

/** 是否运行在 Tauri 壳里（桌面端）。 */
export function isDesktop(): boolean {
  return typeof window !== "undefined" && "__TAURI_INTERNALS__" in window;
}

async function call<T>(command: string, args?: Record<string, unknown>): Promise<T> {
  if (!isDesktop()) throw new Error("desktop runtime unavailable");
  const { invoke } = await import("@tauri-apps/api/core");
  return invoke<T>(command, args);
}

export const desktopFs = {
  defaultRoot: () => call<string>("fs_default_root"),
  ensureDir: (path: string) => call<void>("fs_ensure_dir", { path }),
  list: (root: string) => call<FsEntry[]>("fs_list_markdown", { root }),
  read: (path: string) => call<string>("fs_read_markdown", { path }),
  write: (path: string, contents: string) =>
    call<FsEntry>("fs_write_markdown", { path, contents }),
  trash: (path: string, trashDir: string) =>
    call<string>("fs_trash_markdown", { path, trash_dir: trashDir }),
  rename: (from: string, to: string) =>
    call<FsEntry>("fs_rename_markdown", { from, to }),
  reveal: (path: string) => call<void>("fs_reveal", { path }),
  /** 递归监听目录；事件通过 onFsChanged 推回来。 */
  watch: (root: string) => call<void>("fs_watch_start", { root }),
  unwatch: () => call<void>("fs_watch_stop"),
};

/**
 * 导出相关的原生能力。
 *
 * `writeText` 与工作区写入分开：工作区只认 `.md`（不允许编辑器把任意文件
 * 当笔记打开），导出则要写 `.html` 这类「给别人的文件」。
 */
export const desktopExport = {
  writeText: (path: string, contents: string) =>
    call<void>("export_write_text", { path, contents }),
  writeBytes: (path: string, data: Uint8Array) =>
    call<void>("export_write_bytes", { path, data: Array.from(data) }),
  /** 调起系统打印对话框（PDF 由用户在里面选「存储为 PDF」）。 */
  print: () => call<void>("export_print"),
};

/**
 * 图片资产：写入工作区的 `.vellink-assets/`，导出时再读回来内嵌。
 * `Uint8Array` 要走 IPC 必须展开成普通数组，JSON 不会序列化 typed array 的字节。
 */
export const desktopAssets = {
  write: (root: string, name: string, bytes: Uint8Array) =>
    call<string>("fs_write_asset", { root, name, data: Array.from(bytes) }),
  read: (root: string, name: string) =>
    call<number[]>("fs_read_asset", { root, name }),
  /** 导入 md 时读源文件旁边的图片（绝对路径 + 图片扩展名白名单）。 */
  readImage: (path: string) => call<number[]>("fs_read_image", { path }),
};

/** 监听器事件名，与 `src-tauri/src/fs.rs` 的 WATCH_EVENT 保持一致。 */
const FS_CHANGED = "vellink://fs-changed";

/**
 * 订阅目录变更事件。
 *
 * 返回退订函数；网页版（无 Tauri 运行时）返回空操作，调用方无需分支。
 */
export async function onFsChanged(
  handler: (paths: string[]) => void,
): Promise<() => void> {
  if (!isDesktop()) return () => undefined;
  const { listen } = await import("@tauri-apps/api/event");
  const unlisten = await listen<string[]>(FS_CHANGED, (event) => {
    handler(Array.isArray(event.payload) ? event.payload : []);
  });
  return () => {
    void unlisten();
  };
}

/** 系统文件夹选择器；网页版返回 null（UI 据此提示仅桌面端可用）。 */
export async function pickFolder(): Promise<string | null> {
  if (!isDesktop()) return null;
  const { open } = await import("@tauri-apps/plugin-dialog");
  const picked = await open({ directory: true, multiple: false });
  return typeof picked === "string" && picked.length > 0 ? picked : null;
}

export interface PickedFile {
  name: string;
  path?: string;
  text: string;
}

/**
 * 选一个或多个 Markdown 文件。
 *
 * 桌面端经系统对话框拿到绝对路径再用 fs_read_markdown 读（顺带做 BOM/CRLF
 * 归一）；网页端用隐藏 input 读 File.text()。两条路都返回同样的结构，
 * 调用方不用分辨环境。
 */
export async function pickMarkdownFiles(): Promise<PickedFile[]> {
  if (isDesktop()) {
    const { open } = await import("@tauri-apps/plugin-dialog");
    const picked = await open({
      multiple: true,
      filters: [{ name: "Markdown", extensions: ["md", "markdown"] }],
    });
    const paths = Array.isArray(picked) ? picked : picked ? [picked] : [];
    const out: PickedFile[] = [];
    for (const path of paths) {
      try {
        out.push({
          name: path,
          path,
          text: await desktopFs.read(path),
        });
      } catch {
        // 单个文件读失败不该拖垮整批；交给 planImports 记为 skipped
        out.push({ name: path, path, text: "" });
      }
    }
    return out;
  }
  return pickFilesInBrowser();
}

/** 浏览器端文件选择：动态建 input，选完即移除，不留 DOM 垃圾。 */
function pickFilesInBrowser(): Promise<PickedFile[]> {
  return new Promise((resolve) => {
    const input = document.createElement("input");
    input.type = "file";
    input.multiple = true;
    input.accept = ".md,.markdown,text/markdown";
    input.addEventListener("change", async () => {
      const files = Array.from(input.files ?? []);
      const out: PickedFile[] = [];
      for (const file of files) {
        try {
          out.push({ name: file.name, text: await file.text() });
        } catch {
          out.push({ name: file.name, text: "" });
        }
      }
      input.remove();
      resolve(out);
    });
    // 用户取消对话框时 change 不触发：监听 focus 兜底，稍后清理
    window.addEventListener(
      "focus",
      () => {
        window.setTimeout(() => {
          if (input.isConnected) {
            input.remove();
            resolve([]);
          }
        }, 1000);
      },
      { once: true },
    );
    input.click();
  });
}
