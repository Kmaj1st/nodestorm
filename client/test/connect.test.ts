import type { Graph } from "@nodestorm/shared";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { suggestConnections } from "../src/lib/actions";
import { mentionedIn } from "../src/lib/extract";
import * as ops from "../src/lib/graphOps";
import { useGraphStore } from "../src/store/graphStore";
import { useSettings } from "../src/store/settingsStore";

// "Suggest connections": keywords for a concept to connect to, reviewed by the user before anything is added.

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

beforeEach(() => {
  store().reset();
  useSettings.setState({ connection: "browser", provider: "mock", lookup: { enabled: false, proofwiki: true, wikipedia: true, baidu: true, fandom: "", bwiki: "" } });
});

describe("mentionedIn", () => {
  it("finds the concepts a definition names (name, alias or plural), not itself and not inside formulas", () => {
    let g = ops.emptyGraph();
    for (const n of ["Group", "Homomorphism", "Kernel", "Set"]) g = ops.addNode(g, { name: n, aliases: n === "Kernel" ? ["ker"] : [] }).graph;
    const id = g.nodes.find((n) => n.name === "Kernel")!.id;
    g = ops.updateNode(g, id, { definition: "The elements a homomorphism sends to the identity of the groups; $Set$ is a set." });
    const names = mentionedIn(g, g.nodes.find((n) => n.id === id)!).map((n) => n.name);
    expect(names.sort()).toEqual(["Group", "Homomorphism", "Set"]);
  });
});

describe("suggestConnections (offline demo)", () => {
  it("offers named concepts and the AI's suggestions, never already linked ones, as a review nothing is added from yet", async () => {
    store().mutate((g) => {
      let out = ops.addNode(g, { name: "Group" }).graph;
      out = ops.addNode(out, { name: "Subgroup", definition: "A subset of a group that is itself a group under the same operation." }).graph;
      return out;
    });
    const sub = graph().nodes.find((n) => n.name === "Subgroup")!;
    const before = graph();
    const review = await suggestConnections(sub.id);
    expect(graph()).toBe(before); // nothing added until the user picks
    const names = review!.items.map((i) => i.name);
    expect(names[0]).toBe("Group"); // named in the definition, found without the AI
    expect(names.some((n) => /normal subgroup/i.test(n))).toBe(true); // builds on Subgroup (the AI's suggestion)
    expect(review!.items.find((i) => i.name === "Group")!.include).toBe(false); // already in the graph: linked, not added
    expect(review!.links.every((l) => l.from === "Subgroup" && l.include)).toBe(true);
    expect(review!.links.flatMap((l) => [l.aToB.kind, l.bToA.kind]).every((k) => !/ by$/.test(k))).toBe(true);
    // Once linked, Group isn't suggested again.
    store().mutate((g) => ops.upsertRelation(g, sub.id, g.nodes.find((n) => n.name === "Group")!.id, { kind: "using", explanation: "" }, { kind: "none", explanation: "" }, "mix"));
    const again = await suggestConnections(sub.id);
    expect(again!.items.map((i) => i.name)).not.toContain("Group");
  });

  it("says so when there is nothing to suggest", async () => {
    store().mutate((g) => ops.addNode(g, { name: "Zorblax" }).graph);
    expect(await suggestConnections(graph().nodes[0].id)).toBeNull();
    expect(store().toast).toMatch(/No new connections/);
  });
});
