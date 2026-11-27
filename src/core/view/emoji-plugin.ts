/**
 * WYSIWYG 里的 Emoji 短码补全。
 *
 * 输入 `:` 进入捕获态，后续字母数字累积成短码，再输入 `:` 时若短码在表里
 * 就用 emoji 替换整段；输入空白 / 标点或超时则退出。源码视图走 CodeMirror
 * 的 autocompletion，两条路径互不干扰。
 */

import { Plugin, PluginKey, TextSelection } from "prosemirror-state";
import { EMOJI } from "../emoji";

interface Capture {
  /** 捕获开始处的 PM 位置（冒号的位置）。 */
  from: number;
  /** 已累积的短码（不含冒号）。 */
  code: string;
}

export const emojiPluginKey = new PluginKey<Capture | null>("vellink-emoji");

const CODE_RE = /^[a-z0-9_\u4e00-\u9fff]+$/i;

export function createEmojiPlugin(): Plugin<Capture | null> {
  return new Plugin<Capture | null>({
    key: emojiPluginKey,
    state: {
      init: () => null,
      apply(tr, value) {
        const meta = tr.getMeta(emojiPluginKey);
        if (meta !== undefined) return meta as Capture | null;
        if (!tr.docChanged) return value;
        return value ? { ...value } : null;
      },
    },
    props: {
      handleTextInput(view, from, to, text) {
        if (to !== from) return false; // 有选区时不介入
        const capture = emojiPluginKey.getState(view.state);

        if (!capture) {
          if (text !== ":") return false;
          view.dispatch(
            view.state.tr.setMeta(emojiPluginKey, { from, code: "" }),
          );
          return false; // 让冒号正常输入
        }

        // 捕获中：只允许短码字符与结束冒号
        if (text === ":") {
          const emoji = EMOJI[capture.code.toLowerCase()];
          if (!emoji) {
            view.dispatch(view.state.tr.setMeta(emojiPluginKey, null));
            return false;
          }
          // 替换 `:code:` 为 emoji（当前输入尚未写入文档，to=from 是冒号后）
          const tr = view.state.tr.insertText(emoji, capture.from, from);
          tr.setSelection(TextSelection.create(tr.doc, capture.from + emoji.length));
          tr.setMeta(emojiPluginKey, null);
          view.dispatch(tr);
          return true;
        }

        if (!CODE_RE.test(text)) {
          view.dispatch(view.state.tr.setMeta(emojiPluginKey, null));
          return false;
        }
        view.dispatch(
          view.state.tr.setMeta(emojiPluginKey, { from: capture.from, code: capture.code + text }),
        );
        return false;
      },
    },
  });
}
