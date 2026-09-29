import type { Graph, Prerequisite } from "@nodestorm/shared";
import { describe, expect, it } from "vitest";
import * as ops from "../src/lib/graphOps";
import * as paths from "../src/lib/paths";

const id = (g: Graph, name: string) => g.nodes.find((n) => n.name === name)!.id;
const pre = (name: string): Prerequisite => ({ name, role: "uses", reason: `needs ${name}`, matchesExisting: null });

/** Build a graph from "X needs [A, B]" lines. Names not listed as keys stay missing. */
function build(spec: Record<string, string[]>): Graph {
  let g = ops.emptyGraph();
  for (const name of Object.keys(spec)) g = ops.addNode(g, { name }).graph;
  for (const [name, deps] of Object.entries(spec)) g = ops.applyDeps(g, id(g, name), deps.map(pre));
  return g;
}

const names = (g: Graph, ids: Iterable<string>) => [...ids].map((i) => g.nodes.find((n) => n.id === i)!.name);

describe("learning path", () => {
  const g = build({
    "Quotient Group": ["Group", "Normal Subgroup"],
    "Normal Subgroup": ["Subgroup"],
    Subgroup: ["Group", "Set"], // Set is not in the graph
    Group: [],
    Unrelated: ["Group"],
  });

  it("closure holds all transitive prerequisites and nothing else", () => {
    expect(names(g, paths.prerequisiteClosure(g, id(g, "Quotient Group"))).sort()).toEqual(["Group", "Normal Subgroup", "Subgroup"]);
    expect(paths.prerequisiteClosure(g, id(g, "Group")).size).toBe(0);
  });

  it("orders prerequisites first, ends with the target and marks missing ones", () => {
    const { steps, cyclic } = paths.learningPath(g, id(g, "Quotient Group"));
    expect(cyclic).toBe(false);
    expect(steps.map((s) => (s.kind === "missing" ? `(${s.name})` : s.name))).toEqual([
      "Group", "(Set)", "Subgroup", "Normal Subgroup", "Quotient Group",
    ]);
    // Valid topological order: every node comes after all of its dependencies.
    const pos = new Map(steps.flatMap((s, i) => (s.kind === "node" ? [[s.id, i] as const] : [])));
    for (const s of steps) {
      if (s.kind !== "node") continue;
      for (const d of g.nodes.find((n) => n.id === s.id)!.dependsOn) expect(pos.get(d)!).toBeLessThan(pos.get(s.id)!);
    }
  });

  it("a concept without prerequisites is its own one-step path", () => {
    expect(paths.learningPath(g, id(g, "Group")).steps).toHaveLength(1);
  });
});

describe("cycle detection", () => {
  it("finds no cycles in a DAG", () => {
    const g = build({ A: ["B", "C"], B: ["C"], C: [] });
    expect(paths.findCycles(g)).toEqual([]);
    expect(paths.cycleThrough(g, id(g, "A"))).toBeNull();
  });

  it("detects a two-node cycle created by applying deps", () => {
    const g = build({ A: ["B"], B: ["A"], C: ["A"] });
    const cycles = paths.findCycles(g);
    expect(cycles.map((c) => names(g, c).sort())).toEqual([["A", "B"]]);
    expect(names(g, paths.cycleThrough(g, id(g, "A"))!)).toEqual(["A", "B", "A"]);
    expect(paths.cycleThrough(g, id(g, "C"))).toBeNull(); // depends on the cycle but isn't on it
    // A and B share one edge, and it is flagged.
    const info = paths.cycleInfo(g);
    expect(names(g, info.nodes).sort()).toEqual(["A", "B"]);
    expect(info.links).toEqual(new Set([paths.linkKey(id(g, "A"), id(g, "B")), paths.linkKey(id(g, "B"), id(g, "A"))]));
    expect(paths.learningPath(g, id(g, "C")).cyclic).toBe(true);
  });

  it("detects longer cycles and returns the shortest one through a node", () => {
    const g = build({ A: ["B"], B: ["C"], C: ["A", "D"], D: [] });
    expect(paths.findCycles(g).map((c) => names(g, c).sort())).toEqual([["A", "B", "C"]]);
    expect(names(g, paths.cycleThrough(g, id(g, "B"))!)).toEqual(["B", "C", "A", "B"]);
    expect(paths.cycleInfo(g).links.has(paths.linkKey(id(g, "C"), id(g, "D")))).toBe(false);
  });

  it("sameDependencies: a status update or a move keeps the cycles, new prerequisites or concepts don't", () => {
    const g = build({ A: ["B"], B: ["A"], C: [] });
    expect(paths.sameDependencies(g, g)).toBe(true);
    expect(paths.sameDependencies(g, ops.updateNode(g, id(g, "A"), { status: "checking" }))).toBe(true);
    expect(paths.sameDependencies(g, ops.updateNode(g, id(g, "C"), { position: { x: 9, y: 9 } }))).toBe(true);
    expect(paths.sameDependencies(g, ops.applyDeps(g, id(g, "C"), [pre("A")]))).toBe(false);
    expect(paths.sameDependencies(g, ops.addNode(g, { name: "D" }).graph)).toBe(false);
    expect(paths.sameDependencies(g, ops.removeNode(g, id(g, "C")))).toBe(false);
  });

  it("removing one link of a cycle breaks it", () => {
    const g = build({ A: ["B"], B: ["C"], C: ["A"] });
    const out = ops.removeDependency(g, id(g, "C"), id(g, "A"));
    expect(paths.findCycles(out)).toEqual([]);
    expect(ops.findRelation(out, id(g, "C"), id(g, "A"))).toBeUndefined();
    expect(out.relations).toHaveLength(2);
  });
});
