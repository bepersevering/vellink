import { describe, expect, it } from "vitest";
import { emojiCandidates, EMOJI, findEmojiShortcodes } from "./emoji";
import { createEmojiPlugin, emojiPluginKey } from "./view/emoji-plugin";
import { EditorState, TextSelection } from "prosemirror-state";
import { vellinkSchema } from "./view/schema";

describe("Emoji shortcodes", () => {
  it("common shortcodes map to the right emoji", () => {
    expect(EMOJI.smile).toBe("😄");
    expect(EMOJI.thumbsup).toBe("👍");
    expect(EMOJI.fire).toBe("🔥");
    expect(EMOJI.完成).toBe("✅");
  });

  it("recognizes :code: in text and returns an exact span", () => {
    const text = "great job :thumbsup: keep going";
    const hits = findEmojiShortcodes(text);
    expect(hits).toHaveLength(1);
    expect(hits[0].emoji).toBe("👍");
    expect(text.slice(hits[0].from, hits[0].to)).toBe(":thumbsup:");
  });

  it("does not recognize unknown shortcodes", () => {
    expect(findEmojiShortcodes("there is no :notexist: shortcode")).toHaveLength(0);
  });

  it("matches prefix candidates by shortcode", () => {
    const list = emojiCandidates("smi");
    expect(list.some((c) => c.value === ":smile:")).toBe(true);
    expect(emojiCandidates("")).toEqual([]);
  });
});

describe("WYSIWYG Emoji plugin", () => {
  const doc = () =>
    vellinkSchema.node("doc", null, [
      vellinkSchema.node("paragraph", null, [vellinkSchema.text("text")]),
    ]);
  const state = () =>
    EditorState.create({
      doc: doc(),
      plugins: [createEmojiPlugin()],
      selection: TextSelection.create(doc(), 1),
    });

  it("enters capture mode when : is typed", () => {
    const s = state();
    const tr = s.tr.setMeta(emojiPluginKey, { from: 1, code: "" });
    const next = s.apply(tr);
    expect(emojiPluginKey.getState(next)).toEqual({ from: 1, code: "" });
  });

  it("exits capture mode on an invalid character", () => {
    const s = state();
    const next = s.apply(
      s.tr.setMeta(emojiPluginKey, { from: 1, code: "smi" }).setMeta(emojiPluginKey, null),
    );
    expect(emojiPluginKey.getState(next)).toBeNull();
  });

  it("does not replace an unknown shortcode", () => {
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
