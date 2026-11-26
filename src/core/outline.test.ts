import { describe, expect, it } from "vitest";
import { buildOutline, docTitle } from "./outline";

describe("buildOutline", () => {
  it("抽出顶层标题、层级与源码偏移", () => {
    const source = ["# 一", "", "## 二", "", "### 三", "", "正文"].join("\n");
    const outline = buildOutline(source);

    expect(outline.map((item) => [item.level, item.depth, item.label])).toEqual([
      [1, 1, "一"],
      [2, 2, "二"],
      [3, 3, "三"],
    ]);
    expect(source.slice(outline[1].offset, outline[1].offset + 2)).toBe("##");
  });

  it("4–6 级标题在面板里归一化到 3 级", () => {
    const outline = buildOutline("#### 四级\n\n##### 五级");
    expect(outline.map((item) => item.level)).toEqual([3, 3]);
    expect(outline.map((item) => item.depth)).toEqual([4, 5]);
  });

  it("忽略代码块、引用与列表里的标题", () => {
    const source = [
      "# 真标题",
      "",
      "```md",
      "# 代码里的井号",
      "```",
      "",
      "> # 引用里的标题",
      "",
      "- ## 列表里的标题",
    ].join("\n");

    expect(buildOutline(source).map((item) => item.label)).toEqual(["真标题"]);
  });

  it("标题里的强调与链接只保留可见文字", () => {
    const outline = buildOutline("## 关于 **重点** 与 [链接](https://example.com)");
    expect(outline[0].label).toBe("关于 重点 与 链接");
  });

  it("空标题不产生条目", () => {
    expect(buildOutline("##\n\n正文")).toHaveLength(0);
  });
});

describe("docTitle", () => {
  it("优先取一级标题，而不是第一个出现的标题", () => {
    expect(docTitle("## 小节\n\n# 真标题")).toBe("真标题");
  });

  it("没有一级标题时退化为第一个标题", () => {
    expect(docTitle("## 小节\n\n正文")).toBe("小节");
  });

  it("没有标题时退化为首个非空行", () => {
    expect(docTitle("\n\n  第一行文字\n\n第二行")).toBe("第一行文字");
  });

  it("完全空文档使用兜底名", () => {
    expect(docTitle("   \n\n", "未命名")).toBe("未命名");
  });
});
