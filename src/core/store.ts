import { emptyDocument, type DocumentIR } from "./ir/types";
import { commit, undo } from "./transaction/engine";
import type { Op, Transaction } from "./transaction/types";
import { bus } from "./event/bus";
import { commands } from "./command/registry";

/**
 * DocumentStore — M0 验收载体。
 * 把 IR / 事务 / 事件总线 / 命令系统串成一个可用闭环：
 *   改 IR 节点 → 事件总线收到通知 → 撤销后恢复。
 */
export class DocumentStore {
  private doc: DocumentIR;
  private undoStack: Transaction[] = [];

  constructor(initial: DocumentIR = emptyDocument()) {
    this.doc = initial;
    this.registerCommands();
  }

  private registerCommands() {
    commands.register({
      id: "doc.undo",
      title: "撤销",
      keybinding: "Mod+Z",
      run: () => this.undo(),
    });
  }

  getDocument(): DocumentIR {
    return this.doc;
  }

  /** 应用一组 op，并广播 document:changed 事件。 */
  apply(ops: Op[]): Transaction {
    const result = commit(this.doc, ops);
    this.doc = result.document;
    this.undoStack.push(result.transaction);
    bus.emit({
      type: "document:changed",
      transaction: result.transaction,
      version: this.doc.version,
    });
    return result.transaction;
  }

  undo(): boolean {
    const tx = this.undoStack.pop();
    if (!tx) return false;
    this.doc = undo(this.doc, tx);
    bus.emit({
      type: "document:changed",
      transaction: tx,
      version: this.doc.version,
    });
    return true;
  }

  canUndo(): boolean {
    return this.undoStack.length > 0;
  }
}
