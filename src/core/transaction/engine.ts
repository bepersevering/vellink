import type { BlockNode, DocumentIR } from "../ir/types";
import type { Op, Transaction, TransactionResult } from "./types";

/** Generate a simple unique ID (fine for M0; swap in nanoid later). */
let counter = 0;
export function nextId(prefix = "n"): string {
  counter += 1;
  return `${prefix}_${Date.now().toString(36)}_${counter.toString(36)}`;
}

/** Generate the inverse op for a single op. */
function invert(op: Op, doc: DocumentIR): Op {
  switch (op.type) {
    case "insert":
      return { type: "delete", at: op.at, count: op.nodes.length };
    case "delete":
      return {
        type: "insert",
        at: op.at,
        nodes: doc.children.slice(op.at, op.at + op.count),
      };
    case "replace":
      return {
        type: "replace",
        at: op.at,
        count: op.nodes.length,
        nodes: doc.children.slice(op.at, op.at + op.count),
      };
    case "updateSource":
      return { type: "updateSource", source: doc.source };
    case "replaceDocument":
      return {
        type: "replaceDocument",
        children: doc.children,
        source: doc.source,
      };
  }
}

/** Apply a single op, returning the new children and source (pure; doesn't mutate the input). */
function applyOp(
  doc: DocumentIR,
  op: Op,
): { children: BlockNode[]; source: string } {
  const children = doc.children.slice();
  switch (op.type) {
    case "insert":
      children.splice(op.at, 0, ...op.nodes);
      return { children, source: doc.source };
    case "delete":
      children.splice(op.at, op.count);
      return { children, source: doc.source };
    case "replace":
      children.splice(op.at, op.count, ...op.nodes);
      return { children, source: doc.source };
    case "updateSource":
      return { children, source: op.source };
    case "replaceDocument":
      return { children: op.children, source: op.source };
  }
}

/**
 * Commit a transaction: apply ops in order, record their inverses, and bump the version by 1.
 * Inverses are stored in reverse op order so undo can simply apply them forward.
 */
export function commit(
  doc: DocumentIR,
  ops: Op[],
  id: string = nextId("tx"),
): TransactionResult {
  let current: DocumentIR = doc;
  const inverse: Op[] = [];

  for (const op of ops) {
    inverse.push(invert(op, current));
    const next = applyOp(current, op);
    current = {
      ...current,
      children: next.children,
      source: next.source,
      version: current.version + 1,
    };
  }

  const tx: Transaction = {
    id,
    ops,
    inverse: inverse.reverse(),
    timestamp: Date.now(),
  };
  return { document: current, transaction: tx };
}

/** Undo a transaction by applying its inverse ops. */
export function undo(doc: DocumentIR, tx: Transaction): DocumentIR {
  let current = doc;
  for (const op of tx.inverse) {
    const next = applyOp(current, op);
    current = {
      ...current,
      children: next.children,
      source: next.source,
      version: current.version + 1,
    };
  }
  return current;
}
