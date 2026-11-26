/**
 * 导出落地。
 *
 * 桌面端让用户自己挑位置（系统保存对话框），浏览器端退回「下载」——
 * 两条路都以 `{ saved, location }` 收尾，调用方不需要知道当前跑在哪。
 */

import { desktopExport, isDesktop } from "../desktop/bridge";
import type { ExportPayload } from ".";

/** 保存对话框里的类型名；格式名中英文一致，不必过 i18n。 */
const FILTER_NAMES: Record<string, string> = {
  md: "Markdown",
  html: "HTML",
  pdf: "PDF",
};

export interface SaveResult {
  /** 用户在对话框里点了取消时为 false。 */
  saved: boolean;
  /** 落盘路径或下载后的文件名，用于提示。 */
  location: string;
}

/** 把建议文件名挂到目录后面；只处理分隔符，不做路径规范化。 */
function joinPath(dir: string, name: string): string {
  const trimmed = dir.replace(/[\\/]+$/, "");
  return trimmed ? `${trimmed}/${name}` : name;
}

export interface SaveOptions {
  /** 保存对话框的初始目录（通常是当前工作区）。 */
  defaultDir?: string | null;
}

export async function saveExportFile(
  payload: ExportPayload,
  options: SaveOptions = {},
): Promise<SaveResult> {
  if (!isDesktop()) {
    download(payload);
    return { saved: true, location: payload.fileName };
  }

  const { save } = await import("@tauri-apps/plugin-dialog");
  const path = await save({
    title: payload.fileName,
    defaultPath: options.defaultDir
      ? joinPath(options.defaultDir, payload.fileName)
      : payload.fileName,
    filters: [
      {
        name: FILTER_NAMES[payload.extension] ?? payload.extension.toUpperCase(),
        extensions: [payload.extension],
      },
    ],
  });
  if (!path) return { saved: false, location: "" };

  await desktopExport.writeText(path, payload.contents);
  return { saved: true, location: path };
}

/** 浏览器端下载：Blob + 一次点击，不进任何外部服务。 */
function download(payload: ExportPayload): void {
  const blob = new Blob([payload.contents], { type: payload.mime });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = payload.fileName;
  anchor.rel = "noopener";
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  // 立刻 revoke 会让部分浏览器来不及取数据
  window.setTimeout(() => URL.revokeObjectURL(url), 5000);
}

/**
 * 调起打印。
 *
 * 桌面端走原生打印（WKWebView / WebView2 / WebKitGTK 的系统对话框），
 * 网页端退回 `window.print()`；两者都止步于「系统打印对话框」——
 * PDF 就是在这里由用户选「存储为 PDF」产出的。
 */
export async function printCurrentWindow(): Promise<"native" | "web"> {
  if (isDesktop()) {
    try {
      await desktopExport.print();
      return "native";
    } catch (error) {
      // 原生打印不可用时不要静默失败：退到 window.print()，至少还有一条路
      console.warn("[vellink] 原生打印不可用，退回 window.print()", error);
    }
  }
  window.print();
  return "web";
}
