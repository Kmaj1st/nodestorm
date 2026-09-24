import type { DepRole } from "@nodestorm/shared";
import { describe, expect, it } from "vitest";
import * as ops from "../src/lib/graphOps";
import { buildWalkthrough } from "../src/lib/walkthrough";

const dep = (name: string, role: DepRole, reason: string) => ({ name, role, reason, matchesExisting: null });

/** Theorem → Isomorphism → Homomorphism (added in reverse order), a relation, a missing prerequisite, a lone Group. */
function scenario() {
  const thm = ops.addNode(ops.emptyGraph("Group theory"), { name: "First Isomorphism Theorem", definition: "$G/\\ker φ$" });
  const iso = ops.addNode(thm.graph, { name: "Isomorphism", definition: "A bijective homomorphism." });
  const hom = ops.addNode(iso.graph, { name: "Homomorphism", definition: "A structure-preserving map." });
  const grp = ops.addNode(hom.graph, { name: "Group", definition: "" });
  let g = ops.applyDeps(grp.graph, hom.id, []);
  g = ops.applyDeps(g, iso.id, [dep("Homomorphism", "uses", "is a special homomorphism")]);
  g = ops.applyDeps(g, thm.id, [dep("Isomorphism", "derives", "concludes one"), dep("Kernel", "uses", "quotients by it")]);
  g = ops.upsertRelation(
    g,
    hom.id,
    iso.id,
    { kind: "generalizes", explanation: "every iso is a hom" },
    { kind: "specializes", explanation: "adds bijectivity" },
  );
  return { g, thm: thm.id, iso: iso.id, hom: hom.id, grp: grp.id };
}

const names = (g: ReturnType<typeof scenario>["g"], root?: string) => buildWalkthrough(g, root).slides.map((s) => s.name);

describe("buildWalkthrough", () => {
  it("follows a concept's learning path, deepest prerequisite first and the concept last", () => {
    const { g, thm } = scenario();
    expect(names(g, thm)).toEqual(["Homomorphism", "Isomorphism", "First Isomorphism Theorem"]);
  });

  it("covers the whole graph in study order without a root (or with an unknown one)", () => {
    const { g } = scenario();
    const all = names(g);
    expect(all).toHaveLength(4);
    expect(all.indexOf("Homomorphism")).toBeLessThan(all.indexOf("Isomorphism"));
    expect(all.indexOf("Isomorphism")).toBeLessThan(all.indexOf("First Isomorphism Theorem"));
    expect(names(g, "nope")).toEqual(all);
    expect(buildWalkthrough(g).cyclic).toBe(false);
  });

  it("picks prerequisites, both directions of each relation, missing prerequisites and saved extras", () => {
    const { g, thm, iso, hom } = scenario();
    const withExtras = ops.updateNode(g, iso, {
      notes: "Remember the inverse.",
      explanation: {
        summary: "Same structure.", intuition: "", keyPoints: ["bijective", " "], examples: [], pitfalls: [],
        furtherReading: [], level: "intuitive", createdAt: 1,
      },
    });
    const slides = buildWalkthrough(withExtras, thm).slides;
    const isoSlide = slides.find((s) => s.id === iso)!;
    expect(isoSlide.buildsOn).toEqual([{ id: hom, name: "Homomorphism" }]);
    // applyDeps also records each dependency as a relation, so pick the mixed one (upsert replaced it for Hom–Iso).
    expect(isoSlide.relations.filter((r) => r.otherId === hom)).toEqual([
      { dir: "out", otherId: hom, otherName: "Homomorphism", kind: "specializes", explanation: "adds bijectivity" },
      { dir: "in", otherId: hom, otherName: "Homomorphism", kind: "generalizes", explanation: "every iso is a hom" },
    ]);
    expect(isoSlide.explanation).toEqual({ summary: "Same structure.", keyPoints: ["bijective"] });
    expect(isoSlide.notes).toBe("Remember the inverse.");
    const homSlide = slides[0];
    expect(homSlide.relations.map((r) => `${r.dir}:${r.kind}`)).toEqual(["out:generalizes", "in:specializes"]);
    expect(isoSlide.relations.filter((r) => r.otherId === thm).map((r) => r.dir)).toEqual(["out", "in"]);
    expect(homSlide.explanation).toBeUndefined();
    expect(homSlide.notes).toBeUndefined();
    expect(slides[2].missing).toEqual([{ name: "Kernel", reason: "quotients by it" }]);
  });

  it("returns no slides for an empty graph", () => {
    expect(buildWalkthrough(ops.emptyGraph("Empty"))).toEqual({ slides: [], cyclic: false });
  });

  it("still shows every concept once when prerequisites form a cycle, and says so", () => {
    const a = ops.addNode(ops.emptyGraph("Cycle"), { name: "A", definition: "" });
    const b = ops.addNode(a.graph, { name: "B", definition: "" });
    let g = ops.updateNode(b.graph, a.id, { dependsOn: [b.id] });
    g = ops.updateNode(g, b.id, { dependsOn: [a.id] });
    const path = buildWalkthrough(g, a.id);
    expect(path.slides.map((s) => s.name)).toEqual(["B", "A"]);
    expect(path.cyclic).toBe(true);
    const whole = buildWalkthrough(g);
    expect(whole.slides.map((s) => s.name).sort()).toEqual(["A", "B"]);
    expect(whole.cyclic).toBe(true);
  });
});
