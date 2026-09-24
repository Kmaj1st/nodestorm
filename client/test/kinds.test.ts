import type { Graph } from "@nodestorm/shared";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { addCandidate, analyzeNode, chooseSense } from "../src/lib/actions";
import { buildExample, EXAMPLES } from "../src/lib/examples";
import { toMarkdown } from "../src/lib/export";
import { applyExtraction, buildReview } from "../src/lib/extract";
import * as ops from "../src/lib/graphOps";
import { repairImport } from "../src/lib/importRepair";
import { KIND_LABEL, KIND_NAME, KIND_TONE, KINDS } from "../src/lib/kinds";
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

beforeEach(() => {
  store().reset();
  useSettings.setState({ connection: "browser", provider: "mock" });
});

describe("kind graph operations", () => {
  const one = () => ops.addNode(ops.emptyGraph(), { name: "A" });

  it("addNode takes a kind; without one the node has none", () => {
    expect(ops.addNode(ops.emptyGraph(), { name: "A", kind: "lemma" }).graph.nodes[0].kind).toBe("lemma");
    expect("kind" in one().graph.nodes[0]).toBe(false);
    expect("kind" in ops.addNode(ops.emptyGraph(), { name: "A", kind: null }).graph.nodes[0]).toBe(false);
  });

  it("suggestKind fills a missing kind but never overrides one", () => {
    const { graph: g, id } = one();
    const g2 = ops.suggestKind(g, id, "theorem");
    expect(g2.nodes[0].kind).toBe("theorem");
    expect(ops.suggestKind(g2, id, "definition").nodes[0].kind).toBe("theorem");
    expect(ops.suggestKind(g, id, null)).toBe(g);
    expect(ops.suggestKind(g, "nope", "theorem")).toBe(g);
  });

  it("setKind sets and clears", () => {
    const { graph: g, id } = one();
    const set = ops.setKind(g, id, "axiom");
    expect(set.nodes[0].kind).toBe("axiom");
    expect("kind" in ops.setKind(set, id, null).nodes[0]).toBe(false);
  });

  it("a chosen meaning brings its kind", () => {
    const { graph: g, id } = one();
    const r = ops.applySense(ops.setKind(g, id, "definition"), id, { name: "A (logic)", definition: "d", kind: "axiom" });
    expect(r.graph.nodes[0].kind).toBe("axiom");
    expect(ops.applySense(g, id, { name: "A", definition: "d" }).graph.nodes[0].kind).toBeUndefined();
  });
});

describe("kinds from the AI (offline demo)", () => {
  it("a check classifies a new concept", async () => {
    store().mutate((g) => ops.addNode(g, { name: "First Isomorphism Theorem" }).graph);
    await analyzeNode(byName("First Isomorphism Theorem")!.id);
    expect(byName("First Isomorphism Theorem")?.kind).toBe("theorem");
  });

  it("a check keeps a kind set by hand, and the AI result is not an undo step", async () => {
    store().mutate((g) => ops.addNode(g, { name: "Kernel" }).graph);
    const id = byName("Kernel")!.id;
    store().mutate((g) => ops.setKind(g, id, "notation"));
    await analyzeNode(id);
    expect(byName("Kernel")?.kind).toBe("notation");
    store().undo(); // takes back the hand-set kind, not the check
    expect(byName("Kernel")?.kind).toBe("definition"); // the check's kind was rebased into the earlier state
  });

  it("a picked name and a picked meaning carry their kind", async () => {
    addCandidate({ name: "Zorn's lemma", definition: "Every chain…", aliases: [], kind: "lemma" });
    expect(byName("Zorn's lemma")?.kind).toBe("lemma");
    store().mutate((g) => ops.addNode(g, { name: "Expectation" }).graph);
    const id = byName("Expectation")!.id;
    chooseSense(graph().id, id, { name: "Expectation (probability)", definition: "E[X]", kind: "definition" });
    expect(byName("Expectation (probability)")?.kind).toBe("definition");
  });

  it("extraction carries kinds into the new concepts", () => {
    const review = buildReview(ops.emptyGraph(), {
      concepts: [{ name: "Main Lemma", definition: "", aliases: [], kind: "lemma" }, { name: "Thing", definition: "", aliases: [] }],
      relations: [],
      prerequisites: [],
    });
    const { graph: g } = applyExtraction(ops.emptyGraph(), review);
    expect(g.nodes.find((n) => n.name === "Main Lemma")?.kind).toBe("lemma");
    expect(g.nodes.find((n) => n.name === "Thing")?.kind).toBeUndefined();
  });
});

describe("kinds in files", () => {
  it("the example graph is typed", () => {
    const g = buildExample(ops.emptyGraph(), EXAMPLES.groupTheory);
    expect(g.nodes.find((n) => n.name === "First Isomorphism Theorem")?.kind).toBe("theorem");
    expect(g.nodes.find((n) => n.name === "Group")?.kind).toBe("definition");
  });

  it("import keeps valid kinds, lower-cases hand-written ones and drops unknown ones", () => {
    const node = (name: string, kind: unknown) => ({ id: name, name, position: { x: 0, y: 0 }, kind });
    const { doc, fixes } = repairImport({ nodes: [node("A", "lemma"), node("B", "Theorem"), node("C", "remark"), node("D", null)] });
    expect(doc.graphs[0].nodes.map((n) => n.kind)).toEqual(["lemma", "theorem", undefined, undefined]);
    expect(fixes.some((f) => f.includes("unknown concept kinds"))).toBe(true);
  });

  it("share links keep the kind (graph content)", () => {
    const { graph: g } = ops.addNode(ops.emptyGraph(), { name: "A", kind: "corollary" });
    const packed = packGraph(g, "P") as { graphs: { nodes: { kind?: string }[] }[] };
    expect(packed.graphs[0].nodes[0].kind).toBe("corollary");
    const back = repairImport(packed).doc.graphs[0].nodes[0];
    expect(back.kind).toBe("corollary");
  });

  it("Markdown notes name the kind", () => {
    const { graph: g } = ops.addNode(ops.emptyGraph(), { name: "A", kind: "conjecture" });
    expect(toMarkdown(g)).toContain("*Kind:* Conjecture");
  });

  it("every kind has a label, an English name and a colour", () => {
    for (const k of KINDS) {
      expect(KIND_LABEL[k]).toMatch(/^kind\./);
      expect(KIND_NAME[k]).toBeTruthy();
      expect(KIND_TONE[k]).toBeTruthy();
    }
  });
});
