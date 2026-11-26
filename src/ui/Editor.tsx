import {
  forwardRef,
  useEffect,
  useImperativeHandle,
  useRef,
  useState,
} from "react";
import { EditorState, TextSelection } from "prosemirror-state";
import { EditorView } from "prosemirror-view";
import { baseKeymap, toggleMark } from "prosemirror-commands";
import { keymap } from "prosemirror-keymap";
import type { DocumentIR } from "../core/ir/types";
import type { DocumentStore } from "../core/store";
import { vellinkSchema } from "../core/view/schema";
import { ViewBridge } from "../core/view/sync";
import { t } from "../i18n";
import { SourceEditor, type SourceEditorHandle } from "./SourceEditor";

export type EditorMode = "wysiwyg" | "source";

/** 传给状态栏的实时统计，也作为双视图已接通的可观测证据。 */
export interface DocStats {
  line: number;
  chars: number;
  pm: number;
  source: number;
}

/** 暴露给 App 的编辑入口——撤销权威在 DocumentStore，定位走 source map。 */
export interface EditorHandle {
  undo(): boolean;
  redo(): boolean;
  canUndo(): boolean;
  canRedo(): boolean;
  /** 跳到源码偏移（大纲点击），两种视图都支持。 */
  seek(offset: number): void;
}

interface Props {
  /** 当前文档的撤销权威，由 Workspace 持有，切换文档时整体替换。 */
  store: DocumentStore | null;
  docId: string;
  /**
   * 稳定标识：改标题会重命名文件、`docId`（路径）随之变化，但 `docUid` 不变。
   * 源码视图用它做 key，改名时不会重建 CodeMirror、光标不跳。
   */
  docUid: string;
  docName: string;
  mode: EditorMode;
  onStats?: (stats: DocStats) => void;
}

/**
 * 编辑区：真实编辑器挂载点。
 *
 * IME 策略：composition 期间只更新视图，不序列化、不进撤销栈；
 * compositionend 后一次性提交最终文本。避免拼音中间态污染正文和撤销历史。
 *
 * 双来源刷新：本组件发起的事务直接更新视图；插件命令 / 撤销等外部写入
 * 由 store.subscribe 通知后回灌，两者用 internalRef 区分，避免自触发。
 */
