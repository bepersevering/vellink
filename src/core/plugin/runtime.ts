/**
 * 插件运行时 — manifest 校验通过后，负责生命周期、贡献点与 API 门控。
 *
 * 边界：本模块不碰 import()/文件路径，模块解析由 loader 层注入。
 * 这样核心运行时可在 Node 单测里直接跑，也方便未来换 Worker 宿主。
 */

import type { DocumentIR } from "../ir/types";
import type { ApplyOptions, Op } from "../transaction/types";
import type { DocumentStore } from "../store";
import { commands as globalCommands, type CommandRegistry } from "../command/registry";
import { bus as globalBus, type AppEvent, type EventBus } from "../event/bus";
import { satisfiesVersion, type ManifestCommand, type PluginManifest, type PluginPermission } from "./manifest";
import type { Credential, CredentialStore } from "../vfs/credentials";
import { ContributionRegistry, type Contribution, type ContributionKind } from "./contributions";

export interface PluginModule {
  /** 插件激活；返回值忽略，所有注册请放进 context.subscriptions。 */
  activate?: (context: PluginContext) => void | Promise<void>;
  deactivate?: () => void | Promise<void>;
  /** 声明式命令的实现，key 为去掉插件命名空间后的短名。 */
  commands?: Record<string, (context: PluginContext) => unknown | Promise<unknown>>;
}

export interface PluginStorage {
  get(pluginId: string, key: string): unknown | undefined;
  set(pluginId: string, key: string, value: unknown): void;
  delete(pluginId: string, key: string): void;
  all(pluginId: string): Record<string, unknown>;
  clear(pluginId: string): void;
}

export function createMemoryStorage(): PluginStorage {
  const data = new Map<string, Map<string, unknown>>();
  const bucket = (pluginId: string) => {
    let b = data.get(pluginId);
    if (!b) {
      b = new Map();
      data.set(pluginId, b);
    }
    return b;
  };
  return {
    get: (pluginId, key) => bucket(pluginId).get(key),
    set: (pluginId, key, value) => void bucket(pluginId).set(key, value),
    delete: (pluginId, key) => void bucket(pluginId).delete(key),
    all: (pluginId) => Object.fromEntries(bucket(pluginId)),
    clear: (pluginId) => void data.delete(pluginId),
  };
}

export interface PluginContext {
  readonly pluginId: string;
  readonly manifest: PluginManifest;
  /** 插件注册的任何可释放资源放这里，deactivate 时逆序执行。 */
  readonly subscriptions: Array<() => void>;
  onDeactivate(fn: () => void): void;
  log(...args: unknown[]): void;
  notify(message: string): void;
  hasPermission(permission: PluginPermission): boolean;
  commands: {
    register(id: string, title: string, run: () => unknown | Promise<unknown>, keybinding?: string): () => void;
    run(id: string): Promise<boolean>;
  };
  events: {
    on<T extends AppEvent["type"]>(
      type: T,
      handler: (event: Extract<AppEvent, { type: T }>) => void,
    ): () => void;
    emit<E extends AppEvent>(event: E): void;
  };
  /** 需要 storage 权限。 */
  storage: {
    get<T = unknown>(key: string): T | undefined;
    set(key: string, value: unknown): void;
    delete(key: string): void;
    all(): Record<string, unknown>;
  };
  /** getDocument 需要 documents:read；apply 需要 documents:write。 */
  documents: {
    getDocument(): DocumentIR;
    apply(ops: Op[], options?: ApplyOptions): void;
  };
  /** 需要 credentials 权限；插件只传 service/account，不接触明文存储实现。 */
  credentials: {
    get(service: string, account: string): Promise<Credential | undefined>;
    set(service: string, account: string, credential: Credential): Promise<void>;
    delete(service: string, account: string): Promise<void>;
  };
  /** 需要 network 权限；走宿主 fetch，便于审计与替换 HTTP 栈。 */
  net: {
    fetch(input: RequestInfo | URL, init?: RequestInit): Promise<Response>;
  };
  contributions: {
    register<T>(kind: ContributionKind, id: string, value: T): () => void;
  };
}

export interface PluginSummary {
  id: string;
  name: string;
  version: string;
  description?: string;
  enabled: boolean;
  active: boolean;
  error?: string;
  commands: ManifestCommand[];
  views: Array<{ id: string; title: string; location: string }>;
}

