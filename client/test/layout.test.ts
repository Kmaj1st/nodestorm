import type { Graph } from "@nodestorm/shared";
import { describe, expect, it } from "vitest";
import { searchNodes } from "../src/lib/fuzzy";
import * as ops from "../src/lib/graphOps";
import { dependencyLayers, layeredLayout } from "../src/lib/layout";

const { w, h } = ops.NODE_SIZE;
const overlaps = (a: { x: number; y: number }, b: { x: number; y: number }) =>
  Math.abs(a.x - b.x) < w && Math.abs(a.y - b.y) < h;

/** Build a graph from names; `deps` maps a dependent to its prerequisites. */
function build(names: string[], deps: Record<string, string[]> = {}): Graph {
  let g = ops.emptyGraph();
  const id: Record<string, string> = {};
  for (const n of names) {
    const r = ops.addNode(g, { name: n });
    g = r.graph;
    id[n] = r.id;
  }
  for (const [d, ps] of Object.entries(deps)) {
    g = ops.applyDeps(g, id[d], ps.map((p) => ({ name: p, role: "uses", reason: "test", matchesExisting: p })));
  }
  return g;
}
const byName = (g: Graph, name: string) => g.nodes.find((n) => n.name === name)!;

describe("findFreeSpot", () => {
  it("returns the target when nothing is in the way", () => {
    expect(ops.findFreeSpot([], { x: 10, y: 20 })).toEqual({ x: 10, y: 20 });
    expect(ops.findFreeSpot([{ x: 1000, y: 1000 }], { x: 10, y: 20 })).toEqual({ x: 10, y: 20 });
  });

  it("moves off an occupied spot to a nearby free one", () => {
    const occupied = [{ x: 0, y: 0 }];
    const p = ops.findFreeSpot(occupied, { x: 0, y: 0 });
    expect(overlaps(p, occupied[0])).toBe(false);
    expect(Math.hypot(p.x, p.y)).toBeLessThan(400);
  });

  it("never overlaps in a crowded area", () => {
    const occupied: { x: number; y: number }[] = [];
    for (let i = 0; i < 25; i++) occupied.push(ops.findFreeSpot(occupied, { x: 50, y: 50 }));
    for (let i = 0; i < occupied.length; i++)
      for (let j = i + 1; j < occupied.length; j++) expect(overlaps(occupied[i], occupied[j])).toBe(false);
  });

  it("addNode treats the requested position as a preference and avoids overlaps", () => {
    let g = ops.addNode(ops.emptyGraph(), { name: "A", position: { x: 0, y: 0 } }).graph;
    g = ops.addNode(g, { name: "B", position: { x: 5, y: 5 } }).graph;
    expect(byName(g, "A").position).toEqual({ x: 0, y: 0 });
    expect(overlaps(byName(g, "A").position, byName(g, "B").position)).toBe(false);
  });
});

describe("layeredLayout", () => {
  it("puts prerequisites above the concepts that depend on them", () => {
    const g = build(["First Isomorphism Theorem", "Isomorphism", "Homomorphism", "Group"], {
      "First Isomorphism Theorem": ["Homomorphism", "Isomorphism"],
      Isomorphism: ["Homomorphism"],
      Homomorphism: ["Group"],
    });
    const pos = layeredLayout(g);
    const y = (n: string) => pos.get(byName(g, n).id)!.y;
    expect(y("Group")).toBeLessThan(y("Homomorphism"));
    expect(y("Homomorphism")).toBeLessThan(y("Isomorphism"));
    expect(y("Isomorphism")).toBeLessThan(y("First Isomorphism Theorem"));
  });

  it("gives every node a position and no two nodes overlap", () => {
    const names = Array.from({ length: 20 }, (_, i) => `C${i}`);
    const deps = Object.fromEntries(names.slice(5).map((n, i) => [n, [names[i % 5]]]));
    const g = build(names, deps);
    const pos = [...layeredLayout(g).values()];
    expect(pos).toHaveLength(20);
    for (let i = 0; i < pos.length; i++) for (let j = i + 1; j < pos.length; j++) expect(overlaps(pos[i], pos[j])).toBe(false);
  });

  it("doesn't crash on dependency cycles and still lays out every node", () => {
    let g = build(["A", "B", "C"]);
    const [a, b, c] = g.nodes.map((n) => n.id);
    g = ops.updateNode(g, a, { dependsOn: [c] });
    g = ops.updateNode(g, b, { dependsOn: [a] });
    g = ops.updateNode(g, c, { dependsOn: [b, c] }); // a 3-cycle plus a self-loop
    const layers = dependencyLayers(g);
    expect([...layers.values()].sort()).toEqual([0, 1, 2]);
    expect(layeredLayout(g).size).toBe(3);
  });

  it("orders a row next to related nodes (fewer crossings)", () => {
    // P1 above D1 and P2 above D2, but inserted crosswise.
    const g = build(["P1", "P2", "D2", "D1"], { D1: ["P1"], D2: ["P2"] });
    const pos = layeredLayout(g);
    const x = (n: string) => pos.get(byName(g, n).id)!.x;
    expect(Math.sign(x("P1") - x("P2"))).toBe(Math.sign(x("D1") - x("D2")));
  });
});

describe("searchNodes", () => {
  const g = build(["Homomorphism", "First Isomorphism Theorem", "Isomorphism", "Kernel"]);
  const withAlias = ops.updateNode(g, byName(g, "Kernel").id, { aliases: ["Null space"] });

  it("ranks prefix and substring matches first", () => {
    expect(searchNodes(g.nodes, "iso").map((n) => n.name)).toEqual(["Isomorphism", "First Isomorphism Theorem"]);
    expect(searchNodes(g.nodes, "homo")[0].name).toBe("Homomorphism");
  });

  it("matches scattered letters and aliases", () => {
    expect(searchNodes(g.nodes, "fit")[0].name).toBe("First Isomorphism Theorem");
    expect(searchNodes(withAlias.nodes, "null")[0].name).toBe("Kernel");
    expect(searchNodes(g.nodes, "zzz")).toEqual([]);
  });
});
