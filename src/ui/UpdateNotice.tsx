/**
 * 更新提示卡片。
 *
 * 只在真的有事发生时出现：查到新版本、正在下载、装完等重启、手动检查的结果。
 * 写作界面里不做模态对话框——不打断正在写的句子。
 */
import { formatBytes, progressPercent } from "../core/update-policy";
import { t } from "../i18n";
import { Icon } from "./Icon";
import type { UpdaterController } from "./useUpdater";

interface Props {
  updater: UpdaterController;
}

const VISIBLE = new Set([
  "checking",
  "available",
  "downloading",
  "installing",
  "ready",
  "current",
  "error",
]);

export function UpdateNotice({ updater }: Props) {
  const { phase, update, progress, error, currentVersion } = updater;
  if (!VISIBLE.has(phase)) return null;

  const percent = progressPercent(progress.downloaded, progress.total);
  const size = progress.downloaded > 0 ? formatBytes(progress.downloaded) : "";

  return (
    <section className={`update-card ${phase}`} role="status" aria-live="polite">
      <div className="update-head">
        <span className="update-badge">
          <Icon name="down" />
        </span>
        <div className="update-heading">
          <strong>
            {phase === "checking"
              ? t("update.checking")
              : phase === "current"
                ? t("update.upToDate", { version: currentVersion })
                : phase === "error"
                  ? t("update.failedTitle")
                  : phase === "ready"
                    ? t("update.readyTitle", { version: update?.version ?? "" })
                    : t("update.title", { version: update?.version ?? "" })}
          </strong>
          {phase !== "current" && phase !== "error" && phase !== "checking" && (
            <span className="update-sub">
              {phase === "ready"
                ? t("update.ready", { version: update?.version ?? "" })
                : t("update.current", { current: currentVersion })}
            </span>
          )}
        </div>
        <button
          className="update-close"
          onClick={updater.dismiss}
          aria-label={t("update.close")}
          title={t("update.close")}
        >
          <Icon name="close" />
        </button>
      </div>

      {phase === "available" && update?.notes && (
        <div className="update-notes">
          <span className="update-notes-label">{t("update.notes")}</span>
          {update.notes}
        </div>
      )}

      {(phase === "downloading" || phase === "installing") && (
        <div className="update-progress">
          <div className="update-bar">
            <span
              className={percent === null ? "indeterminate" : undefined}
              style={percent === null ? undefined : { width: `${percent}%` }}
            />
          </div>
          <span className="update-progress-text">
            {phase === "installing"
              ? t("update.installing")
              : percent === null
                ? t("update.downloadingUnknown", { size })
                : t("update.downloading", { percent, size })}
          </span>
        </div>
      )}

      {phase === "error" && <div className="update-error">{error}</div>}

      <div className="update-actions">
        {phase === "available" && (
          <>
            <button className="service-btn primary" onClick={() => void updater.install()}>
              {t("update.install")}
            </button>
            <button className="service-btn" onClick={updater.later}>
              {t("update.later")}
            </button>
          </>
        )}
        {phase === "ready" && (
          <button className="service-btn primary" onClick={() => void updater.restart()}>
            {t("update.restart")}
          </button>
        )}
        {phase === "error" && (
          <button className="service-btn" onClick={() => void updater.check(true)}>
            {t("update.retry")}
          </button>
        )}
      </div>
    </section>
  );
}
