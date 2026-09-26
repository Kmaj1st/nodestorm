import type { Graph } from "@nodestorm/shared";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { analyzeNode, chooseSense, compareSources, relookup, replaceDefinition } from "../src/lib/actions";
import { api } from "../src/lib/api";
import * as ops from "../src/lib/graphOps";
import { activeSites, lookupLanguage, resetLookup } from "../src/lib/lookup";
import { resetSources } from "../src/lib/sources";
import { useGraphStore } from "../src/store/graphStore";
import { useSettings } from "../src/store/settingsStore";

// The definition step of analyzeNode (Settings: use the AI right away), against fake encyclopedia answers, a fake web
// search (off unless a test turns it on) and the offline mock AI, which rates the sources but never writes a definition.

vi.mock("../src/lib/webSearch", () => import("./fakeWebSearch"));
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
const json = (body: unknown) => new Response(JSON.stringify(body), { status: 200, headers: { "content-type": "application/json" } });

/** Answer requests to the encyclopedias with these routes (anything else there: 404); other URLs are untouched. */
let routes: [RegExp, () => Response][] = [];
let lookups = 0;
const realFetch = globalThis.fetch;
beforeEach(() => {
  routes = [];
  lookups = 0;
  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = decodeURIComponent(String(input)).replace(/\+/g, " ");
    if (!/proofwiki|wikipedia|wikidata/.test(url)) return realFetch(input, init);
    lookups++;
    return routes.find(([re]) => re.test(url))?.[1]() ?? new Response("{}", { status: 404, headers: { "content-type": "application/json" } });
  }) as typeof fetch;
  store().reset();
  resetLookup();
  resetSources();
  fake.ready = false;
  fake.pages = undefined;
  useSettings.setState({
    newConcepts: "auto", // the automatic flow (lookupFlow.test.ts has the asking one)
    connection: "browser",
    provider: "mock",
    language: "auto",
    clarify: { enabled: true, options: 3 },
    lookup: { enabled: true, proofwiki: true, wikipedia: true, baidu: true, fandom: "", bwiki: "" },
  });
});
afterEach(() => {
  globalThis.fetch = realFetch;
  vi.restoreAllMocks();
});

function add(name: string) {
  let id = "";
  store().mutate((g) => {
    const r = ops.addNode(g, { name });
    id = r.id;
    return r.graph;
  });
  return id;
}

const KERNEL = "== Definition ==\nThe '''kernel''' of $\\phi$ is $\\map {\\phi^{-1} } {e_H}$.";

