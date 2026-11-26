/**
 * Vellink 的 ProseMirror schema —— WYSIWYG 视图的数据模型。
 * 与 DocumentIR 的节点类型一一对应，但不是 IR 本身（IR 仍是唯一真源，含 source map）。
 *
 * 关键：这是一棵"无 markdown 标记"的树。源码里的 #、**、`、[]() 等标记
 * 在 PM 里表现为 heading 节点类型 / strong/em/code mark，不占文本内容。
 * 光标映射的难点正是这套"标记字符 ↔ 节点/mark 边界"的坐标换算。
 */
import { Schema, type MarkType, type NodeType } from "prosemirror-model";

export const vellinkSchema = new Schema({
  nodes: {
    doc: { content: "block+" },
    paragraph: { content: "inline*", group: "block", parseDOM: [{ tag: "p" }], toDOM: () => ["p", 0] },
    heading: {
      content: "inline*",
      group: "block",
      attrs: { level: { default: 1 } },
      parseDOM: [{ tag: "h1", attrs: { level: 1 } }, { tag: "h2", attrs: { level: 2 } }, { tag: "h3", attrs: { level: 3 } }],
      toDOM: (node) => [`h${node.attrs.level}`, 0],
    },
    blockquote: { content: "block+", group: "block", parseDOM: [{ tag: "blockquote" }], toDOM: () => ["blockquote", 0] },
    bulletList: { content: "listItem+", group: "block", parseDOM: [{ tag: "ul" }], toDOM: () => ["ul", 0] },
    orderedList: {
      content: "listItem+",
      group: "block",
      attrs: { start: { default: 1 } },
      parseDOM: [{ tag: "ol" }],
      toDOM: (node) => ["ol", node.attrs.start === 1 ? {} : { start: node.attrs.start }, 0],
    },
    listItem: {
      content: "paragraph block*",
      group: "listItem",
      attrs: { checked: { default: null } },
      parseDOM: [{ tag: "li" }],
      toDOM: (node) => {
        const attrs = node.attrs.checked === null ? {} : { "data-checked": String(node.attrs.checked) };
        return ["li", attrs, 0];
      },
    },
    codeBlock: {
      content: "text*",
      group: "block",
      attrs: { lang: { default: null } },
      marks: "",
      parseDOM: [{ tag: "pre" }],
      toDOM: (node) => ["pre", node.attrs.lang ? { "data-lang": node.attrs.lang } : {}, ["code", 0]],
    },
    horizontalRule: { group: "block", parseDOM: [{ tag: "hr" }], toDOM: () => ["hr"] },
    table: { content: "tableRow+", group: "block", parseDOM: [{ tag: "table" }], toDOM: () => ["table", ["tbody", 0]] },
    tableRow: { content: "tableCell+", group: "tableRow", parseDOM: [{ tag: "tr" }], toDOM: () => ["tr", 0] },
    tableCell: { content: "inline*", group: "tableCell", parseDOM: [{ tag: "td" }], toDOM: () => ["td", 0] },
    text: { group: "inline" },
    hardBreak: { group: "inline", inline: true, parseDOM: [{ tag: "br" }], toDOM: () => ["br"] },
  },
  marks: {
    strong: { parseDOM: [{ tag: "strong" }, { tag: "b" }], toDOM: () => ["strong", 0] },
    em: { parseDOM: [{ tag: "em" }, { tag: "i" }], toDOM: () => ["em", 0] },
    code: { parseDOM: [{ tag: "code" }], toDOM: () => ["code", 0] },
    link: {
      attrs: { href: {}, title: { default: null } },
      inclusive: false,
      parseDOM: [{ tag: "a", getAttrs: (dom) => ({ href: (dom as HTMLElement).getAttribute("href") ?? "" }) }],
      toDOM: (mark) => ["a", { href: mark.attrs.href, ...(mark.attrs.title ? { title: mark.attrs.title } : {}) }, 0],
    },
    wikiLink: {
      attrs: { target: {} },
      inclusive: false,
      parseDOM: [{ tag: "span[data-wikilink]" }],
      toDOM: (mark) => ["span", { "data-wikilink": mark.attrs.target }],
    },
  },
  topNode: "doc",
});

export type PMNodeType = NodeType;
export type PMMarkType = MarkType;

export const T = vellinkSchema.nodes;
export const M = vellinkSchema.marks;
