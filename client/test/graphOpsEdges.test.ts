import type { Graph } from "@nodestorm/shared";
import { describe, expect, it } from "vitest";
import * as ops from "../src/lib/graphOps";

const dep = (name: string) => ({ name, role: "uses" as const, reason: `needs ${name}`, matchesExisting: null });
const byName = (g: Graph, name: string) => g.nodes.find((n) => n.name === name)!;

describe("folding a concept into its twin keeps its prerequisites", () => {
  it("merge: a concept both sides added keeps the sandbox's prerequisite links and missing prerequisites", () => {
    const base = ops.addNode(ops.emptyGraph(), { name: "Group", definition: "g" });
    const parent0 = ops.applyDeps(base.graph, base.id, []);
    const sb0 = ops.fork(parent0, "S");
    // The sandbox adds "Ring" needing Group (in the graph) and Abelian group (missing)…
    const ring = ops.addNode(sb0, { name: "Ring", definition: "r" });
    const sb = ops.applyDeps(ring.graph, ring.id, [dep("Group"), dep("Abelian group")]);
    // …while the parent adds its own "Ring" without checking it.
    const pr = ops.addNode(parent0, { name: "Ring" });
    const merged = ops.merge(pr.graph, sb);
    const r = byName(merged, "Ring");
    expect(merged.nodes.filter((n) => n.name === "Ring")).toHaveLength(1);
    expect(r.dependsOn).toEqual([base.id]);
    expect(r.missingDeps.map((d) => d.name)).toEqual(["Abelian group"]);
    // Every dependency edge still stands for a dependsOn record.
    for (const rel of merged.relations.filter((x) => x.origin === "dependency")) {
      const a = merged.nodes.find((n) => n.id === rel.a)!;
      expect(a.dependsOn).toContain(rel.b);
    }
  });

  it("redirectNode: the kept concept takes over the folded one's prerequisites", () => {
    const a = ops.addNode(ops.emptyGraph(), { name: "Set", definition: "s" });
    const b = ops.addNode(a.graph, { name: "Group", definition: "g" });
    const c = ops.addNode(b.graph, { name: "Groupe", definition: "g" });
    let g = ops.applyDeps(c.graph, c.id, [dep("Set"), dep("Binary operation")]);
    g = ops.applyDeps(g, b.id, []);
    g = ops.redirectNode(g, c.id, b.id);
    const group = byName(g, "Group");
    expect(group.dependsOn).toEqual([a.id]);
    expect(group.missingDeps.map((d) => d.name)).toEqual(["Binary operation"]);
    expect(group.status).toBe("blocked");
  });
});
