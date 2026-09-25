import type { AbsurdChainResponse, Graph } from "@nodestorm/shared";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { applyAbsurdChain, chainConcepts, chainToText, hopExplanation, intermediates, isStop, sandboxName } from "../src/lib/absurd";
import { absurdChain, addAbsurdChainToSandbox } from "../src/lib/actions";
import { api } from "../src/lib/api";
import * as ops from "../src/lib/graphOps";
import { useAbsurd } from "../src/store/absurdStore";
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

const hop = (from: string, to: string, kind = "leads to") => ({ from, to, kind, fact: `${from} is linked to ${to}.`, quip: `Behold, ${to}!` });
const chain: AbsurdChainResponse = {
  title: "The Saga of Homomorphism and Toast",
  chain: [hop("Homomorphism", "Fourier transform"), hop("Fourier transform", "Heat"), hop("Heat", "Toast", "")],
  moral: "All roads lead to breakfast.",
  plausibility: "Every link is textbook material.",
};

function base(): Graph {
  let g = ops.emptyGraph();
  for (const [name, x, y] of [["Homomorphism", 0, 0], ["Group", 600, 0]] as const) {
    const r = ops.addNode(g, { name, position: { x, y } });
    g = ops.applyDeps(r.graph, r.id, []);
  }
  const [h, gr] = g.nodes;
  return ops.upsertRelation(g, h.id, gr.id, { kind: "preserves", explanation: "mine" }, { kind: "none", explanation: "" });
}

describe("absurd chain helpers", () => {
  it("lists the concepts on the chain and the ones in between", () => {
    expect(chainConcepts(chain)).toEqual(["Homomorphism", "Fourier transform", "Heat", "Toast"]);
    expect(intermediates(chain)).toEqual(["Fourier transform", "Heat"]);
    expect(chainConcepts({ chain: [] })).toEqual([]);
  });

  it("names a sandbox after the title, kept short", () => {
    expect(sandboxName("  The   Saga ")).toBe("The Saga");
    expect(sandboxName("x".repeat(80))).toHaveLength(60);
    expect(sandboxName("x".repeat(80)).endsWith("…")).toBe(true);
    expect(sandboxName("")).toBe("Absurd chain");
  });

  it("writes the chain as plain text: links, facts, narration, moral", () => {
    const text = chainToText(chain);
    expect(text.split("\n").slice(0, 5)).toEqual([
      "The Saga of Homomorphism and Toast",
      "",
      "1. Homomorphism → Fourier transform (leads to)",
      "   Fact: Homomorphism is linked to Fourier transform.",
      "   “Behold, Fourier transform!”",
    ]);
    expect(text).toContain("3. Heat → Toast\n");
    expect(text).toContain("Moral: All roads lead to breakfast.");
    expect(text).toContain("How solid: Every link is textbook material.");
    expect(hopExplanation({ fact: "F.", quip: "" })).toBe("F.");
  });
});

