/**
 * WebDAV Provider — 用标准 DAV 方法实现 VFS：PROPFIND / GET / PUT / MKCOL / DELETE。
 *
 * 设计：
 * 1. fetch 可注入，Node 单测用假实现，浏览器用原生 fetch；Tauri 里换成 HTTP 插件即可。
 * 2. 凭据只从 CredentialStore 取，Provider 配置里没有密码字段。
 * 3. XML 用轻量正则解析 DAV:multistatus 的常见结构，避免引入 DOM/SAX 依赖。
 */

import {
  basicAuthHeader,
  type CredentialStore,
} from "./credentials";
import {
  VfsError,
  joinPath,
  normalizePath,
  type VfsFile,
  type VfsListResult,
  type VfsPath,
  type VfsProvider,
  type VfsStat,
  type WriteOptions,
} from "./types";

export interface WebDavOptions {
  id?: string;
  /** 形如 https://dav.example.com/remote.php/dav/files/user */
  baseUrl: string;
  /** 可选根路径（baseUrl 之后）；不传则用 baseUrl 的 pathname */
  rootPath?: string;
  /** 凭据仓库索引；插件只传 service/account，不传明文 */
  credentials: CredentialStore;
  service: string;
  account: string;
  /** 认证方式：basic（默认）或 bearer（secret 作为 token） */
  auth?: "basic" | "bearer" | "none";
  fetch?: typeof fetch;
}

interface DavEntry {
  href: string;
  etag?: string;
  size?: number;
  modifiedAt?: number;
  isDirectory: boolean;
}

