import type { Graph, LookupSense } from "@nodestorm/shared";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { addConcept, compareSources, installAllMissing, installDep, openSources, relookup } from "../src/lib/actions";
import { toMarkdown } from "../src/lib/export";
import { repairImport } from "../src/lib/importRepair";
import { decodeShare, encodeShare } from "../src/lib/share";
import * as ops from "../src/lib/graphOps";
import { resetLookup } from "../src/lib/lookup";
import {
  autoPick,
  defaultPassage,
  groupBySense,
  leadSentences,
  mergeFound,
  mergeRatings,
  resetSources,
  cachedSources,
  gatherSources,
  sourceRef,
  SOURCES_CACHE_CHARS,
  SOURCES_CACHE_KEY,
  sourcesAsSenses,
  sourcesFromSenses,
  type Source,
} from "../src/lib/sources";
import { useGraphStore } from "../src/store/graphStore";
import { useSettings } from "../src/store/settingsStore";

// Sources for a definition: encyclopedias and web pages in one list, rated by the AI, never written by it.

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

afterEach(() => {
  vi.useRealTimers();
});

const store = () => useGraphStore.getState();
const graph = (): Graph => store().graphs[store().activeId];
const settle = () => new Promise((r) => setTimeout(r, 20));
const idle = async () => {
  for (let i = 0; i < 200 && Object.keys(store().busy).length; i++) await settle();
};

const wiki = (name: string, definition: string, exact = true): LookupSense => ({
  name,
  domain: "algebra",
  definition,
  aliases: [],
  source: { site: "Wikipedia", title: name, url: `https://en.wikipedia.org/wiki/${name}` },
  exact,
});
const page = (url: string, text: string, title = "Page") => ({ title, url, site: "x", text });

beforeEach(() => {
  store().reset();
  resetLookup();
  resetSources();
  fake.ready = true;
  fake.pages = undefined;
  useSettings.setState({
    newConcepts: "ask",
    connection: "browser",
    provider: "mock",
    language: "auto",
    clarify: { enabled: true, options: 3 },
    // No encyclopedia is asked (they would need the network): the fake web search is the only source.
    lookup: { enabled: false, proofwiki: true, wikipedia: true, baidu: true, fandom: "", bwiki: "" },
    installAll: { maxDepth: 3, maxNodes: 15 },
  });
});

