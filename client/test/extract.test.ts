import type { ExtractResponse, Graph } from "@nodestorm/shared";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { extractFromText, insertExtraction } from "../src/lib/actions";
import { applyExtraction, buildReview, duplicateOf, linkUsable, resolveEndpoint } from "../src/lib/extract";
import * as ops from "../src/lib/graphOps";
import { repairImport } from "../src/lib/importRepair";
import { decodeShare, encodeShare } from "../src/lib/share";
import { DEFAULT_VIEW, visibleParts } from "../src/lib/view";
import { useGraphStore } from "../src/store/graphStore";
import { useSettings } from "../src/store/settingsStore";

// The stores persist to localStorage; give them an in-memory one (hoisted above the imports).
vi.hoisted(() => {
  const data = new Map<string, string>();
  (globalThis as { localStorage?: unknown }).localStorage = {
    getItem: (k: string) => data.get(k) ?? null,
    setItem: (k: string, v: string) => void data.set(k, v),
    removeItem: (k: string) => void data.delete(k),
  };
});

const dir = (kind: string) => ({ kind, explanation: `${kind}.` });

function base(): Graph {
  let g = ops.emptyGraph();
  for (const [name, aliases] of [["Group", []], ["Homomorphism", ["group homomorphism"]]] as const) {
    const r = ops.addNode(g, { name, aliases: [...aliases] });
    g = ops.applyDeps(r.graph, r.id, []);
  }
  return g;
}

const answer: ExtractResponse = {
  concepts: [
    { name: "groups", definition: "A set with an operation.", aliases: [], quote: "A group is…" },
    { name: "Kernel", definition: "Elements sent to the identity.", aliases: ["ker"], quote: "The kernel…" },
    { name: "Widget", definition: "Something new.", aliases: ["group homomorphism"] }, // duplicate by alias
    { name: "Coset", definition: "A translate of a subgroup.", aliases: [] },
    { name: "kernel", definition: "repeated", aliases: [] },
  ],
  relations: [
    { from: "Coset", to: "Kernel", aToB: dir("partitions by"), bToA: dir("is a coset of") },
    { from: "Coset", to: "Group", aToB: dir("lives in"), bToA: dir("contains") },
  ],
  prerequisites: [{ dependent: "Kernel", prerequisite: "Widget", role: "uses", reason: "Defined for a homomorphism." }],
};

