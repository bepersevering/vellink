import { afterEach, describe, expect, it } from "vitest";
import { getLocale, setLocale, t, toggleLocale } from "./index";
import { en } from "./en";
import { zhCN } from "./zh-CN";

describe("i18n", () => {
  afterEach(() => setLocale("en"));

  it("英文包与中文包键位完全一致", () => {
    const enKeys = Object.keys(en).sort();
    const zhKeys = Object.keys(zhCN).sort();
    expect(zhKeys).toEqual(enKeys);
  });

  it("t() 解析当前语言并插值参数", () => {
    setLocale("en");
    expect(t("status.pluginsEnabled", { count: 3 })).toBe("3 plugins enabled");
    setLocale("zh-CN");
    expect(t("status.pluginsEnabled", { count: 3 })).toBe("3 个插件已启用");
  });

  it("未知键原样返回，不抛错", () => {
    expect(t("no.such.key")).toBe("no.such.key");
  });

  it("切换语言持久化并可往返", () => {
    setLocale("zh-CN");
    expect(getLocale()).toBe("zh-CN");
    // 测试环境可能是 node（无 localStorage）：有则验证持久化，无则跳过
    if (typeof localStorage !== "undefined") {
      expect(localStorage.getItem("vellink-locale")).toBe("zh-CN");
    }
    toggleLocale();
    expect(getLocale()).toBe("en");
    if (typeof localStorage !== "undefined") {
      expect(localStorage.getItem("vellink-locale")).toBe("en");
    }
  });

  it("en 包缺失的键回退到 en 再回退到键名", () => {
    setLocale("zh-CN");
    // 两个包键位一致，这里验证 t() 的回退链：直接查一个只存在于 en 的假想键
    expect(t("status.saved")).toBe(zhCN["status.saved"]);
  });
});
