import { describe, expect, it } from "vitest";
import { createRegistry } from "../command/registry";
import { EventBus } from "../event/bus";
import { parseMarkdown } from "../parser/markdown";
import { DocumentStore } from "../store";
import { validateManifest, type PluginManifest } from "./manifest";
import { createMemoryStorage, PluginRuntime, type PluginModule } from "./runtime";

function setup(appVersion = "0.1.0") {
  const registry = createRegistry();
  const eventBus = new EventBus();
  const store = new DocumentStore(
    parseMarkdown({ source: "# Hello\n\nworld" }).ir,
    registry,
    eventBus,
  );
  const notified: string[] = [];
  const runtime = new PluginRuntime({
    appVersion,
    commandRegistry: registry,
    eventBus,
    getStore: () => store,
    notify: (message) => notified.push(message),
    storage: createMemoryStorage(),
  });
  return { runtime, registry, eventBus, store, notified };
}

function manifest(overrides: Record<string, unknown> = {}): PluginManifest {
  return validateManifest({
    id: "demo",
    name: "Demo",
    version: "1.0.0",
    entry: "index.ts",
    permissions: ["storage", "documents:read"],
    contributes: { commands: [{ command: "demo.report", title: "Report" }] },
    ...overrides,
  });
}

const moduleWith = (overrides: Partial<PluginModule> = {}): PluginModule => ({
  activate: () => undefined,
  commands: {
    report: (ctx) => {
      ctx.notify(`chars=${ctx.documents.getDocument().source.length}`);
      return true;
    },
  },
  ...overrides,
});

describe("PluginRuntime installation and activation", () => {
  it("declarative commands are visible on install, first execution triggers lazy activation", async () => {
    const { runtime, registry, notified } = setup();
    let activations = 0;
    runtime.install(
      manifest(),
      moduleWith({
        activate: (ctx) => {
          activations++;
          ctx.storage.set("times", 1);
        },
      }),
    );

    expect(activations).toBe(0);
    expect(registry.get("demo.report")?.title).toBe("Report");
    expect(await runtime.runCommand("demo.report")).toMatchObject({ ok: true, notified: true });
    expect(activations).toBe(1);
    expect(runtime.get("demo")?.active).toBe(true);
    expect(notified[0]).toMatch(/^chars=\d+$/);
    expect(runtime.contribution("commands", "demo.report")?.value).toMatchObject({
      command: "demo.report",
    });
  });

  it("onStartup plugins activate automatically at startup", async () => {
    const { runtime } = setup();
    let activated = false;
    runtime.install(
      manifest({ activationEvents: ["onStartup"] }),
      moduleWith({
        activate: () => {
          activated = true;
        },
      }),
    );
    expect(activated).toBe(false);
    await runtime.activateStartup();
    expect(activated).toBe(true);
  });

  it("all six contribution kinds are registered and can be cleaned up by owner", () => {
    const { runtime } = setup();
    runtime.install(
      manifest({
        contributes: {
          commands: [{ command: "demo.report", title: "Report" }],
          menus: [{ location: "commandPalette", commands: ["demo.report"] }],
          views: [{ id: "demo.panel", title: "Panel", location: "rightDrawer" }],
          blockRenderers: [{ type: "callout" }],
          syntax: [{ id: "demo.lang" }],
          providers: [{ kind: "ai", id: "demo.ai" }],
        },
      }),
      moduleWith(),
    );
    expect(runtime.listContributions("commands")).toHaveLength(1);
    expect(runtime.listContributions("menus")).toHaveLength(1);
    expect(runtime.listContributions("views")).toHaveLength(1);
    expect(runtime.listContributions("blockRenderers")).toHaveLength(1);
    expect(runtime.listContributions("syntax")).toHaveLength(1);
    expect(runtime.listContributions("providers")).toHaveLength(1);
  });

  it("incompatible versions, duplicate installs and missing command implementations are rejected at install time", () => {
    const { runtime } = setup();
    expect(() =>
      runtime.install(manifest({ engines: { vellink: "^9.0.0" } }), moduleWith()),
    ).toThrow(/requires Vellink/);
    expect(() =>
      runtime.install(manifest({ contributes: { commands: [{ command: "demo.report", title: "R" }] } }), {}),
    ).toThrow(/implementation missing/);
    runtime.install(manifest(), moduleWith());
    expect(() => runtime.install(manifest(), moduleWith())).toThrow(/already installed/);
  });
});