interface PluginRecord {
  manifest: PluginManifest;
  module: PluginModule;
  context: PluginContext;
  enabled: boolean;
  active: boolean;
  error?: string;
  /** 安装期资源（命令代理、贡献点）：只有 uninstall 才释放。 */
  installDisposers: Array<() => void>;
  /** 激活期资源：deactivate 就释放，再次激活可重建。 */
  runtimeDisposers: Array<() => void>;
}

export interface PluginRuntimeOptions {
  appVersion?: string;
  commandRegistry?: CommandRegistry;
  eventBus?: EventBus;
  getStore?: () => DocumentStore | null;
  notify?: (message: string) => void;
  storage?: PluginStorage;
  credentialStore?: CredentialStore;
  fetch?: typeof fetch;
}

export class PluginRuntime {
  private records = new Map<string, PluginRecord>();
  private readonly appVersion: string;
  private readonly commandRegistry: CommandRegistry;
  private readonly eventBus: EventBus;
  private readonly getStore: () => DocumentStore | null;
  private readonly notify: (message: string) => void;
  private readonly storage: PluginStorage;
  private readonly credentialStore: CredentialStore;
  private readonly fetchImpl: typeof fetch;
  private notificationCount = 0;
  readonly contributions = new ContributionRegistry();

  constructor(options: PluginRuntimeOptions = {}) {
    this.appVersion = options.appVersion ?? "0.1.0";
    this.commandRegistry = options.commandRegistry ?? globalCommands;
    this.eventBus = options.eventBus ?? globalBus;
    this.getStore = options.getStore ?? (() => null);
    const userNotify = options.notify ?? (() => undefined);
    this.notify = (message) => {
      this.notificationCount++;
      userNotify(message);
    };
    this.storage = options.storage ?? createMemoryStorage();
    this.credentialStore = options.credentialStore ?? {
      async get() {
        return undefined;
      },
      async set() {
        throw new Error("CredentialStore 未配置");
      },
      async delete() {
        throw new Error("CredentialStore 未配置");
      },
    };
    this.fetchImpl = options.fetch ?? fetch;
  }

  /**
   * 安装插件：校验过的 manifest + 已解析的 ESM 模块。
   * 声明式命令在这时就注册代理（点击时才激活插件），保证命令面板能搜到。
   */
  install(manifest: PluginManifest, module: PluginModule, enabled = true): PluginSummary {
    if (this.records.has(manifest.id))
      throw new Error(`Plugin already installed: ${manifest.id}`);

    const incompatible = manifest.engines?.vellink;
    if (incompatible && !satisfiesVersion(this.appVersion, incompatible))
      throw new Error(
        `Plugin ${manifest.id} requires Vellink ${incompatible}, current ${this.appVersion}`,
      );

    const record: PluginRecord = {
      manifest,
      module,
      context: undefined as unknown as PluginContext,
      enabled,
      active: false,
      installDisposers: [],
      runtimeDisposers: [],
    };
    record.context = this.createContext(record);
    this.records.set(manifest.id, record);

    try {
      for (const cmd of manifest.contributes?.commands ?? []) {
        const short = cmd.command.slice(manifest.id.length + 1);
        const handler = module.commands?.[short];
        if (!handler)
          throw new Error(`Command implementation missing: ${cmd.command} (export commands.${short})`);
        record.installDisposers.push(
          this.commandRegistry.register({
            id: cmd.command,
            title: cmd.title,
            keybinding: cmd.keybinding,
            enabled: () => record.enabled && !record.error,
            run: async () => {
              try {
                await this.activate(manifest.id, `onCommand:${cmd.command}`);
                const result = await handler(record.context);
                return result === false ? false : true;
              } catch (error) {
                this.notify(`插件 ${manifest.name} 执行失败：${messageOf(error)}`);
                return false;
              }
            },
          }),
        );
        record.installDisposers.push(
          this.contributions.register(manifest.id, "commands", cmd.command, cmd),
        );
      }

      const contributes = manifest.contributes;
      if (contributes?.menus)
        record.installDisposers.push(
          this.contributions.register(manifest.id, "menus", `${manifest.id}.menus`, contributes.menus),
        );
      for (const view of contributes?.views ?? [])
        record.installDisposers.push(
          this.contributions.register(manifest.id, "views", view.id, view),
        );
      for (const renderer of contributes?.blockRenderers ?? [])
        record.installDisposers.push(
          this.contributions.register(manifest.id, "blockRenderers", renderer.type, renderer),
        );
      for (const syntax of contributes?.syntax ?? [])
        record.installDisposers.push(
          this.contributions.register(manifest.id, "syntax", syntax.id, syntax),
        );
      for (const provider of contributes?.providers ?? [])
        record.installDisposers.push(
          this.contributions.register(manifest.id, "providers", provider.id, provider),
        );
    } catch (error) {
      this.rollback(record.installDisposers);
      this.records.delete(manifest.id);
      throw error;
    }

    this.eventBus.emit({ type: "plugin:loaded", id: manifest.id });
    return this.summarize(record);
  }