describe("merging what was found", () => {
  it("puts encyclopedias first, takes a web page's host as its site, and keeps one source per page", () => {
    const merged = mergeFound(
      [wiki("Group", "A group is a set with an operation.")],
      [
        page("https://www.mathworld.example/Group.html", "A group is a set. It has inverses."),
        page("https://mathworld.example/Group.html#top", "Same page again."),
        page("https://en.wikipedia.org/wiki/Group/", "The encyclopedia's page again."),
        page("https://empty.example/", "   "),
      ],
    );
    expect(merged.map((s) => [s.kind, s.site])).toEqual([
      ["encyclopedia", "Wikipedia"],
      ["web", "mathworld.example"],
    ]);
    // Without the AI: the encyclopedia's whole definition, the page's first sentences.
    expect(merged.map((s) => s.passage)).toEqual(["A group is a set with an operation.", "A group is a set. It has inverses."]);
  });

  it("the non-AI passage is the text's own first sentence or two, never rewritten", () => {
    expect(leadSentences("A group is a set with an associative operation, identity and inverses. It is central. More.")).toBe(
      "A group is a set with an associative operation, identity and inverses.",
    );
    expect(leadSentences("Group. A set with an operation, e.g. addition. Next.")).toBe("Group. A set with an operation, e.g. addition.");
    // A very short first sentence brings the second along.
    expect(leadSentences("群是一种代数结构。它有单位元。还有更多。")).toBe("群是一种代数结构。它有单位元。");
    expect(defaultPassage({ kind: "encyclopedia", text: " Whole definition. Second sentence. " })).toBe("Whole definition. Second sentence.");
  });

  it("merges the AI's ratings, sorts most reliable first (unrated last) and keeps only verbatim passages", () => {
    const found = mergeFound([], [
      page("https://a.example/", "Alpha text. Defines it here."),
      page("https://b.example/", "Beta text."),
      page("https://c.example/", "Gamma text."),
    ]);
    const merged = mergeRatings(found, [
      { id: "w2", reliability: "high", reasons: "good", sense: "algebra", passage: "Beta text." },
      { id: "w1", reliability: "low", reasons: "forum", sense: "algebra", passage: "Not in the text." },
    ]);
    expect(merged.map((s) => [s.site, s.reliability])).toEqual([["b.example", "high"], ["a.example", "low"], ["c.example", null]]);
    expect(merged[0]).toMatchObject({ passage: "Beta text.", pointed: true });
    // A quote that isn't the page's text is not kept: the default passage stays, not marked as the AI's.
    expect(merged[1]).toMatchObject({ passage: "Alpha text. Defines it here.", pointed: false });
  });

  it("groups sources by meaning only when the AI says they differ", () => {
    const s = (id: string, sense: string, reliability: Source["reliability"] = "high") =>
      ({ id, kind: "web", site: id, title: "", text: "t", reliability, reasons: "", sense, passage: "t", pointed: true }) as Source;
    expect(groupBySense([s("a", "algebra"), s("b", "Algebra")])).toEqual([{ sense: "", sources: [s("a", "algebra"), s("b", "Algebra")] }]);
    const groups = groupBySense([s("a", "algebra"), s("b", "video game"), s("c", "algebra", "low"), s("d", "", null)]);
    expect(groups.map((g) => [g.sense, g.sources.map((x) => x.id)])).toEqual([
      ["algebra", ["a", "c"]],
      ["video game", ["b"]],
      ["", ["d"]],
    ]);
  });

  it("takes a passage unasked only from a reliable source, and not when reliable sources mean different things", () => {
    const s = (id: string, reliability: Source["reliability"], sense = "algebra", extra: Partial<Source> = {}) =>
      ({ id, kind: "web", site: id, title: "", text: "t", reliability, reasons: "", sense, passage: `p${id}`, pointed: true, ...extra }) as Source;
    expect(autoPick({ rated: true, sources: [s("a", "high"), s("b", "medium")] })?.id).toBe("a");
    expect(autoPick({ rated: true, sources: [s("a", "low"), s("b", "unusable")] })).toBeUndefined();
    expect(autoPick({ rated: true, sources: [s("a", "high"), s("b", "high", "video game")] })).toBeUndefined();
    // An encyclopedia's page for another name is never taken unasked.
    expect(autoPick({ rated: true, sources: [s("a", "high", "algebra", { kind: "encyclopedia", exact: false })] })).toBeUndefined();
    // Without a rating: only an exact encyclopedia page found alone.
    expect(autoPick({ rated: false, sources: [s("a", null, "", { kind: "encyclopedia", exact: true })] })?.id).toBe("a");
    expect(autoPick({ rated: false, sources: [s("a", null)] })).toBeUndefined();
  });

  it("stores the sources on a waiting concept as meanings with their own words and sources, and reads them back", () => {
    const found = mergeRatings(mergeFound([wiki("Kernel (algebra)", "The kernel is the preimage of the identity.", false)], [
      page("https://notes.example/k", "Notes. The kernel is the set sent to e.", "Lecture notes"),
      page("https://junk.example/k", "Buy now."),
    ]), [
      { id: "e1", reliability: "high", reasons: "", sense: "algebra", passage: "The kernel is the preimage of the identity." },
      { id: "w1", reliability: "medium", reasons: "", sense: "algebra", passage: "The kernel is the set sent to e." },
      { id: "w2", reliability: "unusable", reasons: "an advert", sense: "", passage: "" },
    ]);
    const senses = sourcesAsSenses(found, "Kernel");
    // Each with the AI's rating of it (3 sources were compared), never text the AI wrote for the definition.
    expect(senses).toEqual([
      { name: "Kernel (algebra)", domain: "algebra", definition: "The kernel is the preimage of the identity.", kind: null, source: { site: "Wikipedia", title: "Kernel (algebra)", url: "https://en.wikipedia.org/wiki/Kernel (algebra)", rating: { reliability: "high", reasons: "", compared: 3 } } },
      { name: "Kernel", domain: "algebra", definition: "The kernel is the set sent to e.", kind: null, source: { site: "notes.example", title: "Lecture notes", url: "https://notes.example/k", rating: { reliability: "medium", reasons: "", compared: 3 } } },
    ]);
    const back = sourcesFromSenses([...senses, { name: "K", domain: "", definition: "AI text", source: { site: "AI", title: "Demo" } }]);
    expect(back.map((s) => [s.kind, s.site, s.passage, s.reliability, s.sense, s.compared])).toEqual([
      ["encyclopedia", "Wikipedia", "The kernel is the preimage of the identity.", "high", "algebra", 3],
      ["web", "notes.example", "The kernel is the set sent to e.", "medium", "algebra", 3],
    ]);
    // Unrated (older projects, no AI): no rating stored or read back.
    const unrated = sourcesAsSenses(mergeFound([], [page("https://notes.example/k", "Notes.")]), "Kernel");
    expect(unrated[0].source).toEqual({ site: "notes.example", title: "Page", url: "https://notes.example/k" });
    expect(sourcesFromSenses(unrated)[0]).toMatchObject({ reliability: null, reasons: "", sense: "" });
  });
});

