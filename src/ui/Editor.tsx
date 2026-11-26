import { useEffect, useRef, useState, type ChangeEvent } from "react";
import { EditorState, TextSelection } from "prosemirror-state";
import { EditorView } from "prosemirror-view";
import { vellinkSchema } from "../core/view/schema";
import { ViewBridge } from "../core/view/sync";
import { SAMPLE_MARKDOWN } from "./sample";

export type EditorMode = "wysiwyg" | "source";

/** 传给状态栏的实时统计，也作为双视图已接通的可观测证据。 */
export interface DocStats {
  line: number;
  chars: number;
  pm: number;
  source: number;
}

interface Props {
  docName: string;
  mode: EditorMode;
  onStats?: (stats: DocStats) => void;
}

/**
 * 编辑区：真实编辑器挂载点。
 *
 * data-editor-host 所在的 .doc-body 由 ProseMirror 接管（WYSIWYG）。
 * 源码模式复用同一个 ViewBridge：PM 事务 → serializePM → 源码；
 * 源码输入 → parseMarkdown → buildPMView → 整体替换 PM doc。
 * 两种视图共享同一份 source offset ↔ PM pos 映射，光标切换时不丢位置。
 */
export function Editor({ docName, mode, onStats }: Props) {
  const hostRef = useRef<HTMLDivElement>(null);
  const sourceRef = useRef<HTMLTextAreaElement>(null);
  const viewRef = useRef<EditorView | null>(null);
  const bridgeRef = useRef<ViewBridge | null>(null);
  /** 源码输入引发 PM dispatch 时，跳过回写，避免把未规范化的输入又覆盖掉。 */
  const fromSourceRef = useRef(false);
  const cursorRef = useRef({ pm: 1, source: 0 });

  const [source, setSource] = useState(SAMPLE_MARKDOWN);
  const [cursor, setCursor] = useState({ pm: 1, source: 0 });

  // 挂载 ProseMirror。docName 变化视为换文档，重新建桥（M3 会换成真实文件内容）。
  useEffect(() => {
    const host = hostRef.current;
    if (!host) return;

    const bridge = new ViewBridge(SAMPLE_MARKDOWN);
    bridgeRef.current = bridge;
    const state = EditorState.create({ doc: bridge.doc, schema: vellinkSchema });

    const view = new EditorView(host, {
      state,
      dispatchTransaction(tr) {
        const next = view.state.apply(tr);
        view.updateState(next);
        // 源码侧驱动的事务不再反向写源码，避免循环与光标抖动
        if (fromSourceRef.current) return;
        const snap = bridge.fromPM(next, tr.docChanged);
        cursorRef.current = snap.cursor;
        setSource(snap.source);
        setCursor(snap.cursor);
      },
    });
    viewRef.current = view;

    const initial = bridge.fromPM(state, false);
    cursorRef.current = initial.cursor;
    setSource(initial.source);
    setCursor(initial.cursor);

    return () => {
      view.destroy();
      viewRef.current = null;
      bridgeRef.current = null;
    };
  }, [docName]);

  // 切换视图时把光标带到另一侧：同一份映射，不重新解析、不重排文档。
  useEffect(() => {
    if (mode === "source") {
      const ta = sourceRef.current;
      if (!ta) return;
      ta.focus();
      const pos = Math.min(cursorRef.current.source, ta.value.length);
      ta.setSelectionRange(pos, pos);
      return;
    }
    const view = viewRef.current;
    if (!view) return;
    view.focus();
    const pos = Math.min(cursorRef.current.pm, view.state.doc.content.size);
    view.dispatch(
      view.state.tr.setSelection(TextSelection.create(view.state.doc, pos)),
    );
  }, [mode]);

  // 状态栏：真实字数 / 行数 / 双视图光标位置
  useEffect(() => {
    if (!onStats) return;
    const line = source.slice(0, cursor.source).split("\n").length;
    onStats({
      line,
      chars: source.replace(/\s/g, "").length,
      pm: cursor.pm,
      source: cursor.source,
    });
  }, [source, cursor, onStats]);

  const handleSourceInput = (e: ChangeEvent<HTMLTextAreaElement>) => {
    const next = e.target.value;
    const caret = e.target.selectionStart ?? next.length;
    const bridge = bridgeRef.current;
    const view = viewRef.current;
    if (!bridge || !view) return;

    fromSourceRef.current = true;
    try {
      const { doc, snapshot } = bridge.fromSource(next, caret);
      const tr = view.state.tr.replaceWith(
        0,
        view.state.doc.content.size,
        doc.content,
      );
      const pos = Math.min(snapshot.cursor.pm, tr.doc.content.size);
      tr.setSelection(TextSelection.create(tr.doc, pos));
      view.dispatch(tr);

      cursorRef.current = snapshot.cursor;
      setSource(next);
      setCursor(snapshot.cursor);
    } finally {
      fromSourceRef.current = false;
    }
  };

  return (
    <main className="editor" id="editor">
      <div className="doc-wrap" data-editor-host={docName}>
        <div className="kicker">写作 · 方法论</div>
        <h1>如何建立自己的知识体系</h1>
        <div className="meta">2026-11-25　·　约 2,400 字　·　预计阅读 8 分钟</div>

        <div
          ref={hostRef}
          className={`doc-body pm-host ${mode === "wysiwyg" ? "" : "hidden"}`}
          data-view="wysiwyg"
          aria-hidden={mode !== "wysiwyg"}
        />
        <textarea
          ref={sourceRef}
          className={`source-editor ${mode === "source" ? "" : "hidden"}`}
          data-view="source"
          value={source}
          onChange={handleSourceInput}
          spellCheck={false}
          aria-label="Markdown 源码编辑区"
        />
      </div>
    </main>
  );
}
