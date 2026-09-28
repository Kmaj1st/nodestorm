import { describe, expect, it } from "vitest";
import {
  addHint,
  addStep,
  applyGraphPlan,
  buildGraphPlan,
  editStep,
  isSolved,
  newDerivation,
  nextHintNumber,
  numberReferences,
  problemName,
  removeStep,
  sessionConcepts,
  setCheck,
  stepsForTutor,
  toMarkdown,
  type StepCheck,
} from "../src/lib/derivation";
import * as ops from "../src/lib/graphOps";
import { repairImport } from "../src/lib/importRepair";
import { decodeShare, encodeShare } from "../src/lib/share";

const statement = "Show that the kernel of a group homomorphism is a normal subgroup.";
const src = { docId: "doc1", title: "Sheet 3", page: 1 };
const check = (patch: Partial<StepCheck> = {}): StepCheck => ({
  verdict: "ok", comment: "", missing: [], cites: [], concepts: [], solved: false, ...patch,
});

function session() {
  let d = newDerivation("p1", { statement, label: "1", source: src });
  const a = addStep(d, "Let $k \\in \\ker\\varphi$ and $g \\in G$.");
  d = a.derivation;
  const b = addStep(d, "Then $\\varphi(gkg^{-1}) = e$.");
  d = b.derivation;
  return { d, first: a.id, second: b.id };
}

describe("derivation sessions", () => {
  it("editing a step drops its check and the checks after it", () => {
    let { d, first, second } = session();
    d = setCheck(d, first, check());
    d = setCheck(d, second, check({ verdict: "gap" }));
    expect(editStep(d, second, " Then $\\varphi(gkg^{-1}) = e$. ")).toBe(d); // same text: nothing changes
    const e = editStep(d, first, "Let $k \\in \\ker\\varphi$.");
    expect(e.steps.map((s) => s.check)).toEqual([undefined, undefined]);
    expect(e.steps[0].text).toBe("Let $k \\in \\ker\\varphi$.");
  });

  it("removing a step keeps the checks before it and drops later hints", () => {
    let { d, first, second } = session();
    d = setCheck(d, first, check());
    d = addHint(d, { text: "h", cites: [], concepts: [] }); // given with 2 steps
    const r = removeStep(d, second);
    expect(r.steps).toHaveLength(1);
    expect(r.steps[0]).toMatchObject({ id: first, check: check() });
    expect(r.hints).toHaveLength(0);
  });

  it("hints for the same step get numbered, and restart after a new step", () => {
    let { d } = session();
    expect(nextHintNumber(d)).toBe(1);
    d = addHint(d, { text: "h1", cites: [], concepts: [] });
    d = addHint(d, { text: "h2", cites: [], concepts: [] });
    expect(nextHintNumber(d)).toBe(3);
    d = addStep(d, "Hence normal.").derivation;
    expect(nextHintNumber(d)).toBe(1);
  });

  it("is solved only when the last step is correct and finishes it", () => {
    let { d, second } = session();
    expect(isSolved(d)).toBe(false);
    d = setCheck(d, second, check({ solved: true }));
    expect(isSolved(d)).toBe(true);
    expect(isSolved(addStep(d, "More.").derivation)).toBe(false);
  });

  it("numbers references from 1 and resolves citations back to pages", () => {
    const { refs, resolve } = numberReferences([
      { docId: "a", title: "Notes", page: 3, text: "Kernel…" },
      { docId: "b", title: "Book", page: 40, text: "Normal…" },
    ]);
    expect(refs.map((r) => r.n)).toEqual([1, 2]);
    expect(resolve([2, 5])).toEqual([{ n: 2, docId: "b", title: "Book", page: 40 }]);
  });

  it("collects the concepts the tutor mentioned once each, with their source", () => {
    let { d, first, second } = session();
    const cite = { n: 1, docId: "a", title: "Notes", page: 3 };
    d = setCheck(d, first, check({ concepts: [{ name: "Kernel", definition: "" }], cites: [cite] }));
    d = setCheck(d, second, check({ verdict: "gap", missing: ["Homomorphism", "kernel"] }));
    d = addHint(d, { text: "h", cites: [], concepts: [{ name: "Kernels", definition: "Elements sent to e." }] });
    expect(sessionConcepts(d)).toEqual([
      { name: "Kernel", definition: "Elements sent to e.", source: { title: "Notes", page: 3 } },
      { name: "Homomorphism", definition: "" },
    ]);
  });

  it("keeps a whole page used as the problem, and long step lists, within what the tutor accepts", () => {
    const d = newDerivation("p", { statement: "x".repeat(9000) });
    expect(d.problem.statement.length).toBeLessThanOrEqual(4000);
    expect(d.problem.statement.endsWith(" …")).toBe(true);
    let e = d;
    for (let i = 0; i < 70; i++) e = addStep(e, `step ${i}`).derivation;
    const sent = stepsForTutor(e.steps);
    expect(sent).toHaveLength(60);
    expect(sent[59]).toBe("step 69");
  });

  it("names the problem after its statement", () => {
    expect(problemName({ statement })).toBe("The kernel of a group homomorphism is a normal subgroup");
    expect(problemName({ statement: "x".repeat(100) }, 10)).toBe("Xxxxxxxxx…");
  });

  it("exports to Markdown with verdicts", () => {
    let { d, second } = session();
    d = setCheck(d, second, check({ verdict: "gap", comment: "Why is it $e$?" }));
    const md = toMarkdown(d);
    expect(md).toContain("**Problem 1:** Show that");
    expect(md).toContain("*Source:* Sheet 3, p. 1");
    expect(md).toContain("2. Then $\\varphi(gkg^{-1}) = e$. — *Gap*");
    expect(md).toContain("   > Why is it $e$?");
  });
});