describe("PluginRuntime lifecycle and isolation", () => {
  it("deactivation releases activation-time registrations; uninstall clears commands and all contributions", async () => {
    const { runtime, registry, store, eventBus } = setup();
    let events = 0;
    let cleanup = 0;
    const loaded: string[] = [];
    const unloaded: string[] = [];
    eventBus.on("plugin:loaded", (e) => loaded.push(e.id));
    eventBus.on("plugin:unloaded", (e) => unloaded.push(e.id));

    runtime.install(
      manifest(),
      moduleWith({
        activate: (ctx) => {
          ctx.commands.register("ping", "Ping", () => true);
          ctx.events.on("document:changed", () => events++);
          ctx.subscriptions.push(() => cleanup++);
        },
        deactivate: () => undefined,
      }),
    );
    await runtime.activate("demo");
    expect(registry.get("demo.ping")).toBeDefined();
    store.apply([{ type: "updateSource", source: "changed" }]);
    expect(events).toBe(1);

    await runtime.deactivate("demo");
    expect(registry.get("demo.ping")).toBeUndefined();
    expect(cleanup).toBe(1);
    store.apply([{ type: "updateSource", source: "again" }]);
    expect(events).toBe(1); // The event subscription has been released

    await runtime.uninstall("demo");
    expect(registry.get("demo.report")).toBeUndefined();
    expect(runtime.list()).toHaveLength(0);
    expect(runtime.listContributions("commands")).toHaveLength(0);
    expect(loaded).toEqual(["demo"]);
    expect(unloaded).toEqual(["demo"]);
  });

  it("failed activation rolls back registrations and marks commands unavailable", async () => {
    const { runtime, registry, notified } = setup();
    runtime.install(
      manifest(),
      moduleWith({
        activate: (ctx) => {
          ctx.commands.register("half", "Half-registered", () => true);
          throw new Error("boom");
        },
      }),
    );
    expect(await runtime.activate("demo")).toBe(false);
    expect(registry.get("demo.half")).toBeUndefined();
    expect(runtime.get("demo")?.error).toContain("boom");
    expect(registry.get("demo.report")?.enabled?.()).toBe(false);
    expect(notified[0]).toContain("激活失败");
  });

  it("permissions are a real gate: a plugin without storage permission fails to access storage", async () => {
    const { runtime, notified } = setup();
    runtime.install(
      manifest({ permissions: ["documents:read"] }),
      moduleWith({
        commands: {
          report: (ctx) => {
            ctx.storage.get("secret");
            return true;
          },
        },
      }),
    );
    expect((await runtime.runCommand("demo.report")).ok).toBe(false);
    expect(notified[0]).toContain("lacks permission: storage");
  });

  it("private storage is isolated per plugin id and supports all/delete/clear", () => {
    const storage = createMemoryStorage();
    storage.set("a", "key", 1);
    storage.set("b", "key", 2);
    expect(storage.get("a", "key")).toBe(1);
    expect(storage.all("b")).toEqual({ key: 2 });
    storage.delete("a", "key");
    expect(storage.get("a", "key")).toBeUndefined();
    storage.clear("b");
    expect(storage.all("b")).toEqual({});
  });

  it("deactivation keeps the installed state; re-enabling allows activation again", async () => {
    const { runtime, registry } = setup();
    let activations = 0;
    runtime.install(
      manifest({ activationEvents: ["onStartup"] }),
      moduleWith({
        activate: () => {
          activations++;
        },
      }),
    );
    await runtime.activateStartup();
    await runtime.setEnabled("demo", false);
    expect(runtime.get("demo")?.active).toBe(false);
    expect(registry.get("demo.report")?.enabled?.()).toBe(false);
    await runtime.setEnabled("demo", true);
    expect(runtime.get("demo")?.active).toBe(true);
    expect(activations).toBe(2);
  });

  it("dispose clears all registrations synchronously; StrictMode double-mount won't collide on duplicate ids", () => {
    const { runtime, registry } = setup();
    runtime.install(manifest(), moduleWith());
    runtime.dispose();
    expect(registry.get("demo.report")).toBeUndefined();
    expect(runtime.list()).toHaveLength(0);
    expect(runtime.listContributions("commands")).toHaveLength(0);
  });
});
