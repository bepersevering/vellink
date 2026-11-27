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

/** 最小的 Storage 替身：只要 getItem / setItem 就够这个模块用。 */
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

describe("设置的边界", () => {
  it("越界的数字被夹回可用区间，而不是照单全收", () => {
    const huge = normalizeSettings({ fontSize: 99, lineWidth: 4000, autosaveMs: 99999 });
    expect(huge.fontSize).toBe(LIMITS.fontSize.max);
    expect(huge.lineWidth).toBe(LIMITS.lineWidth.max);
    expect(huge.autosaveMs).toBe(LIMITS.autosaveMs.max);

    const tiny = normalizeSettings({ fontSize: 4, lineWidth: 100, autosaveMs: 10 });
    expect(tiny.fontSize).toBe(LIMITS.fontSize.min);
    expect(tiny.lineWidth).toBe(LIMITS.lineWidth.min);
    expect(tiny.autosaveMs).toBe(LIMITS.autosaveMs.min);
  });

  it("类型不对、NaN、字符串一律退回默认值", () => {
    const junk = normalizeSettings({
      fontSize: "18",
      lineWidth: Number.NaN,
      autosaveMs: null,
    });
    expect(junk.fontSize).toBe(DEFAULT_SETTINGS.fontSize);
    expect(junk.lineWidth).toBe(DEFAULT_SETTINGS.lineWidth);
    expect(junk.autosaveMs).toBe(DEFAULT_SETTINGS.autosaveMs);
  });

  it("非对象输入不会炸，主题只认三个合法值", () => {
    expect(normalizeSettings(null)).toEqual(DEFAULT_SETTINGS);
    expect(normalizeSettings("dark")).toEqual(DEFAULT_SETTINGS);
    expect(normalizeSettings({ theme: "dark" }).theme).toBe("dark");
    expect(normalizeSettings({ theme: "sepia" }).theme).toBe("system");
  });

  it("取整到整数：滑块只应该给出整数值", () => {
    expect(normalizeSettings({ fontSize: 16.7 }).fontSize).toBe(17);
  });
});

describe("读写设置", () => {
  it("没存过 → 默认值", () => {
    expect(loadSettings(memoryStorage())).toEqual(DEFAULT_SETTINGS);
  });

  it("老版本的 vellink-theme 会迁移成显式选择，不被「跟随系统」覆盖", () => {
    const store = memoryStorage({ "vellink-theme": "dark" });
    expect(loadSettings(store).theme).toBe("dark");
  });

  it("存过设置就以设置为准，哪怕同时有老键", () => {
    const store = memoryStorage({
      "vellink-theme": "dark",
      "vellink-settings:v1": JSON.stringify({ theme: "light", fontSize: 20 }),
    });
    const loaded = loadSettings(store);
    expect(loaded.theme).toBe("light");
    expect(loaded.fontSize).toBe(20);
  });

  it("坏 JSON 当作没存过，而不是让应用起不来", () => {
    const store = memoryStorage({ "vellink-settings:v1": "{not json" });
    expect(loadSettings(store)).toEqual(DEFAULT_SETTINGS);
  });

  it("写入时也走一遍校验，坏值不会落进 storage", () => {
    const store = memoryStorage();
    saveSettings({ ...DEFAULT_SETTINGS, fontSize: 500 }, store);
    const raw = JSON.parse(store.getItem("vellink-settings:v1") ?? "{}");
    expect(raw.fontSize).toBe(LIMITS.fontSize.max);
  });
});

describe("主题解析", () => {
  it("跟随系统时看系统，固定时忽略系统", () => {
    expect(resolveTheme("system", true)).toBe("dark");
    expect(resolveTheme("system", false)).toBe("light");
    expect(resolveTheme("light", true)).toBe("light");
    expect(resolveTheme("dark", false)).toBe("dark");
  });
});

describe("落地到样式", () => {
  it("把字号与栏宽写成 CSS 变量", () => {
    const written: Record<string, string> = {};
    const root = {
      style: { setProperty: (name: string, value: string) => void (written[name] = value) },
    } as unknown as HTMLElement;
    applySettings({ ...DEFAULT_SETTINGS, fontSize: 18, lineWidth: 640 }, root);
    expect(written["--doc-font"]).toBe("18px");
    expect(written["--doc-width"]).toBe("640px");
  });

  it("毫秒换算成一位小数的秒", () => {
    expect(secondsOf(300)).toBe("0.3");
    expect(secondsOf(700)).toBe("0.7");
    expect(secondsOf(3000)).toBe("3.0");
  });

  it("「恢复默认」的禁用条件只认完整相等", () => {
    expect(isDefaultSettings({ ...DEFAULT_SETTINGS })).toBe(true);
    expect(isDefaultSettings({ ...DEFAULT_SETTINGS, theme: "dark" })).toBe(false);
  });
});


describe("写作模式偏好", () => {
  it("布尔字段只认 true，坏值回落 false", () => {
    expect(normalizeSettings({ typewriter: true, focusLines: true }).typewriter).toBe(true);
    expect(normalizeSettings({ typewriter: true, focusLines: true }).focusLines).toBe(true);
    expect(normalizeSettings({ typewriter: "true", focusLines: 1 }).typewriter).toBe(false);
    expect(normalizeSettings({ typewriter: "true", focusLines: 1 }).focusLines).toBe(false);
  });

  it("缺省值不开启这两种模式", () => {
    const s = normalizeSettings({});
    expect(s.typewriter).toBe(false);
    expect(s.focusLines).toBe(false);
  });
});
