import type { Graph } from "@nodestorm/shared";
import { describe, expect, it } from "vitest";
import * as ops from "../src/lib/graphOps";
import { createSim, graphLinks, isSettled, reheat, setFixed, settle, simPositions, step, type SimNode } from "../src/lib/physics";

const { w, h } = ops.NODE_SIZE;
const overlaps = (a: { x: number; y: number }, b: { x: number; y: number }) => Math.abs(a.x - b.x) < w && Math.abs(a.y - b.y) < h;
const noOverlaps = (ps: Map<string, { x: number; y: number }>) => {
  const list = [...ps.values()];
  for (let i = 0; i < list.length; i++) for (let j = i + 1; j < list.length; j++) if (overlaps(list[i], list[j])) return false;
  return true;
};
const dist = (a: { x: number; y: number }, b: { x: number; y: number }) => Math.hypot(a.x - b.x, a.y - b.y);

function build(names: string[], deps: Record<string, string[]> = {}): Graph {
  let g = ops.emptyGraph();
  for (const n of names) g = ops.addNode(g, { name: n }).graph;
  for (const [d, ps] of Object.entries(deps)) {
    const id = g.nodes.find((n) => n.name === d)!.id;
    g = ops.applyDeps(g, id, ps.map((p) => ({ name: p, role: "uses", reason: "test", matchesExisting: p })));
  }
  return g;
}
const id = (g: Graph, name: string) => g.nodes.find((n) => n.name === name)!.id;
/** Every node on the same spot: the worst start. */
const pile = (g: Graph): SimNode[] => g.nodes.map((n) => ({ id: n.id, x: 0, y: 0 }));

describe("physics", () => {
  it("pushes a pile of cards apart until none overlap", () => {
    const g = build(Array.from({ length: 12 }, (_, i) => `N${i}`));
    const sim = createSim(pile(g), graphLinks(g));
    settle(sim);
    expect(isSettled(sim)).toBe(true);
    expect(noOverlaps(simPositions(sim))).toBe(true);
  });

  it("pulls linked concepts closer than unlinked ones, and puts prerequisites above", () => {
    const g = build(["Set", "Group", "Kernel", "Weather", "Poetry"], { Group: ["Set"], Kernel: ["Group"] });
    const start = g.nodes.map((n, i) => ({ id: n.id, x: (i % 3) * 700, y: Math.floor(i / 3) * 600 }));
    const sim = createSim(start, graphLinks(g));
    settle(sim);
    const p = simPositions(sim);
    const at = (n: string) => p.get(id(g, n))!;
    expect(dist(at("Group"), at("Kernel"))).toBeLessThan(dist(at("Group"), at("Poetry")));
    expect(at("Set").y).toBeLessThan(at("Group").y);
    expect(at("Group").y).toBeLessThan(at("Kernel").y);
    expect(noOverlaps(p)).toBe(true);
  });

  it("never moves a fixed (pinned or dragged) node; a drag pulls its neighbours along", () => {
    const g = build(["A", "B"], { B: ["A"] });
    const sim = createSim([{ id: id(g, "A"), x: 0, y: 0, fixed: true }, { id: id(g, "B"), x: 0, y: 400 }], graphLinks(g));
    settle(sim);
    expect(simPositions(sim).get(id(g, "A"))).toEqual({ x: 0, y: 0 });
    const before = simPositions(sim).get(id(g, "B"))!;
    setFixed(sim, id(g, "A"), true, { x: 2000, y: 0 });
    reheat(sim, 1);
    settle(sim);
    expect(simPositions(sim).get(id(g, "A"))).toEqual({ x: 2000, y: 0 });
    expect(simPositions(sim).get(id(g, "B"))!.x).toBeGreaterThan(before.x + 1000);
  });

  it("copes with dependency cycles and self-links", () => {
    let g = build(["A", "B", "C"], { B: ["A"], C: ["B"] });
    g = ops.applyDeps(g, id(g, "A"), [{ name: "C", role: "uses", reason: "loop", matchesExisting: "C" }]);
    const sim = createSim(pile(g), [...graphLinks(g), { a: id(g, "A"), b: id(g, "A") }]);
    settle(sim);
    const p = simPositions(sim);
    expect([...p.values()].every((q) => Number.isFinite(q.x) && Number.isFinite(q.y))).toBe(true);
    expect(noOverlaps(p)).toBe(true);
  });

  it("settles a 50-concept graph quickly, and large graphs too", () => {
    const names = Array.from({ length: 50 }, (_, i) => `C${i}`);
    const deps = Object.fromEntries(names.slice(1).map((n, i) => [n, [names[Math.floor(i / 3)]]]));
    const g = build(names, deps);
    const sim = createSim(g.nodes.map((n) => ({ id: n.id, x: n.position.x, y: n.position.y })), graphLinks(g));
    expect(settle(sim)).toBeLessThan(600);
    expect(noOverlaps(simPositions(sim))).toBe(true);
    // Above 150 nodes it switches to the grid; still no overlaps.
    const many = Array.from({ length: 200 }, (_, i) => ({ id: `n${i}`, x: (i % 20) * 60, y: Math.floor(i / 20) * 40 }));
    const big = createSim(many, []);
    settle(big, 2000);
    expect(noOverlaps(simPositions(big))).toBe(true);
  });

  it("in layered mode moves only x and keeps each card on its row", () => {
    const nodes = ["a", "b", "c", "d"].map((n, i) => ({ id: n, x: 0, y: i < 2 ? 0 : 200 }));
    const sim = createSim(nodes, [{ a: "a", b: "c", prereq: true }], { lockY: true });
    settle(sim);
    const p = simPositions(sim);
    expect([...p.values()].map((q) => q.y)).toEqual([0, 0, 200, 200]);
    expect(noOverlaps(p)).toBe(true);
  });

  it("does nothing once settled until reheated", () => {
    const g = build(["A", "B"]);
    const sim = createSim(pile(g), graphLinks(g));
    settle(sim);
    const p = simPositions(sim);
    expect(step(sim)).toBe(0);
    expect(simPositions(sim)).toEqual(p);
  });
});
