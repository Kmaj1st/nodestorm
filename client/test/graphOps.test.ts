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
    expect(rel.aToB.kind).toBe("uses definition of");
  });

  it("installing the missing node unblocks the dependent and links it", () => {
    const { g, thmId } = theoremScenario();
    const iso = ops.addNode(g, { name: "isomorphism" });
    const thm = node(iso.graph, "First Isomorphism Theorem");
    expect(thm.status).toBe("ok");
    expect(thm.missingDeps).toEqual([]);
    expect(thm.dependsOn).toContain(iso.id);
    expect(ops.findRelation(iso.graph, thmId, iso.id)?.aToB.kind).toBe("derives");
  });

  it("does not add duplicate nodes", () => {
    const { g, homId } = theoremScenario();
    const r = ops.addNode(g, { name: "HOMOMORPHISM" });
    expect(r.existed).toBe(true);
    expect(r.id).toBe(homId);
    expect(r.graph).toBe(g);
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
