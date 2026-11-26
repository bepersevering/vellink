/** 全库搜索：标题优先、正文分片段、偏移可直接用于定位。 */
import { describe, expect, it } from "vitest";
import { Workspace, type WorkspaceDoc } from "./workspace";

const doc = (id: string, source: string, updatedAt = 1): WorkspaceDoc => ({
  id,
  title: source.match(/^#\s+(.+)$/m)?.[1] ?? id,
  source,
  savedSource: source,
  createdAt: updatedAt,
  updatedAt,
});

const workspaceOf = () =>
  new Workspace([
    doc("a.md", "# 知识体系\n\n我们每天都在接收大量信息，但真正能沉淀下来的少之又少。\n\n## 从收集到连接\n\n收藏夹越来越满。\n"),
    doc("b.md", "# Vellink\n\nVellink is a local-first editor. Try Vellink today.\n"),
    doc("c.md", "# 无关\n\n这篇没有那个词。\n"),
  ]);

describe("Workspace.search", () => {
  it("空查询返回空数组", () => {
    const ws = workspaceOf();
    expect(ws.search("")).toEqual([]);
    expect(ws.search("   ")).toEqual([]);
  });

  it("标题命中排在最前，片段给的是正文首句", () => {
    const ws = workspaceOf();
    const hits = ws.search("知识体系");
    expect(hits.length).toBeGreaterThan(0);
    const first = hits[0];
    expect(first.id).toBe("a.md");
    expect(first.inTitle).toBe(true);
    expect(first.snippet).toContain("我们每天都在接收");
  });

  it("正文命中的片段包含命中词", () => {
    const ws = workspaceOf();
    const hit = ws.search("沉淀").find((h) => !h.inTitle);
    expect(hit).toBeDefined();
    expect(hit?.snippet).toContain("沉淀");
  });

  it("只命中正文时 inTitle 为 false 且偏移指向源码", () => {
    const ws = workspaceOf();
    const hits = ws.search("收藏夹");
    expect(hits).toHaveLength(1);
    expect(hits[0].inTitle).toBe(false);
    const source = ws.get(hits[0].id)?.source ?? "";
    expect(source.slice(hits[0].offset, hits[0].offset + 3)).toBe("收藏夹");
  });

  it("英文不区分大小写，同一篇按 perDoc 限条", () => {
    const ws = workspaceOf();
    const hits = ws.search("vellink", { perDoc: 1, limit: 10 });
    const inB = hits.filter((hit) => hit.id === "b.md" && !hit.inTitle);
    expect(inB).toHaveLength(1);
  });

  it("标题命中排在正文命中之前", () => {
    const ws = workspaceOf();
    const hits = ws.search("Vellink");
    expect(hits[0].inTitle).toBe(true);
    expect(hits[0].id).toBe("b.md");
  });

  it("总量受 limit 限制", () => {
    const ws = workspaceOf();
    expect(ws.search("的", { limit: 2 }).length).toBeLessThanOrEqual(2);
  });

  it("搜不到时返回空数组，不抛错", () => {
    const ws = workspaceOf();
    expect(ws.search("完全不存在的词")).toEqual([]);
  });

  it("标题命中指向标题文字本身，长度可用于选中", () => {
    const ws = workspaceOf();
    const hit = ws.search("Vellink").find((h) => h.inTitle);
    expect(hit).toBeDefined();
    if (!hit) return;
    const source = ws.get(hit.id)?.source ?? "";
    expect(source.slice(hit.offset, hit.offset + hit.length)).toBe("Vellink");
    // 提示语不能是标题本身（那等于占两行说同一件事）
    expect(hit.snippet).not.toBe(hit.title);
    expect(hit.snippet.length).toBeGreaterThan(0);
  });

  it("片段把换行压成空格，便于单行展示", () => {
    const ws = workspaceOf();
    const hits = ws.search("少之又少");
    expect(hits[0].snippet).not.toContain("\n");
  });
});
