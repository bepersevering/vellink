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

describe("Autosave delay", () => {
  it("writes once after typing stops for the delay, not on every keystroke", async () => {
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

  it("reschedules an already-pending save immediately when the delay changes", async () => {
    vi.useFakeTimers();
    try {
      const store = backend();
      const autosave = new Autosave(store, {}, 2000);
      autosave.schedule(doc("x"));
      await vi.advanceTimersByTimeAsync(500);
      // The user changes autosave from 2s to 0.3s: don't wait out the remaining 1.5s
      autosave.setDelay(300);
      await vi.advanceTimersByTimeAsync(300);
      expect(store.saves).toEqual(["x"]);
      autosave.dispose();
    } finally {
      vi.useRealTimers();
    }
  });

  it("leaves the delay unchanged when setDelay receives invalid input", async () => {
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
