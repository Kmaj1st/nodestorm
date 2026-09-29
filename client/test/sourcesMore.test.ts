import { CancelledError } from "@nodestorm/shared";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { resetLookup } from "../src/lib/lookup";
import { cachedSources, gatherSources, resetSources, SOURCES_CACHE_KEY } from "../src/lib/sources";
import { useSettings } from "../src/store/settingsStore";

// The sources flow when the web search fails or the storage is full: what the user is told, and what is cached.

vi.mock("../src/lib/webSearch", () => import("./fakeWebSearch"));
const { fake } = await import("./fakeWebSearch");

const storage = vi.hoisted(() => {
  const data = new Map<string, string>();
  const s = { data, failWhenOver: Infinity };
  (globalThis as { localStorage?: unknown }).localStorage = {
    getItem: (k: string) => data.get(k) ?? null,
    setItem: (k: string, v: string) => {
      if (v.length > s.failWhenOver) throw new DOMException("full", "QuotaExceededError");
      data.set(k, v);
    },
    removeItem: (k: string) => void data.delete(k),
  };
  return s;
});

beforeEach(() => {
  resetLookup();
  resetSources();
  storage.failWhenOver = Infinity;
  fake.ready = true;
  fake.pages = undefined;
  fake.calls = 0;
  fake.paused = false;
  useSettings.setState({
    connection: "browser",
    provider: "mock",
    language: "auto",
    clarify: { enabled: true, options: 3 },
    lookup: { enabled: false, proofwiki: true, wikipedia: true, baidu: true, fandom: "", bwiki: "" },
  });
});

describe("gathering sources when the web search fails", () => {
  it("says the web search failed, offers nothing made up, and searches again next time instead of caching it", async () => {
    fake.pages = () => {
      throw new Error("engine down");
    };
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const out = await gatherSources("Group");
    expect(out.sources).toEqual([]);
    expect(out.failed).toEqual(["web search"]);
    expect(out.rated).toBe(false);
    expect(warn).toHaveBeenCalled();
    expect(cachedSources("Group")).toBeUndefined();

    fake.pages = undefined;
    const again = await gatherSources("Group");
    expect(fake.calls).toBe(2);
    expect(again.failed).toEqual([]);
    expect(again.sources.length).toBeGreaterThan(0);
    expect(again.rated).toBe(true);
    warn.mockRestore();
  });

  it("cancelling during the search throws CancelledError and caches nothing", async () => {
    const ctrl = new AbortController();
    fake.pages = () => {
      ctrl.abort();
      throw new Error("aborted");
    };
    await expect(gatherSources("Group", { signal: ctrl.signal })).rejects.toBeInstanceOf(CancelledError);
    expect(cachedSources("Group")).toBeUndefined();
  });
});

describe("the stored sources when the storage is full", () => {
  it("drops the oldest names until the rest fits, and keeps what it can", async () => {
    const text = (name: string) => `${name} is a structure studied in algebra. ${"More about it. ".repeat(60)}`;
    fake.pages = (name) => [{ engine: "demo", title: name, url: `https://notes.example/${name}`, site: "notes.example", text: text(name) }];
    await gatherSources("Group");
    const one = storage.data.get(SOURCES_CACHE_KEY)!.length;
    // Room for about one name's sources: the next save must drop "Group" to keep "Ring".
    storage.failWhenOver = Math.round(one * 1.5);
    await gatherSources("Ring");
    const saved = JSON.parse(storage.data.get(SOURCES_CACHE_KEY)!) as [string, unknown][];
    expect(saved).toHaveLength(1);
    expect(saved[0][0]).toMatch(/ring$/);
    // After a reload only "Ring" is still known without searching.
    resetSources(false);
    expect(cachedSources("Ring")).toBeDefined();
    expect(cachedSources("Group")).toBeUndefined();
  });
});

describe("sources cached while the web search was paused", () => {
  it("aren't reopened as they were once the engine can search again (the badge searches, as adding would)", async () => {
    fake.ready = false;
    fake.paused = true; // set up, but paused after a refusal: the encyclopedias only
    await gatherSources("Group");
    expect(cachedSources("Group")).toMatchObject({ web: false });
    fake.ready = true; // the pause is over
    expect(cachedSources("Group")).toBeUndefined();
    const again = await gatherSources("Group");
    expect(again.web).toBe(true);
    expect(fake.calls).toBe(1);
  });
});
