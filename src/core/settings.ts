/**
 * 用户偏好：字号、行宽、主题、自动保存间隔。
 *
 * 只有四个字段，但每个字段都有一条「不能让它把界面搞坏」的边界：
 * - 字号 13–22px：再小看不清，再大一行放不下几个字；
 * - 行宽 560–960px：低于 560 中文一行只剩十来个字，高于 960 又回到满屏长行；
 * - 自动保存 300–3000ms：低于 300 等于每敲一个字写一次盘。
 *
 * 所以存储里的值一律不可信：`normalizeSettings` 会把越界、类型不对、甚至
 * 被手改坏的值夹回合法区间，读出来永远是一个能用的 Settings。
 */

export type ThemeMode = "light" | "dark" | "system";

export interface Settings {
  /** 正文字号，px。 */
  fontSize: number;
  /** 正文栏宽，px。 */
  lineWidth: number;
  /** 主题：固定浅色 / 固定深色 / 跟随系统。 */
  theme: ThemeMode;
  /** 自动保存防抖间隔，ms。 */
  autosaveMs: number;
  /** 打字机模式：当前行始终保持在窗口垂直中央。 */
  typewriter: boolean;
  /** 聚焦段落：当前段落清晰，其余淡化。 */
  focusLines: boolean;
}

export const LIMITS = {
  fontSize: { min: 13, max: 22, step: 1, default: 16 },
  lineWidth: { min: 560, max: 960, step: 20, default: 720 },
  autosaveMs: { min: 300, max: 3000, step: 100, default: 700 },
} as const;

export const DEFAULT_SETTINGS: Settings = {
  fontSize: LIMITS.fontSize.default,
  lineWidth: LIMITS.lineWidth.default,
  // 默认跟随系统：写作软件不该在深色桌面上开出一块刺眼的白板
  theme: "system",
  autosaveMs: LIMITS.autosaveMs.default,
  typewriter: false,
  focusLines: false,
};

const STORAGE_KEY = "vellink-settings:v1";
/** 设置面板出现之前，主题单独存过一份；迁移时优先尊重用户原来的选择。 */
const LEGACY_THEME_KEY = "vellink-theme";

/** 取一个可以安全落到 storage 的 Storage；隐私模式下访问会抛异常。 */
function safeStorage(storage?: Storage | null): Storage | null {
  if (storage !== undefined) return storage;
  try {
    return window.localStorage;
  } catch {
    return null;
  }
}

function clampNumber(value: unknown, min: number, max: number, fallback: number): number {
  if (typeof value !== "number" || !Number.isFinite(value)) return fallback;
  return Math.min(max, Math.max(min, Math.round(value)));
}

/** 任意输入 → 合法设置。所有入口（读盘、导入、测试）都走这里。 */
export function normalizeSettings(raw: unknown): Settings {
  const input =
    raw && typeof raw === "object" ? (raw as Record<string, unknown>) : {};
  const theme = input.theme;
  return {
    fontSize: clampNumber(
      input.fontSize,
      LIMITS.fontSize.min,
      LIMITS.fontSize.max,
      DEFAULT_SETTINGS.fontSize,
    ),
    lineWidth: clampNumber(
      input.lineWidth,
      LIMITS.lineWidth.min,
      LIMITS.lineWidth.max,
      DEFAULT_SETTINGS.lineWidth,
    ),
    theme:
      theme === "light" || theme === "dark" || theme === "system"
        ? theme
        : DEFAULT_SETTINGS.theme,
    autosaveMs: clampNumber(
      input.autosaveMs,
      LIMITS.autosaveMs.min,
      LIMITS.autosaveMs.max,
      DEFAULT_SETTINGS.autosaveMs,
    ),
    typewriter: input.typewriter === true,
    focusLines: input.focusLines === true,
  };
}

/**
 * 读设置。
 *
 * 没有存过设置的老用户，把 `vellink-theme` 里明确选过的浅色/深色迁移成
 * 同一个显式选择——不能因为「默认跟随系统」就把他们的界面改成另一个样子。
 */
export function loadSettings(storage?: Storage | null): Settings {
  const store = safeStorage(storage);
  if (!store) return { ...DEFAULT_SETTINGS };
  try {
    const raw = store.getItem(STORAGE_KEY);
    if (raw) return normalizeSettings(JSON.parse(raw));
    const legacy = store.getItem(LEGACY_THEME_KEY);
    if (legacy === "light" || legacy === "dark") {
      return { ...DEFAULT_SETTINGS, theme: legacy };
    }
  } catch {
    /* 坏数据当没存过 */
  }
  return { ...DEFAULT_SETTINGS };
}

export function saveSettings(settings: Settings, storage?: Storage | null): void {
  const store = safeStorage(storage);
  if (!store) return;
  try {
    store.setItem(STORAGE_KEY, JSON.stringify(normalizeSettings(settings)));
  } catch {
    /* 存不下就只记在内存里，不影响本次使用 */
  }
}

/**
 * 把设置落成 CSS 变量。
 *
 * 用变量而不是改内联样式：`--doc-font` / `--doc-width` 在样式表里有多处引用
 * （正文、标题、源码视图、导出预览），写一次全局生效，不用挨个节点改。
 */
export function applySettings(
  settings: Settings,
  root: HTMLElement | null = typeof document === "undefined"
    ? null
    : document.documentElement,
): void {
  if (!root) return;
  root.style.setProperty("--doc-font", `${settings.fontSize}px`);
  root.style.setProperty("--doc-width", `${settings.lineWidth}px`);
}

/** 主题模式 + 系统偏好 → 真正生效的那一个。 */
export function resolveTheme(mode: ThemeMode, systemDark: boolean): "light" | "dark" {
  if (mode === "system") return systemDark ? "dark" : "light";
  return mode;
}

/** 是否等于默认值（「恢复默认」按钮用它判断要不要禁用）。 */
export function isDefaultSettings(settings: Settings): boolean {
  return (
    settings.fontSize === DEFAULT_SETTINGS.fontSize &&
    settings.lineWidth === DEFAULT_SETTINGS.lineWidth &&
    settings.theme === DEFAULT_SETTINGS.theme &&
    settings.autosaveMs === DEFAULT_SETTINGS.autosaveMs
  );
}

/** 毫秒 → 秒的显示值，保留一位小数（300ms → "0.3"）。 */
export function secondsOf(ms: number): string {
  return (ms / 1000).toFixed(1);
}