describe("no definition from the AI through the look-up paths", () => {
  const noAiSource = () => {
    for (const g of Object.values(store().graphs)) {
      for (const n of g.nodes) {
        expect(n.source?.site).not.toBe("AI");
        for (const s of n.senses ?? []) expect(s.source?.site).not.toBe("AI");
      }
    }
  };

  it("ask first, use the AI right away, install, install all and compare: every definition is a source's words", async () => {
    addConcept({ name: "Group" });
    await idle();
    useSettings.setState({ newConcepts: "auto" });
    const q = addConcept({ name: "Quotient Group" });
    await idle();
    expect(graph().nodes.find((n) => n.id === q)).toMatchObject({
      definition: "The group $G/N$ of cosets of a normal subgroup $N$, with $(aN)(bN) = abN$.",
      source: { site: "demo-encyclopedia.example" },
    });
    await installAllMissing(q);
    await idle();
    const installed = graph().nodes.filter((n) => n.id !== q && n.name !== "Group");
    expect(installed.length).toBeGreaterThan(0);
    for (const n of installed) expect(n.source?.site).toBe("demo-encyclopedia.example");
    // Unknown to the demo: no source, so it needs a definition (the AI doesn't make one up).
    const z = addConcept({ name: "Zorblax" });
    await idle();
    expect(graph().nodes.find((n) => n.id === z)).toMatchObject({ status: "unclear", definition: "", senses: [] });
    useSettings.setState({ newConcepts: "ask" });
    store().mutate((g) => ops.updateNode(g, q, { missingDeps: [{ name: "Kernel", role: "uses", reason: "r" }] }));
    installDep(q, "Kernel");
    await idle();
    await compareSources(q);
    noAiSource();
  });

  it("with the AI's check failing, the sources are still offered, unrated", async () => {
    const { api } = await import("../src/lib/api");
    vi.spyOn(api, "assess").mockRejectedValueOnce(new Error("boom"));
    const id = addConcept({ name: "Subgroup" });
    await idle();
    expect(store().clarifying).toMatchObject({ nodeId: id, sources: { rated: false, assessError: "boom" } });
    expect(store().clarifying!.sources!.sources[0]).toMatchObject({
      reliability: null,
      passage: "A subset of a group that is itself a group under the same operation.",
    });
    // Not offered again unrated from the cache: its badge asks the AI again (the search itself is cached).
    expect(cachedSources("Subgroup")).toBeUndefined();
    vi.restoreAllMocks();
  });
});

describe("the AI's rating kept with the chosen definition", () => {
  const rated = (): Source => ({
    id: "w1",
    kind: "web",
    site: "notes.example",
    title: "Lecture notes",
    url: "https://notes.example/k",
    text: "The kernel is the set sent to e.",
    reliability: "high",
    reasons: "Lecture notes; agrees with the encyclopedia.",
    sense: "algebra",
    passage: "The kernel is the set sent to e.",
    pointed: true,
    compared: 3,
  });

  it("is recorded with the source: reliability, the short reason, how many were compared", () => {
    expect(sourceRef(rated())).toEqual({
      site: "notes.example",
      title: "Lecture notes",
      url: "https://notes.example/k",
      rating: { reliability: "high", reasons: "Lecture notes; agrees with the encyclopedia.", compared: 3 },
    });
    expect(sourceRef({ ...rated(), reasons: "x".repeat(2000) }).rating!.reasons).toHaveLength(500);
    expect(sourceRef({ ...rated(), reliability: null }).rating).toBeUndefined();
    expect(sourceRef({ site: "Wikipedia", title: "Group" }).rating).toBeUndefined();
  });

  it("is stored when a concept takes a rated source's passage, and dropped when the definition is written by hand", async () => {
    useSettings.setState({ newConcepts: "auto" });
    const id = addConcept({ name: "Quotient Group" });
    await idle();
    const n = graph().nodes.find((x) => x.id === id)!;
    expect(n.source).toMatchObject({ site: "demo-encyclopedia.example", rating: { reliability: "high" } });
    expect(n.source!.rating!.compared).toBeGreaterThanOrEqual(1);
    // The inspector's definition field sets the source to "you" on a hand edit: no rating goes with it.
    store().mutate((g) => ops.updateNode(g, id, { definition: "My words.", source: ops.OWN_SOURCE }));
    expect(graph().nodes.find((x) => x.id === id)!.source).toEqual({ site: "you", title: "" });
  });

  it("goes through import repair, share links and the Markdown export", async () => {
    const g = ops.addNode(ops.emptyGraph(), { name: "Kernel", definition: "The kernel is the set sent to e.", source: sourceRef(rated()) }).graph;
    const back = repairImport({ format: "nodestorm/v1", graphs: [g] }).doc.graphs[0].nodes[0];
    expect(back.source).toEqual(sourceRef(rated()));
    const shared = await decodeShare(await encodeShare(g, "x"));
    expect(shared.graph.nodes[0].source).toEqual(sourceRef(rated()));
    // A damaged rating is dropped; the source itself is kept.
    const damaged = repairImport({ format: "nodestorm/v1", graphs: [{ ...g, nodes: [{ ...g.nodes[0], source: { ...sourceRef(rated()), rating: { reliability: "great" } } }] }] });
    expect(damaged.doc.graphs[0].nodes[0].source).toEqual({ site: "notes.example", title: "Lecture notes", url: "https://notes.example/k" });
    expect(toMarkdown(g)).toContain(
      "*Source:* [notes.example: Lecture notes](https://notes.example/k) · Reliable (AI check of 3 sources): Lecture notes; agrees with the encyclopedia.",
    );
  });
});

