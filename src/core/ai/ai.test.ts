import { describe, expect, it, vi } from "vitest";
import { parseMarkdown } from "../parser/markdown";
import { chunkDocument } from "./chunk";
import { OpenAICompatProvider } from "./provider";
import { MemoryVectorStore, cosineSimilarity, hashEmbed, indexChunks } from "./vector";

const DOC = `# 架构总览

本文描述 Vellink 的整体架构。

## IR 内核

DocumentIR 是唯一真源，所有视图都是投影。

## 插件系统

插件通过 manifest 声明贡献点，ESM 动态加载。

## WebDAV 同步

远端 ETag 用于条件写入，断网时本地先写。`;

describe("IR 语义切片", () => {
  const ir = parseMarkdown({ source: DOC }).ir;

  it("按标题切块并保留标题路径与 offset", () => {
    const chunks = chunkDocument(ir);
    expect(chunks.length).toBeGreaterThanOrEqual(4);
    expect(chunks.some((c) => c.headings.join("/") === "架构总览/IR 内核")).toBe(true);
    expect(chunks.some((c) => c.text.includes("DocumentIR 是唯一真源"))).toBe(true);
    for (const chunk of chunks) {
      expect(ir.source.slice(chunk.start, chunk.end)).toContain(chunk.text.split("\n")[0].slice(0, 4));
    }
  });

  it("长段落按 maxChars 切开", () => {
    const long = parseMarkdown({ source: `# T\n\n${"很长的段落 ".repeat(300)}` }).ir;
    const chunks = chunkDocument(long, 400);
    expect(chunks.length).toBeGreaterThan(1);
    expect(chunks.every((c) => c.text.length <= 600)).toBe(true);
  });
});

describe("向量检索", () => {
  it("能召回正确段落，相似度自反最高", async () => {
    const ir = parseMarkdown({ source: DOC }).ir;
    const chunks = chunkDocument(ir);
    const store = new MemoryVectorStore();
    await indexChunks(store, chunks);
    expect(store.size()).toBe(chunks.length);

    const target = chunks.find((c) => c.text.includes("WebDAV"))!;
    const matches = await store.query(hashEmbed("WebDAV ETag 条件写入"), 3);
    expect(matches[0].text).toBe(target.text);
    expect(cosineSimilarity(hashEmbed("hello"), hashEmbed("hello"))).toBeCloseTo(1);
  });

  it("哈希嵌入维度固定且与输入确定性一致", () => {
    expect(hashEmbed("测试")).toHaveLength(256);
    expect(hashEmbed("测试")).toEqual(hashEmbed("测试"));
  });
});

describe("AIProvider", () => {
  it("OpenAI 兼容接口带 Bearer Key 并解析回答", async () => {
    const fetchMock = vi.fn(async () =>
      new Response(
        JSON.stringify({ choices: [{ message: { content: "回答内容" } }] }),
        { status: 200, headers: { "Content-Type": "application/json" } },
      ),
    ) as unknown as typeof fetch;
    const provider = new OpenAICompatProvider({
      baseUrl: "https://api.deepseek.com/v1",
      apiKey: "sk-test",
      model: "deepseek-flash",
      fetch: fetchMock,
    });
    expect(await provider.chat([{ role: "user", content: "问题" }])).toBe("回答内容");
    const [url, init] = vi.mocked(fetchMock).mock.calls[0];
    expect(String(url)).toBe("https://api.deepseek.com/v1/chat/completions");
    expect((init?.headers as Record<string, string>).Authorization).toBe("Bearer sk-test");
    expect(JSON.parse(String(init?.body)).model).toBe("deepseek-flash");
  });

  it("错误响应抛出可读信息，空 Key 拒绝构造", async () => {
    const fetchMock = vi.fn(async () =>
      new Response(JSON.stringify({ error: { message: "额度不足" } }), { status: 402 }),
    ) as unknown as typeof fetch;
    const provider = new OpenAICompatProvider({
      baseUrl: "https://api.deepseek.com",
      apiKey: "sk-test",
      model: "deepseek-flash",
      fetch: fetchMock,
    });
    await expect(provider.chat([{ role: "user", content: "x" }])).rejects.toThrow("额度不足");
    expect(
      () =>
        new OpenAICompatProvider({ baseUrl: "https://x", apiKey: "", model: "m" }),
    ).toThrow("Key");
  });
});
