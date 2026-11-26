import { describe, expect, it, vi } from "vitest";
import {
  Autosave,
  type WorkspaceBackend,
} from "./workspace-storage";
import type { WorkspaceDoc } from "./workspace";

const doc = (source: string): WorkspaceDoc => ({
  id: "note.md",
  title: "note",
  source,
  savedSource: source,
  createdAt: 0,
  updatedAt: 0,
});

function backend(): WorkspaceBackend & { saves: string[] } {
  const saves: string[] = [];
  return {
    saves,
    load: async () => [],
    save: async (target) => {
      saves.push(target.source);
    },
    remove: async () => {},
  };
}

describe("Autosave 的间隔", () => {
  it("连续输入只在停手 delay 之后写一次", async () => {
    vi.useFakeTimers();
    try {
      const store = backend();
      const autosave = new Autosave(store, {}, 700);
      autosave.schedule(doc("a"));
      await vi.advanceTimersByTimeAsync(300);
      autosave.schedule(doc("ab"));
      await vi.advanceTimersByTimeAsync(600);
      expect(store.saves).toEqual([]);
      await vi.advanceTimersByTimeAsync(200);
      expect(store.saves).toEqual(["ab"]);
      autosave.dispose();
    } finally {
      vi.useRealTimers();
    }
  });

  it("改间隔时，已经在等的那次立刻按新间隔重排", async () => {
    vi.useFakeTimers();
    try {
      const store = backend();
      const autosave = new Autosave(store, {}, 2000);
      autosave.schedule(doc("x"));
      await vi.advanceTimersByTimeAsync(500);
      // 用户把「自动保存」从 2 秒调到 0.3 秒：不该再等剩下的 1.5 秒
      autosave.setDelay(300);
      await vi.advanceTimersByTimeAsync(300);
      expect(store.saves).toEqual(["x"]);
      autosave.dispose();
    } finally {
      vi.useRealTimers();
    }
  });

  it("setDelay 接受非法输入时不动原间隔", async () => {
    vi.useFakeTimers();
    try {
      const store = backend();
      const autosave = new Autosave(store, {}, 400);
      autosave.setDelay(Number.NaN);
      autosave.setDelay(0);
      autosave.setDelay(-100);
      autosave.schedule(doc("y"));
      await vi.advanceTimersByTimeAsync(400);
      expect(store.saves).toEqual(["y"]);
      autosave.dispose();
    } finally {
      vi.useRealTimers();
    }
  });
});
