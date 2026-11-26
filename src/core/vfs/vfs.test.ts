import { describe, expect, it, vi } from "vitest";
import { createMemoryCredentialStore } from "./credentials";
import { LocalVfs } from "./local";
import { VfsError, basename, dirname, joinPath, normalizePath } from "./types";
import { WebDavProvider, parseMultistatus } from "./webdav";
import { SyncEngine, hashContent } from "../sync/engine";

const XML_BASE = `<?xml version="1.0"?>
<d:multistatus xmlns:d="DAV:">
%s
</d:multistatus>`;

const response = (href: string, etag: string, collection = false, body = "") => `
<d:response>
  <d:href>${href}</d:href>
  <d:propstat><d:prop>
    <d:getetag>&quot;${etag}&quot;</d:getetag>
    <d:getcontentlength>${body.length}</d:getcontentlength>
    <d:resourcetype>${collection ? "<d:collection/>" : ""}</d:resourcetype>
  </d:prop><d:status>HTTP/1.1 200 OK</d:status></d:propstat>
</d:response>`;

function davFetch(handler: (url: string, init: RequestInit) => Response | Promise<Response>): typeof fetch {
  return vi.fn(async (input: RequestInit | string | URL, init?: RequestInit) =>
    handler(String(input), (init ?? {}) as RequestInit),
  ) as unknown as typeof fetch;
}

function jsonResponse(body: string, status = 200, headers: Record<string, string> = {}): Response {
  return new Response(status === 204 ? null : body, { status, headers });
}

describe("VFS 路径", () => {
  it("规范化路径并拒绝穿越与协议", () => {
    expect(normalizePath("a//b/./c.md")).toBe("/a/b/c.md");
    expect(() => normalizePath("../secret")).toThrow(VfsError);
    expect(() => normalizePath("https://example.com/x")).toThrow(VfsError);
    expect(joinPath("/docs", "note.md")).toBe("/docs/note.md");
    expect(dirname("/docs/note.md")).toBe("/docs");
    expect(basename("/docs/note.md")).toBe("note.md");
    expect(() => joinPath("/docs", "../x.md")).toThrow(VfsError);
  });
});

describe("WebDAV Provider", () => {
  const credentials = createMemoryCredentialStore();

  it("解析 multistatus 的 ETag / 目录标记", () => {
    const xml = XML_BASE.replace(
      "%s",
      response("/dav/notes/a.md", "abc") + response("/dav/notes/sub/", "def", true),
    );
    const entries = parseMultistatus(xml);
    expect(entries).toHaveLength(2);
    expect(entries[0].etag).toBe("abc");
    expect(entries[1].isDirectory).toBe(true);
  });

  it("stat/read/list/write 走标准 DAV 方法并带认证", async () => {
    await credentials.set("dav", "alice", { username: "alice", secret: "pw" });
    let putBody: string | undefined;
    const provider = new WebDavProvider({
      baseUrl: "https://dav.example.com/dav",
      credentials,
      service: "dav",
      account: "alice",
      fetch: davFetch((url, init) => {
        expect(url).toContain("/dav/notes");
        expect((init.headers as Record<string, string>).Authorization).toBe("Basic YWxpY2U6cHc=");
        const method = init.method;
        if (method === "PROPFIND") {
          const collection = /\/notes\/?$/.test(new URL(url).pathname);
          return jsonResponse(
            XML_BASE.replace(
              "%s",
              collection
                ? response("/dav/notes/", "dir", true) +
                  response("/dav/notes/a%20b.md", "etag1", false, "hello") +
                  response("/dav/notes/sub/", "sub", true)
                : response("/dav/notes/a%20b.md", "etag1", false, "hello"),
            ),
          );
        }
        if (method === "GET") return jsonResponse("hello", 200, { etag: '"etag1"' });
        if (method === "PUT") {
          putBody = init.body as string;
          return jsonResponse("", 201, { etag: '"etag2"' });
        }
        if (method === "DELETE") return jsonResponse("", 204);
        return jsonResponse("", 405);
      }),
    });

    const stat = await provider.stat("/notes/a b.md");
    expect(stat.etag).toBe("etag1");
    expect((await provider.read("/notes/a b.md")).content).toBe("hello");
    const list = await provider.list("/notes");
    expect(list.entries.map((e) => e.path)).toEqual(["/notes/a b.md", "/notes/sub"]);
    expect((await provider.write("/notes/a b.md", "new", { etag: "etag1" })).etag).toBe("etag2");
    expect(putBody).toBe("new");
    await provider.delete("/notes/a b.md");
    await provider.mkdir("/notes/sub");
  });

  it("write 用 If-Match 防止覆盖，缺凭据直接报错", async () => {
    const empty = createMemoryCredentialStore();
    const provider = new WebDavProvider({
      baseUrl: "https://dav.example.com/dav",
      credentials: empty,
      service: "dav",
      account: "nobody",
      fetch: davFetch((_url, init) => {
        if (init.method === "PROPFIND")
          return jsonResponse(XML_BASE.replace("%s", response("/dav/x.md", "e2")));
        return jsonResponse("", 201, { etag: '"e2"' });
      }),
    });
    await expect(provider.read("/x.md")).rejects.toThrow("凭据缺失");
    await empty.set("dav", "nobody", { username: "n", secret: "s" });
    expect((await provider.write("/x.md", "v", { etag: "e1" })).etag).toBe("e2");
  });
});

