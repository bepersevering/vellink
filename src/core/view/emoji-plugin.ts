/**
 * Emoji shortcode completion in the WYSIWYG editor.
 *
 * Typing `:` enters capture mode; subsequent alphanumerics accumulate into a shortcode,
 * and typing `:` again replaces the whole segment with the emoji if the shortcode is in
 * the table. Whitespace / punctuation or a timeout exits capture. The source view uses
 * CodeMirror's autocompletion, so the two paths don't interfere with each other.
 */

import { Plugin, PluginKey, TextSelection } from "prosemirror-state";
import { EMOJI } from "../emoji";

interface Capture {
  /** PM position where capture began (the position of the colon). */
  from: number;
  /** Shortcode accumulated so far (excluding the colon). */
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
        if (to !== from) return false; // Don't interfere when there's a selection
        const capture = emojiPluginKey.getState(view.state);

        if (!capture) {
          if (text !== ":") return false;
          view.dispatch(
            view.state.tr.setMeta(emojiPluginKey, { from, code: "" }),
          );
          return false; // Let the colon be typed normally
        }

        // Capturing: only allow shortcode characters and the closing colon
        if (text === ":") {
          const emoji = EMOJI[capture.code.toLowerCase()];
          if (!emoji) {
            view.dispatch(view.state.tr.setMeta(emojiPluginKey, null));
            return false;
          }
          // Replace `:code:` with the emoji (the current input hasn't been written to the doc yet; to=from is after the colon)
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
