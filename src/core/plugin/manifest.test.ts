import { describe, expect, it } from "vitest";
import { PluginManifestError, satisfiesVersion, validateManifest } from "./manifest";

const minimal = () => ({
  id: "demo",
  name: "Demo",
  version: "1.0.0",
  entry: "index.ts",
});

describe("validateManifest", () => {
  it("接受最小 manifest 并规范化可选字段", () => {
    const manifest = validateManifest(minimal());
    expect(manifest).toEqual(minimal());
    expect(manifest.activationEvents).toBeUndefined();
    expect(manifest.contributes).toBeUndefined();
  });

  it("拒绝非法 id / version / name", () => {
    expect(() => validateManifest({ ...minimal(), id: "Demo" })).toThrow(PluginManifestError);
    expect(() => validateManifest({ ...minimal(), id: "a" })).toThrow(/长度/);
    expect(() => validateManifest({ ...minimal(), version: "1.0" })).toThrow(/语义化/);
    expect(() => validateManifest({ ...minimal(), name: "  " })).toThrow(/非空/);
  });

  it("拒绝路径穿越、绝对路径与远程入口", () => {
    for (const entry of ["../evil/index.ts", "/tmp/a.js", "https://evil.test/a.js", ""])
      expect(() => validateManifest({ ...minimal(), entry })).toThrow(PluginManifestError);
  });

  it("校验 activationEvents 与 permissions 白名单", () => {
    expect(
      validateManifest({
        ...minimal(),
        activationEvents: ["onStartup", "onCommand:demo.ping", "onView:demo.panel"],
        permissions: ["storage", "documents:read"],
      }).permissions,
    ).toEqual(["storage", "documents:read"]);
    expect(() =>
      validateManifest({ ...minimal(), activationEvents: ["onClick:anything"] }),
    ).toThrow(/激活事件/);
    expect(() => validateManifest({ ...minimal(), permissions: ["root"] })).toThrow(/未知权限/);
  });

  it("强制命令、视图、语法、Provider 使用插件命名空间", () => {
    expect(() =>
      validateManifest({
        ...minimal(),
        contributes: { commands: [{ command: "other.ping", title: "Ping" }] },
      }),
    ).toThrow(/命名空间/);
    expect(
      validateManifest({
        ...minimal(),
        contributes: {
          commands: [{ command: "demo.ping", title: "Ping", keybinding: "Mod+K" }],
          views: [{ id: "demo.panel", title: "面板", location: "rightDrawer" }],
          syntax: [{ id: "demo.lang", extensions: [".demo"] }],
          providers: [{ kind: "ai", id: "demo.ai" }],
        },
      }).contributes?.views?.[0].id,
    ).toBe("demo.panel");
  });

  it("拒绝未知菜单位置、视图位置与 Provider 类型", () => {
    expect(() =>
      validateManifest({
        ...minimal(),
        contributes: { menus: [{ location: "nowhere", commands: ["demo.ping"] }] },
      }),
    ).toThrow(/location/);
    expect(() =>
      validateManifest({
        ...minimal(),
        contributes: { views: [{ id: "demo.p", title: "P", location: "floating" }] },
      }),
    ).toThrow(/location/);
    expect(() =>
      validateManifest({
        ...minimal(),
        contributes: { providers: [{ kind: "magic", id: "demo.magic" }] },
      }),
    ).toThrow(/Provider/);
  });

  it("校验 engines 范围语法", () => {
    expect(() =>
      validateManifest({ ...minimal(), engines: { vellink: "totally-wrong" } }),
    ).toThrow(/版本范围/);
  });
});

describe("satisfiesVersion", () => {
  it("支持 ^ / ~ / >= / 精确版本与 AND 组合", () => {
    expect(satisfiesVersion("0.1.3", "^0.1.0")).toBe(true);
    expect(satisfiesVersion("0.2.0", "^0.1.0")).toBe(false);
    expect(satisfiesVersion("1.4.0", "^1.2.3")).toBe(true);
    expect(satisfiesVersion("2.0.0", "~1.2.3")).toBe(false);
    expect(satisfiesVersion("1.2.9", "~1.2.3")).toBe(true);
    expect(satisfiesVersion("0.3.0", ">=0.1.0 <0.4.0")).toBe(true);
    expect(satisfiesVersion("0.4.0", ">=0.1.0 <0.4.0")).toBe(false);
    expect(satisfiesVersion("1.0.0", "1.0.0")).toBe(true);
    expect(satisfiesVersion("1.0.1", "1.0.0")).toBe(false);
    expect(satisfiesVersion("1.0.0-rc.1", ">=1.0.0")).toBe(false);
  });
});