  /** 启动阶段批量激活声明了 onStartup 的插件；单个失败不影响其余。 */
  async activateStartup(): Promise<void> {
    for (const record of this.records.values()) {
      if (
        record.enabled &&
        !record.active &&
        record.manifest.activationEvents?.includes("onStartup")
      ) {
        await this.activate(record.manifest.id, "onStartup");
      }
    }
  }

  async activate(id: string, reason = "manual"): Promise<boolean> {
    const record = this.records.get(id);
    if (!record) throw new Error(`Plugin not installed: ${id}`);
    if (record.active) return true;
    if (!record.enabled) throw new Error(`Plugin disabled: ${id}`);

    const before = record.runtimeDisposers.length;
    try {
      await record.module.activate?.(record.context);
      record.active = true;
      record.error = undefined;
      void reason; // 预留给 onView/onLanguage 的条件激活日志
      return true;
    } catch (error) {
      const added = record.runtimeDisposers.splice(before);
      this.rollback(added);
      record.error = messageOf(error);
      this.notify(`插件 ${record.manifest.name} 激活失败：${record.error}`);
      return false;
    }
  }

  async deactivate(id: string): Promise<void> {
    const record = this.records.get(id);
    if (!record?.active) return;
    record.active = false;
    try {
      await record.module.deactivate?.();
    } catch (error) {
      this.notify(`插件 ${record.manifest.name} 停用异常：${messageOf(error)}`);
    }
    this.rollback(record.runtimeDisposers);
    record.runtimeDisposers = [];
    this.eventBus.emit({ type: "plugin:unloaded", id });
  }

  /** 用户开关：停用保留安装态（命令仍可见但不可执行），启用后可重新激活。 */
  async setEnabled(id: string, enabled: boolean): Promise<void> {
    const record = this.records.get(id);
    if (!record) return;
    if (!enabled) await this.deactivate(id);
    record.enabled = enabled;
    record.error = undefined;
    if (enabled && record.manifest.activationEvents?.includes("onStartup"))
      await this.activate(id, "onStartup");
  }

  async uninstall(id: string): Promise<void> {
    const record = this.records.get(id);
    if (!record) return;
    await this.deactivate(id);
    this.rollback(record.installDisposers);
    this.contributions.removePlugin(id);
    this.storage.clear(id);
    this.records.delete(id);
  }

  /**
   * 命令面板统一入口：未激活插件的声明式命令代理会在这里触发激活。
   * notified 告诉调用方插件已自行反馈，避免宿主再弹一个通用 toast 覆盖它。
   */
  async runCommand(id: string): Promise<{ ok: boolean; notified: boolean }> {
    const before = this.notificationCount;
    const ok = await this.commandRegistry.run(id);
    return { ok, notified: this.notificationCount > before };
  }

  list(): PluginSummary[] {
    return [...this.records.values()].map((record) => this.summarize(record));
  }

  get(id: string): PluginSummary | undefined {
    const record = this.records.get(id);
    return record ? this.summarize(record) : undefined;
  }

  contribution<T>(kind: ContributionKind, id: string): Contribution<T> | undefined {
    return this.contributions.find<T>(kind, id);
  }

  listContributions<T>(kind: ContributionKind): Array<Contribution<T>> {
    return this.contributions.list<T>(kind);
  }

  /** StrictMode 重复挂载时同步清干净，避免命令重复注册崩溃。 */
  dispose(): void {
    for (const record of this.records.values()) {
      this.rollback(record.runtimeDisposers);
      this.rollback(record.installDisposers);
      this.storage.clear(record.manifest.id);
    }
    this.records.clear();
    this.contributions.clear();
  }