describe("adding a derivation to the graph", () => {
  function withSession() {
    let { d, first } = session();
    d = setCheck(d, first, check({ concepts: [{ name: "Kernel", definition: "Elements sent to $e$." }], cites: [{ n: 1, docId: "x", title: "Notes", page: 3 }] }));
    d = setCheck(d, session().second, check());
    d = addHint(d, { text: "h", cites: [], concepts: [{ name: "Normal subgroup", definition: "Invariant under conjugation." }] });
    return d;
  }

  it("lists the problem and the concepts, marking ones already in the graph", () => {
    const g = ops.addNode(ops.emptyGraph(), { name: "Normal subgroups" }).graph;
    const plan = buildGraphPlan(withSession(), g);
    expect(plan.items.map((i) => [i.kind, i.name, Boolean(i.existingId)])).toEqual([
      ["problem", "The kernel of a group homomorphism is a normal subgroup", false],
      ["concept", "Kernel", false],
      ["concept", "Normal subgroup", true],
    ]);
    expect(plan.items[0].source).toEqual({ title: "Sheet 3", page: 1 });
  });

  it("adds new concepts, links the problem to all of them, and keeps sources and steps", () => {
    const d = withSession();
    const g0 = ops.addNode(ops.emptyGraph(), { name: "Normal subgroup" }).graph;
    const plan = buildGraphPlan(d, g0);
    const { graph, added, problemId } = applyGraphPlan(g0, plan, d);
    expect(added).toHaveLength(2);
    const problem = graph.nodes.find((n) => n.id === problemId)!;
    const kernel = graph.nodes.find((n) => n.name === "Kernel")!;
    const normal = graph.nodes.find((n) => n.name === "Normal subgroup")!;
    expect(problem.dependsOn.sort()).toEqual([kernel.id, normal.id].sort());
    expect(problem.source).toEqual({ title: "Sheet 3", page: 1 });
    expect(problem.definition).toBe(statement);
    expect(problem.notes).toContain("1. Let $k");
    expect(kernel.source).toEqual({ title: "Notes", page: 3 });
    expect(normal.source).toBeUndefined();
  });

  it("respects unticked items and the steps option", () => {
    const d = withSession();
    const plan = buildGraphPlan(d, ops.emptyGraph());
    plan.items[1].include = false;
    plan.keepSteps = false;
    const { graph, problemId } = applyGraphPlan(ops.emptyGraph(), plan, d);
    expect(graph.nodes.map((n) => n.name).sort()).toEqual(["Normal subgroup", "The kernel of a group homomorphism is a normal subgroup"]);
    expect(graph.nodes.find((n) => n.id === problemId)!.notes).toBeUndefined();
  });

  it("a node's source survives JSON import and share links", async () => {
    const d = withSession();
    const { graph } = applyGraphPlan(ops.emptyGraph(), buildGraphPlan(d, ops.emptyGraph()), d);
    const back = repairImport({ format: "nodestorm/v1", graphs: [graph] });
    expect(back.doc.graphs[0].nodes.find((n) => n.name === "Kernel")!.source).toEqual({ title: "Notes", page: 3 });
    const bad = repairImport({ format: "nodestorm/v1", graphs: [{ ...graph, nodes: [{ ...graph.nodes[0], source: { page: "x" } }] }] });
    expect(bad.doc.graphs[0].nodes[0].source).toBeUndefined();
    expect(bad.fixes.join()).toMatch(/source/);
    const shared = await decodeShare(await encodeShare(graph, "G"));
    expect(shared.graph.nodes.find((n) => n.name === "Kernel")!.source).toEqual({ title: "Notes", page: 3 });
  });
});
