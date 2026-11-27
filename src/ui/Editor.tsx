import {
  forwardRef,
  useCallback,
  useEffect,
  useImperativeHandle,
  useRef,
  useState,
} from "react";
import { EditorState, Plugin, PluginKey, TextSelection } from "prosemirror-state";
import { Decoration, DecorationSet, EditorView } from "prosemirror-view";
import { baseKeymap, toggleMark } from "prosemirror-commands";
import { keymap } from "prosemirror-keymap";
import type { DocumentIR } from "../core/ir/types";
import type { DocumentStore } from "../core/store";
import { vellinkSchema } from "../core/view/schema";
import { ViewBridge } from "../core/view/sync";
import { expandReplacement, findMatches } from "../core/find";
import { buildPMTextMap, locateInPM } from "../core/find-pm";
import { isImageType } from "../core/asset";
import { renderMath } from "../core/view/math-view";
import { renderExtSyntax } from "../core/view/ext-view";
import { clipboardHtml, htmlToMarkdown } from "../core/paste-html";
import { createHighlightPlugin } from "../core/view/highlight-plugin";
import { t } from "../i18n";
import { SourceEditor, type SourceEditorHandle } from "./SourceEditor";
import { FindBar } from "./FindBar";

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
  /**
   * 跳到源码偏移（大纲点击 / 全库搜索命中），两种视图都支持。
   * 给了 `length` 就顺带选中那一段，让用户看见「就是这里」。
   */
  seek(offset: number, length?: number): boolean;
  /**
   * 当前选区在源码坐标系里的区间（导出用）。
   * 两个视图各算各的，`pmToSource` 换到同一套偏移；没有选区返回 null。
   */
  selectionRange(): { from: number; to: number } | null;
  /** 在当前光标/选区插入一段 Markdown（图片粘贴用），和打字共用一次撤销。 */
  insertMarkdown(text: string, options?: { block?: boolean }): boolean;
  /** 打开查找替换浮层（⌘F）；已有选区时以选区为初始查询。 */
  openFind(): void;
  closeFind(): void;
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
  /** 替换结果之类的轻提示，交给 App 的 toast。 */
  onNotify?: (message: string) => void;
  /** 粘进来 / 拖进来的图片，由 App 决定落盘方式，再回调本组件插入。 */
  onImages?: (files: File[]) => void;
}

/* ------------------------------ 查找高亮（PM 侧） ------------------------------ */

interface FindDecorState {
  ranges: ReadonlyArray<{ from: number; to: number }>;
  current: number;
}

const emptyFind: FindDecorState = { ranges: [], current: -1 };

const findPluginKey = new PluginKey<FindDecorState>("vellink-find");

/**
 * 命中高亮。
 *
 * 走 plugin meta 而不是整篇重绘：查找不产生任何文档变更，装饰器只负责
 * 让用户看见「都在哪、现在在哪一处」。
 */
const findPlugin = new Plugin<FindDecorState>({
  key: findPluginKey,
  state: {
    init: () => emptyFind,
    apply(tr, value) {
      const meta = tr.getMeta(findPluginKey) as FindDecorState | undefined;
      if (meta) return meta;
      // 文档一变，旧偏移立即失效；上层算完新命中会再发一次 meta
      return tr.docChanged ? emptyFind : value;
    },
  },
  props: {
    decorations(state) {
      const value = findPluginKey.getState(state);
      if (!value || value.ranges.length === 0) return null;
      const size = state.doc.content.size;
      const decorations = value.ranges.map((range, index) =>
        Decoration.inline(
          Math.min(range.from, size),
          Math.min(range.to, size),
          { class: index === value.current ? "find-hit find-hit-on" : "find-hit" },
        ),
      );
      return DecorationSet.create(state.doc, decorations);
    },
  },
});

