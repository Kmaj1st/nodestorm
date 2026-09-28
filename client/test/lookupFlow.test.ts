import type { Graph } from "@nodestorm/shared";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { addConcept, checkWithAi, chooseSense, installDep, sensesLookedUp } from "../src/lib/actions";
import { api } from "../src/lib/api";
import * as ops from "../src/lib/graphOps";
import { everySite, lookupEverywhere, resetLookup } from "../src/lib/lookup";
import { resetSources } from "../src/lib/sources";
import { useGraphStore } from "../src/store/graphStore";
import { useSettings } from "../src/store/settingsStore";

// Adding a concept with "ask first" (the default): the sources found (encyclopedias, wikis; the web search is off
// here unless a test turns it on) are offered, rated by the AI; the AI checks prerequisites only when the user says so.

vi.mock("../src/lib/webSearch", () => import("./fakeWebSearch"));
vi.mock("../src/lib/webSearchReady", () => import("./fakeWebSearch"));
const { fake } = await import("./fakeWebSearch");

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
/** The AI writing a definition itself ("Describe it"): never part of a look-up. */
let aiWrites: { mock: { calls: unknown[] } };
let deps: { mock: { calls: unknown[] } };
let assess: { mock: { calls: unknown[][] } };
beforeEach(() => {
  routes = [];
  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = decodeURIComponent(String(input)).replace(/\+/g, " ");
    if (!/proofwiki|wikipedia|wikidata|fandom/.test(url)) return realFetch(input, init);
    return routes.find(([re]) => re.test(url))?.[1]() ?? new Response("{}", { status: 404, headers: { "content-type": "application/json" } });
  }) as typeof fetch;
  store().reset();
  resetLookup();
  resetSources();
  fake.ready = false;
  fake.pages = undefined;
  useSettings.setState({
    newConcepts: "ask",
    connection: "browser",
    provider: "mock",
    language: "auto",
    clarify: { enabled: true, options: 3 },
    lookup: { enabled: true, proofwiki: true, wikipedia: true, baidu: true, fandom: "minecraft", bwiki: "" },
  });
  aiWrites = vi.spyOn(api, "name");
  deps = vi.spyOn(api, "deps");
  assess = vi.spyOn(api, "assess");
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

  it("asks Baidu Baike and Moegirl for a name in Chinese, whatever language the AI answers in", () => {
    useSettings.setState({ language: "English" });
    expect(everySite("正规子群")).toEqual(["proofwiki", "wikipedia", "baidu", "moegirl", "fandom"]);
    useSettings.setState({ language: "Chinese (中文)" });
    expect(everySite("Kernel")).toEqual(["proofwiki", "wikipedia", "fandom"]);
  });

  it("asks nothing when look-ups are off", async () => {
    useSettings.setState({ lookup: { ...useSettings.getState().lookup, enabled: false } });
    expect(await lookupEverywhere("Kernel", 3)).toEqual({ senses: [], asked: [], failed: [] });
  });
});

