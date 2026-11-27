import type { Transaction } from "../transaction/types";

/**
 * Event bus — the only communication channel between plugins and the core.
 * M0 is a synchronous in-memory version; it can later be swapped for Worker/Comlink
 * without callers noticing.
 */

export interface DocumentChangedEvent {
  type: "document:changed";
  transaction: Transaction;
  version: number;
}

export interface DocumentSavedEvent {
  type: "document:saved";
  uri: string;
}

export interface PluginLoadedEvent {
  type: "plugin:loaded";
  id: string;
}

export interface PluginUnloadedEvent {
  type: "plugin:unloaded";
  id: string;
}

export type AppEvent =
  | DocumentChangedEvent
  | DocumentSavedEvent
  | PluginLoadedEvent
  | PluginUnloadedEvent;

type Handler<E extends AppEvent = AppEvent> = (event: E) => void;

export class EventBus {
  private handlers = new Map<AppEvent["type"], Set<Handler>>();

  on<T extends AppEvent["type"]>(
    type: T,
    handler: (event: Extract<AppEvent, { type: T }>) => void,
  ): () => void {
    let set = this.handlers.get(type);
    if (!set) {
      set = new Set();
      this.handlers.set(type, set);
    }
    set.add(handler as Handler);
    return () => set!.delete(handler as Handler);
  }

  emit<E extends AppEvent>(event: E): void {
    const set = this.handlers.get(event.type);
    if (!set) return;
    for (const handler of set) (handler as Handler<E>)(event);
  }

  clear(): void {
    this.handlers.clear();
  }
}

/** Global singleton: one bus per app in M0. */
export const bus = new EventBus();
