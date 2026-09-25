import { beforeEach, describe, expect, it, vi } from "vitest";
import { analyzeNode } from "../src/lib/actions";
import * as ops from "../src/lib/graphOps";
import { decodeShare, encodeShare } from "../src/lib/share";
import { activeGraph, isViewing, useGraphStore } from "../src/store/graphStore";
import { useSettings } from "../src/store/settingsStore";

// The read-only viewer for shared graphs: it never touches or persists the user's own data.

const saved = vi.hoisted(() => {
  const data = new Map<string, string>();
  (globalThis as { localStorage?: unknown }).localStorage = {
    getItem: (k: string) => data.get(k) ?? null,
    setItem: (k: string, v: string) => void data.set(k, v),
    removeItem: (k: string) => void data.delete(k),
  };
  return data;
});

const store = () => useGraphStore.getState();

async function openShared() {
  // Share the user's own graph: the viewer must not be confused by identical node ids.
  const own = activeGraph(store());
  store().openView((await decodeShare(await encodeShare(own, "Shared P"))).graph, "Shared P");
}

beforeEach(() => {
  store().reset();
  useSettings.setState({ connection: "browser", provider: "mock" });
  store().mutate((g) => ops.addNode(ops.addNode(g, { name: "Group" }).graph, { name: "Subgroup" }).graph);
});

describe("shared graph viewer", () => {
  it("shows the shared graph without saving it, and blocks edits and AI", async () => {
    const ownId = store().activeId;
    const before = JSON.stringify(store().graphs[ownId]);
    await openShared();
    expect(isViewing(store())).toBe(true);
    expect(activeGraph(store()).nodes.map((n) => n.name)).toEqual(["Group", "Subgroup"]);

    const first = activeGraph(store()).nodes[0].id;
    store().mutate((g) => ops.removeNode(g, first));
    expect(activeGraph(store()).nodes).toHaveLength(2);
    // The shared concepts were still being checked: they arrive needing a definition, and the viewer leaves them so.
    expect(activeGraph(store()).nodes[0].status).toBe("unclear");
    await analyzeNode(first);
    expect(activeGraph(store()).nodes[0].status).toBe("unclear");
    expect(store().toast).toMatch(/Save a copy/);
    store().forkActive();
    expect(isViewing(store())).toBe(true);

    // Persisted state is the user's own workspace only.
    const persisted = JSON.parse(saved.get("nodestorm")!).state;
    expect(persisted.activeId).toBe(ownId);
    expect(Object.keys(persisted.graphs)).toEqual([ownId]);
    expect(JSON.stringify(store().graphs[ownId])).toBe(before);
    // Export gives the shared graph.
    expect(JSON.parse(store().exportJson())).toMatchObject({ project: { name: "Shared P" }, graphs: [{ nodes: [{}, {}] }] });
  });

  it("closes back to the user's graph", async () => {
    const ownId = store().activeId;
    await openShared();
    store().closeView();
    expect(isViewing(store())).toBe(false);
    expect(store().activeId).toBe(ownId);
    expect(Object.keys(store().graphs)).toEqual([ownId]);
  });

  it("saves a copy as a new project and leaves existing ones alone", async () => {
    const ownProject = store().projectId;
    await openShared();
    expect(store().saveViewCopy()).toBe("Shared P");
    expect(isViewing(store())).toBe(false);
    expect(Object.keys(store().projects)).toHaveLength(2);
    expect(store().projectId).not.toBe(ownProject);
    expect(activeGraph(store()).nodes.map((n) => n.name)).toEqual(["Group", "Subgroup"]);
    // The copy is editable.
    store().mutate((g) => ops.addNode(g, { name: "Ring" }).graph);
    expect(activeGraph(store()).nodes).toHaveLength(3);
  });
});
