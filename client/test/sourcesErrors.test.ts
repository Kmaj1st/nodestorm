import { ProviderError } from "@nodestorm/shared";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useLocale } from "../src/i18n";
import { addConcept, compareSources } from "../src/lib/actions";
import { api } from "../src/lib/api";
import { resetLookup } from "../src/lib/lookup";
import { allSourcesFailed, gatherSources, resetSources } from "../src/lib/sources";
import { useGraphStore } from "../src/store/graphStore";
import { useSettings } from "../src/store/settingsStore";

// The sources flow when something fails: the AI's rating, one search engine, or every source.

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
const settle = () => new Promise((r) => setTimeout(r, 20));
const idle = async () => {
  for (let i = 0; i < 200 && Object.keys(store().busy).length; i++) await settle();
};

beforeEach(() => {
  store().reset();
  resetLookup();
  resetSources();
  Object.assign(fake, { ready: true, pages: undefined, failed: [], error: undefined, fresh: undefined });
  useSettings.setState({
    autoRate: true, // these tests follow the AI's rating of the sources (off by default)
    newConcepts: "ask",
    connection: "browser",
    provider: "mock",
    language: "auto",
    clarify: { enabled: true, options: 3 },
    // No encyclopedia is asked (they would need the network): the fake web search is the only source.
    lookup: { enabled: false, proofwiki: true, wikipedia: true, baidu: true, fandom: "", bwiki: "" },
  });
});
afterEach(() => {
  vi.restoreAllMocks();
  useLocale.setState({ lang: "en" });
});

describe("the AI's rating fails", () => {
  const cases: [string, unknown, RegExp][] = [
    ["a network failure", new ProviderError("fetch failed", 502, undefined, { code: "unreachable", params: { provider: "OpenAI" } }), /OpenAI/],
    ["a rejected key (401)", new ProviderError("401", 401, undefined, { code: "invalidKey", params: { provider: "OpenAI" } }), /OpenAI/],
    ["a malformed answer", new ProviderError("bad json", 502, undefined, { code: "malformed", params: { provider: "OpenAI" } }), /OpenAI/],
    ["a plain error", new TypeError("Failed to fetch"), /Failed to fetch/],
  ];
  for (const [what, error, text] of cases) {
    it(`${what}: the sources are still shown, unrated, with why`, async () => {
      vi.spyOn(api, "assess").mockRejectedValueOnce(error);
      const found = await gatherSources("Group");
      expect(found.rated).toBe(false);
      expect(found.sources.length).toBeGreaterThan(0);
      expect(found.sources.every((s) => s.reliability === null && s.passage)).toBe(true);
      expect(found.assessError).toMatch(text);
    });
  }

  it("the reason is in the interface language", async () => {
    useLocale.setState({ lang: "zh" });
    vi.spyOn(api, "assess").mockRejectedValueOnce(new ProviderError("401", 401, undefined, { code: "invalidKey", params: { provider: "OpenAI" } }));
    const found = await gatherSources("Group");
    expect(found.assessError).toMatch(/[一-鿿]/);
    expect(found.assessError).not.toMatch(/rejected/i);
  });
});

describe("search engines fail", () => {
  it("one engine failing: the others' sources are shown and the failure is listed", async () => {
    fake.failed = ["tavily"];
    const found = await gatherSources("Group");
    expect(found.sources.length).toBeGreaterThan(0);
    expect(found.rated).toBe(true);
    expect(found.failed).toEqual(["Tavily"]);
    expect(found.asked).toContain("Offline demo");
    expect(allSourcesFailed(found)).toBe(false);
  });

  it("every source failing is told apart from nothing existing", async () => {
    fake.error = new Error("offline");
    const found = await gatherSources("Group");
    expect(found.sources).toEqual([]);
    expect(found.failed).toEqual(["web search"]);
    expect(allSourcesFailed(found)).toBe(true);
    // Nothing found although every site answered: not a failure.
    fake.error = undefined;
    fake.pages = () => [];
    const none = await gatherSources("Zorblax");
    expect(none.failed).toEqual([]);
    expect(allSourcesFailed(none)).toBe(false);
  });

  it("a failed search isn't cached: the next gather asks again", async () => {
    fake.error = new Error("offline");
    await gatherSources("Group");
    fake.error = undefined;
    const calls = fake.calls;
    const found = await gatherSources("Group");
    expect(fake.calls).toBe(calls + 1);
    expect(found.sources.length).toBeGreaterThan(0);
  });
});

describe("Search again", () => {
  it("asks the search engines past their cache; the menu's compare (fresh only) keeps their cache", async () => {
    const id = addConcept({ name: "Group" });
    await idle();
    expect(fake.fresh).toBeFalsy();
    await compareSources(id, undefined, { fresh: true });
    expect(fake.fresh).toBeFalsy();
    await compareSources(id, undefined, { fresh: true, requery: true });
    expect(fake.fresh).toBe(true);
    expect(store().clarifying?.sources?.sources.length).toBeGreaterThan(0);
  });
});
