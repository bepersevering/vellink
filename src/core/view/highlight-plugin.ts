/**
 * WYSIWYG 代码块语法着色——用 ProseMirror Decoration 实现。
 *
 * 为什么不改 DOM：PM 有自己的 DOMObserver，直接改 code 里的节点会被它当成
 * 外部改动并试图「修复」，两者互相触发形成死循环（实跑踩过）。
 * Decoration 是 PM 官方机制，只给已有文本节点套 span，文档结构不变，
 * 代码块照样可编辑、可撤销，源码视图也不受影响。
 */

import { Plugin, PluginKey } from "prosemirror-state";
import { Decoration, DecorationSet } from "prosemirror-view";
import type { Node as PMNode } from "prosemirror-model";
import { tokenize, type TokenKind } from "./code-highlight";

export const highlightPluginKey = new PluginKey<DecorationSet>("vellink-code-highlight");

const CLASS: Record<TokenKind, string | null> = {
  plain: null,
  comment: "cm",
  keyword: "kw",
  string: "st",
  number: "nu",
};

/** 扫描整棵 PM 文档，给每个 codeBlock 里的 token 生成 inline decoration。 */
export function buildDecorations(doc: PMNode): DecorationSet {
  const decorations: Decoration[] = [];
  doc.descendants((node, pos) => {
    if (node.type.name !== "codeBlock") return;
    const lang = String(node.attrs.lang ?? "");
    const text = node.textContent;
    if (!text) return;

    // codeBlock 内只有一个文本节点（schema marks:""），从 pos+1 开始
    let offset = 1;
    node.forEach((child) => {
      const source = child.isText ? child.text ?? "" : "";
      for (const token of tokenize(source, lang)) {
        const cls = CLASS[token.kind];
        if (cls) {
          const from = pos + offset;
          const to = from + token.text.length;
          if (to > from) decorations.push(Decoration.inline(from, to, { class: cls }, { tokenClass: cls }));
        }
        offset += token.text.length;
      }
    });
  });
  return DecorationSet.create(doc, decorations);
}

/**
 * 插件。文档一变就重建装饰（DecorationSet 会跟随 tr.map 自动平移，
 * 但 token 边界可能因语言/内容变化而改，所以干脆整篇重算——代码块通常很少）。
 */
export function createHighlightPlugin(): Plugin<DecorationSet> {
  return new Plugin<DecorationSet>({
    key: highlightPluginKey,
    state: {
      init: (_, state) => buildDecorations(state.doc),
      apply(tr, old) {
        return tr.docChanged ? buildDecorations(tr.doc) : old.map(tr.mapping, tr.doc);
      },
    },
    props: {
      decorations(state) {
        return highlightPluginKey.getState(state) ?? null;
      },
    },
  });
}
