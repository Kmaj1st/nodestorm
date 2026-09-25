import type { Graph } from "@nodestorm/shared";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { addConcept, checkWithAi, chooseSense, installDep } from "../src/lib/actions";
import { api } from "../src/lib/api";
import * as ops from "../src/lib/graphOps";
import { lookupEverywhere, resetLookup } from "../src/lib/lookup";
import { useGraphStore } from "../src/store/graphStore";
import { useSettings } from "../src/store/settingsStore";

// Adding a concept with "ask first" (the default): what the encyclopedias and wikis found is offered, and the AI is
// used only when the user says so.

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
const node = (id: string) => graph().nodes.find((n) => n.id === id)!;
const byName = (name: string) => graph().nodes.find((n) => n.name === name)!;
const json = (body: unknown) => new Response(JSON.stringify(body), { status: 200, headers: { "content-type": "application/json" } });
const settle = () => new Promise((r) => setTimeout(r, 20));
const idle = async () => {
  for (let i = 0; i < 100 && Object.keys(store().busy).length; i++) await settle();
};

const KERNEL = "== Definition ==\nThe '''kernel''' of $\\phi$ is $\\map {\\phi^{-1} } {e_H}$.";
const FANDOM_KERNEL = "The Kernel is a block found deep underground, used to power the ancient machines of the Nether.";

let routes: [RegExp, () => Response][] = [];
const realFetch = globalThis.fetch;
let clarify: { mock: { calls: unknown[] } };
let deps: { mock: { calls: unknown[] } };
beforeEach(() => {
  routes = [];
  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = decodeURIComponent(String(input)).replace(/\+/g, " ");
    if (!/proofwiki|wikipedia|wikidata|fandom/.test(url)) return realFetch(input, init);
    return routes.find(([re]) => re.test(url))?.[1]() ?? new Response("{}", { status: 404, headers: { "content-type": "application/json" } });
  }) as typeof fetch;
  store().reset();
  store().setClarifying(null);
  resetLookup();
  useSettings.setState({
    newConcepts: "ask",
    connection: "browser",
    provider: "mock",
    language: "auto",
    clarify: { enabled: true, options: 3 },
    lookup: { enabled: true, proofwiki: true, wikipedia: true, baidu: true, fandom: "minecraft", bwiki: "" },
  });
  clarify = vi.spyOn(api, "clarify");
  deps = vi.spyOn(api, "deps");
});
afterEach(() => {
  globalThis.fetch = realFetch;
  vi.restoreAllMocks();
});

const kernelRoutes = () => {
  routes = [
    [/proofwiki.*page=Definition:Kernel/, () => json({ parse: { title: "Definition:Kernel", wikitext: KERNEL } })],
    [/fandom.*titles=Kernel/, () => json({ query: { pages: [{ title: "Kernel", extract: FANDOM_KERNEL }] } })],
  ];
};

describe("look-ups everywhere", () => {
  it("asks every enabled source and lists exact matches first, with their sources", async () => {
    kernelRoutes();
    const res = await lookupEverywhere("Kernel", 3);
    expect(res.asked).toEqual(["proofwiki", "wikipedia", "fandom"]);
    expect(res.senses.map((s) => s.source?.site)).toEqual(["ProofWiki", "Fandom (minecraft)"]);
    expect(res.failed).toEqual([]);
  });

  it("reports a site that refused", async () => {
    routes = [[/proofwiki/, () => new Response("x", { status: 403, headers: { "content-type": "text/html", "cf-mitigated": "challenge" } })]];
    const res = await lookupEverywhere("Kernel", 3);
    expect(res.senses).toEqual([]);
    expect(res.failed).toContain("proofwiki");
  });

  it("asks nothing when look-ups are off", async () => {
    useSettings.setState({ lookup: { ...useSettings.getState().lookup, enabled: false } });
    expect(await lookupEverywhere("Kernel", 3)).toEqual({ senses: [], asked: [], failed: [] });
  });
});

