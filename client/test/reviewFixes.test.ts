import type { Graph } from "@nodestorm/shared";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { addConcept, cancelTask, chooseSense } from "../src/lib/actions";
import * as ops from "../src/lib/graphOps";
import { useGraphStore } from "../src/store/graphStore";
import { useSettings } from "../src/store/settingsStore";

// Regressions for bugs found in the post-merge review; drives the real store + actions with the mock AI.

vi.hoisted(() => {
  const data = new Map<string, string>();
  (globalThis as { localStorage?: unknown }).localStorage = {
    getItem: (k: string) => data.get(k) ?? null,
    setItem: (k: string, v: string) => void data.set(k, v),
    removeItem: (k: string) => void data.delete(k),
  };
});

const store = () => useGraphStore.getState();
const graph = (): Graph => store().graphs[store().activeId];
const byName = (g: Graph, name: string) => g.nodes.find((n) => n.name === name);
const settle = () => new Promise((r) => setTimeout(r, 20));
const idle = async () => {
  for (let i = 0; i < 100 && Object.keys(store().busy).length; i++) await settle();
};

beforeEach(() => {
  store().reset();
  useSettings.setState({ newConcepts: "auto", connection: "browser", provider: "mock", clarify: { enabled: true, options: 3 } });
});

describe("sandboxes and running checks", () => {
  it("a fork never inherits a check that is running in the original", () => {
    let g = ops.emptyGraph();
    const r = ops.addNode(g, { name: "Subgroup" }); // addNode leaves it "checking"
    g = r.graph;
    const sb = ops.fork(g, "S");
    expect(byName(sb, "Subgroup")!.status).toBe("error");
    expect(byName(g, "Subgroup")!.status).toBe("checking");
  });

  it("merge keeps the parent's node over a sandbox copy that is still checking", () => {
    let g = ops.applyDeps(ops.addNode(ops.emptyGraph(), { name: "Group" }).graph, "", []);
    const id = g.nodes[0].id;
    g = ops.updateNode(g, id, { status: "ok", definition: "parent" });
    const sb = ops.updateNode(ops.fork(g, "S"), id, { status: "checking", definition: "sandbox" });
    const merged = ops.merge(g, sb);
    expect(merged.nodes.find((n) => n.id === id)).toMatchObject({ status: "ok", definition: "parent" });
  });

  it("merge folds concepts both sides added under the same name, and one relation per pair", () => {
    const base = ops.addNode(ops.emptyGraph(), { name: "Group" });
    const groupId = base.id;
    const sb0 = ops.fork(base.graph, "S");
    const inParent = ops.addNode(base.graph, { name: "Vector" });
    const inSandbox = ops.addNode(sb0, { name: "vectors" });
    const rel = { kind: "k", explanation: "" };
    const parent = ops.upsertRelation(inParent.graph, inParent.id, groupId, rel, rel);
    const sandbox = ops.upsertRelation(inSandbox.graph, inSandbox.id, groupId, rel, rel);
    const merged = ops.merge(parent, sandbox);
    expect(merged.nodes.filter((n) => /vector/i.test(n.name))).toHaveLength(1);
    expect(merged.relations).toHaveLength(1);
  });

  it("forking right after adding leaves no node stuck on 'checking' anywhere", async () => {
    addConcept({ name: "Subgroup" });
    store().forkActive();
    await idle();
    for (const g of Object.values(store().graphs)) {
      expect(g.nodes.every((n) => n.status !== "checking")).toBe(true);
    }
  });
});

describe("choosing a meaning and undo", () => {
  it("undoing a chosen meaning brings back the unclear concept, not a hybrid", async () => {
    addConcept({ name: "Expectation" });
    await idle();
    const id = byName(graph(), "Expectation")!.id;
    expect(byName(graph(), "Expectation")!.status).toBe("unclear");
    const sense = graph().nodes.find((n) => n.id === id)!.senses![0];
    chooseSense(store().activeId, id, sense);
    await idle();
    expect(graph().nodes.find((n) => n.id === id)!.name).toBe(sense.name);
    store().undo();
    const back = graph().nodes.find((n) => n.id === id)!;
    expect(back).toMatchObject({ name: "Expectation", status: "unclear", definition: "" });
    expect(back.senses?.length).toBeGreaterThan(1);
  });
});

describe("cancelling a check", () => {
  it("an explicit cancel still marks the node so it can be retried", async () => {
    addConcept({ name: "Kernel", definition: "set sent to the identity" });
    const id = byName(graph(), "Kernel")!.id;
    cancelTask(Object.keys(store().busy)[0]);
    await idle();
    expect(graph().nodes.find((n) => n.id === id)!.status).toBe("error");
  });
});