describe("SyncEngine 离线同步", () => {
  it("断网编辑入队，联网后按 ETag 上传", async () => {
    const local = new LocalVfs();
    const remote = new LocalVfs();
    await remote.write("/notes/a.md", "v1");
    const remoteStat = await remote.stat("/notes/a.md");
    const engine = new SyncEngine(local, remote);
    engine.track("/notes/a.md", remoteStat.etag, "v1");

    await engine.queue("/notes/a.md", "v2");
    expect((await local.read("/notes/a.md")).content).toBe("v2");
    expect(engine.pending).toBe(1);
    expect((await remote.read("/notes/a.md")).content).toBe("v1");

    const report = await engine.sync();
    expect(report.actions).toEqual([{ type: "upload", path: "/notes/a.md" }]);
    expect(report.pending).toBe(0);
    expect((await remote.read("/notes/a.md")).content).toBe("v2");
  });

  it("远端被他人修改时保留本地冲突副本，不静默覆盖", async () => {
    const local = new LocalVfs();
    const remote = new LocalVfs();
    await remote.write("/a.md", "base");
    const first = await remote.stat("/a.md");
    const engine = new SyncEngine(local, remote);
    engine.track("/a.md", first.etag, "base");

    await engine.queue("/a.md", "mine");
    await remote.write("/a.md", "theirs");
    const report = await engine.sync();

    expect(report.actions[0].type).toBe("conflict");
    expect((await remote.read("/a.md")).content).toBe("theirs");
    const conflict = report.actions.find((a) => a.type === "conflict");
    if (conflict?.type === "conflict")
      expect((await local.read(conflict.conflictPath)).content).toBe("mine");
  });

  it("远端变更在无本地待发时拉回本地", async () => {
    const local = new LocalVfs();
    const remote = new LocalVfs();
    await remote.write("/a.md", "v1");
    const stat = await remote.stat("/a.md");
    const engine = new SyncEngine(local, remote);
    engine.track("/a.md", stat.etag, "v1");
    await remote.write("/a.md", "v2");
    const report = await engine.sync();
    expect(report.actions).toEqual([{ type: "download", path: "/a.md" }]);
    expect((await local.read("/a.md")).content).toBe("v2");
  });

  it("内容哈希稳定", () => {
    expect(hashContent("hello")).toBe(hashContent("hello"));
    expect(hashContent("hello")).not.toBe(hashContent("world"));
  });
});
