import { Icon } from "./Icon";
import { t } from "../i18n";
import type { DocStats } from "./Editor";

interface Props {
  pluginCount: number;
  stats: DocStats;
}

export function StatusBar({ pluginCount, stats }: Props) {
  return (
    <footer className="statusbar">
      <div className="status-i">
        <Icon name="check" />
        {t("status.saved")}
      </div>
      <div className="status-i sync">
        <Icon name="cloud" />
        {t("status.webdavSynced")}
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