  private summarize(record: PluginRecord): PluginSummary {
    return {
      id: record.manifest.id,
      name: record.manifest.name,
      version: record.manifest.version,
      description: record.manifest.description,
      enabled: record.enabled && !record.error,
      active: record.active,
      error: record.error,
      commands: record.manifest.contributes?.commands ?? [],
      views: (record.manifest.contributes?.views ?? []).map((v) => ({
        id: v.id,
        title: v.title,
        location: v.location,
      })),
    };
  }

  private rollback(disposers: Array<() => void>): void {
    for (const dispose of [...disposers].reverse()) {
      try {
        dispose();
      } catch {
        // 清理阶段不抛错，避免掩盖原始失败
      }
    }
  }

  private require(record: PluginRecord, permission: PluginPermission): void {
    if (!(record.manifest.permissions ?? []).includes(permission))
      throw new Error(`Plugin ${record.manifest.id} lacks permission: ${permission}`);
  }

  private createContext(record: PluginRecord): PluginContext {
    const self = this;
    const pluginId = record.manifest.id;
    const track = (dispose: () => void) => {
      record.runtimeDisposers.push(dispose);
      return dispose;
    };

    const context: PluginContext = {
      pluginId,
      manifest: record.manifest,
      subscriptions: record.runtimeDisposers,
      onDeactivate: (fn) => void track(fn),
      log: (...args) => console.info(`[plugin:${pluginId}]`, ...args),
      notify: (message) => self.notify(message),
      hasPermission: (permission) => (record.manifest.permissions ?? []).includes(permission),

      commands: {
        register(id, title, run, keybinding) {
          const fullId = id.startsWith(`${pluginId}.`) ? id : `${pluginId}.${id}`;
          const disposeCommand = self.commandRegistry.register({
            id: fullId,
            title,
            keybinding,
            enabled: () => record.enabled && record.active,
            run: async () => {
              const result = await run();
              return result === false ? false : true;
            },
          });
          const disposeContribution = self.contributions.register(
            pluginId,
            "commands",
            fullId,
            { command: fullId, title },
          );
          return track(() => {
            disposeCommand();
            disposeContribution();
          });
        },
        run: (id) => self.commandRegistry.run(id),
      },

      events: {
        on: (type, handler) =>
          track(
            self.eventBus.on(
              type,
              handler as (event: Extract<AppEvent, { type: typeof type }>) => void,
            ),
          ),
        emit: (event) => self.eventBus.emit(event),
      },

      storage: {
        get: <T,>(key: string): T | undefined => {
          self.require(record, "storage");
          return self.storage.get(pluginId, key) as T | undefined;
        },
        set: (key, value) => {
          self.require(record, "storage");
          self.storage.set(pluginId, key, value);
        },
        delete: (key) => {
          self.require(record, "storage");
          self.storage.delete(pluginId, key);
        },
        all: () => {
          self.require(record, "storage");
          return self.storage.all(pluginId);
        },
      },

      documents: {
        getDocument: () => {
          self.require(record, "documents:read");
          const store = self.getStore();
          if (!store) throw new Error("DocumentStore is not ready");
          return store.getDocument();
        },
        apply: (ops: Op[], options?: ApplyOptions) => {
          self.require(record, "documents:write");
          const store = self.getStore();
          if (!store) throw new Error("DocumentStore is not ready");
          store.apply(ops, options);
        },
      },

      credentials: {
        get: (service, account) => {
          self.require(record, "credentials");
          return self.credentialStore.get(service, account);
        },
        set: (service, account, credential) => {
          self.require(record, "credentials");
          return self.credentialStore.set(service, account, credential);
        },
        delete: (service, account) => {
          self.require(record, "credentials");
          return self.credentialStore.delete(service, account);
        },
      },

      net: {
        fetch: (input, init) => {
          self.require(record, "network");
          return self.fetchImpl(input, init);
        },
      },

      contributions: {
        register: <T,>(kind: ContributionKind, id: string, value: T) => {
          const fullId = id.startsWith(`${pluginId}.`) ? id : `${pluginId}.${id}`;
          const dispose = self.contributions.register(pluginId, kind, fullId, value);
          return track(dispose);
        },
      },
    };

    return context;
  }
}

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
