/**
 * User preferences: font size, line width, theme, autosave interval.
 *
 * Only four fields, but each has a boundary that "must not break the UI":
 * - Font size 13–22px: smaller is unreadable, larger fits too few characters per line;
 * - Line width 560–960px: below 560 a Chinese line holds only about ten characters, above 960 you're back to full-screen long lines;
 * - Autosave 300–3000ms: below 300 means writing to disk on every keystroke.
 *
 * So values in storage are never trusted: `normalizeSettings` clamps out-of-range, wrong-typed, and even
 * hand-corrupted values back into the valid range, so what you read is always a usable Settings.
 */

export type ThemeMode = "light" | "dark" | "system";

export interface Settings {
  /** Body font size, in px. */
  fontSize: number;
  /** Body column width, in px. */
  lineWidth: number;
  /** Theme: fixed light / fixed dark / follow system. */
  theme: ThemeMode;
  /** Autosave debounce interval, in ms. */
  autosaveMs: number;
  /** Typewriter mode: keep the current line vertically centered in the window. */
  typewriter: boolean;
  /** Focus paragraph: current paragraph stays clear, the rest fade out. */
  focusLines: boolean;
  /** User-defined CSS (external links stripped), injected into the editor. */
  customCss: string;
  /** Max edge length for pasted images; 0 means no compression. */
  maxImageEdge: number;
  /** Automatic heading numbers (render layer only, not written into Markdown). */
  headingNumbers: boolean;
  /** Root directory for relative image paths when exporting HTML; empty means no rewriting. */
  imageBase: string;
}

export const LIMITS = {
  fontSize: { min: 13, max: 22, step: 1, default: 16 },
  lineWidth: { min: 560, max: 960, step: 20, default: 720 },
  autosaveMs: { min: 300, max: 3000, step: 100, default: 700 },
} as const;

export const DEFAULT_SETTINGS: Settings = {
  fontSize: LIMITS.fontSize.default,
  lineWidth: LIMITS.lineWidth.default,
  // Follow the system by default: a writing app shouldn't show a glaring white board on a dark desktop
  theme: "system",
  autosaveMs: LIMITS.autosaveMs.default,
  typewriter: false,
  focusLines: false,
  customCss: "",
  // Default compression to 2048: clear enough for text screenshots, yet shrinks 4K images to a fraction of their size
  maxImageEdge: 2048,
  headingNumbers: false,
  imageBase: "",
};

const STORAGE_KEY = "vellink-settings:v1";
/** Before the settings panel existed, the theme was stored separately; migration respects the user's original choice. */
const LEGACY_THEME_KEY = "vellink-theme";

/** Get a Storage safe to write to; access throws in private mode. */
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

/** Any input → valid settings. All entry points (load, import, tests) go through here. */
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
    customCss: typeof input.customCss === "string" ? input.customCss.slice(0, 20000) : "",
    maxImageEdge: clampNumber(input.maxImageEdge, 0, 4096, DEFAULT_SETTINGS.maxImageEdge),
    headingNumbers: input.headingNumbers === true,
    imageBase: typeof input.imageBase === "string" ? input.imageBase.slice(0, 200) : "",
  };
}

/**
 * Load settings.
 *
 * For long-time users who never saved settings, migrate an explicitly chosen light/dark theme from
 * `vellink-theme` into the same explicit choice — don't change their UI just because "the default is follow system".
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
    /* Bad data is treated as nothing stored */
  }
  return { ...DEFAULT_SETTINGS };
}

export function saveSettings(settings: Settings, storage?: Storage | null): void {
  const store = safeStorage(storage);
  if (!store) return;
  try {
    store.setItem(STORAGE_KEY, JSON.stringify(normalizeSettings(settings)));
  } catch {
    /* If it can't be saved, keep it in memory only; this session is unaffected */
  }
}

/**
 * Apply settings as CSS variables.
 *
 * Use variables rather than inline styles: `--doc-font` / `--doc-width` are referenced in multiple places
 * in the stylesheet (body, headings, source view, export preview), so writing once takes effect globally
 * without touching each node.
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

/** Theme mode + system preference → the one actually in effect. */
export function resolveTheme(mode: ThemeMode, systemDark: boolean): "light" | "dark" {
  if (mode === "system") return systemDark ? "dark" : "light";
  return mode;
}

/** Whether it equals defaults (used by the 'Reset to defaults' button to decide whether to disable). */
export function isDefaultSettings(settings: Settings): boolean {
  return (
    settings.fontSize === DEFAULT_SETTINGS.fontSize &&
    settings.lineWidth === DEFAULT_SETTINGS.lineWidth &&
    settings.theme === DEFAULT_SETTINGS.theme &&
    settings.autosaveMs === DEFAULT_SETTINGS.autosaveMs
  );
}

/** Milliseconds → seconds for display, one decimal place (300ms → "0.3"). */
export function secondsOf(ms: number): string {
  return (ms / 1000).toFixed(1);
}
