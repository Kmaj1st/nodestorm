import type { Graph } from "@nodestorm/shared";
import { beforeEach, describe, expect, it, vi } from "vitest";
import * as ops from "../src/lib/graphOps";
import { activeGraph, useGraphStore } from "../src/store/graphStore";

// The graph store's project and sandbox actions and its saved state: the places where a slip loses the user's work.

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
const names = (g: Graph = activeGraph(store())) => g.nodes.map((n) => n.name).sort();
const addNode = (name: string, graphId?: string) => store().mutate((g) => ops.addNode(g, { name }).graph, graphId);

beforeEach(() => {
  store().reset();
  store().setToast(null);
});

describe("graph store: sandboxes", () => {
  it("merging a sandbox brings its changes into the parent as one undo step and re-parents nested sandboxes", () => {
    addNode("Group");
    const mainId = store().activeId;
    store().forkActive("Try");
    const sandboxId = store().activeId;
    expect(store().graphs[sandboxId].parentId).toBe(mainId);
    addNode("Ring");
    addNode("Field");
    store().forkActive("Nested");
    const nestedId = store().activeId;

    store().mergeSandbox(sandboxId);
    expect(store().activeId).toBe(mainId);
    expect(store().graphs[sandboxId]).toBeUndefined();
    expect(store().history[sandboxId]).toBeUndefined();
    expect(store().graphs[nestedId].parentId).toBe(mainId);
    expect(names()).toEqual(["Field", "Group", "Ring"]);

    store().undo();
    expect(names()).toEqual(["Group"]);
    store().redo();
    expect(names()).toEqual(["Field", "Group", "Ring"]);
  });

  it("merging a graph that is not a sandbox does nothing", () => {
    addNode("Group");
    const before = store().graphs;
    store().mergeSandbox(store().activeId);
    store().mergeSandbox("missing");
    expect(store().graphs).toBe(before);
  });

  it("discarding a sandbox leaves the parent as it was and goes back to it", () => {
    addNode("Group");
    const mainId = store().activeId;
    store().forkActive();
    const sandboxId = store().activeId;
    addNode("Ring");
    store().forkActive();
    const nestedId = store().activeId;
    store().switchTo(sandboxId);

    store().discardSandbox(sandboxId);
    expect(store().activeId).toBe(mainId);
    expect(store().graphs[sandboxId]).toBeUndefined();
    expect(store().graphs[nestedId].parentId).toBe(mainId);
    expect(names()).toEqual(["Group"]);
    // The main graph itself can't be discarded.
    store().discardSandbox(mainId);
    expect(store().graphs[mainId]).toBeDefined();
  });

  it("sandboxes are numbered per project and a shared graph in the viewer can't be forked", () => {
    store().forkActive();
    expect(activeGraph(store()).name).toMatch(/1/);
    store().switchTo(activeGraph(store()).parentId!);
    store().forkActive();
    expect(activeGraph(store()).name).toMatch(/2/);
    const count = Object.keys(store().graphs).length;
    store().openView(activeGraph(store()), "Shared");
    store().forkActive();
    expect(Object.keys(store().graphs)).toHaveLength(count + 1); // the viewer's copy only
  });
});

