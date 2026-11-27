import { describe, expect, it } from "vitest";
import {
  DEFAULT_SETTINGS,
  LIMITS,
  applySettings,
  isDefaultSettings,
  loadSettings,
  normalizeSettings,
  resolveTheme,
  saveSettings,
  secondsOf,
} from "./settings";

/** Minimal Storage stub: only getItem / setItem are needed for this module. */
function memoryStorage(initial: Record<string, string> = {}): Storage {
  const map = new Map(Object.entries(initial));
  return {
    get length() {
      return map.size;
    },
    clear: () => map.clear(),
    getItem: (key: string) => map.get(key) ?? null,
    key: (index: number) => [...map.keys()][index] ?? null,
    removeItem: (key: string) => void map.delete(key),
    setItem: (key: string, value: string) => void map.set(key, value),
  };
}

describe("settings bounds", () => {
  it("out-of-range numbers are clamped to the valid range instead of accepted as-is", () => {
    const huge = normalizeSettings({ fontSize: 99, lineWidth: 4000, autosaveMs: 99999 });
    expect(huge.fontSize).toBe(LIMITS.fontSize.max);
    expect(huge.lineWidth).toBe(LIMITS.lineWidth.max);
    expect(huge.autosaveMs).toBe(LIMITS.autosaveMs.max);

    const tiny = normalizeSettings({ fontSize: 4, lineWidth: 100, autosaveMs: 10 });
    expect(tiny.fontSize).toBe(LIMITS.fontSize.min);
    expect(tiny.lineWidth).toBe(LIMITS.lineWidth.min);
    expect(tiny.autosaveMs).toBe(LIMITS.autosaveMs.min);
  });

  it("wrong types, NaN, and strings all fall back to defaults", () => {
    const junk = normalizeSettings({
      fontSize: "18",
      lineWidth: Number.NaN,
      autosaveMs: null,
    });
    expect(junk.fontSize).toBe(DEFAULT_SETTINGS.fontSize);
    expect(junk.lineWidth).toBe(DEFAULT_SETTINGS.lineWidth);
    expect(junk.autosaveMs).toBe(DEFAULT_SETTINGS.autosaveMs);
  });

  it("non-object input doesn't throw; theme only accepts three valid values", () => {
    expect(normalizeSettings(null)).toEqual(DEFAULT_SETTINGS);
    expect(normalizeSettings("dark")).toEqual(DEFAULT_SETTINGS);
    expect(normalizeSettings({ theme: "dark" }).theme).toBe("dark");
    expect(normalizeSettings({ theme: "sepia" }).theme).toBe("system");
  });

  it("rounds to integers: sliders should only produce integer values", () => {
    expect(normalizeSettings({ fontSize: 16.7 }).fontSize).toBe(17);
  });
});

describe("settings read/write", () => {
  it("nothing stored → defaults", () => {
    expect(loadSettings(memoryStorage())).toEqual(DEFAULT_SETTINGS);
  });

  it("legacy vellink-theme migrates to an explicit choice, not overridden by 'follow system'", () => {
    const store = memoryStorage({ "vellink-theme": "dark" });
    expect(loadSettings(store).theme).toBe("dark");
  });

  it("stored settings take precedence even when legacy keys are also present", () => {
    const store = memoryStorage({
      "vellink-theme": "dark",
      "vellink-settings:v1": JSON.stringify({ theme: "light", fontSize: 20 }),
    });
    const loaded = loadSettings(store);
    expect(loaded.theme).toBe("light");
    expect(loaded.fontSize).toBe(20);
  });

  it("malformed JSON is treated as nothing stored rather than preventing startup", () => {
    const store = memoryStorage({ "vellink-settings:v1": "{not json" });
    expect(loadSettings(store)).toEqual(DEFAULT_SETTINGS);
  });

  it("writes also run validation so bad values never reach storage", () => {
    const store = memoryStorage();
    saveSettings({ ...DEFAULT_SETTINGS, fontSize: 500 }, store);
    const raw = JSON.parse(store.getItem("vellink-settings:v1") ?? "{}");
    expect(raw.fontSize).toBe(LIMITS.fontSize.max);
  });
});

describe("theme resolution", () => {
  it("follows the system when set to 'system', ignores it when fixed", () => {
    expect(resolveTheme("system", true)).toBe("dark");
    expect(resolveTheme("system", false)).toBe("light");
    expect(resolveTheme("light", true)).toBe("light");
    expect(resolveTheme("dark", false)).toBe("dark");
  });
});

describe("applying styles", () => {
  it("writes font size and column width as CSS variables", () => {
    const written: Record<string, string> = {};
    const root = {
      style: { setProperty: (name: string, value: string) => void (written[name] = value) },
    } as unknown as HTMLElement;
    applySettings({ ...DEFAULT_SETTINGS, fontSize: 18, lineWidth: 640 }, root);
    expect(written["--doc-font"]).toBe("18px");
    expect(written["--doc-width"]).toBe("640px");
  });

  it("converts milliseconds to seconds with one decimal place", () => {
    expect(secondsOf(300)).toBe("0.3");
    expect(secondsOf(700)).toBe("0.7");
    expect(secondsOf(3000)).toBe("3.0");
  });

  it("'Reset to defaults' is disabled only on full equality", () => {
    expect(isDefaultSettings({ ...DEFAULT_SETTINGS })).toBe(true);
    expect(isDefaultSettings({ ...DEFAULT_SETTINGS, theme: "dark" })).toBe(false);
  });
});


describe("writing mode preferences", () => {
  it("boolean fields only accept true; bad values fall back to false", () => {
    expect(normalizeSettings({ typewriter: true, focusLines: true }).typewriter).toBe(true);
    expect(normalizeSettings({ typewriter: true, focusLines: true }).focusLines).toBe(true);
    expect(normalizeSettings({ typewriter: "true", focusLines: 1 }).typewriter).toBe(false);
    expect(normalizeSettings({ typewriter: "true", focusLines: 1 }).focusLines).toBe(false);
  });

  it("defaults don't enable either mode", () => {
    const s = normalizeSettings({});
    expect(s.typewriter).toBe(false);
    expect(s.focusLines).toBe(false);
  });
});
