import { describe, expect, it } from "vitest";
import { parseMarkdown } from "../parser/markdown";
import { buildPMView } from "./mapping";
import { buildDecorations, highlightPluginKey, createHighlightPlugin } from "./highlight-plugin";
import { EditorState } from "prosemirror-state";

function docOf(source: string) {
  return buildPMView(parseMarkdown({ source }).ir).doc;
}

describe("代码块高亮 Decoration", () => {
  it("给关键字 / 数字 / 字符串 / 注释分别加 class", () => {
    const doc = docOf("```js\nconst x = 42; // 注\nlet s = \"hi\";\n```");
    const set = buildDecorations(doc);
    const classes = set.find().map((d) => d.spec.tokenClass);
    expect(classes).toContain("kw");
    expect(classes).toContain("nu");
    expect(classes).toContain("st");
    expect(classes).toContain("cm");
  });

  it("普通段落不产生装饰", () => {
    const doc = docOf("# 标题\n\n一段 const x = 1 的文字。\n");
    expect(buildDecorations(doc).find()).toHaveLength(0);
  });

  it("装饰落在代码块内的真实文本范围", () => {
    const source = "```js\nconst x = 1;\n```";
    const doc = docOf(source);
    const set = buildDecorations(doc);
    for (const d of set.find()) {
      expect(d.from).toBeGreaterThan(0);
      expect(d.to).toBeLessThanOrEqual(doc.content.size);
      expect(d.to).toBeGreaterThan(d.from);
    }
    // 装饰的 from/to 是 PM 坐标，不是源码偏移；从 PM 文本节点取真实字符
    const flat: string[] = [];
    doc.descendants((node) => {
      if (node.isText) flat.push(node.text ?? "");
    });
    const pmText = flat.join("");
    const kw = set.find().find((d) => d.spec.tokenClass === "kw");
    expect(kw).toBeDefined();
    expect(pmText.slice(kw!.from - 1, kw!.to - 1)).toBe("const");
  });

  it("插件随文档变化重算装饰", () => {
    const plugin = createHighlightPlugin();
    const doc = docOf("```js\nconst x = 1;\n```");
    const state = EditorState.create({ doc, plugins: [plugin] });
    expect(highlightPluginKey.getState(state)!.find().length).toBeGreaterThan(0);

    // 用不含代码的文档重建 state，装饰应归零
    const state2 = EditorState.create({ doc: docOf("普通文字"), plugins: [plugin] });
    expect(highlightPluginKey.getState(state2)!.find()).toHaveLength(0);
  });

  it("无语言标记也着色", () => {
    const doc = docOf("```\nconst x = 1;\n```");
    const classes = buildDecorations(doc).find().map((d) => d.spec.tokenClass);
    expect(classes).toContain("kw");
  });
});