describe("applyAbsurdChain", () => {
  it("reuses concepts already in the graph and adds the others, with a relation per link", () => {
    const g = base();
    const { graph, added, linked } = applyAbsurdChain(g, chain, { x: 0, y: 0 });
    expect(graph.nodes.map((n) => n.name)).toEqual(["Homomorphism", "Group", "Fourier transform", "Heat", "Toast"]);
    expect(added.map((a) => graph.nodes.find((n) => n.id === a.id)?.name)).toEqual(["Fourier transform", "Heat", "Toast"]);
    expect(added[0].fact).toBe("Homomorphism is linked to Fourier transform.");
    expect(linked).toBe(3);
    const id = (name: string) => graph.nodes.find((n) => n.name === name)!.id;
    const rel = ops.findRelation(graph, id("Heat"), id("Toast"))!;
    expect(rel.a).toBe(id("Heat"));
    expect(rel.aToB).toEqual({ kind: "leading to", explanation: "Heat is linked to Toast.\n\n“Behold, Toast!”" });
    expect(rel.bToA.kind).toBe("none");
    // New concepts say where they came from; the user's own concepts are left as they were.
    expect(graph.nodes.find((n) => n.name === "Toast")?.notes).toBe("Added by the absurd chain “The Saga of Homomorphism and Toast”.");
    expect(graph.nodes.find((n) => n.name === "Homomorphism")?.notes).toBeUndefined();
    // No two concepts on the same spot.
    const spots = new Set(graph.nodes.map((n) => `${n.position.x},${n.position.y}`));
    expect(spots.size).toBe(graph.nodes.length);
  });

  it("keeps a relation the user already has between two concepts on the chain", () => {
    const g = base();
    const res: AbsurdChainResponse = { ...chain, chain: [hop("Homomorphism", "Group"), hop("group", "Toast")] };
    const { graph, linked } = applyAbsurdChain(g, res);
    expect(linked).toBe(1);
    const [h, gr] = graph.nodes;
    expect(ops.findRelation(graph, h.id, gr.id)?.aToB.explanation).toBe("mine");
    expect(graph.nodes.filter((n) => n.name.toLowerCase() === "group")).toHaveLength(1); // matched by name
  });

  it("gives a new custom stop the user's description as its definition, from you", () => {
    const g = base();
    const stops = [{ name: "heat", description: "  What the toaster makes.  " }, { name: "Group", description: "ignored: already mine" }];
    const { graph } = applyAbsurdChain(g, { ...chain, chain: [hop("Homomorphism", "Group"), hop("Group", "Heat"), hop("Heat", "Toast")] }, undefined, stops);
    const by = (name: string) => graph.nodes.find((n) => n.name === name)!;
    expect(by("Heat")).toMatchObject({ definition: "What the toaster makes.", source: ops.OWN_SOURCE });
    expect(by("Group").definition).toBe("");
    expect(by("Toast")).toMatchObject({ definition: "" });
    expect(by("Toast").source).toBeUndefined();
    // A stop without a description is left for the AI to define, like any new concept.
    const bare = applyAbsurdChain(g, chain, undefined, [{ name: "Heat", description: " " }]).graph;
    expect(bare.nodes.find((n) => n.name === "Heat")?.definition).toBe("");
  });

  it("knows the user's stops by name, whatever the spelling", () => {
    expect(isStop("heat ", [{ name: "Heat" }])).toBe(true);
    expect(isStop("Toast", [{ name: "Heat" }])).toBe(false);
  });

  it("places a chain whose ends are both new in a staircase around the given centre", () => {
    const { graph } = applyAbsurdChain(ops.emptyGraph(), { ...chain, chain: [hop("Opera", "Paper"), hop("Paper", "Jazz")] }, { x: 1000, y: 1000 });
    const ys = graph.nodes.map((n) => n.position.y);
    expect(ys[0]).toBeLessThan(ys[1]);
    expect(ys[1]).toBeLessThan(ys[2]);
    expect(graph.nodes.every((n) => Math.abs(n.position.x - 1000) < 600)).toBe(true);
  });
});

