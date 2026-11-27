import { Icon } from "./Icon";
import { t, toggleLocale } from "../i18n";

export type AppMode = "focus" | "manage";
export type Theme = "light" | "dark";

interface Props {
  mode: AppMode;
  theme: Theme;
  leftOpen: boolean;
  rightOpen: boolean;
  docName: string;
  onModeChange: (m: AppMode) => void;
  onThemeToggle: () => void;
  onToggleLeft: () => void;
  onToggleRight: () => void;
  onOpenPalette: () => void;
  onOpenSettings: () => void;
}

export function TitleBar({
  mode,
  theme,
  leftOpen,
  rightOpen,
  docName,
  onModeChange,
  onThemeToggle,
  onToggleLeft,
  onToggleRight,
  onOpenPalette,
  onOpenSettings,
}: Props) {
  return (
    // data-tauri-drag-region: macOS uses an overlay title bar (no system title bar strip),
    // so this area must declare itself draggable or the window won't move
    <header className="titlebar" data-tauri-drag-region>
      <div className="win-dots" aria-hidden="true" data-tauri-drag-region>
        <span className="dot r" />
        <span className="dot y" />
        <span className="dot g" />
      </div>

      <div className="tb-center" data-tauri-drag-region>
        <span className="saved" title={t("titlebar.saved")} data-tauri-drag-region />
        <span className="doc-name" data-tauri-drag-region>
          {docName}.md
        </span>
        <div className="mode-switch" role="tablist" aria-label={t("titlebar.modeSwitch")}>
          <button
            className={`mode-btn ${mode === "focus" ? "on" : ""}`}
            onClick={() => onModeChange("focus")}
            role="tab"
            aria-selected={mode === "focus"}
          >
            {t("titlebar.focusMode")}
          </button>
          <button
            className={`mode-btn ${mode === "manage" ? "on" : ""}`}
            onClick={() => onModeChange("manage")}
            role="tab"
            aria-selected={mode === "manage"}
          >
            {t("titlebar.manageMode")}
          </button>
        </div>
      </div>

      <div className="tb-right">
        <button
          className="icon-btn"
          onClick={onOpenPalette}
          title={t("titlebar.palette")}
          aria-label={t("titlebar.palette")}
        >
          <Icon name="cmd" />
        </button>
        <button
          className={`icon-btn ${leftOpen ? "on" : ""}`}
          onClick={onToggleLeft}
          title={t("titlebar.fileTree")}
          aria-label={t("titlebar.toggleFileTree")}
          aria-pressed={leftOpen}
        >
          <Icon name="left" />
        </button>
        <button
          className={`icon-btn ${rightOpen ? "on" : ""}`}
          onClick={onToggleRight}
          title={t("titlebar.sidePanel")}
          aria-label={t("titlebar.toggleSidePanel")}
          aria-pressed={rightOpen}
        >
          <Icon name="right" />
        </button>
        <button
          className="icon-btn"
          onClick={toggleLocale}
          title={t("titlebar.language")}
          aria-label={t("titlebar.language")}
        >
          <Icon name="lang" />
        </button>
        <button
          className="icon-btn"
          onClick={onThemeToggle}
          title={t("titlebar.toggleTheme")}
          aria-label={t("titlebar.toggleTheme")}
        >
          <Icon name={theme === "dark" ? "sun" : "moon"} />
        </button>
        <button
          className="icon-btn"
          onClick={onOpenSettings}
          title={t("titlebar.settings")}
          aria-label={t("titlebar.settings")}
        >
          <Icon name="set" />
        </button>
      </div>
    </header>
  );
}
