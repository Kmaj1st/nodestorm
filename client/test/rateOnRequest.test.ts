import { beforeEach, describe, expect, it, vi } from "vitest";
import { addConcept, compareSources } from "../src/lib/actions";
import { api } from "../src/lib/api";
import { resetLookup } from "../src/lib/lookup";
import { assessExcerpt, cachedSources, gatherSources, resetSources } from "../src/lib/sources";
import { useGraphStore } from "../src/store/graphStore";
import { useSettings } from "../src/store/settingsStore";

// By default the AI never rates the sources by itself (an AI call can take a long while): they show at once, unrated,
// and "Check reliability with AI" (compareSources with `rate`) asks for the rating.

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
const graph = () => store().graphs[store().activeId];
const settle = () => new Promise((r) => setTimeout(r, 20));
const idle = async () => {
  for (let i = 0; i < 200 && Object.keys(store().busy).length; i++) await settle();
};

beforeEach(() => {
  store().reset();
  store().setClarifying(null);
  resetLookup();
  resetSources();
  vi.restoreAllMocks();
  Object.assign(fake, { ready: true, pages: undefined, failed: [], error: undefined, fresh: undefined });
  useSettings.setState({
    autoRate: false,
    newConcepts: "ask",
    connection: "browser",
    provider: "mock",
    language: "auto",
    clarify: { enabled: true, options: 3 },
    lookup: { enabled: false, proofwiki: true, wikipedia: true, baidu: true, fandom: "", bwiki: "" },
  });
});

describe("the AI rates the sources only when asked", () => {
  it("is off by default", () => {
    expect(useSettings.getInitialState().autoRate).toBe(false);
  });

  it("gathering shows the sources at once, unrated, without an AI call", async () => {
    const assess = vi.spyOn(api, "assess");
    const found = await gatherSources("Group");
    expect(assess).not.toHaveBeenCalled();
    expect(found.rated).toBe(false);
    expect(found.sources.length).toBeGreaterThan(0);
    expect(found.sources.every((s) => s.reliability === null && s.passage)).toBe(true);
    // Unrated results count as found: reopening the pop-up shows them without searching again.
    expect(cachedSources("Group")?.sources.length).toBe(found.sources.length);
  });

  it("adding a concept by name opens the unrated sources, and no AI task of any kind runs", async () => {
    const calls = Object.keys(api).map((k) => vi.spyOn(api, k as keyof typeof api));
    const id = addConcept({ name: "Group" });
    await idle();
    expect(calls.filter((c) => c.mock.calls.length).length).toBe(0);
    expect(store().clarifying).toMatchObject({ nodeId: id });
    expect(store().clarifying?.sources?.rated).toBe(false);
  });

  it("“Check reliability with AI” rates the sources already found, without searching again", async () => {
    const id = addConcept({ name: "Group" });
    await idle();
    const searches = fake.calls ?? 0;
    const assess = vi.spyOn(api, "assess");
    await compareSources(id, undefined, { rate: true, ifOpen: true });
    expect(assess).toHaveBeenCalledTimes(1);
    expect(fake.calls ?? 0).toBe(searches);
    expect(store().clarifying?.sources?.rated).toBe(true);
    expect(store().clarifying?.sources?.sources.some((s) => s.reliability)).toBe(true);
    // The rating is kept: gathering again shows it without another AI call.
    const again = await gatherSources("Group");
    expect(again.rated).toBe(true);
    expect(assess).toHaveBeenCalledTimes(1);
  });

  it("with “Rate sources with AI automatically” on, the sources are rated right away", async () => {
    useSettings.setState({ autoRate: true });
    const assess = vi.spyOn(api, "assess");
    const found = await gatherSources("Group");
    expect(assess).toHaveBeenCalledTimes(1);
    expect(found.rated).toBe(true);
  });

  it("the fully automatic way of adding concepts lets the AI rate (and pick) by itself", async () => {
    useSettings.setState({ newConcepts: "auto" });
    const assess = vi.spyOn(api, "assess");
    const id = addConcept({ name: "Group" });
    await idle();
    expect(assess).toHaveBeenCalledTimes(1);
    expect(graph().nodes.find((n) => n.id === id)?.definition).not.toBe("");
  });
});

describe("what the AI reads when asked", () => {
  it("a long text is cut to a window around its passage", () => {
    const passage = "A group is a set with an associative operation, an identity and inverses.";
    const text = `${"x".repeat(3000)} ${passage} ${"y".repeat(3000)}`;
    const cut = assessExcerpt({ text, passage });
    expect(cut.length).toBeLessThanOrEqual(1200);
    expect(cut).toContain(passage);
  });

  it("a short text goes as it is", () => {
    expect(assessExcerpt({ text: "short", passage: "short" })).toBe("short");
  });
});
