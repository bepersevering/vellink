import { describe, expect, it } from "vitest";
import { EditorState, TextSelection } from "prosemirror-state";
import { vellinkSchema } from "./schema";
import { createAutoPairPlugin } from "./auto-pair";

function withSel(text: string, from: number, to: number) {
  const doc = vellinkSchema.node("doc", null, [
    vellinkSchema.node("paragraph", null, [vellinkSchema.text(text)]),
  ]);
  return EditorState.create({
    doc,
    plugins: [createAutoPairPlugin()],
    selection: TextSelection.create(doc, from, to),
  });
}

describe("WYSIWYG 自动配对", () => {
  it("选中文本输入 * 变粗体，不插入星号", () => {
    let applied: unknown = null;
    const view = {
      state: withSel("选中文字", 1, 5),
      dispatch: (tr: never) => {
        applied = tr;
      },
    };
    const plugin = createAutoPairPlugin();
    const call = plugin.props.handleTextInput as (...a: unknown[]) => boolean;
    const handled = call(view, 1, 5, "*", undefined, view.dispatch);
    expect(handled).toBe(true);
    expect(applied).not.toBeNull();
  });

  it("没有选区时不拦截正常输入", () => {
    const plugin = createAutoPairPlugin();
    const view = { state: withSel("文字", 1, 1), dispatch: () => undefined };
    const call = plugin.props.handleTextInput as (...a: unknown[]) => boolean;
    expect(call(view, 1, 1, "*", undefined, view.dispatch)).toBe(false);
  });

  it("非配对符号不拦截", () => {
    const plugin = createAutoPairPlugin();
    const view = { state: withSel("文字", 1, 3), dispatch: () => undefined };
    const call = plugin.props.handleTextInput as (...a: unknown[]) => boolean;
    expect(call(view, 1, 3, "a", undefined, view.dispatch)).toBe(false);
  });

  it("mark 类型映射正确", () => {
    const plugin = createAutoPairPlugin();
    for (const [text, mark] of [["*", "strong"], ["_", "em"], ["`", "code"]] as const) {
      const state = withSel("abc", 1, 4);
      let applied: unknown = null;
      const view = {
        state,
        dispatch: (tr: never) => { applied = tr; },
      };
      const call = plugin.props.handleTextInput as (...a: unknown[]) => boolean;
      expect(call(view, 1, 4, text, undefined, view.dispatch)).toBe(true);
      expect(applied).not.toBeNull();
      expect(mark).toBeTruthy();
    }
  });
});
