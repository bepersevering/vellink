/**
 * Dual-view sync bridge — the only seam between the Editor UI and the core layer.
 *
 * Responsibilities:
 * 1. Hold the current "source ↔ PM document" mapping view (PMView); both directions share the
 *    same anchors.
 * 2. After a WYSIWYG edit: serializePM → new source → re-parse IR → rebuild mapping.
 * 3. After a source edit: parseMarkdown → new IR → buildPMView → new PM document and mapping.
 * 4. Cursor: PM pos ↔ source offset both go through the current mapping, so switching views
 *    never loses the position.
 *
 * Deliberately out of scope:
 * - No undo stack (unifying PM's own history with DocumentStore is left for later).
 * - No IME composition handling (to be verified in a real browser).
 * - No incremental serialization (see the design notes in serialize.ts).
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

/** Cursor snapshot after a sync. */
export interface CursorSnapshot {
  /** ProseMirror document position */
  pm: number;
  /** UTF-16 offset in the Markdown source */
  source: number;
}

/** Sync result, used by the React layer to update state. */
export interface SyncSnapshot {
  source: string;
  ir: DocumentIR;
  cursor: CursorSnapshot;
}

/** Result of a source → PM sync. */
export interface FromSourceResult {
  /** New doc for replacing the whole PM document */
  doc: PMNode;
  snapshot: SyncSnapshot;
}

export class ViewBridge {
  private sourceText: string;
  private documentIR: DocumentIR;
  /** Authoritative mapping between the current PM doc and the current sourceText. */
  private mapping: PMView;

  constructor(initialSource: string) {
    this.sourceText = initialSource;
    this.documentIR = parseMarkdown({ source: initialSource }).ir;
    this.mapping = buildPMView(this.documentIR);
  }

  /** Initial PM document (used only once when mounting the EditorView). */
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
   * Called after a document change (or just a cursor move) on the WYSIWYG side.
   * When docChanged is true, re-serialize; a selection-only change just updates the cursor
   * mapping and leaves the source untouched.
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
   * Called after input on the source side.
   * Re-parses and builds a PM document; returns the doc for a full replacement and a cursor
   * snapshot. `caret` is the source textarea's selectionStart.
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
   * Feed back a saved IR after undo/redo: rebuild the PM document and mapping without re-parsing
   * the source. Unlike fromSource, no transaction beyond creating a new document object is needed.
   */
  reset(ir: DocumentIR): void {
    this.sourceText = ir.source;
    this.documentIR = ir;
    this.mapping = buildPMView(ir);
  }

  /** Current PM pos → current source offset. */
  pmToSource(pos: number): number {
    return pmToSource(this.mapping, pos);
  }

  /** Current source offset → current PM pos. */
  sourceToPM(offset: number): number {
    return sourceToPM(this.mapping, offset);
  }
}
