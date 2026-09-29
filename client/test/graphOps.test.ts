import type { Graph } from "@nodestorm/shared";
import { describe, expect, it } from "vitest";
import * as ops from "../src/lib/graphOps";

const node = (g: Graph, name: string) => g.nodes.find((n) => n.name === name)!;

function theoremScenario() {
  let g = ops.emptyGraph();
  const hom = ops.addNode(g, { name: "Homomorphism" });
  g = ops.applyDeps(hom.graph, hom.id, []);
  const thm = ops.addNode(g, { name: "First Isomorphism Theorem" });
  g = ops.applyDeps(thm.graph, thm.id, [
    { name: "homomorphisms", role: "uses", reason: "starts from φ", matchesExisting: null },
    { name: "Isomorphism", role: "derives", reason: "concludes G/ker φ ≅ im φ", matchesExisting: null },
  ]);
  return { g, homId: hom.id, thmId: thm.id };
}

describe("dependencies", () => {
  it("links existing prerequisites (plural-insensitive) and blocks on missing ones", () => {
    const { g, homId, thmId } = theoremScenario();
    const thm = node(g, "First Isomorphism Theorem");
    expect(thm.status).toBe("blocked");
    expect(thm.dependsOn).toEqual([homId]);
    expect(thm.missingDeps.map((d) => d.name)).toEqual(["Isomorphism"]);
    const rel = ops.findRelation(g, thmId, homId)!;
    expect(rel.origin).toBe("dependency");
    expect(rel.a).toBe(thmId);
    // One active label from the dependent; the prerequisite's side is "none" (no passive "is used by").
    expect(rel.aToB.kind).toBe("using");
    expect(rel.bToA.kind).toBe("none");
  });

  it("installing the missing node unblocks the dependent and links it", () => {
    const { g, thmId } = theoremScenario();
    const iso = ops.addNode(g, { name: "isomorphism" });
    const thm = node(iso.graph, "First Isomorphism Theorem");
    expect(thm.status).toBe("ok");
    expect(thm.missingDeps).toEqual([]);
    expect(thm.dependsOn).toContain(iso.id);
    expect(ops.findRelation(iso.graph, thmId, iso.id)?.aToB.kind).toBe("deriving");
  });

  it("does not add duplicate nodes", () => {
    const { g, homId } = theoremScenario();
    const r = ops.addNode(g, { name: "HOMOMORPHISM" });
    expect(r.existed).toBe(true);
    expect(r.id).toBe(homId);
    expect(r.graph).toBe(g);
  });

  it("removing one direction of a two-way dependency keeps the edge for the other direction", () => {
    const { g, homId, thmId } = theoremScenario();
    const cyc = ops.applyDeps(g, homId, [{ name: "First Isomorphism Theorem", role: "uses", reason: "wrong", matchesExisting: null }]);
    expect(node(cyc, "Homomorphism").dependsOn).toEqual([thmId]);
    expect(cyc.relations).toHaveLength(1); // both directions share one edge

    // Drop the direction the edge describes (theorem → homomorphism): the edge flips to describe the rest.
    const a = ops.removeDependency(cyc, thmId, homId);
    expect(node(a, "First Isomorphism Theorem").dependsOn).toEqual([]);
    expect(a.relations).toHaveLength(1);
    expect(a.relations[0]).toMatchObject({ a: homId, b: thmId, origin: "dependency" });

    // Drop the other direction: the edge stays as it was.
    const b = ops.removeDependency(cyc, homId, thmId);
    expect(node(b, "Homomorphism").dependsOn).toEqual([]);
    expect(b.relations).toEqual(cyc.relations);
  });

  it("installed nodes are placed clear of existing ones", () => {
    const { g, thmId } = theoremScenario();
    const first = ops.installPosition(g, thmId, 0);
    const g2 = ops.addNode(g, { name: "Isomorphism", position: first }).graph;
    const second = ops.installPosition(g2, thmId, 0);
    expect(second.y).toBe(first.y);
    expect(second.x - first.x).toBeGreaterThanOrEqual(240);
    // ...clear enough for addNode (which keeps LAYOUT_GAP around a new concept) to leave it on that spot.
    const g3 = ops.addNode(g2, { name: "Kernel", position: second });
    expect(g3.graph.nodes.find((n) => n.id === g3.id)?.position).toEqual(second);
  });

  it("removing a node cleans up relations and dependsOn", () => {
    const { g, homId } = theoremScenario();
    const out = ops.removeNode(g, homId);
    expect(out.relations).toHaveLength(0);
    expect(node(out, "First Isomorphism Theorem").dependsOn).toEqual([]);
  });
});

