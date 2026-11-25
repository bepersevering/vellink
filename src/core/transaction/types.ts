import type { BlockNode, DocumentIR } from "../ir/types";

/**
 * 事务与操作 — 所有文档修改的唯一入口。
 *
 * 约束：
 * 1. 每个 op 必须能生成 inverse（反向 op），undo 靠它。
 * 2. applyTransaction 是纯函数：返回新 IR，不改原树。
 * 3. 事务是 CRDT 同步、插件监听、撤销栈的共同载体。
 */

export interface InsertOp {
  type: "insert";
  /** 插入到该索引之前（顶层 children 位置） */
  at: number;
  nodes: BlockNode[];
}

export interface DeleteOp {
  type: "delete";
  /** 从该索引开始删除 count 个顶层节点 */
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

export type Op = InsertOp | DeleteOp | ReplaceOp | UpdateSourceOp;

/** 事务：一组原子 op。 */
export interface Transaction {
  id: string;
  ops: Op[];
  /** 该事务生成的反向 op 序列（按逆序应用） */
  inverse: Op[];
  timestamp: number;
}

export interface TransactionResult {
  document: DocumentIR;
  transaction: Transaction;
}
