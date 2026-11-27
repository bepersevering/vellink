/**
 * Markdown symbol auto-pairing in the WYSIWYG view.
 *
 * The source view uses CodeMirror's closeBrackets for ( [ { " ' etc.; in the PM document those
 * marker characters don't exist (they're nodes/marks), so we only wrap a selection when the
 * user types * _ ` — the most common writing case. Paired single-character input is left to
 * the user via ⌘B/⌘I.
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
        if (to <= from) return false; // No selection: let normal input handle it
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
