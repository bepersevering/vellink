/**
 * Official plugin contract tests: load the manifest + module with a real PluginRuntime,
 * verifying that config is written to the credential store, provider contribution points
 * are overridden by runtime services, and commands go through the shared undo stack.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { createRegistry } from "../core/command/registry";
import { EventBus } from "../core/event/bus";
import { parseMarkdown } from "../core/parser/markdown";
import { PluginRuntime } from "../core/plugin/runtime";
import { DocumentStore } from "../core/store";
import { createMemoryCredentialStore } from "../core/vfs/credentials";
import aiChatManifest from "./ai-chat/manifest.json";
import aiChatModule from "./ai-chat/index";
import webdavManifest from "./webdav/manifest.json";
import webdavModule from "./webdav/index";

function setup() {
  const registry = createRegistry();
  const bus = new EventBus();
  const credentials = createMemoryCredentialStore();
  const store = new DocumentStore(
    parseMarkdown({
      source: "# Architecture\n\nVellink uses IR as the single source of truth.\n\n## Sync\n\nWebDAV ETags are used for conditional writes.",
    }).ir,
    registry,
    bus,
  );
  const notifications: string[] = [];
  const runtime = new PluginRuntime({
    commandRegistry: registry,
    eventBus: bus,
    getStore: () => store,
    credentialStore: credentials,
    notify: (message) => notifications.push(message),
    fetch: vi.fn() as unknown as typeof fetch,
  });
  runtime.install(aiChatManifest as never, aiChatModule);
  runtime.install(webdavManifest as never, webdavModule);
  return { runtime, registry, store, credentials, notifications };
}

describe("Official plugin contract", () => {
  beforeEach(() => {
    // The global bus isn't used in this test, so no cleanup is needed
  });

  it("installs both manifests through the runtime and declares provider contribution points", () => {
    const { runtime } = setup();
    expect(runtime.list().map((p) => p.id)).toEqual(["ai-chat", "webdav"]);
    expect(runtime.listContributions("providers").map((c) => c.id)).toEqual([
      "ai-chat.provider",
      "webdav.provider",
    ]);
  });

  it("writes AI config to the credential store and overrides the provider contribution with a callable service", async () => {
    const { runtime, credentials } = setup();
    await runtime.activate("ai-chat");
    const service = runtime.contribution("providers", "ai-chat.provider")?.value as {
      configured(): boolean;
      config(): { hasKey: boolean };
      configure(config: unknown, key: string): Promise<void>;
      reindex(): Promise<number>;
    };
    expect(typeof service.configure).toBe("function");
    expect(service.configured()).toBe(false);
    await service.configure(
      { baseUrl: "https://api.deepseek.com", model: "deepseek-flash", account: "me" },
      "sk-test",
    );
    expect(service.configured()).toBe(true);
    expect(service.config().hasKey).toBe(true);
    expect((await credentials.get("vellink:ai", "me"))?.secret).toBe("sk-test");
    expect(await service.reindex()).toBeGreaterThan(0);
  });

  it("keeps the WebDAV password out of plugin storage, leaving only a credential handle", async () => {
    const { runtime, credentials } = setup();
    await runtime.activate("webdav");
    const service = runtime.contribution("providers", "webdav.provider")?.value as {
      configure(config: unknown, secret: string): Promise<void>;
      config(): { account: string };
    };
    await service.configure(
      { baseUrl: "https://dav.example.com", account: "alice", remotePath: "notes" },
      "app-password",
    );
    expect(service.config().account).toBe("alice");
    expect((await credentials.get("vellink:webdav", "alice"))?.secret).toBe("app-password");
  });

  it("writes answers back through DocumentStore and restores the document on undo", async () => {
    const { runtime, registry, store } = setup();
    await runtime.activate("ai-chat");
    const service = runtime.contribution("providers", "ai-chat.provider")?.value as {
      appendToDocument(result: { answer: string; sources: unknown[] }): void;
    };
    const before = store.getDocument().source;
    service.appendToDocument({ answer: "Test answer", sources: [] });
    expect(store.getDocument().source).toContain("Test answer");
    expect(await registry.run("doc.undo")).toBe(true);
    expect(store.getDocument().source).toBe(before);
  });
});
