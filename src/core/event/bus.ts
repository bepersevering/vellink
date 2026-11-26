import type { Transaction } from "../transaction/types";

/**
 * 事件总线 — 插件与内核之间的唯一通信通道。
 * M0 只做同步内存版；后续可换 Worker/Comlink 而调用方无感。
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

/** 全局单例：M0 阶段一个应用一个总线。 */
export const bus = new EventBus();
