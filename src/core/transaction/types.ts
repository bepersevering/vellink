import type { BlockNode, DocumentIR } from "../ir/types";

/**
 * Transactions and ops — the single entry point for all document changes.
 *
 * Constraints:
 * 1. Every op must produce an inverse op; undo relies on it.
 * 2. applyTransaction is pure: it returns a new IR without mutating the original tree.
 * 3. Transactions are the shared carrier for CRDT sync, plugin listeners and the undo stack.
 */

export interface InsertOp {
  type: "insert";
  /** Insert before this index (position among top-level children) */
  at: number;
  nodes: BlockNode[];
}

export interface DeleteOp {
  type: "delete";
  /** Delete `count` top-level nodes starting at this index */
  at: number;
  count: number;
}

export interface ReplaceOp {
  type: "replace";
  at: number;
  count: number;
  nodes: BlockNode[];
}

export interface UpdateSourceOp {
  type: "updateSource";
  source: string;
}

/**
 * Replace the whole document: swap the IR node tree and source text together.
 * Designed for dual-view sync — the new IR from a WYSIWYG or source edit is one atomic undo step.
 */
export interface ReplaceDocumentOp {
  type: "replaceDocument";
  children: BlockNode[];
  source: string;
}

export type Op =
  | InsertOp
  | DeleteOp
  | ReplaceOp
  | UpdateSourceOp
  | ReplaceDocumentOp;

/** A transaction: a group of atomic ops. */
export interface Transaction {
  id: string;
  ops: Op[];
  /** Inverse ops produced by this transaction (applied in reverse order) */
  inverse: Op[];
  timestamp: number;
  /** For merging continuous typing; replaceDocument transactions with the same key inside the time window merge into one undo step */
  mergeKey?: string;
}

/** Optional behavior for apply. */
export interface ApplyOptions {
  /** Merge a single-op document replacement with the last one if the key matches and the gap is under mergeWindowMs */
  mergeKey?: string;
  mergeWindowMs?: number;
}

export interface TransactionResult {
  document: DocumentIR;
  transaction: Transaction;
}
