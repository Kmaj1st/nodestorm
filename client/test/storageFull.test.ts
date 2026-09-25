import { beforeEach, describe, expect, it, vi } from "vitest";
import * as ops from "../src/lib/graphOps";
import { activeGraph, useGraphStore } from "../src/store/graphStore";

// Browser storage that is full (or blocked) must not break editing: the change still happens, and the user is told
// it isn't being saved.

const storage = vi.hoisted(() => {
  const data = new Map<string, string>();
  const s = { full: false, data };
  (globalThis as { localStorage?: unknown }).localStorage = {
    getItem: (k: string) => data.get(k) ?? null,
    setItem: (k: string, v: string) => {
      if (s.full) throw new DOMException("The quota has been exceeded.", "QuotaExceededError");
      data.set(k, v);
    },
    removeItem: (k: string) => void data.delete(k),
  };
  return s;
});

const store = () => useGraphStore.getState();

beforeEach(() => {
  storage.full = false;
  store().reset();
  store().setToast(null);
});

describe("graph store with full storage", () => {
  it("keeps the change and says it couldn't be saved", () => {
    storage.full = true;
    expect(() => store().mutate((g) => ops.addNode(g, { name: "Group" }).graph)).not.toThrow();
    expect(activeGraph(store()).nodes.map((n) => n.name)).toEqual(["Group"]);
    expect(store().toast).toMatch(/storage/i);
    expect(store().toastKind).toBe("error");
  });

  it("says so once, not on every change, and saves again once there is room", () => {
    storage.full = true;
    store().mutate((g) => ops.addNode(g, { name: "Group" }).graph);
    store().setToast(null);
    store().mutate((g) => ops.addNode(g, { name: "Ring" }).graph);
    expect(store().toast).toBeNull();
    storage.full = false;
    store().mutate((g) => ops.addNode(g, { name: "Field" }).graph);
    expect(storage.data.get("nodestorm")).toContain("Field");
    // Full again later: said again.
    storage.full = true;
    store().mutate((g) => ops.addNode(g, { name: "Module" }).graph);
    expect(store().toast).toMatch(/storage/i);
  });
});
