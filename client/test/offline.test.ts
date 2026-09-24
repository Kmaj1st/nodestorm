import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { api } from "../src/lib/api";
import { offlineMessage, OfflineError, isOnline, offlineBlocks } from "../src/lib/online";
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

const setOnline = (onLine: boolean) => vi.stubGlobal("navigator", { onLine });
afterEach(() => vi.unstubAllGlobals());

describe("offline guard", () => {
  it("blocks every provider but the offline demo, and only when offline", () => {
    expect(offlineBlocks("siliconflow", false)).toBe(true);
    expect(offlineBlocks("anthropic", false)).toBe(true);
    expect(offlineBlocks("openai", false)).toBe(true);
    expect(offlineBlocks("mock", false)).toBe(false);
    expect(offlineBlocks("siliconflow", true)).toBe(false);
  });

  it("reads navigator.onLine, treating an unknown state as online", () => {
    setOnline(false);
    expect(isOnline()).toBe(false);
    setOnline(true);
    expect(isOnline()).toBe(true);
    vi.stubGlobal("navigator", {});
    expect(isOnline()).toBe(true);
  });
});

describe("AI calls while offline", () => {
  beforeEach(() => useGraphStore.getState().reset());

  it("fail at once with the offline message instead of waiting for a timeout", async () => {
    useSettings.setState({ connection: "browser", provider: "siliconflow" });
    setOnline(false);
    const fetchSpy = vi.fn();
    vi.stubGlobal("fetch", fetchSpy);
    const started = Date.now();
    const err = await api.name({ description: "a map between groups that preserves the operation", context: [] }).catch((e) => e);
    expect(err).toBeInstanceOf(OfflineError);
    expect(err.message).toBe(offlineMessage());
    expect(Date.now() - started).toBeLessThan(100);
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("still run with the offline demo provider", async () => {
    useSettings.setState({ connection: "browser", provider: "mock" });
    setOnline(false);
    const r = await api.name({ description: "a map between groups that preserves the operation", context: [] });
    expect(r.candidates.length).toBeGreaterThan(0);
  });
});
