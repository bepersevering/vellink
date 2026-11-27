/**
 * CodeMirror 6 source view.
 *
 * Deliberately no history / historyKeymap: DocumentStore is the sole undo authority.
 * The Markdown language package reuses @lezer/markdown, the same parser as M1, so there's no second syntax tree.
 */
import { forwardRef, useEffect, useImperativeHandle, useRef } from "react";
import {
  EditorSelection,
  EditorState,
  StateEffect,
  StateField,
  type Range,
} from "@codemirror/state";
import {
  Decoration,
  EditorView,
  drawSelection,
  highlightActiveLine,
  highlightActiveLineGutter,
  keymap,
  lineNumbers,
  type DecorationSet,
} from "@codemirror/view";
import { defaultKeymap, indentLess, indentMore } from "@codemirror/commands";
import {
  bracketMatching,
  defaultHighlightStyle,
  indentOnInput,
  syntaxHighlighting,
} from "@codemirror/language";
import { markdown } from "@codemirror/lang-markdown";
import { emojiCandidates } from "../core/emoji";
import { indentListLine } from "../core/list-indent";
import { autocompletion, closeBrackets, closeBracketsKeymap, type CompletionContext } from "@codemirror/autocomplete";

/** Show emoji candidates when the user types :smi. */
const emojiCompletion = (context: CompletionContext) => {
  const match = context.matchBefore(/:[a-z0-9_\u4e00-\u9fff]*/);
  if (!match || (match.from === match.to && !context.explicit)) return null;
  const options = emojiCandidates(match.text.slice(1));
  if (!options.length) return null;
  return { from: match.from, options, validFor: /^[a-z0-9_\u4e00-\u9fff]*$/ };
};

/** Tab / Shift+Tab on list items: indent by two spaces; non-list items use CodeMirror's default behavior. */
const listIndent = (outdent: boolean) => (view: EditorView): boolean => {
  const line = view.state.doc.lineAt(view.state.selection.main.head);
  const next = indentListLine(line.text, outdent);
  if (next === null || next === line.text) {
    return (outdent ? indentLess : indentMore)(view);
  }
  view.dispatch({
    changes: { from: line.from, to: line.to, insert: next },
    selection: { anchor: view.state.selection.main.head + (next.length - line.text.length) },
  });
  return true;
};

export interface SourceEditorHandle {
  /** Sync the CM document when source is updated externally (PM edit / undo), without writing back to the bridge. */
  setDocument(text: string, caret: number): void;
  /** Switch to source mode: focus and place the caret at the given offset; if `end` is given, select that range. */
  focusAt(caret: number, end?: number): void;
  getSelection(): number;
  /** Currently selected text (used as the initial query when opening Find). */
  getSelectedText(): string;
  /** Current selection range (for exporting "selection"); from === to when collapsed. */
  getRange(): { from: number; to: number };
  /** Find highlights: all matches plus the current one, drawn by CM decorations. */
  setFindHits(ranges: ReadonlyArray<{ from: number; to: number }>, current: number): void;
  /** Select one match and scroll it into view (without stealing focus, so the input stays editable). */
  selectRange(from: number, to: number): void;
}

interface Props {
  initialValue: string;
  onChange(next: string, caret: number, composing: boolean): void;
  onSelection(caret: number): void;
  onCompositionEnd(next: string, caret: number): void;
}

const vellinkTheme = EditorView.theme({
  "&": {
    height: "100%",
    backgroundColor: "var(--bg-sub)",
    color: "var(--text)",
  },
  "&.cm-focused": { outline: "none" },
  ".cm-scroller": {
    fontFamily: "var(--font-mono)",
    // Follow the configured body font size, but render code slightly smaller than the serif body
    fontSize: "calc(var(--doc-font, 16px) * 0.8125)",
    lineHeight: "1.75",
  },
  ".cm-content": { padding: "20px 0", caretColor: "var(--accent)" },
  ".cm-gutters": {
    backgroundColor: "var(--bg-sub)",
    color: "var(--text-hint)",
    border: "none",
    paddingRight: "6px",
  },
  ".cm-activeLine": { backgroundColor: "rgba(127,127,127,0.06)" },
  ".cm-activeLineGutter": {
    backgroundColor: "transparent",
    color: "var(--accent)",
    fontWeight: "600",
  },
  ".cm-cursor": { borderLeftColor: "var(--accent)" },
  ".cm-selectionBackground": { backgroundColor: "var(--accent-soft) !important" },
});

/**
 * Find highlighting.
 *
 * Use a StateField instead of rebuilding the whole extension each time: the match list changes
 * constantly while typing, so an effect swaps only the decoration set, leaving the view and undo
 * stack untouched (Find shouldn't produce any document changes).
 */
interface FindHits {
  ranges: ReadonlyArray<{ from: number; to: number }>;
  current: number;
}

const applyFindHits = StateEffect.define<FindHits>();

const findHighlight = StateField.define<DecorationSet>({
  create: () => Decoration.none,
  update(decorations, tr) {
    // When the document changes, old offsets go stale immediately; wait for the caller to compute new matches
    let next = tr.docChanged ? Decoration.none : decorations.map(tr.changes);
    for (const effect of tr.effects) {
      if (!effect.is(applyFindHits)) continue;
      const { ranges, current } = effect.value;
      const marks: Array<Range<Decoration>> = [];
      for (let index = 0; index < ranges.length; index += 1) {
        const from = Math.max(0, Math.min(ranges[index].from, tr.state.doc.length));
        const to = Math.max(from, Math.min(ranges[index].to, tr.state.doc.length));
        if (to <= from) continue;
        marks.push(
          Decoration.mark({
            class: index === current ? "find-hit find-hit-on" : "find-hit",
          }).range(from, to),
        );
      }
      next = Decoration.set(marks, true);
    }
    return next;
  },
  provide: (field) => EditorView.decorations.from(field),
});

