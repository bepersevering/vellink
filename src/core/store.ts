import { emptyDocument, type DocumentIR } from "./ir/types";
import { commit, undo as undoTransaction } from "./transaction/engine";
import type {
  ApplyOptions,
  Op,
  Transaction,
} from "./transaction/types";
import { bus, type EventBus } from "./event/bus";
import { commands, type CommandRegistry } from "./command/registry";

/**
 * DocumentStore — the app's single source of truth for undo.
 *
 * Since M2, ProseMirror no longer keeps its own history: every edit from the WYSIWYG and source
 * views is committed here as an atomic replaceDocument op, and undo/redo are driven solely by
 * this stack. Plugin commands (doc.undo / doc.redo), keyboard shortcuts and both views therefore
 * roll back to the same IR.
 */
export class DocumentStore {
  private doc: DocumentIR;
  private undoStack: Transaction[] = [];
  private redoStack: Transaction[] = [];
  private unregisterCommands: Array<() => void> = [];
  /** View/workspace subscriptions: notified whenever the document changes, from any source (editor, plugin command or undo). */
  private readonly listeners = new Set<() => void>();

  constructor(
    initial: DocumentIR = emptyDocument(),
    private readonly registry: CommandRegistry = commands,
    private readonly eventBus: EventBus = bus,
  ) {
    this.doc = initial;
    this.registerCommands();
  }

  private registerCommands() {
    this.unregisterCommands.push(
      this.registry.register({
        id: "doc.undo",
        title: "撤销",
        keybinding: "Mod+Z",
        run: () => this.undo(),
      }),
      this.registry.register({
        id: "doc.redo",
        title: "Redo",
        keybinding: "Mod+Shift+Z",
        run: () => this.redo(),
      }),
    );
  }

  /** Unregister commands when the store is disposed; React StrictMode's double-mount won't cause duplicate registrations. */
  dispose(): void {
    for (const unregister of this.unregisterCommands) unregister();
    this.unregisterCommands = [];
    this.listeners.clear();
  }

  /**
   * Subscribe to document changes (including plugin writes and undo/redo).
   *
   * Views use it to re-ingest IR after changes they didn't initiate; the workspace uses it to
   * sync dirty state. Callbacks are synchronous, so callers must guard with a flag to avoid
   * self-triggering loops.
   */
  subscribe(listener: () => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  private notifyListeners(): void {
    for (const listener of this.listeners) listener();
  }

  getDocument(): DocumentIR {
    return this.doc;
  }

  /**
   * Replace the whole document with external content (the file was changed by another editor or git).
   *
   * Unlike apply, this is a "file reload": the old undo stack points at a different document, so
   * continuing to undo would take the user back to a history that no longer exists. We clear it
   * and notify views to re-ingest.
   */
  reset(ir: DocumentIR): void {
    this.doc = ir;
    this.undoStack = [];
    this.redoStack = [];
    this.notifyListeners();
  }

  /**
   * Apply a group of ops and broadcast a document:changed event.
   *
   * Continuous typing is merged: a single replaceDocument transaction with the same mergeKey
   * inside the time window folds into the previous undo step (keeping the earliest inverse), so
   * each keystroke doesn't create its own undo point.
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
      // Only update the "current state"; keep the earliest inverse so one undo returns to before the typing burst
      last.ops = result.transaction.ops;
      last.timestamp = result.transaction.timestamp;
    } else {
      result.transaction.mergeKey = options.mergeKey;
      this.undoStack.push(result.transaction);
    }
    // A new edit invalidates the old redo branch
    this.redoStack = [];

    this.eventBus.emit({
      type: "document:changed",
      transaction: result.transaction,
      version: this.doc.version,
    });
    this.notifyListeners();
    return result.transaction;
  }

  undo(): boolean {
    const tx = this.undoStack.pop();
    if (!tx) return false;
    this.doc = undoTransaction(this.doc, tx);
    this.redoStack.push(tx);
    this.eventBus.emit({
      type: "document:changed",
      transaction: tx,
      version: this.doc.version,
    });
    this.notifyListeners();
    return true;
  }

  redo(): boolean {
    const tx = this.redoStack.pop();
    if (!tx) return false;
    // Replay forward: re-apply the original ops
    this.doc = commit(this.doc, tx.ops, tx.id).document;
    this.undoStack.push(tx);
    this.eventBus.emit({
      type: "document:changed",
      transaction: tx,
      version: this.doc.version,
    });
    this.notifyListeners();
    return true;
  }

  canUndo(): boolean {
    return this.undoStack.length > 0;
  }

  canRedo(): boolean {
    return this.redoStack.length > 0;
  }
}
