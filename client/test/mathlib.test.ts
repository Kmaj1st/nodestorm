import type { Graph } from "@nodestorm/shared";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { findInMathlib } from "../src/lib/actions";
import { toMarkdown } from "../src/lib/export";
import * as ops from "../src/lib/graphOps";
import { repairImport } from "../src/lib/importRepair";
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
const json = (body: unknown) => new Response(JSON.stringify(body), { status: 200, headers: { "content-type": "application/json" } });

// Loogle knows two of the mock AI's three names for "Kernel".
const KNOWN: Record<string, { type: string; doc?: string }> = {
  "MonoidHom.ker": { type: " (f : G →* M) : Subgroup G", doc: "The kernel of a monoid homomorphism." },
  "MonoidHom.normal_ker": { type: " (f : G →* M) : f.ker.Normal" },
};
const realFetch = globalThis.fetch;
beforeEach(() => {
  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = new URL(String(input));
    if (url.hostname !== "loogle.lean-lang.org") return realFetch(input, init);
    const q = url.searchParams.get("q")!;
    const k = KNOWN[q];
    return json(k ? { hits: [{ name: q, type: k.type, module: "Mathlib.Algebra.Group.Subgroup.Ker", doc: k.doc ?? null }] } : { error: `unknown identifier '${q}'` });
  }) as typeof fetch;
  store().reset();
  useSettings.setState({ connection: "browser", provider: "mock" });
});
afterEach(() => {
  globalThis.fetch = realFetch;
});

describe("Find in Mathlib", () => {
  it("keeps only the declarations Mathlib has, not as an undo step", async () => {
    let id = "";
    store().mutate((g) => {
      const r = ops.addNode(g, { name: "Kernel", definition: "Elements sent to the identity." });
      id = r.id;
      return r.graph;
    });
    await findInMathlib(id);
    const f = graph().nodes.find((n) => n.id === id)!.formal!;
    expect(f.decls.map((d) => d.name)).toEqual(["MonoidHom.ker", "MonoidHom.normal_ker"]);
    expect(f.decls[0]).toMatchObject({ type: "(f : G →* M) : Subgroup G", doc: "The kernel of a monoid homomorphism.", why: "the kernel as a subgroup" });
    expect(f.unverified).toEqual(["MonoidHom.kernelSubgroupOfDoom"]);
    store().undo(); // undoes the add, not the lookup result alone
    expect(graph().nodes).toHaveLength(0);
  });

  it("says so when nothing is found", async () => {
    let id = "";
    store().mutate((g) => {
      const r = ops.addNode(g, { name: "Zorblax" });
      id = r.id;
      return r.graph;
    });
    await findInMathlib(id);
    expect(graph().nodes[0].formal).toMatchObject({ decls: [], unverified: [] });
    expect(store().toast).toMatch(/No Mathlib declaration/);
  });

  it("travels in JSON exports and the Markdown notes", () => {
    let g = ops.addNode(ops.emptyGraph(), { name: "Kernel" }).graph;
    g = ops.updateNode(g, g.nodes[0].id, {
      formal: { decls: [{ name: "MonoidHom.ker", type: "Subgroup G", module: "Mathlib.X" }], unverified: [], checkedAt: 1 },
    });
    const back = repairImport({ format: "nodestorm/v1", graphs: [g] });
    expect(back.doc.graphs[0].nodes[0].formal?.decls[0].name).toBe("MonoidHom.ker");
    const bad = repairImport({ format: "nodestorm/v1", graphs: [{ ...g, nodes: [{ ...g.nodes[0], formal: { decls: "x" } }] }] });
    expect(bad.doc.graphs[0].nodes[0].formal).toBeUndefined();
    expect(toMarkdown(g)).toContain("*In Lean's Mathlib:* `MonoidHom.ker`");
  });
});