describe("extract review", () => {
  it("ticks new candidates, unticks duplicates (by name, plural or alias) and merges repeated names", () => {
    const g = base();
    const { items, links } = buildReview(g, answer);
    expect(items.map((i) => [i.name, i.include])).toEqual([
      ["groups", false],
      ["Kernel", true],
      ["Widget", false],
      ["Coset", true],
    ]);
    expect(duplicateOf(g, items[0])?.name).toBe("Group");
    expect(duplicateOf(g, items[2])?.name).toBe("Homomorphism");
    // Prerequisites first, worded like dependency links; then relations. All ticked.
    expect(links.map((l) => [l.from, l.to, l.role, l.aToB.kind, l.include])).toEqual([
      ["Kernel", "Widget", "uses", "using", true],
      ["Coset", "Kernel", undefined, "partitions by", true],
      ["Coset", "Group", undefined, "lives in", true],
    ]);
  });

  it("resolves relation ends to candidates (by original or edited name) or to existing concepts", () => {
    const g = base();
    const { items } = buildReview(g, answer);
    items[1] = { ...items[1], name: "Kernel of a map" };
    expect(resolveEndpoint(g, items, "Kernel")).toEqual({ kind: "item", index: 1 });
    expect(resolveEndpoint(g, items, "kernel of a map")).toEqual({ kind: "item", index: 1 });
    expect(resolveEndpoint(g, items, "Widget")).toMatchObject({ kind: "existing", node: { name: "Homomorphism" } });
    expect(resolveEndpoint(g, items, "Homomorphisms")).toMatchObject({ kind: "existing", node: { name: "Homomorphism" } });
    expect(resolveEndpoint(g, items, "Field")).toBeNull();
    // An unticked candidate can't be linked to.
    items[3] = { ...items[3], include: false };
    expect(resolveEndpoint(g, items, "Coset")).toBeNull();
    expect(linkUsable(g, items, { from: "Coset", to: "Kernel" })).toBe(false);
    expect(linkUsable(g, items, { from: "Kernel", to: "Widget" })).toBe(true);
    expect(linkUsable(g, items, { from: "Widget", to: "Homomorphism" })).toBe(false); // the same concept
  });

  it("adds the ticked candidates tidily, links prerequisites, and keeps relations the user already has", () => {
    let g = base();
    const [grp] = g.nodes;
    const mixed = ops.addNode(g, { name: "Coset" }); // the user already related Coset and Group by hand
    g = ops.upsertRelation(mixed.graph, mixed.id, grp.id, dir("mine"), dir("mine too"), "mix");
    const review = buildReview(g, answer);
    const { graph, added } = applyExtraction(g, review, { x: 500, y: 500 });
    expect(added.map((id) => graph.nodes.find((n) => n.id === id)!.name)).toEqual(["Kernel"]);
    const kernel = graph.nodes.find((n) => n.name === "Kernel")!;
    const hom = graph.nodes.find((n) => n.name === "Homomorphism")!;
    expect(kernel).toMatchObject({ definition: "Elements sent to the identity.", aliases: ["ker"], status: "checking" });
    expect(kernel.dependsOn).toEqual([hom.id]);
    expect(ops.findRelation(graph, kernel.id, hom.id)?.origin).toBe("dependency");
    expect(ops.findRelation(graph, mixed.id, kernel.id)).toMatchObject({ origin: "extract", aToB: { kind: "partitions by" } });
    expect(ops.findRelation(graph, mixed.id, grp.id)?.aToB.kind).toBe("mine");
    // Placed near the anchor, clear of the other concepts.
    expect(Math.abs(kernel.position.x - 500)).toBeLessThan(600);
    expect(Math.abs(kernel.position.y - 500)).toBeLessThan(600);
  });

  it("places the new concepts in layers, prerequisites above, without overlaps", () => {
    const res: ExtractResponse = {
      concepts: ["A", "B", "C"].map((name) => ({ name, definition: "", aliases: [] })),
      relations: [],
      prerequisites: [
        { dependent: "B", prerequisite: "A", role: "uses", reason: "" },
        { dependent: "C", prerequisite: "B", role: "uses", reason: "" },
      ],
    };
    const g = ops.emptyGraph();
    const { graph } = applyExtraction(g, buildReview(g, res));
    const y = (n: string) => graph.nodes.find((x) => x.name === n)!.position.y;
    expect(y("A")).toBeLessThan(y("B"));
    expect(y("B")).toBeLessThan(y("C"));
  });
});

describe("the extract relation origin", () => {
  it("survives a share link and an import, and has its own view filter", async () => {
    const g = base();
    const [a, b] = g.nodes;
    const withRel = ops.upsertRelation(g, a.id, b.id, dir("x"), dir("y"), "extract");
    const { graph, fixes } = await decodeShare(await encodeShare(withRel, "P", { native: false }), { native: false });
    expect(graph.relations[0].origin).toBe("extract");
    expect(fixes).toEqual([]);
    expect(repairImport({ format: "nodestorm/v1", graphs: [withRel] }).fixes).toEqual([]);
    expect(DEFAULT_VIEW.origins.extract).toBe(true);
    const hidden = visibleParts(withRel, { ...DEFAULT_VIEW, origins: { ...DEFAULT_VIEW.origins, extract: false } });
    expect(hidden.relations.size).toBe(0);
  });
});

describe("extract flow (store + mock AI)", () => {
  const store = () => useGraphStore.getState();
  const graph = () => store().graphs[store().activeId];

  beforeEach(() => {
    store().reset();
    useSettings.setState({ connection: "browser", provider: "mock" });
    store().mutate(() => base());
  });

  it("extracts with the mock provider and inserts everything as ONE undo step", async () => {
    const res = await extractFromText(
      'A group homomorphism has a kernel, and the kernel is a normal subgroup. Its cosets form a "Quotient Thing".',
    );
    const review = buildReview(graph(), res!);
    expect(review.items.filter((i) => !i.include).map((i) => i.name).sort()).toEqual(["Group", "Homomorphism"]);
    const before = graph();
    const added = insertExtraction(review);
    expect(added).toHaveLength(4); // Kernel, Normal Subgroup, Subgroup, Quotient Thing
    // Let the queued prerequisite checks finish: they are background changes, not undo steps.
    await vi.waitFor(() => expect(graph().nodes.every((n) => n.status !== "checking")).toBe(true));
    expect(graph().nodes.find((n) => n.name === "Kernel")?.status).toBe("ok");
    store().undo();
    expect(graph().nodes.map((n) => n.name)).toEqual(before.nodes.map((n) => n.name));
    expect(graph().relations).toHaveLength(before.relations.length);
    store().redo();
    expect(graph().nodes).toHaveLength(before.nodes.length + 4);
  });
});
