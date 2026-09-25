import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { activeSites, lookupDefinitions, lookupReady, resetLookup } from "../src/lib/lookup";
import { useSettings } from "../src/store/settingsStore";

// The encyclopedia clients are loaded on the first look-up (lib/lookupClients.ts). Here that load fails, as it
// would offline before the service worker has cached the chunk.

const stored = vi.hoisted(() => {
  const data = new Map<string, string>();
  (globalThis as { localStorage?: unknown }).localStorage = {
    getItem: (k: string) => data.get(k) ?? null,
    setItem: (k: string, v: string) => void data.set(k, v),
    removeItem: (k: string) => void data.delete(k),
  };
  return data;
});

vi.mock("../src/lib/lookupClients", () => {
  throw new Error("Failed to fetch dynamically imported module");
});

beforeEach(() => {
  resetLookup();
  stored.clear();
  useSettings.setState({ lookup: { enabled: true, proofwiki: true, wikipedia: true, baidu: true, fandom: "", bwiki: "" } });
  vi.spyOn(console, "warn").mockImplementation(() => {});
});
afterEach(() => vi.restoreAllMocks());

describe("look-up code loaded on demand", () => {
  it("answers the cheap checks without loading it", () => {
    expect(lookupReady()).toBe(true);
    expect(activeSites()).toEqual(["proofwiki", "wikipedia"]);
  });

  it("a failed load finds nothing, caches nothing, and leaves the sites alone for a while (the AI is asked)", async () => {
    expect(await lookupDefinitions("Group", 3)).toEqual([]);
    expect(stored.get("nodestorm-lookup-cache") ?? "{}").toBe("{}");
    expect(activeSites()).toEqual([]);
  });
});
