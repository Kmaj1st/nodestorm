import type { ConceptNode, Graph } from "@nodestorm/shared";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { analyzeNode } from "../src/lib/actions";
import { api } from "../src/lib/api";
import * as ops from "../src/lib/graphOps";
import { repairImport } from "../src/lib/importRepair";
import { dependencyLayers } from "../src/lib/layout";
import { decodeShare, encodeShare } from "../src/lib/share";
import { useGraphStore } from "../src/store/graphStore";
import { useSettings } from "../src/store/settingsStore";

// "Basic concept": a foundation the user takes as given. It never has missing prerequisites, and no prerequisite
// check is run for it.

vi.hoisted(() => {
  const data = new Map<string, string>();
  (globalThis as { localStorage?: unknown }).localStorage = {
    getItem: (k: string) => data.get(k) ?? null,
    setItem: (k: string, v: string) => void data.set(k, v),
    removeItem: (k: string) => void data.delete(k),
  };
});

const node = (id: string, patch: Partial<ConceptNode> = {}): ConceptNode => ({
  id, name: id, definition: `${id} is a thing.`, aliases: [], status: "ok", position: { x: 0, y: 0 }, dependsOn: [], missingDeps: [], ...patch,
});

/** Group needs Set (in the graph, linked) and is missing Binary operation. */
function sample(): Graph {
  let g: Graph = { id: "g1", name: "Main", nodes: [node("Set"), node("Group")], relations: [] };
  g = ops.link(g, "Group", "Set", "uses", "a group is a set");
  return ops.updateNode(g, "Group", {
    status: "blocked",
    missingDeps: [{ name: "Binary operation", role: "uses", reason: "a group has one" }],
  });
}
const find = (g: Graph, id: string) => g.nodes.find((n) => n.id === id)!;

describe("setBasic", () => {
  it("clears missing prerequisites and unblocks, keeping the links it has", () => {
    const g = ops.setBasic(sample(), "Group", true);
    const group = find(g, "Group");
    expect(group).toMatchObject({ basic: true, status: "ok", missingDeps: [], dependsOn: ["Set"] });
    expect(g.relations).toHaveLength(1);
  });

  it("settles a concept waiting for a prerequisite check, but not a running check, an error or an unclear meaning", () => {
    for (const [from, to] of [["pending", "ok"], ["checking", "checking"], ["error", "error"], ["unclear", "unclear"]] as const) {
      const g = ops.setBasic(ops.updateNode(sample(), "Set", { status: from }), "Set", true);
      expect(find(g, "Set").status).toBe(to);
    }
  });

  it("unmarking runs nothing: a ready concept becomes not checked", () => {
    const g = ops.setBasic(ops.setBasic(sample(), "Group", true), "Group", false);
    expect(find(g, "Group").basic).toBeUndefined();
    expect(find(g, "Group").status).toBe("pending");
    expect(find(g, "Group").missingDeps).toEqual([]);
  });

  it("keeps a basic concept settled when later updates say otherwise", () => {
    const g = ops.updateNode(ops.setBasic(sample(), "Set", true), "Set", {
      status: "pending",
      missingDeps: [{ name: "Class", role: "uses", reason: "" }],
    });
    expect(find(g, "Set")).toMatchObject({ status: "ok", missingDeps: [] });
  });

  it("a prerequisite result for a basic concept adds nothing", () => {
    let g = ops.setBasic(sample(), "Set", true);
    g = ops.updateNode(g, "Set", { status: "checking" });
    g = ops.applyDeps(g, "Set", [
      { name: "Group", matchesExisting: "Group", role: "uses", reason: "" },
      { name: "Class", matchesExisting: null, role: "uses", reason: "" },
    ]);
    expect(find(g, "Set")).toMatchObject({ status: "ok", missingDeps: [], dependsOn: [] });
    expect(g.relations).toHaveLength(1);
  });

  it("a basic concept without prerequisites is a foundation (layer 0)", () => {
    const g = ops.setBasic(sample(), "Set", true);
    expect(dependencyLayers(g).get("Set")).toBe(0);
    expect(dependencyLayers(g).get("Group")).toBe(1);
  });
});

describe("the flag travels", () => {
  it("through share links", async () => {
    const out = await decodeShare(await encodeShare(ops.setBasic(sample(), "Group", true), "P"));
    const group = out.graph.nodes.find((n) => n.name === "Group")!;
    expect(group).toMatchObject({ basic: true, status: "ok", missingDeps: [] });
    expect(out.graph.nodes.find((n) => n.name === "Set")!.basic).toBeUndefined();
  });

  it("through import, which drops missing prerequisites a hand-edited file lists for it", () => {
    const g = sample();
    const raw = {
      format: "nodestorm/v1",
      graphs: [{ ...g, nodes: g.nodes.map((n) => (n.id === "Group" ? { ...n, basic: true } : n)) }],
    };
    const group = repairImport(raw).doc.graphs[0].nodes.find((n) => n.id === "Group")!;
    expect(group).toMatchObject({ basic: true, status: "ok", missingDeps: [] });
    // Older files without the flag are unchanged.
    expect(repairImport({ format: "nodestorm/v1", graphs: [g] }).doc.graphs[0].nodes[1]).toMatchObject({ status: "blocked" });
  });

  it("through sandboxes", () => {
    const sb = ops.setBasic(ops.fork(sample(), "Sandbox"), "Group", true);
    expect(find(ops.merge(sample(), sb), "Group")).toMatchObject({ basic: true, missingDeps: [], status: "ok" });
  });
});

describe("in the app", () => {
  const store = () => useGraphStore.getState();
  const graph = (): Graph => store().graphs[store().activeId];
  beforeEach(() => {
    store().reset();
    useSettings.setState({ connection: "browser", provider: "mock", newConcepts: "ask", clarify: { enabled: true, options: 3 } });
  });
  afterEach(() => vi.restoreAllMocks());

  it("marking is one undo step", () => {
    store().mutate(() => ({ ...sample(), id: store().activeId }));
    store().mutate((g) => ops.setBasic(g, "Group", true));
    expect(find(graph(), "Group").missingDeps).toEqual([]);
    store().undo();
    expect(find(graph(), "Group")).toMatchObject({ status: "blocked", missingDeps: [{ name: "Binary operation" }] });
    expect(find(graph(), "Group").basic).toBeUndefined();
  });

  it("skips the AI's prerequisite call for a basic concept", async () => {
    const deps = vi.spyOn(api, "deps");
    store().mutate(() => ops.setBasic({ ...sample(), id: store().activeId }, "Group", true));
    await analyzeNode("Group");
    expect(deps).not.toHaveBeenCalled();
    expect(find(graph(), "Group")).toMatchObject({ status: "ok", missingDeps: [] });
  });
});
