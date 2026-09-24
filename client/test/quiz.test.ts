import type { Graph, Prerequisite } from "@nodestorm/shared";
import { describe, expect, it } from "vitest";
import * as ops from "../src/lib/graphOps";
import { repairImport } from "../src/lib/importRepair";
import * as quiz from "../src/lib/quiz";
import { decodeShare, encodeShare } from "../src/lib/share";

const id = (g: Graph, name: string) => g.nodes.find((n) => n.name === name)!.id;
const pre = (name: string): Prerequisite => ({ name, role: "uses", reason: `needs ${name}`, matchesExisting: null });
const names = (g: Graph, ids: Iterable<string>) => [...ids].map((i) => g.nodes.find((n) => n.id === i)!.name);

/** Build a graph from "X needs [A, B]" lines. Names not listed as keys stay missing (and block their dependent). */
function build(spec: Record<string, string[]>): Graph {
  let g = ops.emptyGraph();
  for (const name of Object.keys(spec)) g = ops.addNode(g, { name }).graph;
  for (const [name, deps] of Object.entries(spec)) g = ops.applyDeps(g, id(g, name), deps.map(pre));
  return g;
}

const DAY = 86_400_000;
const NOW = 1_700_000_000_000;

describe("mastery", () => {
  it("starts at the first grade and moves halfway towards each later one", () => {
    const a = quiz.updateMastery(undefined, "knew", NOW);
    expect(a).toEqual({ score: 1, reviews: 1, reviewedAt: NOW });
    const b = quiz.updateMastery(a, "didnt", NOW + 1);
    expect(b).toEqual({ score: 0.5, reviews: 2, reviewedAt: NOW + 1 });
    expect(quiz.updateMastery(b, "partly", NOW + 2).score).toBe(0.5);
    expect(quiz.updateMastery(undefined, "partly", NOW).score).toBe(0.5);
  });

  it("fades with time, more slowly after more reviews", () => {
    const once = { score: 1, reviews: 1, reviewedAt: NOW };
    const often = { score: 1, reviews: 5, reviewedAt: NOW };
    expect(quiz.strength(once, NOW)).toBe(1);
    expect(quiz.strength(once, NOW + DAY)).toBeCloseTo(0.5);
    expect(quiz.strength(often, NOW + DAY)).toBeGreaterThan(0.9);
    expect(quiz.strength({ score: 0, reviews: 3, reviewedAt: NOW }, NOW)).toBe(0);
  });

  it("buckets strength into weak / fair / strong", () => {
    expect(quiz.masteryLevel({ score: 1, reviews: 1, reviewedAt: NOW }, NOW)).toBe("strong");
    expect(quiz.masteryLevel({ score: 0.5, reviews: 2, reviewedAt: NOW }, NOW)).toBe("fair");
    expect(quiz.masteryLevel({ score: 1, reviews: 1, reviewedAt: NOW - 3 * DAY }, NOW)).toBe("weak");
    expect(quiz.daysAgo({ score: 1, reviews: 1, reviewedAt: NOW - 3 * DAY - 5 }, NOW)).toBe(3);
  });
});

describe("quiz plan", () => {
  const g = build({
    "Quotient Group": ["Group", "Normal Subgroup"],
    "Normal Subgroup": ["Subgroup"],
    Subgroup: ["Group"],
    Group: [],
    Coset: ["Subgroup", "Lagrange"], // Lagrange is missing: blocked
    Other: [],
  });

  it("covers a learning path in study order, prerequisites first", () => {
    const plan = quiz.quizPlan(g, id(g, "Quotient Group"));
    expect(names(g, plan.order)).toEqual(["Group", "Subgroup", "Normal Subgroup", "Quotient Group"]);
    expect(plan.skipped).toEqual([]);
  });

  it("covers the whole graph and skips blocked and unclear concepts with a reason", () => {
    const unclear = ops.updateNode(g, id(g, "Other"), { status: "unclear" });
    const plan = quiz.quizPlan(unclear);
    expect(names(g, plan.order)).toEqual(["Group", "Subgroup", "Normal Subgroup", "Quotient Group"]);
    expect(plan.skipped.map((s) => [s.name, s.reason])).toEqual([["Coset", "blocked"], ["Other", "unclear"]]);
  });

  it("puts every concept after its prerequisites even when they are listed later", () => {
    const h = build({ C: ["B"], B: ["A"], A: [] });
    expect(names(h, quiz.studyOrder(h))).toEqual(["A", "B", "C"]);
  });
});