describe("absurd chain actions", () => {
  const store = () => useGraphStore.getState();

  beforeEach(() => {
    store().reset();
    useSettings.setState({ connection: "browser", provider: "mock" });
    store().mutate((g) => ({ ...base(), id: g.id, name: g.name }));
  });

  it("asks the AI with the graph's own concept for a name it knows, and as typed otherwise", async () => {
    const res = (await absurdChain("homomorphism", "Toast", "bureaucratic", { min: 3, max: 7 }))!;
    expect(res.chain[0].from).toBe("Homomorphism");
    expect(res.chain.at(-1)?.to).toBe("Toast");
    expect(res.title).toBe("Form 27-B: request to connect Homomorphism to Toast");
    expect(store().busy).toEqual({});
  });

  it("builds the chain through the user's stops, a graph concept and a custom one", async () => {
    const via = [{ name: "group", description: "" }, { name: "Grandma's oven", description: "The oven in my grandmother's kitchen." }];
    const res = (await absurdChain("Homomorphism", "Toast", "deadpan", { min: 3, max: 4 }, [], via))!;
    const names = chainConcepts(res);
    expect(names.indexOf("Group")).toBeGreaterThan(0);
    expect(names.indexOf("Grandma's oven")).toBeGreaterThan(names.indexOf("Group"));
    // The custom stop's description survives into the sandbox as its definition, from the user.
    const sandboxId = addAbsurdChainToSandbox(res, via)!;
    const oven = store().graphs[sandboxId].nodes.find((n) => n.name === "Grandma's oven")!;
    expect(oven).toMatchObject({ definition: "The oven in my grandmother's kitchen.", source: { site: "you" } });
    await vi.waitFor(() => expect(store().graphs[sandboxId].nodes.every((n) => n.status !== "checking")).toBe(true));
    expect(store().graphs[sandboxId].nodes.find((n) => n.name === "Grandma's oven")?.definition).toBe("The oven in my grandmother's kitchen.");
  });

  it("says in the user's language when the AI keeps missing a stop", async () => {
    const spy = vi.spyOn(api, "absurdChain").mockRejectedValueOnce(
      new Error('Mock returned malformed output: The chain is broken: it never passes through the stop "X". It must pass through every stop, in this order: "X".'),
    );
    expect(await absurdChain("Homomorphism", "Toast", "deadpan", { min: 3, max: 4 }, [], [{ name: "X", description: "" }])).toBeUndefined();
    expect(store().toast).toBe("The AI couldn't build a chain through all your stops in order. Try again, or change the stops.");
    spy.mockRestore();
    // A stop that is also an end is refused by the request itself (the dialog prevents it); no chain comes back.
    expect(await absurdChain("Homomorphism", "Toast", "deadpan", { min: 3, max: 4 }, [], [{ name: "Toast", description: "" }])).toBeUndefined();
  });

  it("adds a chain to a new sandbox as one undo step, leaving the graph it came from alone", async () => {
    const mainId = store().activeId;
    const before = store().graphs[mainId];
    const sandboxId = addAbsurdChainToSandbox(chain)!;
    expect(store().activeId).toBe(sandboxId);
    const sb = store().graphs[sandboxId];
    expect(sb).toMatchObject({ name: "The Saga of Homomorphism and Toast", parentId: mainId });
    expect(sb.nodes.map((n) => n.name)).toEqual(["Homomorphism", "Group", "Fourier transform", "Heat", "Toast"]);
    expect(store().graphs[mainId]).toBe(before);
    expect(store().history[sandboxId]?.past).toHaveLength(1);
    expect(store().toast).toContain("with 3 new concepts");
    // The new concepts are checked (quietly), like extracted ones.
    await vi.waitFor(() => expect(store().graphs[sandboxId].nodes.every((n) => n.status !== "checking")).toBe(true));
    store().undo();
    expect(store().graphs[sandboxId].nodes.map((n) => n.name)).toEqual(["Homomorphism", "Group"]);
  });

  it("opens the dialog with the two selected concepts as its ends", () => {
    const [a, b] = store().graphs[store().activeId].nodes;
    store().setSelection([a.id, b.id]);
    useAbsurd.getState().openAbsurd();
    expect(useAbsurd.getState().open).toEqual({ from: "Homomorphism", to: "Group" });
    store().setSelection([]);
    store().setInspect({ kind: "node", id: b.id });
    useAbsurd.getState().openAbsurd();
    expect(useAbsurd.getState().open).toEqual({ from: "Group", to: "" });
    useAbsurd.getState().openAbsurd("Fourier transform", "Toast");
    expect(useAbsurd.getState().open).toEqual({ from: "Fourier transform", to: "Toast" });
  });
});