/** 一处命中在「当前视图坐标」里的位置。 */
interface Hit {
  from: number;
  to: number;
  /** 命中原文，替换时回填 $&。 */
  text: string;
  groups: readonly string[];
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
  { store, docId, docUid, docName, mode, onStats, onNotify, onImages },
  ref,
) {
  const hostRef = useRef<HTMLDivElement>(null);
  const wrapRef = useRef<HTMLDivElement>(null);
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

  /* ------------------------------ 查找状态 ------------------------------ */
  const [findOpen, setFindOpen] = useState(false);
  const [findQuery, setFindQuery] = useState("");
  const [findReplaceText, setFindReplaceText] = useState("");
  const [findCase, setFindCase] = useState(false);
  const [findRegex, setFindRegex] = useState(false);
  const [findShowReplace, setFindShowReplace] = useState(false);
  const [hits, setHits] = useState<Hit[]>([]);
  /** `hits` 是在哪个视图里算出来的：切换视图的那一帧要跳过旧坐标系。 */
  const [hitsMode, setHitsMode] = useState<EditorMode>(mode);
  const [hitIndex, setHitIndex] = useState(-1);
  const [findError, setFindError] = useState("");
  const [findTruncated, setFindTruncated] = useState(false);

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

  /* ------------------------------ 查找与替换 ------------------------------ */

  /**
   * 把命中画到当前视图上。
   *
   * 两个视图的坐标系不是一回事（PM 位置 vs 源码偏移），绝不能把一份区间同时
   * 发给两边：切视图时隐藏的那一侧会拿到错位的装饰，等再切回来就正好错一格。
   * 所以只画当前视图，另一侧显式清空。
   */
  const paintHits = useCallback((list: Hit[], current: number) => {
    const ranges = list.map(({ from, to }) => ({ from, to }));
    const view = viewRef.current;
    const sourceView = sourceEditorRef.current;
    const toSource = modeRef.current === "source";

    if (view) {
      view.dispatch(
        view.state.tr.setMeta(findPluginKey, {
          ranges: toSource ? [] : ranges,
          current: toSource ? -1 : current,
        }),
      );
    }
    sourceView?.setFindHits(toSource ? ranges : [], toSource ? current : -1);
  }, []);

  /**
   * 算命中。
   *
   * WYSIWYG 搜「可见文本」（拍平后的 PM 文档），源码视图搜原始 Markdown：
   * 两边都是「搜你看见的字」，不把 `**`、`#` 这类标记卷进结果。
   */
  const computeHits = useCallback((): {
    list: Hit[];
    error: string;
    truncated: boolean;
  } => {
    if (!findQuery) return { list: [], error: "", truncated: false };
    const options = { caseSensitive: findCase, regex: findRegex };

    if (mode === "wysiwyg") {
      const view = viewRef.current;
      if (!view) return { list: [], error: "", truncated: false };
      const map = buildPMTextMap(view.state.doc);
      const result = findMatches(map.text, findQuery, options);
      if (result.error) {
        return { list: [], error: "find.invalidRegex", truncated: false };
      }
      const list: Hit[] = [];
      for (const match of result.matches) {
        const range = locateInPM(map, match.from, match.to);
        // 跨块的命中在 WYSIWYG 里没有对应区间：不列出，也好过高亮错位
        if (!range) continue;
        list.push({
          from: range.from,
          to: range.to,
          text: match.text,
          groups: match.groups,
        });
      }
      return { list, error: "", truncated: result.truncated };
    }

    const result = findMatches(source, findQuery, options);
    if (result.error) return { list: [], error: "find.invalidRegex", truncated: false };
    return {
      list: result.matches.map((match) => ({
        from: match.from,
        to: match.to,
        text: match.text,
        groups: match.groups,
      })),
      error: "",
      truncated: result.truncated,
    };
  }, [findQuery, findCase, findRegex, mode, source]);

  // 查询 / 选项 / 正文 / 视图任一变化都重算命中
  useEffect(() => {
    if (!findOpen) {
      setHits([]);
      setHitIndex(-1);
      setFindError("");
      setFindTruncated(false);
      paintHits([], -1);
      return;
    }
    const { list, error, truncated } = computeHits();
    setHits(list);
    setHitsMode(mode);
    setFindError(error);
    setFindTruncated(truncated);
    // 替换掉一处后停在原序号，等于「接着往下找」
    setHitIndex((prev) =>
      list.length === 0 ? -1 : Math.min(Math.max(prev, 0), list.length - 1),
    );
  }, [findOpen, computeHits, paintHits, mode]);

  // 高亮 + 把当前一处选中并滚进视野
  useEffect(() => {
    if (!findOpen) return;
    // 命中还是上一个视图的坐标系：等重算完再画，避免错位一帧
    if (hitsMode !== mode) return;
    paintHits(hits, hitIndex);
    const hit = hits[hitIndex];
    if (!hit) return;

    if (modeRef.current === "source") {
      // 不抢焦点：用户还要在查找框里继续敲
      sourceEditorRef.current?.selectRange(hit.from, hit.to);
      return;
    }
    const view = viewRef.current;
    if (!view) return;
    const size = view.state.doc.content.size;
    view.dispatch(
      view.state.tr
        .setSelection(
          TextSelection.create(
            view.state.doc,
            Math.min(hit.from, size),
            Math.min(hit.to, size),
          ),
        )
        .scrollIntoView(),
    );
  }, [findOpen, hits, hitIndex, hitsMode, mode, paintHits]);

  const focusTokenRef = useRef(0);
  const [findFocusToken, setFindFocusToken] = useState(0);

  const openFind = useCallback(() => {
    if (findOpen) {
      // 已经开着：⌘F 只是把焦点交回查找框
      focusTokenRef.current += 1;
      setFindFocusToken(focusTokenRef.current);
      return;
    }
    // 有选区就以选区为初始查询，符合直觉
    let selected = "";
    if (modeRef.current === "source") {
      selected = sourceEditorRef.current?.getSelectedText() ?? "";
    } else {
      const view = viewRef.current;
      if (view) {
        const { from, to } = view.state.selection;
        if (to > from) selected = view.state.doc.textBetween(from, to, "\n");
      }
    }
    const usable = selected.length <= 80 && !selected.includes("\n") ? selected : "";
    setFindQuery(usable);
    focusTokenRef.current += 1;
    setFindFocusToken(focusTokenRef.current);
    setFindOpen(true);
    // 查询词可能是选区，先算一轮命中，浮层出现时就有高亮
  }, [findOpen]);

  const closeFind = useCallback(() => {
    setFindOpen(false);
    paintHits([], -1);
    if (modeRef.current === "source") {
      sourceEditorRef.current?.focusAt(cursorRef.current.source);
    } else {
      viewRef.current?.focus();
    }
  }, [paintHits]);

  const stepHit = useCallback(
    (delta: number) => {
      setHitIndex((prev) => {
        if (hits.length === 0) return -1;
        if (prev < 0) return delta > 0 ? 0 : hits.length - 1;
        return (prev + delta + hits.length) % hits.length;
      });
    },
    [hits.length],
  );

  /** 替换给定的命中（一处或全部）。两种视图各走各的原生写入路径。 */
  const replaceHits = useCallback(
    (targets: Hit[]) => {
      if (targets.length === 0) return;

      if (modeRef.current === "source") {
        const current = bridgeRef.current?.source ?? source;
        let next = current;
        for (let i = targets.length - 1; i >= 0; i -= 1) {
          const hit = targets[i];
          next =
            next.slice(0, hit.from) +
            expandReplacement(findReplaceText, hit) +
            next.slice(hit.to);
        }
        if (next === current) return;
        const caret = Math.min(
          next.length,
          targets[0].from + expandReplacement(findReplaceText, targets[0]).length,
        );
        commitSource(next, caret);
        // 程序化改文本：commitSource 只回写 PM 与 store，CM 得单独同步
        sourceEditorRef.current?.setDocument(next, caret);
        return;
      }

      const view = viewRef.current;
      if (!view) return;
      const tr = view.state.tr;
      // 从后往前改，前面的偏移才不会失效
      for (const hit of [...targets].sort((a, b) => b.from - a.from)) {
        const size = tr.doc.content.size;
        const from = Math.max(0, Math.min(hit.from, size));
        const to = Math.max(from, Math.min(hit.to, size));
        if (to <= from) continue;
        // insertText 会继承插入点的 mark（跟手打一致）；replaceWith 会把粗体弄丢
        tr.insertText(expandReplacement(findReplaceText, hit), from, to);
      }
      if (!tr.docChanged) return;
      view.dispatch(tr.scrollIntoView());
    },
    [findReplaceText, source],
  );

  const replaceOne = () => {
    const hit = hits[hitIndex];
    if (!hit) return;
    replaceHits([hit]);
  };

  const replaceAll = () => {
    if (hits.length === 0) return;
    const count = hits.length;
    replaceHits(hits);
    onNotify?.(t("find.replacedAll", { count }));
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

  /** 当前选区的源码偏移；两种视图各算各的，再统一换到源码坐标系。 */
  const sourceSelectionRange = useCallback((): { from: number; to: number } | null => {
    if (modeRef.current === "source") {
      const range = sourceEditorRef.current?.getRange();
      return range && range.to > range.from ? range : null;
    }
    const view = viewRef.current;
    const bridge = bridgeRef.current;
    if (!view || !bridge) return null;
    const { from, to } = view.state.selection;
    if (to <= from) return null;
    const start = bridge.pmToSource(from);
    const end = bridge.pmToSource(to);
    return { from: Math.min(start, end), to: Math.max(start, end) };
  }, []);

  /**
   * 在当前光标/选处插入一段 Markdown。block:true 时放到当前行之后，
   * 避免在标题的 `# ` 中间插入把标题拆坏。图片与网页粘贴都走这里，
   * 因此共享 DocumentStore 的一次撤销。
   */
  const insertText = (text: string, options?: { block?: boolean }): boolean => {
    const bridge = bridgeRef.current;
    if (!bridge || !text) return false;
    const range = sourceSelectionRange();
    const from = range?.from ?? cursorRef.current.source;
    const to = range?.to ?? from;
    let insertion = text;
    let at = from;
    if (options?.block) {
      const lineEnd = bridge.source.indexOf("\n", to);
      at = lineEnd === -1 ? bridge.source.length : lineEnd;
      const before = at > 0 && bridge.source[at - 1] !== "\n" ? "\n" : "";
      insertion = `${before}\n${text}\n`;
    }
    const next =
      bridge.source.slice(0, at) +
      insertion +
      bridge.source.slice(options?.block ? at : to);
    commitSource(next, at + insertion.length);
    return true;
  };
  const insertTextRef = useRef(insertText);
  insertTextRef.current = insertText;

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
      seek: (offset: number, length?: number) => {
        const view = viewRef.current;
        const bridge = bridgeRef.current;
        if (!view || !bridge) return false;
        const safe = Math.max(0, Math.min(offset, bridge.source.length));
        const span = length && length > 0 ? length : 0;

        if (modeRef.current === "source") {
          cursorRef.current = { ...cursorRef.current, source: safe };
          setCursor(cursorRef.current);
          sourceEditorRef.current?.focusAt(safe, safe + span);
          return true;
        }

        const size = view.state.doc.content.size;
        const pos = Math.min(bridge.sourceToPM(safe), size);
        const stop = Math.min(pos + span, size);
        view.dispatch(
          view.state.tr
            .setSelection(TextSelection.create(view.state.doc, pos, stop))
            .scrollIntoView(),
        );
        view.focus();
        cursorRef.current = { pm: pos, source: safe };
        setCursor(cursorRef.current);
        return true;
      },
      selectionRange: sourceSelectionRange,
      insertMarkdown: insertText,
      openFind,
      closeFind,
    }),
    [openFind, closeFind, sourceSelectionRange],
  );

  /**
   * 图片粘贴 / 拖入。
   *
   * 必须在 capture 阶段拦：PM 和 CodeMirror 都有自己的 paste 处理器，
   * 等冒泡到父节点再 preventDefault 已经晚了，普通文本会被插进正文。
   * 只有剪贴板里真的有图片文件才拦，平时复制粘贴完全不受影响。
   */
  useEffect(() => {
    const el = wrapRef.current;
    if (!el) return;

    const onPaste = (event: ClipboardEvent) => {
      // 网页复制的内容带 text/html：转成 Markdown 再插入，避免把网页样式
      // 直接灌进编辑器。纯文本或没有 HTML 时交给 PM / CM 原生处理。
      const html = clipboardHtml(event);
      if (html) {
        const { markdown } = htmlToMarkdown(html, document);
        if (markdown) {
          event.preventDefault();
          event.stopPropagation();
          insertTextRef.current(markdown, { block: true });
          onNotify?.(t("toast.pasteConverted"));
          return;
        }
      }
      const items = event.clipboardData?.items;
      if (!items || !onImages) return;
      const files = Array.from(items)
        .filter((item) => item.kind === "file")
        .map((item) => item.getAsFile())
        .filter((file): file is File => Boolean(file && isImageType(file.type)));
      if (files.length === 0) return;
      event.preventDefault();
      event.stopPropagation();
      onImages(files);
    };
    const onDrop = (event: DragEvent) => {
      if (!onImages) return;
      const files = Array.from(event.dataTransfer?.files ?? []).filter((file) =>
        isImageType(file.type),
      );
      if (files.length === 0) return;
      event.preventDefault();
      event.stopPropagation();
      onImages(files);
    };
    const onDragOver = (event: DragEvent) => {
      if (Array.from(event.dataTransfer?.types ?? []).includes("Files")) {
        event.preventDefault();
      }
    };
    el.addEventListener("paste", onPaste, true);
    el.addEventListener("drop", onDrop, true);
    el.addEventListener("dragover", onDragOver, true);
    return () => {
      el.removeEventListener("paste", onPaste, true);
      el.removeEventListener("drop", onDrop, true);
      el.removeEventListener("dragover", onDragOver, true);
    };
  }, [onImages]);

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
        findPlugin,
        createHighlightPlugin(),
      ],
    });
    const view = new EditorView(host, {
      state,
      dispatchTransaction(tr) {
        const next = view.state.apply(tr);
        view.updateState(next);
        // PM 重绘 DOM 后把公式占位节点换成 KaTeX 输出；幂等，不会重复渲染
        // 公式和代码高亮只改 DOM、不改 PM 文档；无条件调用保证外部回灌
        // （fromSourceRef 分支之前）和首次挂载也能着色。两个函数都幂等。
        renderMath(host);
        if (bridgeRef.current)
          renderExtSyntax(host, bridgeRef.current.source);
        // 源码输入 / 撤销回灌引发的事务不再反向提交，避免循环
        if (fromSourceRef.current) return;
        // 输入法组合中的中间态：不序列化、不进撤销栈
        if (composingRef.current || view.composing) return;
        commitPM(next, tr.docChanged);
      },
    });
    viewRef.current = view;
    renderMath(host);
    renderExtSyntax(host, bridge.source);

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
    <main className="editor-shell">
      <div className="editor" id="editor">
        <div
          ref={wrapRef}
          className="doc-wrap"
          data-editor-id={docId}
          data-editor-host={docName}
        >
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
      </div>

      {findOpen && (
        <FindBar
          query={findQuery}
          onQueryChange={setFindQuery}
          replaceText={findReplaceText}
          onReplaceChange={setFindReplaceText}
          showReplace={findShowReplace}
          onToggleReplace={() => setFindShowReplace((v) => !v)}
          caseSensitive={findCase}
          regex={findRegex}
          onToggleCase={() => setFindCase((v) => !v)}
          onToggleRegex={() => setFindRegex((v) => !v)}
          total={hits.length}
          current={hitIndex}
          truncated={findTruncated}
          error={findError}
          focusToken={findFocusToken}
          onNext={() => stepHit(1)}
          onPrev={() => stepHit(-1)}
          onReplaceOne={replaceOne}
          onReplaceAll={replaceAll}
          onClose={closeFind}
        />
      )}
    </main>
  );
});
