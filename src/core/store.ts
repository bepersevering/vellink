import { emptyDocument, type DocumentIR } from "./ir/types";
import { commit, undo as undoTransaction } from "./transaction/engine";
import type {
  ApplyOptions,
  Op,
  Transaction,
} from "./transaction/types";
import { bus } from "./event/bus";
import { commands } from "./command/registry";

/**
 * DocumentStore — 全应用唯一的撤销权威。
 *
 * M2 起 ProseMirror 不再持有自己的 history：WYSIWYG 与源码视图的每次编辑
 * 都通过 replaceDocument 原子 op 提交到这里，撤销/重做统一由本栈驱动。
 * 这样插件命令（doc.undo / doc.redo）、键盘快捷键、两个视图回退到的是同一份 IR。
 */
export class DocumentStore {
  private doc: DocumentIR;
  private undoStack: Transaction[] = [];
  private redoStack: Transaction[] = [];
  private unregisterCommands: Array<() => void> = [];

  constructor(initial: DocumentIR = emptyDocument()) {
    this.doc = initial;
    this.registerCommands();
  }

  private registerCommands() {
    this.unregisterCommands.push(
      commands.register({
        id: "doc.undo",
        title: "撤销",
        keybinding: "Mod+Z",
        run: () => this.undo(),
      }),
      commands.register({
        id: "doc.redo",
        title: "重做",
        keybinding: "Mod+Shift+Z",
        run: () => this.redo(),
      }),
    );
  }

  /** 卸载 store 时注销命令；React StrictMode 双挂载不会撞重复注册。 */
  dispose(): void {
    for (const unregister of this.unregisterCommands) unregister();
    this.unregisterCommands = [];
  }

  getDocument(): DocumentIR {
    return this.doc;
  }

  /**
   * 应用一组 op，并广播 document:changed 事件。
   *
   * 连续输入合并：同 mergeKey、时间窗内、单条 replaceDocument 事务会合并到
   * 上一次撤销步骤（保留最早的 inverse），避免每敲一个字就产生一个撤销点。
   */
  apply(ops: Op[], options: ApplyOptions = {}): Transaction {
    const result = commit(this.doc, ops);
    this.doc = result.document;

    const last = this.undoStack[this.undoStack.length - 1];
    const canMerge =
      options.mergeKey !== undefined &&
      last !== undefined &&
      last.mergeKey === options.mergeKey &&
      result.transaction.timestamp - last.timestamp <=
        (options.mergeWindowMs ?? 500) &&
      last.ops.length === 1 &&
      ops.length === 1 &&
      last.ops[0].type === "replaceDocument" &&
      ops[0].type === "replaceDocument";

    if (canMerge && last) {
      // 只更新"当前状态"，inverse 保留为最早快照，一次撤销回到连续输入之前
      last.ops = result.transaction.ops;
      last.timestamp = result.transaction.timestamp;
    } else {
      result.transaction.mergeKey = options.mergeKey;
      this.undoStack.push(result.transaction);
    }
    // 新编辑之后，旧的 redo 分支失效
    this.redoStack = [];

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
    this.doc = undoTransaction(this.doc, tx);
    this.redoStack.push(tx);
    bus.emit({
      type: "document:changed",
      transaction: tx,
      version: this.doc.version,
    });
    return true;
  }

  redo(): boolean {
    const tx = this.redoStack.pop();
    if (!tx) return false;
    // 正向重放：重新应用当时的 ops
    this.doc = commit(this.doc, tx.ops, tx.id).document;
    this.undoStack.push(tx);
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

  canRedo(): boolean {
    return this.redoStack.length > 0;
  }
}
