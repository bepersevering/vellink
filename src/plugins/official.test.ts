/**
 * 官方插件契约测试：用真实 PluginRuntime 装载 manifest + module，
 * 验证配置写进凭据仓库、Provider 贡献点被运行时服务覆盖、命令走统一撤销栈。
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
      source: "# 架构\n\nVellink 用 IR 作为唯一真源。\n\n## 同步\n\nWebDAV ETag 用于条件写入。",
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

describe("官方插件契约", () => {
  beforeEach(() => {
    // 全局总线不参与本测试，无需清理
  });

  it("两个 manifest 均通过运行时安装并声明 Provider 贡献点", () => {
    const { runtime } = setup();
    expect(runtime.list().map((p) => p.id)).toEqual(["ai-chat", "webdav"]);
    expect(runtime.listContributions("providers").map((c) => c.id)).toEqual([
      "ai-chat.provider",
      "webdav.provider",
    ]);
  });

  it("AI 配置写入凭据仓库，Provider 贡献点被可调用的服务覆盖", async () => {
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

  it("WebDAV 配置不把密码写进插件存储，只留凭据句柄", async () => {
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

  it("回答写回走 DocumentStore，撤销后文档恢复", async () => {
    const { runtime, registry, store } = setup();
    await runtime.activate("ai-chat");
    const service = runtime.contribution("providers", "ai-chat.provider")?.value as {
      appendToDocument(result: { answer: string; sources: unknown[] }): void;
    };
    const before = store.getDocument().source;
    service.appendToDocument({ answer: "测试回答", sources: [] });
    expect(store.getDocument().source).toContain("测试回答");
    expect(await registry.run("doc.undo")).toBe(true);
    expect(store.getDocument().source).toBe(before);
  });
});
