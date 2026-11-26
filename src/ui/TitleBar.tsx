import { Icon } from "./Icon";

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
}: Props) {
  return (
    <header className="titlebar">
      <div className="win-dots" aria-hidden="true">
        <span className="dot r" />
        <span className="dot y" />
        <span className="dot g" />
      </div>

      <div className="tb-center">
        <span className="saved" title="已保存" />
        <span className="doc-name">{docName}.md</span>
        <div className="mode-switch" role="tablist" aria-label="界面模式">
          <button
            className={`mode-btn ${mode === "focus" ? "on" : ""}`}
            onClick={() => onModeChange("focus")}
            role="tab"
            aria-selected={mode === "focus"}
          >
            写作模式
          </button>
          <button
            className={`mode-btn ${mode === "manage" ? "on" : ""}`}
            onClick={() => onModeChange("manage")}
            role="tab"
            aria-selected={mode === "manage"}
          >
            管理模式
          </button>
        </div>
      </div>

      <div className="tb-right">
        <button
          className="icon-btn"
          onClick={onOpenPalette}
          title="命令面板 (Cmd/Ctrl+P)"
          aria-label="命令面板"
        >
          <Icon name="cmd" />
        </button>
        <button
          className={`icon-btn ${leftOpen ? "on" : ""}`}
          onClick={onToggleLeft}
          title="文件树"
          aria-label="切换文件树"
          aria-pressed={leftOpen}
        >
          <Icon name="left" />
        </button>
        <button
          className={`icon-btn ${rightOpen ? "on" : ""}`}
          onClick={onToggleRight}
          title="侧边面板"
          aria-label="切换侧边面板"
          aria-pressed={rightOpen}
        >
          <Icon name="right" />
        </button>
        <button
          className="icon-btn"
          onClick={onThemeToggle}
          title="切换主题"
          aria-label="切换主题"
        >
          <Icon name={theme === "dark" ? "sun" : "moon"} />
        </button>
        <button className="icon-btn" title="设置" aria-label="设置">
          <Icon name="set" />
        </button>
      </div>
    </header>
  );
}
