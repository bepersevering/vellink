import { describe, expect, it } from "vitest";
import { PluginManifestError, satisfiesVersion, validateManifest } from "./manifest";

const minimal = () => ({
  id: "demo",
  name: "Demo",
  version: "1.0.0",
  entry: "index.ts",
});

describe("validateManifest", () => {
  it("accepts a minimal manifest and normalizes optional fields", () => {
    const manifest = validateManifest(minimal());
    expect(manifest).toEqual(minimal());
    expect(manifest.activationEvents).toBeUndefined();
    expect(manifest.contributes).toBeUndefined();
  });

  it("rejects invalid id / version / name", () => {
    expect(() => validateManifest({ ...minimal(), id: "Demo" })).toThrow(PluginManifestError);
    expect(() => validateManifest({ ...minimal(), id: "a" })).toThrow(/length 2-64/);
    expect(() => validateManifest({ ...minimal(), version: "1.0" })).toThrow(/semantic version/);
    expect(() => validateManifest({ ...minimal(), name: "  " })).toThrow(/non-empty/);
  });

  it("rejects path traversal, absolute paths and remote entries", () => {
    for (const entry of ["../evil/index.ts", "/tmp/a.js", "https://evil.test/a.js", ""])
      expect(() => validateManifest({ ...minimal(), entry })).toThrow(PluginManifestError);
  });

  it("validates activationEvents and permissions allowlists", () => {
    expect(
      validateManifest({
        ...minimal(),
        activationEvents: ["onStartup", "onCommand:demo.ping", "onView:demo.panel"],
        permissions: ["storage", "documents:read"],
      }).permissions,
    ).toEqual(["storage", "documents:read"]);
    expect(() =>
      validateManifest({ ...minimal(), activationEvents: ["onClick:anything"] }),
    ).toThrow(/unrecognized activation event/);
    expect(() => validateManifest({ ...minimal(), permissions: ["root"] })).toThrow(/unknown permission/);
  });

  it("requires commands, views, syntax and providers to use the plugin namespace", () => {
    expect(() =>
      validateManifest({
        ...minimal(),
        contributes: { commands: [{ command: "other.ping", title: "Ping" }] },
      }),
    ).toThrow(/plugin namespace/);
    expect(
      validateManifest({
        ...minimal(),
        contributes: {
          commands: [{ command: "demo.ping", title: "Ping", keybinding: "Mod+K" }],
          views: [{ id: "demo.panel", title: "Panel", location: "rightDrawer" }],
          syntax: [{ id: "demo.lang", extensions: [".demo"] }],
          providers: [{ kind: "ai", id: "demo.ai" }],
        },
      }).contributes?.views?.[0].id,
    ).toBe("demo.panel");
  });

  it("rejects unknown menu locations, view locations and provider kinds", () => {
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
    ).toThrow(/unknown provider type/);
  });

  it("validates engines range syntax", () => {
    expect(() =>
      validateManifest({ ...minimal(), engines: { vellink: "totally-wrong" } }),
    ).toThrow(/unrecognized version range/);
  });
});

describe("satisfiesVersion", () => {
  it("supports ^ / ~ / >= / exact versions and AND ranges", () => {
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