describe("relations", () => {
  it("upserting in the opposite orientation swaps directions", () => {
    const { g, homId, thmId } = theoremScenario();
    const out = ops.upsertRelation(
      g, homId, thmId,
      { kind: "is used by", explanation: "hom→thm" },
      { kind: "applies", explanation: "thm→hom" },
      "mix",
    );
    expect(out.relations).toHaveLength(1);
    const r = out.relations[0];
    expect(r.a).toBe(thmId);
    expect(r.aToB.explanation).toBe("thm→hom");
    expect(r.bToA.explanation).toBe("hom→thm");
    expect(r.origin).toBe("mix");
  });
});

describe("sandboxes", () => {
  it("fork is an isolated deep copy", () => {
    const { g } = theoremScenario();
    const sb = ops.fork(g, "Sandbox 1");
    expect(sb.parentId).toBe(g.id);
    expect(sb.id).not.toBe(g.id);
    const changed = ops.addNode(sb, { name: "Isomorphism" }).graph;
    expect(changed.nodes).toHaveLength(3);
    expect(g.nodes).toHaveLength(2);
    expect(node(g, "First Isomorphism Theorem").status).toBe("blocked");
    sb.nodes[0].name = "mutated";
    expect(g.nodes[0].name).toBe("Homomorphism");
  });

  it("merge brings sandbox work back without deleting parent-only content", () => {
    const { g } = theoremScenario();
    const sb = ops.addNode(ops.fork(g, "S"), { name: "Isomorphism" }).graph;
    const parent = ops.addNode(g, { name: "Kernel" }).graph; // added to parent after the fork
    const merged = ops.merge(parent, sb);
    expect(merged.id).toBe(g.id);
    expect(merged.nodes.map((n) => n.name).sort()).toEqual(["First Isomorphism Theorem", "Homomorphism", "Isomorphism", "Kernel"]);
    expect(node(merged, "First Isomorphism Theorem").status).toBe("ok");
  });
});

describe("choosing a meaning", () => {
  it("renames to the chosen sense, keeps the original name as an alias, and links waiting dependents", () => {
    let g = ops.emptyGraph();
    const law = ops.addNode(g, { name: "Law of Large Numbers" });
    g = ops.applyDeps(law.graph, law.id, [{ name: "Expectation (probability)", role: "uses", reason: "sample mean → E[X]", matchesExisting: null }]);
    const exp = ops.addNode(g, { name: "Expectation" });
    const r = ops.applySense(exp.graph, exp.id, { name: "Expectation (probability)", definition: "E[X]" });
    const n = node(r.graph, "Expectation (probability)");
    expect(r.merged).toBe(false);
    expect(n.aliases).toContain("Expectation");
    expect(n.definition).toBe("E[X]");
    expect(node(r.graph, "Law of Large Numbers").status).toBe("ok");
    expect(node(r.graph, "Law of Large Numbers").dependsOn).toEqual([exp.id]);
  });

  it("folds into an existing concept with that meaning, moving its links", () => {
    const { g, homId } = theoremScenario();
    const dup = ops.addNode(g, { name: "Morphism" });
    const linked = ops.upsertRelation(dup.graph, dup.id, node(dup.graph, "First Isomorphism Theorem").id, { kind: "k", explanation: "" }, { kind: "k2", explanation: "" });
    const r = ops.applySense(linked, dup.id, { name: "homomorphism", definition: "…" });
    expect(r).toMatchObject({ merged: true, id: homId });
    expect(r.graph.nodes.some((n) => n.id === dup.id)).toBe(false);
    expect(r.graph.relations).toHaveLength(1); // the moved link collapsed onto the existing one
  });
});

describe("merge keeps the newer stored AI results", () => {
  it("doesn't drop what the parent got after the fork", () => {
    const r = ops.addNode(ops.emptyGraph("Main"), { name: "Kernel" });
    const sb = ops.fork(r.graph, "Sandbox");
    const formal = { decls: [{ name: "MonoidHom.ker", type: "T", module: "M" }], unverified: [], checkedAt: 5 };
    const parent = ops.updateNode(r.graph, r.id, { formal, kind: "definition" });
    const merged = ops.merge(parent, sb);
    const n = merged.nodes.find((x) => x.id === r.id)!;
    expect(n.formal).toEqual(formal);
    expect(n.kind).toBe("definition");
  });

  it("takes the sandbox's result when it is newer", () => {
    const r = ops.addNode(ops.emptyGraph("Main"), { name: "Kernel" });
    const old = { decls: [], unverified: [], checkedAt: 1 };
    const parent = ops.updateNode(r.graph, r.id, { formal: old });
    const sb = ops.updateNode(ops.fork(parent, "Sandbox"), r.id, { formal: { decls: [], unverified: ["X.y"], checkedAt: 9 } });
    expect(ops.merge(parent, sb).nodes.find((x) => x.id === r.id)!.formal?.checkedAt).toBe(9);
  });
});