describe("the sources cache", () => {
  const stored = () => JSON.parse(localStorage.getItem(SOURCES_CACHE_KEY) ?? "[]") as [string, unknown][];

  it("keeps the rated sources across a reload, for a day, so the badge shows them without searching again", async () => {
    const found = await gatherSources("Group");
    expect(found.rated).toBe(true);
    expect(fake.calls).toBeGreaterThan(0);
    const calls = fake.calls;
    expect(stored()).toHaveLength(1);
    resetSources(false); // a reload: memory is gone, localStorage stays
    const again = cachedSources("Group");
    expect(again).toMatchObject({ rated: true, note: found.note });
    expect(again!.sources.map((s) => [s.site, s.reliability])).toEqual(found.sources.map((s) => [s.site, s.reliability]));
    await gatherSources("Group");
    expect(fake.calls).toBe(calls);
    // A day later it is gone.
    vi.useFakeTimers({ now: Date.now() + 25 * 60 * 60_000 });
    resetSources(false);
    expect(cachedSources("Group")).toBeUndefined();
  });

  it("the badge of a concept with nothing gathered yet searches (web and rating), and one with a cached search doesn't", async () => {
    const g = ops.addNode(graph(), { name: "Group" });
    store().mutate(() => ops.updateNode(g.graph, g.id, { status: "unclear", senses: [] }));
    const before = fake.calls;
    openSources(g.id);
    expect(store().clarifying).toMatchObject({ nodeId: g.id });
    await idle();
    expect(fake.calls).toBe(before + 1);
    expect(store().clarifying).toMatchObject({ nodeId: g.id, sources: { rated: true } });
    store().setClarifying(null);
    openSources(g.id);
    await idle();
    expect(fake.calls).toBe(before + 1);
    expect(store().clarifying).toEqual({ graphId: store().activeId, nodeId: g.id });
    // Closed before the search ends: it doesn't pop up again.
    resetSources();
    openSources(g.id);
    store().setClarifying(null);
    await idle();
    expect(store().clarifying).toBeNull();
  });

  it("is dropped by “Look up in…” and “Search the web and compare…”", async () => {
    const id = addConcept({ name: "Group" });
    await idle();
    expect(cachedSources("Group")).toBeDefined();
    await relookup(id, undefined, "wikipedia");
    expect(cachedSources("Group")).toBeUndefined();
    await gatherSources("Group");
    const calls = fake.calls;
    await compareSources(id, undefined, { fresh: true });
    expect(fake.calls).toBe(calls + 1);
  });

  it("stays under its size cap, oldest names first, and ignores damaged data", async () => {
    fake.pages = (name) => [{ engine: "demo" as const, ...page(`https://long.example/${encodeURIComponent(name)}`, `${name} is ${"very long text ".repeat(4000)}`) }];
    for (const n of ["Alpha", "Beta", "Gamma", "Delta", "Epsilon", "Zeta", "Eta", "Theta", "Iota", "Kappa"]) await gatherSources(n);
    const raw = localStorage.getItem(SOURCES_CACHE_KEY)!;
    expect(raw.length).toBeLessThanOrEqual(SOURCES_CACHE_CHARS);
    const names = stored().map(([k]) => k.split(":").at(-1));
    expect(names.length).toBeGreaterThan(0);
    expect(names.at(-1)).toBe("kappa");
    expect(names).not.toContain("alpha");

    for (const bad of ["{not json", JSON.stringify({ a: 1 }), JSON.stringify([["k", { at: "yesterday" }], 5, null]), JSON.stringify([[stored()[0][0], { at: Date.now(), found: { sources: [{ id: 1 }] } }]])]) {
      localStorage.setItem(SOURCES_CACHE_KEY, bad);
      resetSources(false);
      expect(cachedSources("Kappa")).toBeUndefined();
    }
    // A damaged cache is simply searched past.
    const found = await gatherSources("Kappa");
    expect(found.sources).toHaveLength(1);
  });
});
