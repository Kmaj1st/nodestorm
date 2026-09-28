import "fake-indexeddb/auto";
import { describe, expect, it, vi } from "vitest";
import { closeDerivePanel, openDerivePanel, useDeriveOpen } from "../src/store/deriveOpen";
import { searchEngines, searchReady } from "../src/lib/webSearchReady";
import { useSettings } from "../src/store/settingsStore";

// Code the first paint doesn't need is loaded on demand (the build puts it in chunks of its own): the web search
// engines' code, the sources' gathering and rating, and the "Derive together" store. The cheap checks and the
// buttons work without it. Here loading the search code fails, so any static import of it would fail this file.

vi.mock("../src/lib/webSearch", () => {
  throw new Error("Failed to fetch dynamically imported module");
});

describe("parts loaded on demand", () => {
  it("tells whether a web search can run without loading the engines' code", () => {
    useSettings.setState({ provider: "mock" });
    expect(searchEngines()).toEqual(["demo"]);
    expect(searchReady()).toBe(true);
    useSettings.setState({ provider: "anthropic" });
    expect(searchReady()).toBe(false); // no engine set up
  });

  it("opens and closes the Derive together panel, loading its store only then", async () => {
    expect(useDeriveOpen.getState().open).toBe(false);
    await openDerivePanel();
    expect(useDeriveOpen.getState().open).toBe(true);
    const { useDerive } = await import("../src/store/deriveStore");
    expect(useDerive.getState().open).toBe(true);
    closeDerivePanel();
    await vi.waitFor(() => expect(useDeriveOpen.getState().open).toBe(false));
    expect(useDerive.getState().open).toBe(false);
  });
});