describe("next concept", () => {
  const g = build({ C: ["A", "B"], A: [], B: [], D: [] });
  const order = quiz.quizPlan(g).order;
  const next = (graph: Graph, done: string[]) => {
    const n = quiz.nextConcept(graph, order, new Set(done.map((d) => id(graph, d))), NOW);
    return n && graph.nodes.find((x) => x.id === n)!.name;
  };

  it("asks prerequisites before what depends on them", () => {
    expect(next(g, [])).toBe("A");
    expect(next(g, ["A"])).toBe("B");
    expect(next(g, ["A", "B"])).toBe("C");
    expect(next(g, ["A", "B", "C", "D"])).toBeNull();
  });

  it("prefers unreviewed, then weak concepts among those that are ready", () => {
    const known = { score: 1, reviews: 3, reviewedAt: NOW };
    let h = ops.updateNode(g, id(g, "A"), { mastery: known });
    expect(next(h, [])).toBe("B");
    h = ops.updateNode(h, id(h, "B"), { mastery: { score: 0.5, reviews: 1, reviewedAt: NOW } });
    h = ops.updateNode(h, id(h, "D"), { mastery: known });
    expect(next(h, [])).toBe("B"); // weaker than A and D; C waits for B
    expect(next(h, ["B"])).toBe("C"); // A is known well, so C needn't wait for it
    expect(next(h, ["B", "C"])).toBe("A");
  });

  it("makes dependents wait for a prerequisite that is only partly known", () => {
    const h = ops.updateNode(g, id(g, "A"), { mastery: { score: 0.5, reviews: 2, reviewedAt: NOW } });
    expect(next(h, ["B", "D"])).toBe("A");
  });

  it("still makes progress through a dependency cycle", () => {
    let h = build({ X: ["Y"], Y: [] });
    h = ops.updateNode(h, id(h, "Y"), { dependsOn: [id(h, "X")] });
    const n = quiz.nextConcept(h, [id(h, "X"), id(h, "Y")], new Set(), NOW);
    expect(n).toBe(id(h, "X"));
  });
});

describe("question style and summary", () => {
  it("mixes styles by mastery and never connects without a prerequisite", () => {
    const shaky = { score: 0.25, reviews: 2, reviewedAt: NOW };
    const good1 = { score: 1, reviews: 1, reviewedAt: NOW };
    const good2 = { score: 1, reviews: 2, reviewedAt: NOW };
    expect(quiz.pickStyle("mixed", undefined, true)).toBe("recall");
    expect(quiz.pickStyle("mixed", shaky, true)).toBe("recall");
    expect(quiz.pickStyle("mixed", good1, true)).toBe("connect");
    expect(quiz.pickStyle("mixed", good2, true)).toBe("apply");
    expect(quiz.pickStyle("mixed", good1, false)).toBe("apply");
    expect(quiz.pickStyle("connect", undefined, false)).toBe("recall");
    expect(quiz.pickStyle("apply", undefined, false)).toBe("apply");
  });

  it("counts the outcomes", () => {
    expect(
      quiz.summarize([
        { id: "a", name: "A", grade: "knew" },
        { id: "b", name: "B", grade: "knew" },
        { id: "c", name: "C", grade: "didnt" },
        { id: "d", name: "D", grade: "skipped" },
      ]),
    ).toEqual({ knew: 2, partly: 0, didnt: 1, skipped: 1 });
  });
});

describe("mastery in files and share links", () => {
  const mastery = { score: 0.75, reviews: 3, reviewedAt: NOW };
  const g = build({ B: ["A"], A: [] });
  const withMastery = { ...g, nodes: g.nodes.map((n) => ({ ...n, mastery })) };

  it("survives export and import repair; malformed progress is dropped and reported", () => {
    const file = { format: "nodestorm/v1", graphs: [withMastery] };
    const ok = repairImport(JSON.parse(JSON.stringify(file)));
    expect(ok.doc.graphs[0].nodes.map((n) => n.mastery)).toEqual([mastery, mastery]);
    expect(ok.fixes).toEqual([]);
    const bad = { ...file, graphs: [{ ...withMastery, nodes: withMastery.nodes.map((n) => ({ ...n, mastery: { score: "high" } })) }] };
    const fixed = repairImport(bad);
    expect(fixed.doc.graphs[0].nodes.every((n) => n.mastery === undefined)).toBe(true);
    expect(fixed.fixes.join()).toMatch(/quiz progress/);
  });

  it("is left out of share links (it is the sender's own study progress)", async () => {
    const out = await decodeShare(await encodeShare(withMastery, "Study", { native: false }), { native: false });
    expect(out.graph.nodes).toHaveLength(2);
    expect(out.graph.nodes.every((n) => n.mastery === undefined)).toBe(true);
  });
});
