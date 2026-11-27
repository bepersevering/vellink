/**
 * Minimal zero-dependency i18n.
 * Locale packs are flat key-value dictionaries; values may contain {name}
 * placeholders resolved by t(). The active locale is persisted in localStorage
 * and defaults to the browser language. React components subscribe via
 * useLocale() and re-render on switch.
 */
import { useSyncExternalStore } from "react";
import { en } from "./en";
import { zhCN } from "./zh-CN";

export type Locale = "en" | "zh-CN";

const PACKS: Record<Locale, Record<string, string>> = {
  en,
  "zh-CN": zhCN,
};

const STORAGE_KEY = "vellink-locale";

/** localStorage may be absent (node test environment / Worker): all access is guarded. */
const storage = {
  get(): string | null {
    try {
      return globalThis.localStorage?.getItem(STORAGE_KEY) ?? null;
    } catch {
      return null;
    }
  },
  set(value: string): void {
    try {
      globalThis.localStorage?.setItem(STORAGE_KEY, value);
    } catch {
      /* ignore */
    }
  },
};

function detectLocale(): Locale {
  const saved = storage.get();
  if (saved === "en" || saved === "zh-CN") return saved;
  return navigator.language?.toLowerCase().startsWith("zh") ? "zh-CN" : "en";
}

let current: Locale =
  typeof navigator !== "undefined" ? detectLocale() : "en";

const listeners = new Set<() => void>();

export function getLocale(): Locale {
  return current;
}

export function setLocale(locale: Locale): void {
  if (locale === current) return;
  current = locale;
  storage.set(locale);
  for (const notify of listeners) notify();
}

export function toggleLocale(): void {
  setLocale(current === "en" ? "zh-CN" : "en");
}

export type Translate = (key: string, params?: Record<string, string | number>) => string;

export function t(key: string, params?: Record<string, string | number>): string {
  let text = PACKS[current][key] ?? PACKS.en[key] ?? key;
  if (params) {
    for (const [name, value] of Object.entries(params)) {
      text = text.replaceAll(`{${name}}`, String(value));
    }
  }
  return text;
}

function subscribe(notify: () => void): () => void {
  listeners.add(notify);
  return () => listeners.delete(notify);
}

/** React binding: re-renders the component when the locale changes. */
export function useLocale(): { locale: Locale; t: Translate } {
  useSyncExternalStore(subscribe, getLocale);
  return { locale: current, t };
}

export function listLocales(): Array<{ id: Locale; label: string }> {
  return [
    { id: "en", label: "English" },
    { id: "zh-CN", label: "简体中文" },
  ];
}
