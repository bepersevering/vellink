/**
 * Vellink 的 ProseMirror schema —— WYSIWYG 视图的数据模型。
 * 与 DocumentIR 的节点类型一一对应，但不是 IR 本身（IR 仍是唯一真源，含 source map）。
 *
 * 关键：这是一棵"无 markdown 标记"的树。源码里的 #、**、`、[]() 等标记
 * 在 PM 里表现为 heading 节点类型 / strong/em/code mark，不占文本内容。
 * 光标映射的难点正是这套"标记字符 ↔ 节点/mark 边界"的坐标换算。
 */
import { Schema, type MarkType, type NodeType } from "prosemirror-model";
import { headingAnchor } from "../ext-syntax";

export const vellinkSchema = new Schema({
  nodes: {
    doc: { content: "block+" },
    paragraph: { content: "inline*", group: "block", parseDOM: [{ tag: "p" }], toDOM: () => ["p", 0] },
    heading: {
      content: "inline*",
      group: "block",
      attrs: { level: { default: 1 } },
      parseDOM: [{ tag: "h1", attrs: { level: 1 } }, { tag: "h2", attrs: { level: 2 } }, { tag: "h3", attrs: { level: 3 } }],
      toDOM: (node) => [`h${node.attrs.level}`, { id: headingAnchor(node.textContent) }, 0],
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
    table: {
      content: "tableRow+",
      group: "block",
      // 对齐信息必须从 IR 带进来，否则 WYSIWYG 编辑后序列化会丢失 align
      attrs: { align: { default: null } },
      parseDOM: [{ tag: "table" }],
      toDOM: () => ["table", ["tbody", 0]],
    },
    tableRow: { content: "tableCell+", group: "tableRow", parseDOM: [{ tag: "tr" }], toDOM: () => ["tr", 0] },
    tableCell: { content: "inline*", group: "tableCell", parseDOM: [{ tag: "td" }], toDOM: () => ["td", 0] },
    text: { group: "inline" },
    hardBreak: { group: "inline", inline: true, parseDOM: [{ tag: "br" }], toDOM: () => ["br"] },
    // 图片是 atom：光标不进内部，反向序列化时从 attrs 还原 markdown，
    // 不用拿 alt 文本占位——那样 WYSIWYG 里永远看不到图。
    image: {
      inline: true,
      group: "inline",
      atom: true,
      attrs: { src: {}, alt: { default: "" }, title: { default: null } },
      parseDOM: [
        {
          tag: "img",
          getAttrs: (dom) => ({
            src: (dom as HTMLElement).getAttribute("src") ?? "",
            alt: (dom as HTMLElement).getAttribute("alt") ?? "",
            title: (dom as HTMLElement).getAttribute("title") || null,
          }),
        },
      ],
      toDOM: (node) => [
        "img",
        {
          src: String(node.attrs.src ?? ""),
          alt: String(node.attrs.alt ?? ""),
          ...(node.attrs.title ? { title: String(node.attrs.title) } : {}),
        },
      ],
    },
    // 公式是 atom：schema 只输出占位 DOM，真正的 KaTeX 渲染在视图层
    // （core/view/math-view.ts）做。这样 schema 保持纯数据，node 测试
    // 不需要 DOM，浏览器里又能看到排版好的公式。
    inlineMath: {
      inline: true,
      group: "inline",
      atom: true,
      attrs: { value: {} },
      parseDOM: [
        {
          tag: "span[data-math]",
          getAttrs: (dom) => ({ value: (dom as HTMLElement).getAttribute("data-math") ?? "" }),
        },
      ],
      toDOM: (node) => [
        "span",
        { class: "vellink-math", "data-math": String(node.attrs.value ?? "") },
        `$${String(node.attrs.value ?? "")}$`,
      ],
    },
    mathBlock: {
      group: "block",
      atom: true,
      attrs: { value: {} },
      parseDOM: [
        {
          tag: "div[data-math-block]",
          getAttrs: (dom) => ({ value: (dom as HTMLElement).getAttribute("data-math-block") ?? "" }),
        },
      ],
      toDOM: (node) => [
        "div",
        { class: "vellink-mathblock", "data-math-block": String(node.attrs.value ?? "") },
        `$$${String(node.attrs.value ?? "")}$$`,
      ],
    },
    frontmatter: {
      group: "block",
      atom: true,
      attrs: { value: {} },
      parseDOM: [
        {
          tag: "div[data-frontmatter]",
          getAttrs: (dom) => ({ value: (dom as HTMLElement).getAttribute("data-frontmatter") ?? "" }),
        },
      ],
      toDOM: (node) => [
        "div",
        { class: "vellink-frontmatter", "data-frontmatter": String(node.attrs.value ?? "") },
        "文档属性",
      ],
    },
    toc: {
      group: "block",
      atom: true,
      parseDOM: [{ tag: "div[data-toc]" }],
      toDOM: () => ["div", { class: "vellink-toc", "data-toc": "" }, "[TOC]"],
    },
    footnoteRef: {
      inline: true,
      group: "inline",
      atom: true,
      attrs: { label: {} },
      parseDOM: [
        {
          tag: "sup[data-footnote]",
          getAttrs: (dom) => ({ label: (dom as HTMLElement).getAttribute("data-footnote") ?? "" }),
        },
      ],
      toDOM: (node) => [
        "sup",
        { class: "vellink-footnote-ref", "data-footnote": String(node.attrs.label ?? "") },
        `[^${String(node.attrs.label ?? "")}]`,
      ],
    },
    footnoteDef: {
      group: "block",
      atom: true,
      attrs: { label: {}, text: {} },
      parseDOM: [
        {
          tag: "div[data-footnote-def]",
          getAttrs: (dom) => ({
            label: (dom as HTMLElement).getAttribute("data-footnote-def") ?? "",
            text: (dom as HTMLElement).getAttribute("data-text") ?? "",
          }),
        },
      ],
      toDOM: (node) => [
        "div",
        {
          class: "vellink-footnote-def",
          "data-footnote-def": String(node.attrs.label ?? ""),
          "data-text": String(node.attrs.text ?? ""),
        },
        `[^${String(node.attrs.label ?? "")}]: ${String(node.attrs.text ?? "")}`,
      ],
    },
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
      toDOM: (mark) => ["span", { "data-wikilink": mark.attrs.target }, 0],
    },
  },
  topNode: "doc",
});

export type PMNodeType = NodeType;
export type PMMarkType = MarkType;

export const T = vellinkSchema.nodes;
export const M = vellinkSchema.marks;
