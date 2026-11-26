import { Icon, type IconName } from "./Icon";
import { t, getLocale } from "../i18n";
import type { DocStats } from "./Editor";
import type { SaveState } from "../core/workspace-storage";

interface Props {
  pluginCount: number;
  stats: DocStats;
  /** 当前文档的落盘状态。 */
  saveState: SaveState | "dirty";
  savedAt: number | null;
  docCount: number;
  dirtyCount: number;
  /** 文档存在本地文件夹还是浏览器里。 */
  storageKind: "files" | "browser";
  storagePath: string | null;
}

function saveLabel(state: SaveState | "dirty", savedAt: number | null): string {
  if (state === "saving") return t("status.saving");
  if (state === "error") return t("status.saveFailed");
  if (state === "dirty") return t("status.dirty");
  if (savedAt) {
    const time = new Date(savedAt).toLocaleTimeString(getLocale(), {
      hour: "2-digit",
      minute: "2-digit",
    });
    return t("status.savedAt", { time });
  }
  return t("status.saved");
}

export function StatusBar({
  pluginCount,
  stats,
  saveState,
  savedAt,
  docCount,
  dirtyCount,
  storageKind,
  storagePath,
}: Props) {
  const icon: IconName = saveState === "error" ? "cloud" : "check";
  return (
    <footer className="statusbar">
      <div className={`status-i ${saveState}`}>
        <Icon name={icon} />
        {saveLabel(saveState, savedAt)}
      </div>
      <div className="status-i">
        <Icon name="file" />
        {t("status.docs", { count: docCount, dirty: dirtyCount })}
      </div>
      <div className="status-i" title={storagePath ?? undefined}>
        <Icon name="folder" />
        {storageKind === "files" ? t("status.storageLocal") : t("status.storageBrowser")}
      </div>
      <div className="sp" />
      <div>
        {t("status.lineChars", {
          line: stats.line,
          chars: stats.chars.toLocaleString(),
        })}
      </div>
      <div title={t("status.pmSource", { pm: stats.pm, source: stats.source })}>
        UTF-8　Markdown　PM {stats.pm} ⇄ src {stats.source}
      </div>
      <div className="status-i">
        <Icon name="plug" />
        {t("status.pluginsEnabled", { count: pluginCount })}
      </div>
    </footer>
  );
}