describe("graph store: projects", () => {
  it("deleting a project drops its graphs and their undo steps, and clears the selection when it was open", () => {
    const first = store().projectId;
    addNode("Group");
    const firstGraph = store().activeId;
    store().newProject("Second");
    const second = store().projectId;
    addNode("Ring");
    store().switchProject(first);
    store().setSelection([activeGraph(store()).nodes[0].id]);

    store().deleteProject(first);
    expect(store().projects[first]).toBeUndefined();
    expect(store().graphs[firstGraph]).toBeUndefined();
    expect(store().history[firstGraph]).toBeUndefined();
    expect(store().projectId).toBe(second);
    expect(store().selection).toEqual([]);
    expect(names()).toEqual(["Ring"]);
    store().deleteProject("missing"); // no-op
    expect(store().projectId).toBe(second);
  });

  it("exports the open project with its sandboxes and imports it as a new project with fresh ids", () => {
    addNode("Group");
    store().forkActive("Try");
    addNode("Ring");
    const json = store().exportJson();
    const doc = JSON.parse(json);
    expect(doc.format).toBe("nodestorm/v1");
    expect(doc.graphs).toHaveLength(2);
    expect(doc.graphs[0].parentId).toBeUndefined(); // main graph first

    const before = Object.keys(store().projects).length;
    const { name, fixes } = store().importJson(json);
    expect(fixes).toEqual([]);
    expect(Object.keys(store().projects)).toHaveLength(before + 1);
    expect(store().projects[store().projectId].name).toBe(name);
    const graphs = Object.values(store().graphs).filter((g) => !doc.graphs.some((d: Graph) => d.id === g.id));
    expect(graphs).toHaveLength(2);
    const main = graphs.find((g) => !g.parentId)!;
    expect(names(main)).toEqual(["Group"]);
    expect(names(graphs.find((g) => g.parentId)!)).toEqual(["Group", "Ring"]);
    expect(graphs.find((g) => g.parentId)!.parentId).toBe(main.id);
  });

  it("a shared graph open in the viewer is exported alone and never saved into the workspace", () => {
    addNode("Mine");
    store().openView({ ...activeGraph(store()), nodes: [] }, "Shared");
    const doc = JSON.parse(store().exportJson());
    expect(doc.project.name).toBe("Shared");
    expect(doc.graphs).toHaveLength(1);
    expect(doc.graphs[0].nodes).toEqual([]);
    const persisted = JSON.parse(saved.get("nodestorm")!).state;
    expect(Object.keys(persisted.graphs)).not.toContain(store().activeId);
  });
});

describe("graph store: saved state", () => {
  it("reloads what was saved, and a check that was running when the page closed is marked failed", async () => {
    addNode("Group");
    const id = activeGraph(store()).nodes[0].id;
    store().mutate((g) => ops.updateNode(g, id, { status: "checking" }));
    const graphId = store().activeId;
    store().reset();
    expect(store().graphs[graphId]).toBeUndefined();
    // reset() saved the empty state; put the earlier one back as if the page were reloaded.
    saved.set("nodestorm", JSON.stringify({ state: savedState(graphId, id), version: 2 }));
    await useGraphStore.persist.rehydrate();
    const n = store().graphs[graphId].nodes[0];
    expect(n.name).toBe("Group");
    expect(n.status).toBe("error");
    expect(n.error).toBeTruthy();
  });

  it("a version 1 save (one main graph and its sandboxes) becomes a project", async () => {
    const main = ops.addNode({ ...emptyGraph("g-main"), name: "Main" }, { name: "Group" }).graph;
    const sandbox = { ...ops.addNode({ ...emptyGraph("g-sb"), name: "Try" }, { name: "Ring" }).graph, parentId: "g-main" };
    saved.set("nodestorm", JSON.stringify({ state: { graphs: { "g-main": main, "g-sb": sandbox }, mainId: "g-main", activeId: "g-sb" }, version: 1 }));
    await useGraphStore.persist.rehydrate();
    const p = store().projects[store().projectId];
    expect(p.mainId).toBe("g-main");
    expect(store().activeId).toBe("g-sb");
    expect(names(store().graphs["g-main"])).toEqual(["Group"]);
    expect(store().graphs["g-sb"].parentId).toBe("g-main");
  });

  it("a damaged save is repaired, keeps the good concepts and says what was fixed", async () => {
    const g = ops.addNode(emptyGraph("g1"), { name: "Group" }).graph;
    const bad = { ...g, nodes: [...g.nodes, { id: 7, name: null }] };
    saved.set(
      "nodestorm",
      JSON.stringify({ state: { graphs: { g1: bad }, projects: { p1: { id: "p1", name: "P", mainId: "g1", createdAt: 1 } }, projectId: "p1", activeId: "g1" }, version: 2 }),
    );
    await useGraphStore.persist.rehydrate();
    expect(names(store().graphs.g1)).toEqual(["Group"]);
    expect(store().toastKind).toBe("info");
    expect(store().toast).toBeTruthy();
  });
});

function emptyGraph(id: string): Graph {
  const g = activeGraph(store());
  return { ...g, id, nodes: [], relations: [], parentId: undefined };
}

function savedState(graphId: string, nodeId: string) {
  const g = emptyGraph(graphId);
  const node = { ...ops.addNode(g, { name: "Group" }).graph.nodes[0], id: nodeId, status: "checking" };
  return {
    graphs: { [graphId]: { ...g, nodes: [node] } },
    projects: { p1: { id: "p1", name: "P", mainId: graphId, createdAt: 1 } },
    projectId: "p1",
    activeId: graphId,
  };
}
