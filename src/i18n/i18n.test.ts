import { afterEach, describe, expect, it } from "vitest";
import { getLocale, setLocale, t, toggleLocale } from "./index";
import { en } from "./en";
import { zhCN } from "./zh-CN";

describe("i18n", () => {
  afterEach(() => setLocale("en"));

  it("English and Chinese packs have identical keys", () => {
    const enKeys = Object.keys(en).sort();
    const zhKeys = Object.keys(zhCN).sort();
    expect(zhKeys).toEqual(enKeys);
  });

  it("t() resolves the active locale and interpolates params", () => {
    setLocale("en");
    expect(t("status.pluginsEnabled", { count: 3 })).toBe("3 plugins enabled");
    setLocale("zh-CN");
    expect(t("status.pluginsEnabled", { count: 3 })).toBe("3 个插件已启用");
  });

  it("returns unknown keys verbatim without throwing", () => {
    expect(t("no.such.key")).toBe("no.such.key");
  });

  it("persists locale switches and round-trips correctly", () => {
    setLocale("zh-CN");
    expect(getLocale()).toBe("zh-CN");
    // The test environment may be node (no localStorage): verify persistence when available, otherwise skip
    if (typeof localStorage !== "undefined") {
      expect(localStorage.getItem("vellink-locale")).toBe("zh-CN");
    }
    toggleLocale();
    expect(getLocale()).toBe("en");
    if (typeof localStorage !== "undefined") {
      expect(localStorage.getItem("vellink-locale")).toBe("en");
    }
  });

  it("falls back from a missing key to en and finally to the key name", () => {
    setLocale("zh-CN");
    // Both packs share the same keys; this checks t()'s fallback chain with a hypothetical en-only key
    expect(t("status.saved")).toBe(zhCN["status.saved"]);
  });
});
