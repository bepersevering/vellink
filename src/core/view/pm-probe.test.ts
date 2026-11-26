/**
 * ProseMirror 位置模型探针：确认 pos 计算规则，不猜 API。
 * 光标同步的成败取决于能否精确理解 pos ↔ 文本 offset 的换算。
 */
import { describe, it } from "vitest";
import { Schema } from "prosemirror-model";

/** 最小 schema：doc > (paragraph | heading | code_block)，段落内支持 strong/em/code marks */
const schema = new Schema({
  nodes: {
    doc: { content: "block+" },
    paragraph: { content: "inline*", group: "block" },
    heading: { content: "inline*", group: "block", attrs: { level: {} } },
    code_block: { content: "text*", group: "block" },
    text: { group: "inline" },
  },
  marks: {
    strong: {},
    em: {},
    code: {},
  },
});

const { doc, paragraph, heading } = schema.nodes;
const strongMark = schema.marks.strong.create();
const emMark = schema.marks.em.create();

describe("ProseMirror 位置模型探针", () => {
  it("纯文本节点的 pos 从 1 开始（doc 本身占一个开放位置）", () => {
    const pmDoc = doc.create(null, [paragraph.create(null, [schema.text("abc")])]);
    console.log("doc.nodeSize =", pmDoc.nodeSize);
    console.log("doc.textContent =", JSON.stringify(pmDoc.textContent));
    // 逐个 pos 打印 resolve，看光标在不同位置的表示
    for (let p = 0; p <= pmDoc.content.size; p++) {
      const r = pmDoc.resolve(p);
      console.log(
        `pos=${p}`,
        "parentOffset=" + r.parentOffset,
        "parent=" + r.parent.type.name,
        "depth=" + r.depth,
        "nodeAfter=" + (r.nodeAfter?.type.name ?? "-"),
      );
    }
  });

  it("mark 不额外占 pos —— 这是光标映射的关键", () => {
    const pmDoc = doc.create(null, [
      paragraph.create(null, [
        schema.text("普通"),
        schema.text("粗体", [strongMark]),
        schema.text("斜体", [emMark]),
      ]),
    ]);
    console.log("带 mark 的 doc.nodeSize =", pmDoc.nodeSize);
    console.log("textContent =", JSON.stringify(pmDoc.textContent), "长度", pmDoc.textContent.length);
    for (let p = 1; p <= 8; p++) {
      const r = pmDoc.resolve(p);
      console.log(
        `pos=${p}`,
        "parentOffset=" + r.parentOffset,
        "marks=" + JSON.stringify(r.marks().map((m: { type: { name: string } }) => m.type.name)),
      );
    }
  });

  it("多块结构：块之间的边界 pos 如何分布", () => {
    const pmDoc = doc.create(null, [
      heading.create({ level: 1 }, [schema.text("标题")]),
      paragraph.create(null, [schema.text("第一段")]),
      paragraph.create(null, [schema.text("第二段")]),
    ]);
    console.log("多块 doc.nodeSize =", pmDoc.nodeSize);
    console.log("textContent =", JSON.stringify(pmDoc.textContent));
    for (let p = 1; p <= pmDoc.content.size; p++) {
      const r = pmDoc.resolve(p);
      console.log(
        `pos=${p}`,
        "parent=" + r.parent.type.name,
        "parentOffset=" + r.parentOffset,
        "depth=" + r.depth,
        "index=" + r.index(),
      );
    }
  });
});