export const Editor = forwardRef<EditorHandle, Props>(function Editor(
  { store, docId, docUid, docName, mode, onStats },
  ref,
) {
  const hostRef = useRef<HTMLDivElement>(null);
  const sourceEditorRef = useRef<SourceEditorHandle>(null);
  const viewRef = useRef<EditorView | null>(null);
  const bridgeRef = useRef<ViewBridge | null>(null);
  const storeRef = useRef<DocumentStore | null>(store);
  /** 源码输入 / 撤销回灌引发 PM dispatch 时，跳过再次提交事务。 */
  const fromSourceRef = useRef(false);
  /** 本组件发起的写入：store 通知回来时不再回灌。 */
  const internalRef = useRef(false);
  /** 输入法组合中：暂缓一切序列化与事务提交。 */
  const composingRef = useRef(false);
  const cursorRef = useRef({ pm: 1, source: 0 });
  const modeRef = useRef(mode);
  modeRef.current = mode;

  const initialSource = store?.getDocument().source ?? "";
  const [source, setSource] = useState(initialSource);
  const [cursor, setCursor] = useState({ pm: 1, source: 0 });

  /** 本组件主动写 store：期间屏蔽订阅回调。 */
  const applyInternal = (ops: Parameters<DocumentStore["apply"]>[0], mergeKey: string) => {
    const target = storeRef.current;
    if (!target) return;
    internalRef.current = true;
    try {
      target.apply(ops, { mergeKey });
    } finally {
      internalRef.current = false;
    }
  };

  /** PM 变更 → 源码/IR/撤销栈。组合输入期间由调用方跳过。 */
  const commitPM = (state: EditorState, docChanged: boolean) => {
    const bridge = bridgeRef.current;
    if (!bridge) return;

    const before = bridge.source;
    const snap = bridge.fromPM(state, docChanged);
    if (docChanged && snap.source !== before) {
      applyInternal(
        [
          {
            type: "replaceDocument",
            children: snap.ir.children,
            source: snap.source,
          },
        ],
        "wysiwyg",
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
    if (!bridge || !view) return;

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

      applyInternal(
        [
          {
            type: "replaceDocument",
            children: snapshot.ir.children,
            source: next,
          },
        ],
        "source",
      );

      cursorRef.current = snapshot.cursor;
      setSource(next);
      setCursor(snapshot.cursor);
    } finally {
      fromSourceRef.current = false;
    }
  };

  /** 把 IR 回灌到两个视图（撤销 / 插件写入 / 外部变更共用的唯一入口）。 */
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
        const current = storeRef.current;
        if (!current) return false;
        internalRef.current = true;
        let ok = false;
        try {
          ok = current.undo();
        } finally {
          internalRef.current = false;
        }
        if (!ok) return false;
        restoreDocument(current.getDocument());
        return true;
      },
      redo: () => {
        const current = storeRef.current;
        if (!current) return false;
        internalRef.current = true;
        let ok = false;
        try {
          ok = current.redo();
        } finally {
          internalRef.current = false;
        }
        if (!ok) return false;
        restoreDocument(current.getDocument());
        return true;
      },
      canUndo: () => storeRef.current?.canUndo() ?? false,
      canRedo: () => storeRef.current?.canRedo() ?? false,
      seek: (offset: number) => {
        const view = viewRef.current;
        const bridge = bridgeRef.current;
        if (!view || !bridge) return;
        const safe = Math.max(0, Math.min(offset, bridge.source.length));

        if (modeRef.current === "source") {
          cursorRef.current = { ...cursorRef.current, source: safe };
          setCursor(cursorRef.current);
          sourceEditorRef.current?.focusAt(safe);
          return;
        }

        const pos = Math.min(bridge.sourceToPM(safe), view.state.doc.content.size);
        view.dispatch(
          view.state.tr
            .setSelection(TextSelection.create(view.state.doc, pos))
            .scrollIntoView(),
        );
        view.focus();
        cursorRef.current = { pm: pos, source: safe };
        setCursor(cursorRef.current);
      },
    }),
    [],
  );

  // 挂载 ProseMirror；store 变化（切换文档）时整体重建视图
  useEffect(() => {
    const host = hostRef.current;
    if (!host || !store) return;

    storeRef.current = store;
    const bridge = new ViewBridge(store.getDocument().source);
    bridgeRef.current = bridge;

    const state = EditorState.create({
      doc: bridge.doc,
      schema: vellinkSchema,
      plugins: [
        // 基础编辑行为（回车拆分、退格合并、方向键）必须由 keymap 提供，
        // 否则浏览器原生编辑会绕过 PM，直接改写 DOM。
        keymap({
          "Mod-b": toggleMark(vellinkSchema.marks.strong),
          "Mod-i": toggleMark(vellinkSchema.marks.em),
          "Mod-`": toggleMark(vellinkSchema.marks.code),
        }),
        keymap(baseKeymap),
      ],
    });
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

    // 外部写入（插件命令、工作区恢复）→ 回灌两个视图
    const unsubscribe = store.subscribe(() => {
      if (internalRef.current) return;
      restoreDocument(store.getDocument());
    });

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
    sourceEditorRef.current?.setDocument(initial.source, initial.cursor.source);

    // 新建文档只有一行标题时补一个空正文段落：PM 必须有真实文本块才能把光标
    // 渲染在标题之后，否则浏览器会把输入直接拼进标题。空段落序列化后不产出
    // 额外字符（块间由 "\n" 连接），所以正文与脏标记都不受影响。
    const onlyHeading =
      bridge.ir.children.length === 1 && bridge.ir.children[0].type === "heading";
    if (onlyHeading) {
      const tr = view.state.tr.insert(
        view.state.doc.content.size,
        vellinkSchema.nodes.paragraph.create(),
      );
      tr.setSelection(TextSelection.create(tr.doc, tr.doc.content.size - 1));
      view.dispatch(tr);
      if (modeRef.current === "wysiwyg") view.focus();
      else sourceEditorRef.current?.focusAt(initial.source.length);
    }

    return () => {
      unsubscribe();
      host.removeEventListener("compositionstart", onCompositionStart);
      host.removeEventListener("compositionend", onCompositionEnd);
      view.destroy();
      viewRef.current = null;
      bridgeRef.current = null;
    };
  }, [store]);

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
      <div className="doc-wrap" data-editor-id={docId} data-editor-host={docName}>
        {!store && <div className="doc-empty">{t("editor.loading")}</div>}
        <div
          ref={hostRef}
          className={`doc-body pm-host ${mode === "wysiwyg" ? "" : "hidden"}`}
          data-view="wysiwyg"
          aria-hidden={mode !== "wysiwyg"}
        />
        <div className={`source-wrap ${mode === "source" ? "" : "hidden"}`}>
          <SourceEditor
            key={docUid || docId}
            ref={sourceEditorRef}
            initialValue={initialSource}
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
