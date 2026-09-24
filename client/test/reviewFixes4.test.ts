import { normalizeName, type Graph } from "@nodestorm/shared";
import { describe, expect, it } from "vitest";
import * as ops from "../src/lib/graphOps";
import { capture } from "../src/lib/snapshots";

// Regressions for the final review and the docs pass.

describe("names in every script", () => {
  it("normalizes non-Latin names instead of erasing them", () => {
    for (const name of ["Группа", "Ομάδα", "準同型", "ベクトル空間", "군", "群"]) expect(normalizeName(name)).not.toBe("");
    expect(normalizeName("Группа")).toBe(normalizeName("группа"));
    expect(normalizeName("Groups")).toBe(normalizeName("group"));
    expect(normalizeName("Poincaré")).toBe("poincare");
  });

  it("links a Cyrillic prerequisite that is already in the graph (it used to be skipped)", () => {
    const g0 = ops.addNode(ops.emptyGraph(), { name: "Группа" });
    const thm = ops.addNode(g0.graph, { name: "Подгруппа" });
    const g = ops.applyDeps(thm.graph, thm.id, [{ name: "группа", role: "uses", reason: "r", matchesExisting: null }]);
    const node = g.nodes.find((n) => n.id === thm.id)!;
    expect(node.dependsOn).toEqual([g0.id]);
    expect(node.missingDeps).toEqual([]);
  });

  it("recognises a duplicate written in katakana", () => {
    const g = ops.addNode(ops.emptyGraph(), { name: "ベクトル" });
    expect(ops.addNode(g.graph, { name: "ベクトル" }).existed).toBe(true);
  });
});

describe("quiz progress across sandboxes and versions", () => {
  const withMastery = (g: Graph, id: string, score: number, reviewedAt: number) =>
    ops.updateNode(g, id, { mastery: { score, reviews: 1, reviewedAt } });

  it("merging keeps the more recent mastery, from either side", () => {
    const base = ops.addNode(ops.emptyGraph(), { name: "Group" });
    const id = base.id;
    const sb = withMastery(ops.fork(base.graph, "S"), id, 0, 1_000);
    const parent = withMastery(base.graph, id, 0.75, 2_000); // graded again on main after forking
    expect(ops.merge(parent, sb).nodes.find((n) => n.id === id)!.mastery!.score).toBe(0.75);
    const newerInSandbox = withMastery(sb, id, 0.5, 3_000);
    expect(ops.merge(parent, newerInSandbox).nodes.find((n) => n.id === id)!.mastery!.score).toBe(0.5);
  });

  it("a snapshot's change hash ignores mastery (grading alone isn't a new version)", () => {
    const base = ops.addNode(ops.emptyGraph(), { name: "Group" });
    const ws = (g: Graph) => ({ graphs: { [g.id]: g }, projects: { p: { id: "p", name: "P", mainId: g.id } } });
    const before = capture(ws(base.graph) as never, "p")!;
    const graded = capture(ws(withMastery(base.graph, base.id, 1, 5)) as never, "p")!;
    expect(graded.hash).toBe(before.hash);
    expect(graded.data).not.toBe(before.data); // …but the stored data still has it
    const renamed = capture(ws(ops.updateNode(base.graph, base.id, { definition: "changed" })) as never, "p")!;
    expect(renamed.hash).not.toBe(before.hash);
  });
});
