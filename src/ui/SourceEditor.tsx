/**
 * CodeMirror 6 源码视图。
 *
 * 刻意不装 history / historyKeymap：撤销唯一权威是 DocumentStore。
 * Markdown 语言包复用 @lezer/markdown，与 M1 的解析器同源，不引入第二棵语法树。
 */
import { forwardRef, useEffect, useImperativeHandle, useRef } from "react";
import { EditorSelection, EditorState } from "@codemirror/state";
import {
  EditorView,
  drawSelection,
  highlightActiveLine,
  highlightActiveLineGutter,
  keymap,
  lineNumbers,
} from "@codemirror/view";
import { defaultKeymap, indentWithTab } from "@codemirror/commands";
import {
  bracketMatching,
  defaultHighlightStyle,
  indentOnInput,
  syntaxHighlighting,
} from "@codemirror/language";
import { markdown } from "@codemirror/lang-markdown";

export interface SourceEditorHandle {
  /** 外部（PM 编辑 / 撤销）更新源码时同步 CM 文档，不回写 bridge。 */
  setDocument(text: string, caret: number): void;
  /** 切到源码模式：聚焦并把光标放到指定 offset。 */
  focusAt(caret: number): void;
  getSelection(): number;
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
    fontSize: "13px",
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
    color: "var(--text-sub)",
  },
  ".cm-cursor": { borderLeftColor: "var(--accent)" },
  ".cm-selectionBackground": { backgroundColor: "var(--accent-soft) !important" },
});

export const SourceEditor = forwardRef<SourceEditorHandle, Props>(
  function SourceEditor(props, ref) {
    const hostRef = useRef<HTMLDivElement>(null);
    const viewRef = useRef<EditorView | null>(null);
    const applyingRef = useRef(false);
    // 回调放进 ref：CM 视图只创建一次，不因 React 重渲染重建
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
        focusAt(caret) {
          const view = viewRef.current;
          if (!view) return;
          const pos = Math.max(
            0,
            Math.min(caret, view.state.doc.length),
          );
          view.dispatch({
            selection: EditorSelection.cursor(pos),
            scrollIntoView: true,
          });
          view.focus();
        },
        getSelection() {
          return viewRef.current?.state.selection.main.head ?? 0;
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
          syntaxHighlighting(defaultHighlightStyle, { fallback: true }),
          markdown(),
          keymap.of([...defaultKeymap, indentWithTab]),
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

      // CM 内部也监听 compositionend；注册在其后，读取的是最终文档
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
        view.destroy();
        viewRef.current = null;
      };
    }, []);

    return <div ref={hostRef} className="cm-source-host" data-view="source" />;
  },
);