export const SourceEditor = forwardRef<SourceEditorHandle, Props>(
  function SourceEditor(props, ref) {
    const hostRef = useRef<HTMLDivElement>(null);
    const viewRef = useRef<EditorView | null>(null);
    const applyingRef = useRef(false);
    // Keep callbacks in a ref: the CM view is created once and isn't rebuilt on React re-renders
    const callbacks = useRef(props);
    callbacks.current = props;

    useImperativeHandle(
      ref,
      () => ({
        setDocument(text, caret) {
          const view = viewRef.current;
          if (!view || view.state.doc.toString() === text) return;
          applyingRef.current = true;
          try {
            view.dispatch({
              changes: { from: 0, to: view.state.doc.length, insert: text },
              selection: EditorSelection.cursor(
                Math.max(0, Math.min(caret, text.length)),
              ),
            });
          } finally {
            applyingRef.current = false;
          }
        },
        focusAt(caret, end) {
          const view = viewRef.current;
          if (!view) return;
          const total = view.state.doc.length;
          const start = Math.max(0, Math.min(caret, total));
          const stop =
            end === undefined ? start : Math.max(start, Math.min(end, total));
          view.dispatch({
            selection: EditorSelection.range(start, stop),
            scrollIntoView: true,
          });
          view.focus();
        },
        getSelection() {
          return viewRef.current?.state.selection.main.head ?? 0;
        },
        getSelectedText() {
          const view = viewRef.current;
          if (!view) return "";
          const { from, to } = view.state.selection.main;
          return view.state.sliceDoc(from, to);
        },
        getRange() {
          const view = viewRef.current;
          if (!view) return { from: 0, to: 0 };
          const { from, to } = view.state.selection.main;
          return { from, to };
        },
        setFindHits(ranges, current) {
          const view = viewRef.current;
          if (!view) return;
          view.dispatch({ effects: applyFindHits.of({ ranges, current }) });
        },
        selectRange(from, to) {
          const view = viewRef.current;
          if (!view) return;
          const length = view.state.doc.length;
          const start = Math.max(0, Math.min(from, length));
          const end = Math.max(start, Math.min(to, length));
          view.dispatch({
            selection: EditorSelection.range(start, end),
            scrollIntoView: true,
          });
        },
      }),
      [],
    );

    useEffect(() => {
      const host = hostRef.current;
      if (!host) return;

      const state = EditorState.create({
        doc: callbacks.current.initialValue,
        extensions: [
          lineNumbers(),
          highlightActiveLineGutter(),
          highlightActiveLine(),
          drawSelection(),
          indentOnInput(),
          bracketMatching(),
          // Auto-close ( [ { " ' when typed; wrap the selection instead of overwriting it
          closeBrackets(),
          autocompletion({ override: [emojiCompletion] }),
          syntaxHighlighting(defaultHighlightStyle, { fallback: true }),
          markdown(),
          findHighlight,
          keymap.of([
            ...closeBracketsKeymap,
            { key: "Tab", run: listIndent(false), shift: listIndent(true) },
            ...defaultKeymap.filter((b) => b.key !== "Tab"),
          ]),
          EditorView.lineWrapping,
          vellinkTheme,
          EditorView.updateListener.of((update) => {
            if (applyingRef.current) return;
            if (update.docChanged) {
              callbacks.current.onChange(
                update.state.doc.toString(),
                update.state.selection.main.head,
                update.view.composing,
              );
            } else if (update.selectionSet) {
              callbacks.current.onSelection(update.state.selection.main.head);
            }
          }),
        ],
      });

      const view = new EditorView({ state, parent: host });
      viewRef.current = view;

      // Line numbers sit outside contentDOM, so CM's domEventHandlers don't see them; use a native listener
      const onGutterClick = (event: MouseEvent) => {
        const target = event.target as HTMLElement | null;
        if (!target || !target.classList.contains("cm-gutterElement")) return;
        const lineNumber = Number(target.textContent);
        if (!Number.isInteger(lineNumber) || lineNumber < 1) return;
        const line = view.state.doc.line(Math.min(lineNumber, view.state.doc.lines));
        view.dispatch({
          selection: { anchor: line.from },
          effects: EditorView.scrollIntoView(line.from, { y: "center" }),
        });
        view.focus();
      };
      view.dom.addEventListener("mousedown", onGutterClick, true);

      // CM also listens for compositionend internally; register afterwards to read the final document
      const onCompositionEnd = () => {
        window.setTimeout(() => {
          const v = viewRef.current;
          if (v)
            callbacks.current.onCompositionEnd(
              v.state.doc.toString(),
              v.state.selection.main.head,
            );
        }, 0);
      };
      view.dom.addEventListener("compositionend", onCompositionEnd);

      return () => {
        view.dom.removeEventListener("compositionend", onCompositionEnd);
        view.dom.removeEventListener("mousedown", onGutterClick, true);
      view.destroy();
        viewRef.current = null;
      };
    }, []);

    return <div ref={hostRef} className="cm-source-host" data-view="source" />;
  },
);