/** WebDAV 服务端可能把引号等字符写成 XML 实体，解析时必须解码。 */
function decodeXml(value: string): string {
  return value
    .replace(/&quot;/g, '"')
    .replace(/&apos;|&#39;/g, "'")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&amp;/g, "&");
}

const tag = (xml: string, name: string): string | undefined => {
  const match = new RegExp(`<(?:[\\w-]+:)?${name}(?:\\s[^>]*)?>([\\s\\S]*?)</(?:[\\w-]+:)?${name}>`, "i").exec(xml);
  return match?.[1] ? decodeXml(match[1]).trim() : undefined;
};

/** 解析 DAV:multistatus，返回每个 response 的相对路径与属性。 */
export function parseMultistatus(xml: string): DavEntry[] {
  const responses = xml.match(/<(?:[\w-]+:)?response(?:\s[^>]*)?>[\s\S]*?<\/(?:[\w-]+:)?response>/gi) ?? [];
  return responses.map((response) => {
    const rawHref = tag(response, "href") ?? "";
    let href: string;
    try {
      href = decodeURIComponent(rawHref);
    } catch {
      href = rawHref;
    }
    const etag = tag(response, "getetag");
    const length = tag(response, "getcontentlength");
    const modified = tag(response, "getlastmodified");
    const type = tag(response, "resourcetype") ?? "";
    return {
      href,
      ...(etag ? { etag: etag.replace(/^"|"$/g, "") } : {}),
      ...(length ? { size: Number(length) } : {}),
      ...(modified ? { modifiedAt: Date.parse(modified) } : {}),
      isDirectory: /<(?:[\w-]+:)?collection\s*\/?>/i.test(type),
    };
  });
}

export class WebDavProvider implements VfsProvider {
  readonly id: string;
  private readonly base: URL;
  private readonly root: VfsPath;
  private readonly options: WebDavOptions;
  private readonly doFetch: typeof fetch;

  constructor(options: WebDavOptions) {
    if (!/^https?:$/.test(new URL(options.baseUrl).protocol))
      throw new VfsError(options.baseUrl, "WebDAV 仅支持 http/https");
    this.options = options;
    this.id = options.id ?? "webdav";
    this.base = new URL(options.baseUrl);
    this.root = normalizePath(
      options.rootPath ? `${this.base.pathname}/${options.rootPath}` : this.base.pathname || "/",
    );
    this.doFetch = options.fetch ?? fetch;
  }

  /** 把 VFS 路径映射为完整 URL；每段单独编码，保留 / 分隔。 */
  private urlOf(path: VfsPath): string {
    const segments = normalizePath(`${this.root}${path}`)
      .split("/")
      .filter(Boolean)
      .map(encodeURIComponent);
    const url = new URL(this.base.origin);
    url.pathname = `/${segments.join("/")}`;
    return url.toString();
  }

  private relativeOf(href: string): string {
    const url = new URL(href, this.base.origin);
    let pathname = url.pathname;
    try {
      pathname = decodeURIComponent(pathname);
    } catch {
      // 保留原样
    }
    const prefix = this.root === "/" ? "/" : `${this.root}/`;
    let relative = pathname;
    if (pathname.startsWith(prefix)) relative = pathname.slice(prefix.length - 1);
    else if (pathname === this.root) relative = "/";
    // 目录 href 常带尾部斜杠，统一去掉，否则 list 会把自身当子项
    return relative.length > 1 ? normalizePath(relative) : "/";
  }

  private async headers(): Promise<HeadersInit> {
    const auth = this.options.auth ?? "basic";
    if (auth === "none") return {};
    const credential = await this.options.credentials.get(this.options.service, this.options.account);
    if (!credential) throw new VfsError(this.base.href, "凭据缺失，请先配置 WebDAV 账号");
    return {
      Authorization: auth === "basic" ? basicAuthHeader(credential) : `Bearer ${credential.secret}`,
    };
  }

  private async request(path: VfsPath, method: string, init: RequestInit = {}): Promise<Response> {
    const response = await this.doFetch(this.urlOf(path), {
      ...init,
      method,
      headers: { ...(await this.headers()), ...(init.headers ?? {}) },
    });
    if (!response.ok) {
      throw new VfsError(path, `WebDAV ${method} 失败`, response.status);
    }
    return response;
  }

  private toStat(path: VfsPath, entry: DavEntry): VfsStat {
    return {
      path,
      isDirectory: entry.isDirectory,
      ...(entry.etag ? { etag: entry.etag } : {}),
      ...(Number.isFinite(entry.size) ? { size: entry.size } : {}),
      ...(Number.isFinite(entry.modifiedAt) ? { modifiedAt: entry.modifiedAt } : {}),
    };
  }

  async stat(path: VfsPath): Promise<VfsStat> {
    const clean = normalizePath(path);
    const response = await this.request(clean, "PROPFIND", { headers: { Depth: "0" } });
    const entries = parseMultistatus(await response.text());
    const hit = entries.find((entry) => this.relativeOf(entry.href) === clean);
    if (!hit) throw new VfsError(clean, "WebDAV 响应中找不到该路径");
    return this.toStat(clean, hit);
  }

  async read(path: VfsPath): Promise<VfsFile> {
    const clean = normalizePath(path);
    const response = await this.request(clean, "GET");
    const etag = response.headers.get("etag")?.replace(/^"|"$/g, "");
    return {
      path: clean,
      isDirectory: false,
      ...(etag ? { etag } : {}),
      content: await response.text(),
    };
  }

  async write(path: VfsPath, content: string, options: WriteOptions = {}): Promise<VfsStat> {
    const clean = normalizePath(path);
    const headers: Record<string, string> = { "Content-Type": "text/markdown; charset=utf-8" };
    if (options.etag) headers["If-Match"] = `"${options.etag.replace(/^"|"$/g, "")}"`;
    const response = await this.request(clean, "PUT", { body: content, headers });
    const etag = response.headers.get("etag")?.replace(/^"|"$/g, "");
    if (etag) return { path: clean, isDirectory: false, etag, size: content.length };
    return this.stat(clean);
  }

  async list(path: VfsPath): Promise<VfsListResult> {
    const clean = normalizePath(path);
    const response = await this.request(clean, "PROPFIND", { headers: { Depth: "1" } });
    const entries = parseMultistatus(await response.text());
    const own = entries.find((entry) => this.relativeOf(entry.href) === clean);
    const children = entries
      .filter((entry) => {
        const relative = this.relativeOf(entry.href);
        return relative !== clean && relative.startsWith(clean === "/" ? "/" : `${clean}/`);
      })
      .map((entry) => this.toStat(normalizePath(this.relativeOf(entry.href)), entry));
    return {
      entries: children,
      ...(own?.etag ? { etag: own.etag } : {}),
    };
  }

  async delete(path: VfsPath): Promise<void> {
    await this.request(normalizePath(path), "DELETE");
  }

  async mkdir(path: VfsPath): Promise<void> {
    const clean = normalizePath(path);
    try {
      await this.request(clean, "MKCOL");
    } catch (error) {
      // 405 Method Not Allowed = 目录已存在，幂等成功
      if (!(error instanceof VfsError) || error.status !== 405) throw error;
    }
  }

  /** 轮询目录 etag 变化；错误不打断 watch，下一轮继续。 */
  watch(path: VfsPath, onChange: (stat: VfsStat) => void, intervalMs = 5000): () => void {
    const clean = normalizePath(path);
    let last: string | undefined;
    let stopped = false;
    void (async () => {
      try {
        last = (await this.stat(clean)).etag;
      } catch {
        // 首次失败也进入轮询
      }
      while (!stopped) {
        await new Promise((resolve) => setTimeout(resolve, intervalMs));
        if (stopped) break;
        try {
          const current = await this.stat(clean);
          if (last !== undefined && current.etag && current.etag !== last) onChange(current);
          last = current.etag;
        } catch {
          // 网络抖动交给下一轮
        }
      }
    })();
    return () => {
      stopped = true;
    };
  }
}

/** 确保父目录存在（逐段 MKCOL），供同步写回时使用。 */
export async function ensureParent(provider: VfsProvider, path: VfsPath): Promise<void> {
  const parts = path.split("/").filter(Boolean);
  parts.pop();
  let current: VfsPath = "/";
  for (const part of parts) {
    current = joinPath(current, part);
    await provider.mkdir(current);
  }
}
