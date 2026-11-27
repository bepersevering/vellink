/**
 * 设置面板：字号、行宽、主题、自动保存间隔。
 *
 * 交互取舍：改完立即生效、立即保存，没有「取消」。
 * 理由是这个面板里每一项都能当场看见结果（字变大、栏变窄、主题切换），
 * 让用户先试再确认，比「改完发现没保存」更符合预期；「恢复默认」负责兜底。
 */
import { useEffect, useRef } from "react";
import {
  DEFAULT_SETTINGS,
  LIMITS,
  isDefaultSettings,
  secondsOf,
  type Settings,
  type ThemeMode,
} from "../core/settings";
import { t } from "../i18n";
import { Icon } from "./Icon";

const THEMES: ReadonlyArray<{ id: ThemeMode; label: string }> = [
  { id: "light", label: "settings.theme.light" },
  { id: "dark", label: "settings.theme.dark" },
  { id: "system", label: "settings.theme.system" },
];

interface Props {
  open: boolean;
  settings: Settings;
  onChange: (next: Settings) => void;
  onClose: () => void;
}

export function SettingsDialog({ open, settings, onChange, onClose }: Props) {
  const dialogRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    dialogRef.current?.focus();
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        onClose();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  if (!open) return null;

  const patch = (next: Partial<Settings>) => onChange({ ...settings, ...next });

  return (
    <div className="export-backdrop" onMouseDown={onClose}>
      <div
        ref={dialogRef}
        className="settings-dialog"
        role="dialog"
        aria-modal="true"
        aria-label={t("settings.title")}
        tabIndex={-1}
        onMouseDown={(event) => event.stopPropagation()}
      >
        <header className="export-head">
          <div className="export-heading">
            <strong>{t("settings.title")}</strong>
            <span className="export-sub">{t("settings.sub")}</span>
          </div>
          <button
            className="export-close"
            onClick={onClose}
            aria-label={t("settings.done")}
            title={t("settings.done")}
          >
            <Icon name="close" />
          </button>
        </header>

        <section className="set-row">
          <div className="set-head">
            <span className="set-label">{t("settings.fontSize")}</span>
            <span className="set-value">{t("settings.px", { value: settings.fontSize })}</span>
          </div>
          <input
            className="set-range"
            type="range"
            min={LIMITS.fontSize.min}
            max={LIMITS.fontSize.max}
            step={LIMITS.fontSize.step}
            value={settings.fontSize}
            onChange={(event) => patch({ fontSize: Number(event.target.value) })}
            aria-label={t("settings.fontSize")}
          />
          <p className="set-hint">{t("settings.fontSizeHint")}</p>
        </section>

        <section className="set-row">
          <div className="set-head">
            <span className="set-label">{t("settings.lineWidth")}</span>
            <span className="set-value">{t("settings.px", { value: settings.lineWidth })}</span>
          </div>
          <input
            className="set-range"
            type="range"
            min={LIMITS.lineWidth.min}
            max={LIMITS.lineWidth.max}
            step={LIMITS.lineWidth.step}
            value={settings.lineWidth}
            onChange={(event) => patch({ lineWidth: Number(event.target.value) })}
            aria-label={t("settings.lineWidth")}
          />
          <p className="set-hint">{t("settings.lineWidthHint")}</p>
        </section>

        <section className="set-row">
          <div className="set-head">
            <span className="set-label">{t("settings.theme")}</span>
          </div>
          <div className="set-seg" role="radiogroup" aria-label={t("settings.theme")}>
            {THEMES.map((item) => (
              <button
                key={item.id}
                role="radio"
                aria-checked={settings.theme === item.id}
                className={`set-seg-btn ${settings.theme === item.id ? "on" : ""}`}
                onClick={() => patch({ theme: item.id })}
              >
                {t(item.label)}
              </button>
            ))}
          </div>
          <p className="set-hint">{t("settings.themeHint")}</p>
        </section>

        <section className="set-row">
          <div className="set-head">
            <span className="set-label">{t("settings.autosave")}</span>
            <span className="set-value">
              {t("settings.seconds", { value: secondsOf(settings.autosaveMs) })}
            </span>
          </div>
          <input
            className="set-range"
            type="range"
            min={LIMITS.autosaveMs.min}
            max={LIMITS.autosaveMs.max}
            step={LIMITS.autosaveMs.step}
            value={settings.autosaveMs}
            onChange={(event) => patch({ autosaveMs: Number(event.target.value) })}
            aria-label={t("settings.autosave")}
          />
          <p className="set-hint">{t("settings.autosaveHint")}</p>
        </section>

        <section className="set-row set-toggle-row">
          <label className="set-toggle">
            <input
              type="checkbox"
              checked={settings.typewriter}
              onChange={(e) => patch({ typewriter: e.target.checked })}
            />
            <span className="set-label">{t("settings.typewriter")}</span>
          </label>
          <p className="set-hint">{t("settings.typewriterHint")}</p>
        </section>

        <section className="set-row set-toggle-row">
          <label className="set-toggle">
            <input
              type="checkbox"
              checked={settings.focusLines}
              onChange={(e) => patch({ focusLines: e.target.checked })}
            />
            <span className="set-label">{t("settings.focusLines")}</span>
          </label>
          <p className="set-hint">{t("settings.focusLinesHint")}</p>
        </section>

        <section className="set-row">
          <div className="set-head">
            <span className="set-label">{t("settings.customCss")}</span>
          </div>
          <textarea
            className="set-css"
            value={settings.customCss}
            onChange={(e) => patch({ customCss: e.target.value })}
            placeholder={t("settings.customCssPlaceholder")}
            aria-label={t("settings.customCss")}
            spellCheck={false}
          />
          <p className="set-hint">{t("settings.customCssHint")}</p>
        </section>

        <footer className="export-actions">
          <button
            className="service-btn"
            onClick={() => onChange({ ...DEFAULT_SETTINGS })}
            disabled={isDefaultSettings(settings)}
          >
            {t("settings.reset")}
          </button>
          <button className="service-btn primary" onClick={onClose}>
            {t("settings.done")}
          </button>
        </footer>
      </div>
    </div>
  );
}
