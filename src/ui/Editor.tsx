import {
  forwardRef,
  useEffect,
  useImperativeHandle,
  useRef,
  useState,
} from "react";
import { EditorState, TextSelection } from "prosemirror-state";
import { EditorView } from "prosemirror-view";
import type { DocumentIR } from "../core/ir/types";
import { DocumentStore } from "../core/store";
import { vellinkSchema } from "../core/view/schema";
import { ViewBridge } from "../core/view/sync";
import { SAMPLE_MARKDOWN } from "./sample";
import { SourceEditor, type SourceEditorHandle } from "./SourceEditor";

export type EditorMode = "wysiwyg" | "source";

/** 传给状态栏的实时统计，也作为双视图已接通的可观测证据。 */
export interface DocStats {
  line: number;
  chars: number;
  pm: number;
  source: number;
}

/** 暴露给 App 的撤销/重做入口——唯一权威是 DocumentStore。 */
export interface EditorHandle {
  undo(): boolean;
  redo(): boolean;
  canUndo(): boolean;
  canRedo(): boolean;
}

interface Props {
  docName: string;
  mode: EditorMode;
  onStats?: (stats: DocStats) => void;
  /** 把唯一撤销栈暴露给 App，插件通过受权限门控的 API 读同一份 IR。 */
  onStoreReady?: (store: DocumentStore | null) => void;
}

/**
 * 编辑区：真实编辑器挂载点。
 *
 * IME 策略：composition 期间只更新视图，不序列化、不进撤销栈；
 * compositionend 后一次性提交最终文本。避免拼音中间态污染正文和撤销历史。
 */
