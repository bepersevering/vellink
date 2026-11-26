/**
 * 官方 WebDAV 插件 — 配置存插件私有 storage，凭据走 CredentialStore。
 * 对外暴露 VFS Provider 供宿主命令/UI 使用，插件本身不弹配置窗口。
 */
import type { PluginContext, PluginModule } from "../../core/plugin/runtime";
import { parseMarkdown } from "../../core/parser/markdown";
import { SyncEngine } from "../../core/sync/engine";
import { LocalVfs } from "../../core/vfs/local";
import { WebDavProvider } from "../../core/vfs/webdav";
import type { VfsProvider } from "../../core/vfs/types";

export interface WebDavConfig {
  baseUrl: string;
  account: string;
  remotePath?: string;
}

export interface WebDavService {
  id: "webdav.provider";
  configured(): boolean;
  config(): WebDavConfig | undefined;
  configure(config: WebDavConfig, secret: string): Promise<void>;
  provider(): VfsProvider | undefined;
  sync(): Promise<{ actions: Array<{ type: string; path: string }>; pending: number }>;
  remoteFiles(): Promise<Array<{ path: string; etag?: string }>>;
}

const SERVICE = "vellink:webdav";
const CONFIG_KEY = "config";

function createService(ctx: PluginContext): WebDavService {
  const local = new LocalVfs();
  let provider: WebDavProvider | undefined;
  let engine: SyncEngine | undefined;

  const readConfig = () => ctx.storage.get<WebDavConfig>(CONFIG_KEY);

  const rebuild = () => {
    const config = readConfig();
    provider = config
      ? new WebDavProvider({
          baseUrl: config.baseUrl,
          rootPath: config.remotePath,
          credentials: {
            get: (service, account) => ctx.credentials.get(service, account),
            set: (service, account, credential) => ctx.credentials.set(service, account, credential),
            delete: (service, account) => ctx.credentials.delete(service, account),
          },
          service: SERVICE,
          account: config.account,
          fetch: (input, init) => ctx.net.fetch(input, init),
        })
      : undefined;
    engine = new SyncEngine(local, provider!);
  };
  rebuild();

  return {
    id: "webdav.provider",
    configured: () => Boolean(readConfig()),
    config: readConfig,
    async configure(config, secret) {
      if (!/^https?:\/\//.test(config.baseUrl)) throw new Error("服务地址必须是 http(s) URL");
      if (!config.account || !secret) throw new Error("账号与密码/应用密码不能为空");
      ctx.storage.set(CONFIG_KEY, config);
      await ctx.credentials.set(SERVICE, config.account, {
        username: config.account,
        secret,
      });
      rebuild();
    },
    provider: () => provider,
    async sync() {
      const current = readConfig();
      if (!current || !provider) throw new Error("尚未配置 WebDAV 连接");
      void current;
      const doc = ctx.documents.getDocument();
      await engine!.queue("/vellink.md", doc.source);
      const report = await engine!.sync();
      // 有远端更新时把拉回的内容写回编辑器（同一撤销栈）
      if (report.actions.some((action) => action.type === "download")) {
        const pulled = await local.read("/vellink.md");
        if (pulled.content !== doc.source)
          ctx.documents.apply([
            {
              type: "replaceDocument",
              children: parseMarkdown({ source: pulled.content }).ir.children,
              source: pulled.content,
            },
          ]);
      }
      return {
        actions: report.actions.map((action) => ({ type: action.type, path: action.path })),
        pending: report.pending,
      };
    },
    async remoteFiles() {
      if (!provider) return [];
      const list = await provider.list("/");
      return list.entries.map((entry) => ({ path: entry.path, ...(entry.etag ? { etag: entry.etag } : {}) }));
    },
  };
}

let service: WebDavService | undefined;

const plugin: PluginModule = {
  activate(ctx) {
    service = createService(ctx);
    ctx.contributions.register("providers", "webdav.provider", service);
    ctx.log(service.configured() ? "已加载 WebDAV 配置" : "等待配置 WebDAV");
  },
  commands: {
    configure(ctx) {
      ctx.notify("请在右侧「设置 → WebDAV」填写服务地址与凭据");
      return Boolean(service?.configured());
    },
    async sync(ctx) {
      if (!service?.configured()) {
        ctx.notify("尚未配置 WebDAV 连接");
        return false;
      }
      try {
        const report = await service.sync();
        const conflicts = report.actions.filter((a) => a.type === "conflict").length;
        ctx.notify(
          `同步完成：上传 ${report.actions.filter((a) => a.type === "upload").length} / 下载 ${report.actions.filter((a) => a.type === "download").length}${conflicts ? ` / 冲突 ${conflicts} 份副本` : ""}`,
        );
        return true;
      } catch (error) {
        ctx.notify(`同步失败：${error instanceof Error ? error.message : String(error)}`);
        return false;
      }
    },
  },
};

export default plugin;
