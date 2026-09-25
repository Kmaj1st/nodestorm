import type { Graph, NodeAnatomy } from "@nodestorm/shared";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { anatomyKey, anatomyNode, cancelTask } from "../src/lib/actions";
import { toMarkdown } from "../src/lib/export";
import * as ops from "../src/lib/graphOps";
import { repairImport } from "../src/lib/importRepair";
import { packGraph } from "../src/lib/share";
import { useGraphStore } from "../src/store/graphStore";
import { useSettings } from "../src/store/settingsStore";

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
const byName = (name: string) => graph().nodes.find((n) => n.name === name);

const ANATOMY: NodeAnatomy = {
  hypotheses: [{ text: "$G$ is finite", whyNeeded: "We count cosets.", counterexampleIfDropped: "" }],
  conclusion: "$|H|$ divides $|G|$.",
  proofIdea: "Cosets partition $G$.",
  examples: ["$S_3$"],
  nonExamples: ["The converse fails for $A_4$."],
  createdAt: 1,
};

beforeEach(() => {
  store().reset();
  useSettings.setState({ connection: "browser", provider: "mock" });
});

describe("theorem anatomy action (offline demo)", () => {
  it("stores the answer on the node, without an undo step", async () => {
    store().mutate((g) => ops.addNode(g, { name: "First Isomorphism Theorem", kind: "theorem" }).graph);
    const id = byName("First Isomorphism Theorem")!.id;
    store().mutate((g) => ops.updateNode(g, id, { notes: "mine" })); // the user's last step
    // The clock moves on every read, as it can under load: the undo snapshots must still get the same answer.
    let now = 1_000;
    const clock = vi.spyOn(Date, "now").mockImplementation(() => ++now);
    await anatomyNode(id).finally(() => clock.mockRestore());
    const an = byName("First Isomorphism Theorem")!.anatomy!;
    expect(an.hypotheses.length).toBeGreaterThanOrEqual(2);
    expect(an.conclusion).toContain("\\operatorname{im}");
    expect(an.createdAt).toBeGreaterThan(0);
    store().undo(); // takes back the notes, keeps the anatomy
    expect(byName("First Isomorphism Theorem")!.notes).toBeUndefined();
    expect(byName("First Isomorphism Theorem")!.anatomy).toEqual(an);
    expect(Object.keys(store().busy)).toEqual([]);
  });

  it("a cancelled run leaves the node as it was", async () => {
    store().mutate((g) => ops.addNode(g, { name: "Lagrange's theorem", kind: "theorem" }).graph);
    const id = byName("Lagrange's theorem")!.id;
    const run = anatomyNode(id);
    cancelTask(anatomyKey(graph().id, id));
    await run;
    expect(byName("Lagrange's theorem")!.anatomy).toBeUndefined();
    expect(store().toast).toBeFalsy(); // a cancel is silent
  });
});

describe("theorem anatomy in files", () => {
  const withAnatomy = () => {
    const { graph: g, id } = ops.addNode(ops.emptyGraph(), { name: "Lagrange's theorem", kind: "theorem" });
    return ops.updateNode(g, id, { anatomy: ANATOMY });
  };

  it("survives import, and a malformed one is dropped with a note", () => {
    const g = withAnatomy();
    expect(repairImport({ graphs: [g] }).doc.graphs[0].nodes[0].anatomy).toEqual(ANATOMY);
    const bad = { ...g, nodes: [{ ...g.nodes[0], anatomy: { hypotheses: "no" } }] };
    const { doc, fixes } = repairImport({ graphs: [bad] });
    expect(doc.graphs[0].nodes[0].anatomy).toBeUndefined();
    expect(fixes.some((f) => f.includes("theorem anatomies"))).toBe(true);
  });

  it("stays out of share links, like explanations", () => {
    const packed = packGraph(withAnatomy(), "P") as { graphs: { nodes: Record<string, unknown>[] }[] };
    expect(packed.graphs[0].nodes[0].anatomy).toBeUndefined();
  });

  it("is in the Markdown notes", () => {
    const md = toMarkdown(withAnatomy());
    expect(md).toContain("#### Anatomy");
    expect(md).toContain("1. $G$ is finite");
    expect(md).toContain("*Why needed:* We count cosets.");
    expect(md).toContain("**Conclusion:** $|H|$ divides $|G|$.");
    expect(md).toContain("**Non-examples:**");
  });
});
