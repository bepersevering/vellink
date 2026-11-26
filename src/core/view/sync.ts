/**
 * 双视图同步桥 — Editor UI 与核心层的唯一接缝。
 *
 * 职责：
 * 1. 持有当前「源码 ↔ PM 文档」的映射视图（PMView），两个方向共用同一份锚点。
 * 2. WYSIWYG 编辑后：serializePM → 新源码 → 重新解析 IR → 重建映射。
 * 3. 源码编辑后：parseMarkdown → 新 IR → buildPMView → 新 PM 文档与映射。
 * 4. 光标：PM pos ↔ source offset 都走当前映射，切换视图时不丢位置。
 *
 * 刻意不做的事：
 * - 不碰撤销栈（PM 自己的 history 与 DocumentStore 的统一留到下一步）。
 * - 不处理 IME 组合输入（真实浏览器联调项）。
 * - 不做增量序列化（见 serialize.ts 的设计说明）。
 */

import type { Node as PMNode } from "prosemirror-model";
import type { EditorState } from "prosemirror-state";
import type { DocumentIR } from "../ir/types";
import { parseMarkdown } from "../parser/markdown";
import {
  buildPMView,
  pmToSource,
  sourceToPM,
  type PMView,
} from "./mapping";
import { serializePM } from "./serialize";

/** 一次同步后的光标快照。 */
export interface CursorSnapshot {
  /** ProseMirror 文档坐标 */
  pm: number;
  /** Markdown 源码 UTF-16 偏移 */
  source: number;
}

/** 同步结果：给 React 层更新状态用。 */
export interface SyncSnapshot {
  source: string;
  ir: DocumentIR;
  cursor: CursorSnapshot;
}

/** 源码 → PM 同步结果。 */
export interface FromSourceResult {
  /** 用于整体替换 PM 文档的新 doc */
  doc: PMNode;
  snapshot: SyncSnapshot;
}

export class ViewBridge {
  private sourceText: string;
  private documentIR: DocumentIR;
  /** 当前 PM doc ↔ 当前 sourceText 的权威映射。 */
  private mapping: PMView;

  constructor(initialSource: string) {
    this.sourceText = initialSource;
    this.documentIR = parseMarkdown({ source: initialSource }).ir;
    this.mapping = buildPMView(this.documentIR);
  }

  /** 初始 PM 文档（只在挂载 EditorView 时用一次）。 */
  get doc(): PMNode {
    return this.mapping.doc;
  }

  get source(): string {
    return this.sourceText;
  }

  get ir(): DocumentIR {
    return this.documentIR;
  }

  /**
   * WYSIWYG 侧发生文档变更（或仅光标移动）后调用。
   * docChanged 时重新序列化；纯选区变化只更新光标映射，不碰源码。
   */
  fromPM(state: EditorState, docChanged: boolean): SyncSnapshot {
    const pm = state.selection.from;
    if (docChanged) {
      const { markdown, anchors } = serializePM(state.doc);
      this.sourceText = markdown;
      this.documentIR = parseMarkdown({ source: markdown, previous: this.documentIR }).ir;
      this.mapping = { doc: state.doc, anchors };
    }
    return {
      source: this.sourceText,
      ir: this.documentIR,
      cursor: { pm, source: this.pmToSource(pm) },
    };
  }

  /**
   * 源码侧发生输入后调用。
   * 重新解析并构建 PM 文档；返回整体替换用的 doc 与光标快照。
   * caret 是源码 textarea 的 selectionStart。
   */
  fromSource(nextSource: string, caret: number): FromSourceResult {
    this.sourceText = nextSource;
    this.documentIR = parseMarkdown({
      source: nextSource,
      previous: this.documentIR,
    }).ir;
    this.mapping = buildPMView(this.documentIR);
    const safeCaret = Math.max(0, Math.min(caret, nextSource.length));
    const pm = sourceToPM(this.mapping, safeCaret);
    return {
      doc: this.mapping.doc,
      snapshot: {
        source: nextSource,
        ir: this.documentIR,
        cursor: { pm, source: safeCaret },
      },
    };
  }

  /**
   * 撤销/重做后回灌已保存的 IR：重新构建 PM 文档与映射，但不重新解析源码。
   * 与 fromSource 的区别是这里不需要产生新文档对象之外的事务。
   */
  reset(ir: DocumentIR): void {
    this.sourceText = ir.source;
    this.documentIR = ir;
    this.mapping = buildPMView(ir);
  }

  /** 当前 PM pos → 当前源码 offset。 */
  pmToSource(pos: number): number {
    return pmToSource(this.mapping, pos);
  }

  /** 当前源码 offset → 当前 PM pos。 */
  sourceToPM(offset: number): number {
    return sourceToPM(this.mapping, offset);
  }
}