describe("definitions from encyclopedias", () => {
  it("uses ProofWiki's definition with its source, then checks prerequisites with the AI", async () => {
    routes = [[/proofwiki.*page=Definition:Kernel/, () => json({ parse: { title: "Definition:Kernel", wikitext: KERNEL } })]];
    const id = add("Kernel");
    await analyzeNode(id);
    const n = node(id);
    expect(n.definition).toBe("The kernel of $\\phi$ is $\\phi^{-1} \\left(e_H\\right)$.");
    expect(n.source).toEqual({ site: "ProofWiki", title: "Definition:Kernel", url: "https://proofwiki.org/wiki/Definition:Kernel" });
    expect(n.status).not.toBe("checking");
    expect(n.missingDeps.map((d) => d.name)).toContain("Homomorphism"); // the mock AI's prerequisites
  });

  it("offers several looked-up meanings in “what do you mean?”, and the choice keeps its source", async () => {
    routes = [
      [/proofwiki/, () => new Response("blocked", { status: 403, headers: { "content-type": "text/html", "cf-mitigated": "challenge" } })],
      [/titles=Expectation&/, () => json({ query: { pages: [{ title: "Expectation", pageprops: { disambiguation: "" }, extract: "may refer to" }] } })],
      [/wbsearchentities/, () => json({ search: [
        { id: "Q1", label: "expected value", description: "average of a random variable" },
        { id: "Q2", label: "expectation", description: "belief about the future" },
      ] })],
      [/wbgetentities/, () => json({ entities: {} })],
    ];
    const id = add("Expectation");
    await analyzeNode(id);
    const n = node(id);
    expect(n.status).toBe("unclear");
    // The page named exactly "expectation" first.
    expect(n.senses?.map((s) => [s.name, s.source?.site])).toEqual([["expectation", "Wikidata"], ["expected value", "Wikidata"]]);
    expect(store().clarifying).toMatchObject({ graphId: store().activeId, nodeId: id, sources: { rated: true } });
    chooseSense(store().activeId, id, n.senses![1]);
    expect(node(id).source).toEqual({ site: "Wikidata", title: "Q1", url: "https://www.wikidata.org/wiki/Q1" });
    expect(node(id).definition).toBe("average of a random variable");
  });

  it("asks before taking a near match for a different name, and never adds its name as an alias", async () => {
    routes = [
      [/prefixsearch/, () => json({ query: { prefixsearch: [{ title: "Definition:Normal Subgroup" }] } })],
      [/page=Definition:Normal Subgroup/, () => json({ parse: { title: "Definition:Normal Subgroup", wikitext: "== Definition ==\nInvariant under conjugation." } })],
    ];
    const id = add("Normal");
    await analyzeNode(id);
    expect(node(id)).toMatchObject({ status: "unclear", definition: "", aliases: [] });
    expect(node(id).senses?.map((s) => s.name)).toEqual(["Normal Subgroup"]);
  });

  it("an install's hint goes to the AI's check of the sources, which writes no definition", async () => {
    const assess = vi.spyOn(api, "assess");
    routes = [
      [/proofwiki/, () => new Response("x", { status: 403, headers: { "content-type": "text/html" } })],
      [/titles=Expectation&/, () => json({ query: { pages: [{ title: "Expectation", pageprops: { disambiguation: "" }, extract: "x" }] } })],
      [/wbsearchentities/, () => json({ search: [{ id: "Q1", label: "expected value", description: "average" }, { id: "Q2", label: "expectation", description: "belief" }] })],
      [/wbgetentities/, () => json({ entities: {} })],
    ];
    const id = add("Expectation");
    await analyzeNode(id, undefined, "needed by Variance (probability)");
    expect(assess.mock.calls[0][0]).toMatchObject({ name: "Expectation", hint: "needed by Variance (probability)" });
    // Two near matches: nothing is taken unasked, and nothing comes from the AI.
    expect(node(id)).toMatchObject({ status: "unclear", definition: "" });
    expect(node(id).senses?.every((s) => s.source?.site === "Wikidata")).toBe(true);
  });

  it("without AI set up, a chosen looked-up meaning is kept instead of failing", async () => {
    useSettings.setState({ provider: "siliconflow", configs: { ...useSettings.getState().configs, siliconflow: {} } });
    routes = [
      [/proofwiki/, () => new Response("x", { status: 403, headers: { "content-type": "text/html" } })],
      [/titles=Expectation&/, () => json({ query: { pages: [{ title: "Expectation", pageprops: { disambiguation: "" }, extract: "x" }] } })],
      [/wbsearchentities/, () => json({ search: [{ id: "Q1", label: "expected value", description: "average" }, { id: "Q2", label: "expectation", description: "belief" }] })],
      [/wbgetentities/, () => json({ entities: {} })],
    ];
    const id = add("Expectation");
    await analyzeNode(id);
    chooseSense(store().activeId, id, node(id).senses![1]);
    await vi.waitFor(() => expect(node(store().graphs[store().activeId].nodes[0].id).status).toBe("ok"));
    expect(store().settingsOpen).toBe(false);
  });

  it("nothing found: the concept needs a definition, and no AI text is written", async () => {
    const id = add("Homomorphism");
    await analyzeNode(id);
    expect(node(id)).toMatchObject({ status: "unclear", definition: "", senses: [] });
    expect(node(id).source).toBeUndefined();
  });

  it("with web search, the most reliable page's passage is taken word for word, with the page as its source", async () => {
    fake.ready = true;
    const id = add("Homomorphism");
    await analyzeNode(id);
    const n = node(id);
    expect(n.definition).toBe("A map between algebraic structures that preserves the operations, e.g. $\\varphi(ab) = \\varphi(a)\\varphi(b)$ for groups.");
    expect(n.source).toEqual({ site: "demo-encyclopedia.example", title: "Homomorphism - Demo Encyclopedia", url: "https://demo-encyclopedia.example/wiki/Homomorphism" });
    expect(n.status).not.toBe("unclear");
  });

  it("a doubtful source alone isn't taken: the concept waits for the user", async () => {
    fake.ready = true;
    fake.pages = (name) => [
      { engine: "demo", title: "Forum", url: "https://demo-forum.example/t/1", site: "demo-forum.example", text: `${name} is a set of numbers, trust me.` },
    ];
    const id = add("Homomorphism");
    await analyzeNode(id);
    expect(node(id)).toMatchObject({ status: "unclear", definition: "" });
    expect(node(id).senses?.[0]).toMatchObject({ definition: "Homomorphism is a set of numbers, trust me.", source: { site: "demo-forum.example" } });
    expect(store().clarifying?.sources?.sources[0]).toMatchObject({ reliability: "low" });
  });

  it("skips a site that refused for a while", async () => {
    routes = [[/proofwiki/, () => new Response("x", { status: 403, headers: { "content-type": "text/html" } })]];
    await analyzeNode(add("Zorblax"));
    const before = lookups;
    await analyzeNode(add("Quuxling"));
    // The second concept only asked Wikipedia (1 page query + 1 Wikidata search), not ProofWiki again.
    expect(lookups - before).toBe(2);
  });

  it("keeps a looked-up definition without AI set up, instead of opening Settings", async () => {
    useSettings.setState({ provider: "siliconflow", configs: { ...useSettings.getState().configs, siliconflow: {} } });
    routes = [[/titles=Group&/, () => json({ query: { pages: [{ title: "Group", extract: "A group is a set with an associative operation, identity and inverses." }] } })]];
    const id = add("Group");
    await analyzeNode(id);
    expect(node(id)).toMatchObject({ status: "ok", definition: "A group is a set with an associative operation, identity and inverses." });
    expect(store().settingsOpen).toBe(false);
  });

  it("is off when disabled in Settings", async () => {
    useSettings.setState({ lookup: { enabled: false, proofwiki: true, wikipedia: true, baidu: true, fandom: "", bwiki: "" } });
    await analyzeNode(add("Kernel"));
    expect(lookups).toBe(0);
  });

  it("“Look up again” replaces the definition as one undo step", async () => {
    const id = add("Kernel");
    store().mutate((g) => ops.updateNode(g, id, { definition: "old", status: "ok" }));
    routes = [[/proofwiki.*page=Definition:Kernel/, () => json({ parse: { title: "Definition:Kernel", wikitext: KERNEL } })]];
    await relookup(id);
    expect(node(id).source?.site).toBe("ProofWiki");
    store().undo();
    expect(node(id).definition).toBe("old");
  });

  it("picks the Wikipedia language from the setting or the name's script", () => {
    expect(lookupLanguage("auto", "Kernel")).toBe("en");
    expect(lookupLanguage("auto", "正规子群")).toBe("zh");
    expect(lookupLanguage("auto", "カーネル")).toBe("ja");
    expect(lookupLanguage("auto", "Ядро")).toBe("ru");
    expect(lookupLanguage("Chinese (中文)", "Kernel")).toBe("zh");
    expect(lookupLanguage("Klingon", "Kernel")).toBe("en");
  });

  it("looks up from a source the user picks, even when already defined and look-ups are off", async () => {
    useSettings.setState({ lookup: { enabled: false, proofwiki: true, wikipedia: true, baidu: true, fandom: "", bwiki: "" } });
    routes = [[/proofwiki.*page=Definition:Kernel/, () => json({ parse: { title: "Definition:Kernel", wikitext: KERNEL } })]];
    const id = add("Kernel");
    store().mutate((g) => ops.updateNode(g, id, { definition: "my own words", status: "ok", source: ops.OWN_SOURCE }));
    await relookup(id, undefined, "proofwiki");
    expect(node(id).source?.site).toBe("ProofWiki");
    expect(node(id).definition).toContain("kernel");
  });

  it("“Search the web and compare” opens the sources; choosing replaces the definition as one undo step", async () => {
    fake.ready = true;
    const id = add("Kernel");
    store().mutate((g) => ops.updateNode(g, id, { definition: "my own words", status: "ok", source: ops.OWN_SOURCE }));
    await compareSources(id);
    const c = store().clarifying!;
    expect(c).toMatchObject({ nodeId: id, replace: true, sources: { rated: true } });
    const pick = c.sources!.sources.find((s) => s.site === "demo-encyclopedia.example")!;
    expect(node(id).definition).toBe("my own words"); // nothing changes until the user chooses
    replaceDefinition(store().activeId, id, { definition: pick.passage, source: { site: pick.site, title: pick.title, url: pick.url } });
    expect(node(id)).toMatchObject({ definition: pick.passage, status: "ok", source: { site: "demo-encyclopedia.example" } });
    expect(store().clarifying).toBeNull();
    store().undo();
    expect(node(id)).toMatchObject({ definition: "my own words", source: ops.OWN_SOURCE });
  });

  it("asks Baidu Baike last, and only for a name in Chinese", () => {
    expect(activeSites(Date.now(), "正规子群")).toEqual(["proofwiki", "wikipedia", "baidu"]);
    expect(activeSites(Date.now(), "Normal subgroup")).toEqual(["proofwiki", "wikipedia"]);
    useSettings.setState({ lookup: { ...useSettings.getState().lookup, baidu: false } });
    expect(activeSites(Date.now(), "正规子群")).toEqual(["proofwiki", "wikipedia"]);
  });
});
