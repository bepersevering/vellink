import { describe, expect, it, vi } from "vitest";
import { parseMarkdown } from "../parser/markdown";
import { chunkDocument } from "./chunk";
import { OpenAICompatProvider } from "./provider";
import { MemoryVectorStore, cosineSimilarity, hashEmbed, indexChunks } from "./vector";

const DOC = `# Architecture Overview

This document describes the overall architecture of Vellink.

## IR Core

DocumentIR is the single source of truth; every view is a projection.

## Plugin System

Plugins declare contribution points through their manifest and are loaded dynamically as ESM modules.

## WebDAV Sync

The remote ETag is used for conditional writes; when offline, writes go local first.`;

describe("IR semantic chunking", () => {
  const ir = parseMarkdown({ source: DOC }).ir;

  it("splits by heading and preserves heading paths and offsets", () => {
    const chunks = chunkDocument(ir);
    expect(chunks.length).toBeGreaterThanOrEqual(4);
    expect(chunks.some((c) => c.headings.join("/") === "Architecture Overview/IR Core")).toBe(true);
    expect(chunks.some((c) => c.text.includes("DocumentIR is the single source of truth"))).toBe(true);
    for (const chunk of chunks) {
      expect(ir.source.slice(chunk.start, chunk.end)).toContain(chunk.text.split("\n")[0].slice(0, 4));
    }
  });

  it("splits long paragraphs at maxChars", () => {
    const long = parseMarkdown({ source: `# T\n\n${"a long paragraph ".repeat(300)}` }).ir;
    const chunks = chunkDocument(long, 400);
    expect(chunks.length).toBeGreaterThan(1);
    expect(chunks.every((c) => c.text.length <= 600)).toBe(true);
  });
});

describe("vector search", () => {
  it("recalls the right passage; self-similarity is highest", async () => {
    const ir = parseMarkdown({ source: DOC }).ir;
    const chunks = chunkDocument(ir);
    const store = new MemoryVectorStore();
    await indexChunks(store, chunks);
    expect(store.size()).toBe(chunks.length);

    const target = chunks.find((c) => c.text.includes("WebDAV"))!;
    const matches = await store.query(hashEmbed("WebDAV ETag conditional write"), 3);
    expect(matches[0].text).toBe(target.text);
    expect(cosineSimilarity(hashEmbed("hello"), hashEmbed("hello"))).toBeCloseTo(1);
  });

  it("hash embeddings have a fixed dimension and are deterministic", () => {
    expect(hashEmbed("test")).toHaveLength(256);
    expect(hashEmbed("test")).toEqual(hashEmbed("test"));
  });
});

describe("AIProvider", () => {
  it("sends the Bearer key and parses the reply on an OpenAI-compatible endpoint", async () => {
    const fetchMock = vi.fn(async () =>
      new Response(
        JSON.stringify({ choices: [{ message: { content: "answer content" } }] }),
        { status: 200, headers: { "Content-Type": "application/json" } },
      ),
    ) as unknown as typeof fetch;
    const provider = new OpenAICompatProvider({
      baseUrl: "https://api.deepseek.com/v1",
      apiKey: "sk-test",
      model: "deepseek-flash",
      fetch: fetchMock,
    });
    expect(await provider.chat([{ role: "user", content: "question" }])).toBe("answer content");
    const [url, init] = vi.mocked(fetchMock).mock.calls[0];
    expect(String(url)).toBe("https://api.deepseek.com/v1/chat/completions");
    expect((init?.headers as Record<string, string>).Authorization).toBe("Bearer sk-test");
    expect(JSON.parse(String(init?.body)).model).toBe("deepseek-flash");
  });

  it("throws readable errors for failed responses and rejects an empty key", async () => {
    const fetchMock = vi.fn(async () =>
      new Response(JSON.stringify({ error: { message: "insufficient quota" } }), { status: 402 }),
    ) as unknown as typeof fetch;
    const provider = new OpenAICompatProvider({
      baseUrl: "https://api.deepseek.com",
      apiKey: "sk-test",
      model: "deepseek-flash",
      fetch: fetchMock,
    });
    await expect(provider.chat([{ role: "user", content: "x" }])).rejects.toThrow("insufficient quota");
    expect(
      () =>
        new OpenAICompatProvider({ baseUrl: "https://x", apiKey: "", model: "m" }),
    ).toThrow("Key");
  });
});