describe("adding a concept, asking first", () => {
  it("offers what was found and doesn't use the AI", async () => {
    kernelRoutes();
    const id = addConcept({ name: "Kernel" });
    await idle();
    expect(node(id).status).toBe("unclear");
    expect(node(id).senses?.map((s) => s.source?.site)).toEqual(["ProofWiki", "Fandom (minecraft)"]);
    expect(store().clarifying).toMatchObject({ nodeId: id, searched: { asked: ["ProofWiki", "Wikipedia", "Fandom (minecraft)"], failed: [] } });
    expect(clarify).not.toHaveBeenCalled();
    expect(deps).not.toHaveBeenCalled();
  });

  it("a chosen definition waits for “Check with AI”, which then checks prerequisites", async () => {
    kernelRoutes();
    const id = addConcept({ name: "Kernel" });
    await idle();
    chooseSense(store().activeId, id, node(id).senses![0]);
    await idle();
    expect(node(id)).toMatchObject({ status: "pending", source: { site: "ProofWiki" } });
    expect(deps).not.toHaveBeenCalled();
    expect(checkWithAi(id)).toBe(true);
    await idle();
    expect(deps).toHaveBeenCalledTimes(1);
    expect(clarify).not.toHaveBeenCalled(); // the definition is kept
    expect(node(id).status).not.toBe("pending");
    expect(node(id).missingDeps.map((d) => d.name)).toContain("Homomorphism");
  });

  it("nothing found: the concept needs a definition, and the dialog still opens", async () => {
    const id = addConcept({ name: "Zorblax" });
    await idle();
    expect(node(id)).toMatchObject({ status: "unclear", senses: [] });
    expect(store().clarifying?.nodeId).toBe(id);
    expect(clarify).not.toHaveBeenCalled();
  });

  it("a typed definition waits without any look-up or AI", async () => {
    const id = addConcept({ name: "Widget", definition: "A small gadget.", source: ops.OWN_SOURCE });
    await idle();
    expect(node(id).status).toBe("pending");
    expect(clarify).not.toHaveBeenCalled();
    expect(deps).not.toHaveBeenCalled();
    store().undo();
    expect(graph().nodes.some((n) => n.id === id)).toBe(false); // adding and waiting are one step
  });

  it("without an AI set up, “Check with AI” opens Settings and leaves the concept waiting", async () => {
    useSettings.setState({ provider: "siliconflow", configs: { ...useSettings.getState().configs, siliconflow: {} } });
    const id = addConcept({ name: "Widget", definition: "A small gadget." });
    expect(checkWithAi(id)).toBe(false);
    expect(store().settingsOpen).toBe(true);
    expect(node(id).status).toBe("pending");
  });

  it("an AI-written concept (asked for) is checked right away", async () => {
    addConcept({ name: "Coset", definition: "A translate of a subgroup." }, undefined, undefined, { ai: true });
    await idle();
    expect(deps).toHaveBeenCalled();
  });
});

describe("installing a prerequisite, asking first", () => {
  const withMissing = (dep: string) => {
    const id = addConcept({ name: "Quotient", definition: "G/N." });
    store().mutate((g) => ops.updateNode(g, id, { missingDeps: [{ name: dep, role: "uses", reason: "needed" }], status: "blocked" }));
    return id;
  };

  it("takes an exact encyclopedia page, waiting for “Check with AI”", async () => {
    kernelRoutes();
    const q = withMissing("Kernel");
    installDep(q, "Kernel");
    await idle();
    expect(byName("Kernel")).toMatchObject({ status: "pending", source: { site: "ProofWiki" } });
    expect(clarify).not.toHaveBeenCalled();
    expect(deps).not.toHaveBeenCalled();
  });

  it("without an exact page it needs a definition, and no dialog opens", async () => {
    const q = withMissing("Zorblax");
    installDep(q, "Zorblax");
    await idle();
    expect(byName("Zorblax")).toMatchObject({ status: "unclear", senses: [] });
    expect(store().clarifying).toBe(null);
    expect(clarify).not.toHaveBeenCalled();
  });
});
