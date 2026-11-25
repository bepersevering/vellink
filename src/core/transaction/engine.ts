import type { BlockNode, DocumentIR } from "../ir/types";
import type { Op, Transaction, TransactionResult } from "./types";

/** 生成简单唯一 ID（M0 够用，后续换 nanoid）。 */
let counter = 0;
export function nextId(prefix = "n"): string {
  counter += 1;
  return `${prefix}_${Date.now().toString(36)}_${counter.toString(36)}`;
}

/** 为单个 op 生成反向 op。 */
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
  }
}

/** 应用单个 op，返回新的 children 与 source（纯函数，不改入参）。 */
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
  }
}

/**
 * 提交事务：依次应用 ops，记录 inverse，版本 +1。
 * inverse 按 op 逆序存储，撤销时正序应用即可还原。
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

/** 撤销一个事务：应用其 inverse。 */
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