export const Editor = forwardRef<EditorHandle, Props>(function Editor(
  { docName, mode, onStats, onStoreReady },
  ref,
) {
  const hostRef = useRef<HTMLDivElement>(null);
  const sourceEditorRef = useRef<SourceEditorHandle>(null);
  const viewRef = useRef<EditorView | null>(null);
  const bridgeRef = useRef<ViewBridge | null>(null);
  const storeRef = useRef<DocumentStore | null>(null);
  /** 源码输入 / 撤销回灌引发 PM dispatch 时，跳过再次提交事务。 */
  const fromSourceRef = useRef(false);
  /** 输入法组合中：暂缓一切序列化与事务提交。 */
  const composingRef = useRef(false);
  const cursorRef = useRef({ pm: 1, source: 0 });

  const [source, setSource] = useState(SAMPLE_MARKDOWN);
  const [cursor, setCursor] = useState({ pm: 1, source: 0 });

  /** PM 变更 → 源码/IR/撤销栈。组合输入期间由调用方跳过。 */
  const commitPM = (state: EditorState, docChanged: boolean) => {
    const bridge = bridgeRef.current;
    const store = storeRef.current;
    if (!bridge || !store) return;

    const before = bridge.source;
    const snap = bridge.fromPM(state, docChanged);
    if (docChanged && snap.source !== before) {
      store.apply(
        [
          {
            type: "replaceDocument",
            children: snap.ir.children,
            source: snap.source,
          },
        ],
        { mergeKey: "wysiwyg" },
      );
    }
    cursorRef.current = snap.cursor;
    setSource(snap.source);
    setCursor(snap.cursor);
    sourceEditorRef.current?.setDocument(snap.source, snap.cursor.source);
  };

  /** 源码变更 → PM 文档/IR/撤销栈。重复值直接忽略（IME 结束后的 onChange）。 */
  const commitSource = (next: string, caret: number) => {
    const bridge = bridgeRef.current;
    const view = viewRef.current;
    const store = storeRef.current;
    if (!bridge || !view || !store) return;

    if (next === bridge.source) {
      const c = { ...cursorRef.current, source: caret };
      cursorRef.current = c;
      setCursor(c);
      return;
    }

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

      store.apply(
        [
          {
            type: "replaceDocument",
            children: snapshot.ir.children,
            source: next,
          },
        ],
        { mergeKey: "source" },
      );

      cursorRef.current = snapshot.cursor;
      setSource(next);
      setCursor(snapshot.cursor);
    } finally {
      fromSourceRef.current = false;
    }
  };

  /** 把 DocumentStore 里的 IR 回灌到两个视图（撤销/重做专用，不产生新事务）。 */
  const restoreDocument = (ir: DocumentIR) => {
    const view = viewRef.current;
    const bridge = bridgeRef.current;
    if (!view || !bridge) return;

    bridge.reset(ir);
    fromSourceRef.current = true;
    try {
      const tr = view.state.tr.replaceWith(
        0,
        view.state.doc.content.size,
        bridge.doc.content,
      );
      const pos = Math.min(
        bridge.sourceToPM(cursorRef.current.source),
        tr.doc.content.size,
      );
      tr.setSelection(TextSelection.create(tr.doc, pos));
      view.dispatch(tr);
    } finally {
      fromSourceRef.current = false;
    }

    const snap = bridge.fromPM(view.state, false);
    cursorRef.current = snap.cursor;
    setSource(snap.source);
    setCursor(snap.cursor);
    sourceEditorRef.current?.setDocument(snap.source, snap.cursor.source);
  };

  useImperativeHandle(
    ref,
    () => ({
      undo: () => {
        const store = storeRef.current;
        if (!store?.undo()) return false;
        restoreDocument(store.getDocument());
        return true;
      },
      redo: () => {
        const store = storeRef.current;
        if (!store?.redo()) return false;
        restoreDocument(store.getDocument());
        return true;
      },
      canUndo: () => storeRef.current?.canUndo() ?? false,
      canRedo: () => storeRef.current?.canRedo() ?? false,
    }),
    [],
  );

  // 挂载 ProseMirror 与唯一撤销栈
  useEffect(() => {
    const host = hostRef.current;
    if (!host) return;

    const bridge = new ViewBridge(SAMPLE_MARKDOWN);
    bridgeRef.current = bridge;
    const store = new DocumentStore(bridge.ir);
    storeRef.current = store;
    onStoreReady?.(store);

    const state = EditorState.create({ doc: bridge.doc, schema: vellinkSchema });
    const view = new EditorView(host, {
      state,
      dispatchTransaction(tr) {
        const next = view.state.apply(tr);
        view.updateState(next);
        // 源码输入 / 撤销回灌引发的事务不再反向提交，避免循环
        if (fromSourceRef.current) return;
        // 输入法组合中的中间态：不序列化、不进撤销栈
        if (composingRef.current || view.composing) return;
        commitPM(next, tr.docChanged);
      },
    });
    viewRef.current = view;

    const onCompositionStart = () => {
      composingRef.current = true;
    };
    const onCompositionEnd = () => {
      composingRef.current = false;
      // PM 自己的 compositionend 处理会 flush DOM，用宏任务排在其后读取最终文档
      window.setTimeout(() => {
        const v = viewRef.current;
        if (v) commitPM(v.state, true);
      }, 0);
    };
    host.addEventListener("compositionstart", onCompositionStart);
    host.addEventListener("compositionend", onCompositionEnd);

    const initial = bridge.fromPM(state, false);
    cursorRef.current = initial.cursor;
    setSource(initial.source);
    setCursor(initial.cursor);

    return () => {
      host.removeEventListener("compositionstart", onCompositionStart);
      host.removeEventListener("compositionend", onCompositionEnd);
      view.destroy();
      store.dispose();
      onStoreReady?.(null);
      viewRef.current = null;
      bridgeRef.current = null;
      storeRef.current = null;
    };
  }, [docName, onStoreReady]);

  // 切换视图时把光标带到另一侧：同一份映射，不重新解析、不重排文档。
  useEffect(() => {
    if (mode === "source") {
      sourceEditorRef.current?.focusAt(cursorRef.current.source);
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

  const handleSourceChange = (next: string, caret: number, composing: boolean) => {
    // 组合中间态只更新显示与光标，不解析、不进撤销栈
    setSource(next);
    if (composing || composingRef.current) {
      cursorRef.current = { ...cursorRef.current, source: caret };
      return;
    }
    commitSource(next, caret);
  };

  const handleSourceCompositionEnd = (next: string, caret: number) => {
    composingRef.current = false;
    commitSource(next, caret);
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
        <div className={`source-wrap ${mode === "source" ? "" : "hidden"}`}>
          <SourceEditor
            key={docName}
            ref={sourceEditorRef}
            initialValue={SAMPLE_MARKDOWN}
            onChange={handleSourceChange}
            onSelection={(caret) => {
              cursorRef.current = { ...cursorRef.current, source: caret };
              setCursor(cursorRef.current);
            }}
            onCompositionEnd={handleSourceCompositionEnd}
          />
        </div>
      </div>
    </main>
  );
});
