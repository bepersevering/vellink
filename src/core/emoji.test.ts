import { describe, expect, it } from "vitest";
import { emojiCandidates, EMOJI, findEmojiShortcodes } from "./emoji";
import { createEmojiPlugin, emojiPluginKey } from "./view/emoji-plugin";
import { EditorState, TextSelection } from "prosemirror-state";
import { vellinkSchema } from "./view/schema";

describe("Emoji 短码", () => {
  it("常用短码有对应 emoji", () => {
    expect(EMOJI.smile).toBe("😄");
    expect(EMOJI.thumbsup).toBe("👍");
    expect(EMOJI.fire).toBe("🔥");
    expect(EMOJI.完成).toBe("✅");
  });

  it("识别文本里的 :code: 并给出精确 span", () => {
    const text = "干得漂亮 :thumbsup: 继续";
    const hits = findEmojiShortcodes(text);
    expect(hits).toHaveLength(1);
    expect(hits[0].emoji).toBe("👍");
    expect(text.slice(hits[0].from, hits[0].to)).toBe(":thumbsup:");
  });

  it("未知短码不识别", () => {
    expect(findEmojiShortcodes("没有这个 :notexist: 短码")).toHaveLength(0);
  });

  it("前缀候选按短码匹配", () => {
    const list = emojiCandidates("smi");
    expect(list.some((c) => c.value === ":smile:")).toBe(true);
    expect(emojiCandidates("")).toEqual([]);
  });
});

describe("WYSIWYG Emoji 插件", () => {
  const doc = () =>
    vellinkSchema.node("doc", null, [
      vellinkSchema.node("paragraph", null, [vellinkSchema.text("文字")]),
    ]);
  const state = () =>
    EditorState.create({
      doc: doc(),
      plugins: [createEmojiPlugin()],
      selection: TextSelection.create(doc(), 1),
    });

  it("输入 : 进入捕获态", () => {
    const s = state();
    const tr = s.tr.setMeta(emojiPluginKey, { from: 1, code: "" });
    const next = s.apply(tr);
    expect(emojiPluginKey.getState(next)).toEqual({ from: 1, code: "" });
  });

  it("捕获态遇到非法字符退出", () => {
    const s = state();
    const next = s.apply(
      s.tr.setMeta(emojiPluginKey, { from: 1, code: "smi" }).setMeta(emojiPluginKey, null),
    );
    expect(emojiPluginKey.getState(next)).toBeNull();
  });

  it("未知短码不会替换", () => {
    const plugin = createEmojiPlugin();
    const call = plugin.props.handleTextInput as (...a: unknown[]) => boolean;
    const s = state();
    const view = {
      state: s.apply(s.tr.setMeta(emojiPluginKey, { from: 1, code: "nope" })),
      dispatch: () => undefined,
    };
    expect(call(view, 1, 1, ":", undefined, view.dispatch)).toBe(false);
  });
});
