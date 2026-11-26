/**
 * 更新状态机。
 *
 * 把「什么时候查、查到之后怎么办」收在一个 hook 里，UI 只负责画：
 * idle → checking → available → downloading → installing → ready。
 * 手动检查失败会留下 error 让用户看到原因；后台静默检查失败就当没发生。
 */
import { useCallback, useEffect, useRef, useState } from "react";
import { isDesktop } from "../core/desktop/bridge";
import { checkForUpdate, relaunchApp, type PendingUpdate } from "../core/desktop/updater";
import { UPDATE_CHECK_INTERVAL, shouldCheckForUpdate } from "../core/update-policy";
import { APP_VERSION } from "../core/version";
import { t } from "../i18n";

const LAST_CHECK_KEY = "vellink-update-last-check";
const SKIP_KEY = "vellink-update-skip";

export type UpdatePhase =
  | "idle"
  | "checking"
  | "available"
  | "downloading"
  | "installing"
  | "ready"
  | "current"
  | "error";

export interface UpdateProgress {
  downloaded: number;
  total: number | null;
}

export interface UpdaterController {
  phase: UpdatePhase;
  /** 当前构建的版本号（构建期注入）。 */
  currentVersion: string;
  /** 查到的新版本；没有则为 null。 */
  update: PendingUpdate | null;
  progress: UpdateProgress;
  error: string;
  /** manual=true 时失败会显示错误卡片；自动检查失败静默。 */
  check: (manual: boolean) => Promise<void>;
  install: () => Promise<void>;
  later: () => void;
  restart: () => Promise<void>;
  /** 关掉「已是最新」/「失败」这类一次性卡片。 */
  dismiss: () => void;
}

function readNumber(key: string): number | null {
  try {
    const raw = globalThis.localStorage?.getItem(key);
    if (!raw) return null;
    const value = Number.parseInt(raw, 10);
    return Number.isFinite(value) ? value : null;
  } catch {
    return null;
  }
}

function readString(key: string): string | null {
  try {
    return globalThis.localStorage?.getItem(key) ?? null;
  } catch {
    return null;
  }
}

function write(key: string, value: string): void {
  try {
    globalThis.localStorage?.setItem(key, value);
  } catch {
    /* 隐私模式 / 配额满：记不住就算了，下次再查 */
  }
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

export function useUpdater(): UpdaterController {
  const [phase, setPhase] = useState<UpdatePhase>("idle");
  const [update, setUpdate] = useState<PendingUpdate | null>(null);
  const [progress, setProgress] = useState<UpdateProgress>({ downloaded: 0, total: null });
  const [error, setError] = useState("");

  const pendingRef = useRef<PendingUpdate | null>(null);
  const checkingRef = useRef(false);
  const aliveRef = useRef(true);

  useEffect(() => {
    aliveRef.current = true;
    return () => {
      aliveRef.current = false;
      // 组件卸载时释放原生资源；没装成就丢掉这次更新
      void pendingRef.current?.dismiss();
      pendingRef.current = null;
    };
  }, []);

  /**
   * 关掉手上这个原生句柄（Update 在 Rust 侧握着资源）。
   *
   * 只释放资源、不清 `update` 元数据：装完之后还要拿版本号显示「已安装，重启生效」。
   */
  const releasePending = useCallback(() => {
    const pending = pendingRef.current;
    pendingRef.current = null;
    if (pending) void pending.dismiss().catch(() => undefined);
  }, []);

  const check = useCallback(async (manual: boolean) => {
    if (checkingRef.current) return;
    if (!isDesktop()) {
      setError(t("update.desktopOnly"));
      setPhase("error");
      return;
    }
    checkingRef.current = true;
    setPhase("checking");
    setError("");
    try {
      const found = await checkForUpdate();
      if (!aliveRef.current) {
        await found?.dismiss();
        return;
      }
      write(LAST_CHECK_KEY, String(Date.now()));

      if (!found) {
        setPhase(manual ? "current" : "idle");
        return;
      }
      // 自动检查会尊重「稍后」：同一个版本被跳过过就不再弹
      if (!manual && readString(SKIP_KEY) === found.version) {
        await found.dismiss();
        setPhase("idle");
        return;
      }
      // 之前那次（例如用户已经点了关闭）先释放，避免新旧两个资源并存
      releasePending();
      pendingRef.current = found;
      setUpdate(found);
      setProgress({ downloaded: 0, total: null });
      setPhase("available");
    } catch (err) {
      if (aliveRef.current) {
        if (manual) {
          setError(errorMessage(err));
          setPhase("error");
        } else {
          // 离线、GitHub 被墙、接口 404：后台检查失败不该打扰写作
          console.warn("[vellink] update check failed", err);
          setPhase("idle");
        }
      }
    } finally {
      checkingRef.current = false;
    }
  }, [releasePending]);

  useEffect(() => {
    if (!isDesktop()) return;
    if (!shouldCheckForUpdate(readNumber(LAST_CHECK_KEY), Date.now(), UPDATE_CHECK_INTERVAL)) {
      return;
    }
    // 启动 4 秒后再查：先把文档打开，别和首屏抢网络
    const timer = window.setTimeout(() => void check(false), 4000);
    return () => window.clearTimeout(timer);
  }, [check]);

  const install = useCallback(async () => {
    const pending = pendingRef.current;
    if (!pending) return;
    setPhase("downloading");
    setError("");
    try {
      await pending.install((event) => {
        if (event.kind === "started") {
          setProgress({ downloaded: 0, total: event.total });
        } else if (event.kind === "progress") {
          setProgress({ downloaded: event.downloaded, total: event.total });
        } else if (event.kind === "installing") {
          setPhase("installing");
        }
      });
      if (aliveRef.current) {
        // 装完就不需要这个句柄了，留着只是占着一个原生资源
        releasePending();
        setPhase("ready");
      }
    } catch (err) {
      if (aliveRef.current) {
        releasePending();
        setError(errorMessage(err));
        setPhase("error");
      }
    }
  }, [releasePending]);

  const later = useCallback(() => {
    const pending = pendingRef.current;
    if (pending) write(SKIP_KEY, pending.version);
    releasePending();
    setUpdate(null);
    setPhase("idle");
  }, [releasePending]);

  const restart = useCallback(async () => {
    await relaunchApp();
  }, []);

  // 关闭卡片：释放句柄但**不**记「跳过」，下次检查（或下次启动）还会提示
  const dismiss = useCallback(() => {
    releasePending();
    setUpdate(null);
    setPhase("idle");
  }, [releasePending]);

  // 「已是最新」是一次性反馈，5 秒后自己收起来，不用用户动手
  useEffect(() => {
    if (phase !== "current") return;
    const timer = window.setTimeout(() => setPhase("idle"), 5000);
    return () => window.clearTimeout(timer);
  }, [phase]);

  return {
    phase,
    currentVersion: APP_VERSION,
    update,
    progress,
    error,
    check,
    install,
    later,
    restart,
    dismiss,
  };
}
