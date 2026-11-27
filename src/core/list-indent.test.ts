import { describe, expect, it } from "vitest";
import { indentListLine } from "./list-indent";

describe("Markdown 列表缩进", () => {
  it("无序列表加两个空格", () => {
    expect(indentListLine("- 项目", false)).toBe("  - 项目");
    expect(indentListLine("  - 项目", false)).toBe("    - 项目");
  });

  it("有序列表与星号 / 加号", () => {
    expect(indentListLine("1. 第一", false)).toBe("  1. 第一");
    expect(indentListLine("* 项", false)).toBe("  * 项");
    expect(indentListLine("+ 项", false)).toBe("  + 项");
  });

  it("反缩进去掉两个空格，最小到行首", () => {
    expect(indentListLine("    - 项", true)).toBe("  - 项");
    expect(indentListLine("  - 项", true)).toBe("- 项");
    expect(indentListLine("- 项", true)).toBeNull();
  });

  it("非列表行不处理", () => {
    expect(indentListLine("普通段落", false)).toBeNull();
    expect(indentListLine("# 标题", false)).toBeNull();
    expect(indentListLine("> 引用", true)).toBeNull();
  });
});
