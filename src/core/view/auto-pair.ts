/**
 * WYSIWYG 里的 Markdown 符号自动配对。
 *
 * 源码视图用 CodeMirror 的 closeBrackets 处理 ( [ { " ' 等；PM 这边文档里
 * 没有这些标记字符（它们表现为节点/mark），所以只对「选中文本后输入 * _ `」
 * 做包裹——这是写作里最高频的场景。单个字符的成对输入交给用户按 ⌘B/⌘I。
 */

import { Plugin } from "prosemirror-state";
import { toggleMark } from "prosemirror-commands";
import { vellinkSchema } from "./schema";

const PAIR: Record<string, "strong" | "em" | "code"> = {
  "*": "strong",
  "_": "em",
  "`": "code",
};

export function createAutoPairPlugin(): Plugin {
  return new Plugin({
    props: {
      handleTextInput(view, from, to, text) {
        if (to <= from) return false; // 没有选区：交给正常输入
        const mark = PAIR[text];
        if (!mark) return false;
        const type =
          mark === "strong"
            ? vellinkSchema.marks.strong
            : mark === "em"
              ? vellinkSchema.marks.em
              : vellinkSchema.marks.code;
        const ok = toggleMark(type)(view.state, view.dispatch, view);
        return ok;
      },
    },
  });
}
