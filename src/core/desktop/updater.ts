/**
 * 自动更新桥。
 *
 * 和 fs 桥同样的套路：网页版没有 Tauri 运行时，所有原生模块一律动态 import，
 * 网页构建里被拆成独立 chunk；调用方只看这个文件暴露的类型，不直接碰插件。
 *
 * 版本真相只有两处：运行时 `getVersion()`（Tauri 从 bundle 里读）和构建期注入的
 * `APP_VERSION`（见 core/version.ts）。两者都由 scripts/sync-version.mjs 保证一致。
 */
import { isDesktop } from "./bridge";

/** 下载阶段回调：进度事件由插件逐块推送，这里是累计值。 */
export type UpdateEvent =
  | { kind: "started"; total: number | null }
  | { kind: "progress"; downloaded: number; total: number | null }
  | { kind: "installing" }
  | { kind: "installed" };

export interface PendingUpdate {
  /** 服务端公布的新版本号。 */
  version: string;
  /** 当前跑的版本号。 */
  currentVersion: string;
  /** 发布说明（可空）。 */
  notes: string;
  /** 发布时间（RFC 3339，可空）。 */
  publishedAt: string | null;
  /**
   * 下载并安装。安装完成后调用方应提示重启；
   * Windows 的 passive 安装器会自己关掉应用，这种情况不会走完这一步。
   */
  install: (onEvent: (event: UpdateEvent) => void) => Promise<void>;
  /** 放弃这次更新，释放原生资源。 */
  dismiss: () => Promise<void>;
}

/**
 * 查询更新。没有新版本返回 null；非桌面端抛错（UI 据此提示仅桌面可用）。
 */
export async function checkForUpdate(): Promise<PendingUpdate | null> {
  if (!isDesktop()) throw new Error("updates are only available in the desktop app");
  const { check } = await import("@tauri-apps/plugin-updater");
  const update = await check();
  if (!update) return null;

  return {
    version: update.version,
    currentVersion: update.currentVersion,
    notes: update.body ?? "",
    publishedAt: update.date ?? null,
    install: async (onEvent) => {
      let total: number | null = null;
      let downloaded = 0;
      await update.download((event) => {
        if (event.event === "Started") {
          total = event.data.contentLength ?? null;
          downloaded = 0;
          onEvent({ kind: "started", total });
        } else if (event.event === "Progress") {
          // chunkLength 是「这一块」的长度，累计得自己加
          downloaded += event.data.chunkLength;
          onEvent({ kind: "progress", downloaded, total });
        }
      });
      onEvent({ kind: "installing" });
      await update.install();
      onEvent({ kind: "installed" });
    },
    dismiss: async () => {
      await update.close();
    },
  };
}

/** 重启应用（更新装完后生效）。非桌面端是空操作。 */
export async function relaunchApp(): Promise<void> {
  if (!isDesktop()) return;
  const { relaunch } = await import("@tauri-apps/plugin-process");
  await relaunch();
}