describe("adding a concept, asking first", () => {
  it("offers what was found, rated by the AI, without checking prerequisites or writing a definition", async () => {
    kernelRoutes();
    const id = addConcept({ name: "Kernel" });
    await idle();
    expect(node(id).status).toBe("unclear");
    expect(node(id).senses?.map((s) => s.source?.site)).toEqual(["ProofWiki", "Fandom (minecraft)"]);
    expect(store().clarifying).toMatchObject({
      nodeId: id,
      sources: { asked: ["ProofWiki", "Wikipedia", "Fandom (minecraft)"], failed: [], web: false, rated: true },
    });
    // Two meanings: the mathematical one and the game's block, grouped apart.
    expect(store().clarifying!.sources!.sources.map((s) => s.sense)).toEqual(["mathematics", "The Kernel is"]);
    expect(assess).toHaveBeenCalledTimes(1);
    expect(aiWrites).not.toHaveBeenCalled();
    expect(deps).not.toHaveBeenCalled();
  });

  it("without an AI set up, the sources are offered unrated in the order found", async () => {
    useSettings.setState({ provider: "siliconflow", configs: { ...useSettings.getState().configs, siliconflow: {} } });
    kernelRoutes();
    const id = addConcept({ name: "Kernel" });
    await idle();
    const found = store().clarifying!.sources!;
    expect(found.rated).toBe(false);
    expect(found.sources.map((s) => [s.site, s.reliability])).toEqual([["ProofWiki", null], ["Fandom (minecraft)", null]]);
    // The default passage is the encyclopedia's definition.
    expect(found.sources[1].passage).toBe(FANDOM_KERNEL);
    expect(assess).not.toHaveBeenCalled();
    expect(node(id).status).toBe("unclear");
  });

  it("with web search, the pages come after the encyclopedias, one per URL, and the choice records the page", async () => {
    fake.ready = true;
    fake.pages = () => [
      { engine: "demo", title: "Kernel (algebra)", url: "https://demo-lecture-notes.example/kernel", site: "demo-lecture-notes.example", text: "Definition. The kernel of a homomorphism is the set of elements sent to the identity. More." },
      { engine: "demo", title: "Kernel again", url: "https://demo-lecture-notes.example/kernel/", site: "demo-lecture-notes.example", text: "Duplicate page." },
      { engine: "demo", title: "Kernel??", url: "https://demo-forum.example/t/9", site: "demo-forum.example", text: "kernel is just the zero of a group lol. trust me." },
    ];
    kernelRoutes();
    const id = addConcept({ name: "Kernel" });
    await idle();
    const found = store().clarifying!.sources!;
    expect(found.asked).toEqual(["ProofWiki", "Wikipedia", "Fandom (minecraft)", "Offline demo"]);
    const sites = found.sources.map((s) => `${s.site}:${s.reliability}`);
    expect(sites).toEqual([
      "ProofWiki:high",
      "Fandom (minecraft):high",
      "demo-lecture-notes.example:high",
      "demo-forum.example:low",
    ]);
    const forum = found.sources[3];
    expect(forum.reasons).toMatch(/forum/i);
    const notes = found.sources[2];
    // The AI's passage, verbatim from the page.
    expect(notes.passage).toBe("The kernel of a homomorphism is the set of elements sent to the identity.");
    expect(notes.pointed).toBe(true);
    chooseSense(store().activeId, id, { name: "Kernel", definition: notes.passage, source: { site: notes.site, title: notes.title, url: notes.url } });
    expect(node(id)).toMatchObject({
      status: "pending",
      definition: "The kernel of a homomorphism is the set of elements sent to the identity.",
      source: { site: "demo-lecture-notes.example", title: "Kernel (algebra)", url: "https://demo-lecture-notes.example/kernel" },
    });
    expect(aiWrites).not.toHaveBeenCalled();
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
    expect(aiWrites).not.toHaveBeenCalled(); // the definition is kept
    expect(node(id).status).not.toBe("pending");
    expect(node(id).missingDeps.map((d) => d.name)).toContain("Homomorphism");
  });

  it("nothing found: the concept needs a definition, and the dialog still opens", async () => {
    const id = addConcept({ name: "Zorblax" });
    await idle();
    expect(node(id)).toMatchObject({ status: "unclear", senses: [] });
    expect(store().clarifying?.nodeId).toBe(id);
    expect(store().clarifying?.sources?.sources).toEqual([]);
    expect(aiWrites).not.toHaveBeenCalled();
    expect(assess).not.toHaveBeenCalled(); // nothing to rate
  });

  it("a concept renamed during the look-up isn't given the old name's results: the new name is looked up", async () => {
    kernelRoutes();
    routes.push([/fandom.*Kernal/, () => json({ query: { pages: [{ title: "Kernal", missing: true }] } })]);
    const id = addConcept({ name: "Kernal" });
    store().mutate((g) => ops.renameNode(g, id, "Kernel").graph);
    await idle();
    expect(node(id)).toMatchObject({ name: "Kernel", status: "unclear" });
    expect(node(id).senses?.map((s) => s.source?.site)).toEqual(["ProofWiki", "Fandom (minecraft)"]);
    expect(store().clarifying?.nodeId).toBe(id);
  });

  it("a definition typed during the look-up is kept, waiting for “Check with AI”", async () => {
    kernelRoutes();
    const id = addConcept({ name: "Kernel" });
    store().mutate((g) => ops.updateNode(g, id, { definition: "My own." }));
    await idle();
    expect(node(id)).toMatchObject({ status: "pending", definition: "My own." });
    expect(node(id).senses ?? []).toEqual([]);
    expect(store().clarifying).toBe(null);
  });

  it("an add undone during the look-up opens no dialog; redoing it brings the result", async () => {
    kernelRoutes();
    const id = addConcept({ name: "Kernel" });
    store().undo();
    await idle();
    expect(graph().nodes.some((n) => n.id === id)).toBe(false);
    expect(store().clarifying).toBe(null);
    store().redo();
    expect(node(id).status).toBe("unclear");
    expect(node(id).senses).toHaveLength(2);
  });

  it("tells looked-up definitions from the AI's meanings", () => {
    expect(sensesLookedUp([])).toBe(true);
    expect(sensesLookedUp([{ name: "K", domain: "", definition: "d", source: { site: "ProofWiki", title: "Definition:K" } }])).toBe(true);
    expect(sensesLookedUp([{ name: "K", domain: "", definition: "d", source: { site: "AI", title: "Demo" } }])).toBe(false);
    expect(sensesLookedUp([{ name: "K", domain: "algebra", definition: "d" }])).toBe(false); // older AI meanings
  });

  it("reset closes the dialog", async () => {
    const id = addConcept({ name: "Zorblax" });
    await idle();
    expect(store().clarifying?.nodeId).toBe(id);
    store().reset();
    expect(store().clarifying).toBe(null);
  });

  it("a typed definition waits without any look-up or AI", async () => {
    const id = addConcept({ name: "Widget", definition: "A small gadget.", source: ops.OWN_SOURCE });
    await idle();
    expect(node(id).status).toBe("pending");
    expect(aiWrites).not.toHaveBeenCalled();
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
    expect(aiWrites).not.toHaveBeenCalled();
    expect(deps).not.toHaveBeenCalled();
  });

  it("without an exact page it needs a definition, and no dialog opens", async () => {
    const q = withMissing("Zorblax");
    installDep(q, "Zorblax");
    await idle();
    expect(byName("Zorblax")).toMatchObject({ status: "unclear", senses: [] });
    expect(store().clarifying).toBe(null);
    expect(aiWrites).not.toHaveBeenCalled();
  });
});
