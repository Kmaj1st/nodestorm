import { afterEach, describe, expect, it, vi } from "vitest";
import * as ops from "../src/lib/graphOps";
import { decodeShare, encodeShare } from "../src/lib/share";
import { touchScreen } from "../src/lib/touch";
import { activeGraph, useGraphStore } from "../src/store/graphStore";
import { useView } from "../src/store/viewStore";

// "Select several" (taps add concepts to the selection, for touch screens): a view state of this tab only.

vi.hoisted(() => {
  const data = new Map<string, string>();
  const mem = { getItem: (k: string) => data.get(k) ?? null, setItem: (k: string, v: string) => void data.set(k, v), removeItem: (k: string) => void data.delete(k) };
  const g = globalThis as { localStorage?: unknown; sessionStorage?: unknown };
  g.localStorage = mem;
  g.sessionStorage = mem;
});

describe("Select several", () => {
  afterEach(() => useView.getState().setSelecting(false));

  it("starts off, toggles, and is never remembered with the view preferences", () => {
    expect(useView.getState().selecting).toBe(false);
    useView.getState().setSelecting(true);
    expect(useView.getState().selecting).toBe(true);
    useView.getState().setPrefs({ edgeLabels: false });
    expect(localStorage.getItem("nodestorm-view")).not.toContain("selecting");
    useView.getState().setSelecting(false);
    expect(useView.getState().selecting).toBe(false);
  });
});

describe("Select several ends", () => {
  const store = () => useGraphStore.getState();
  const start = () => {
    store().reset();
    store().mutate((g) => ops.addNode(ops.addNode(g, { name: "Group" }).graph, { name: "Ring" }).graph);
    store().setSelection(activeGraph(store()).nodes.map((n) => n.id));
    useView.getState().setSelecting(true);
  };
  afterEach(() => useView.getState().setSelecting(false));

  it("when another graph (a sandbox) is opened, and the selection goes", () => {
    start();
    store().forkActive("S");
    expect(useView.getState().selecting).toBe(false);
    expect(store().selection).toEqual([]);
    useView.getState().setSelecting(true);
    store().switchTo(activeGraph(store()).parentId!);
    expect(useView.getState().selecting).toBe(false);
  });

  it("when another project is opened", () => {
    start();
    store().newProject("P2");
    expect(useView.getState().selecting).toBe(false);
    expect(store().selection).toEqual([]);
  });

  it("when a share link opens the read-only viewer, and can't be started there", async () => {
    start();
    const shared = (await decodeShare(await encodeShare(activeGraph(store()), "Shared"))).graph;
    store().openView(shared, "Shared");
    expect(useView.getState().selecting).toBe(false);
    useView.getState().setSelecting(true);
    expect(useView.getState().selecting).toBe(false);
    store().closeView();
    useView.getState().setSelecting(true);
    expect(useView.getState().selecting).toBe(true);
  });

  it("but not when the selection is cleared or concepts change", () => {
    start();
    store().setSelection([]);
    store().mutate((g) => ops.addNode(g, { name: "Field" }).graph);
    expect(useView.getState().selecting).toBe(true);
  });
});

describe("touchScreen", () => {
  const g = globalThis as { matchMedia?: unknown };
  afterEach(() => delete g.matchMedia);

  it("is a coarse pointer, and false where matchMedia is missing", () => {
    expect(touchScreen()).toBe(false);
    g.matchMedia = (q: string) => ({ matches: q === "(pointer: coarse)" });
    expect(touchScreen()).toBe(true);
    g.matchMedia = () => ({ matches: false });
    expect(touchScreen()).toBe(false);
  });
});
