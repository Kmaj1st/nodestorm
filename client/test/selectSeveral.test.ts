import { afterEach, describe, expect, it, vi } from "vitest";
import { touchScreen } from "../src/lib/touch";
import { useView } from "../src/store/viewStore";

// "Select several" (taps add concepts to the selection, for touch screens): a view state of this tab only.

vi.hoisted(() => {
  const data = new Map<string, string>();
  const mem = { getItem: (k: string) => data.get(k) ?? null, setItem: (k: string, v: string) => void data.set(k, v), removeItem: (k: string) => void data.delete(k) };
  const g = globalThis as { localStorage?: unknown; sessionStorage?: unknown };
  g.localStorage = mem;
  g.sessionStorage = mem;
});

describe("Select several", () => {
  afterEach(() => useView.getState().setSelecting(false));

  it("starts off, toggles, and is never remembered with the view preferences", () => {
    expect(useView.getState().selecting).toBe(false);
    useView.getState().setSelecting(true);
    expect(useView.getState().selecting).toBe(true);
    useView.getState().setPrefs({ edgeLabels: false });
    expect(localStorage.getItem("nodestorm-view")).not.toContain("selecting");
    useView.getState().setSelecting(false);
    expect(useView.getState().selecting).toBe(false);
  });
});

describe("touchScreen", () => {
  const g = globalThis as { matchMedia?: unknown };
  afterEach(() => delete g.matchMedia);

  it("is a coarse pointer, and false where matchMedia is missing", () => {
    expect(touchScreen()).toBe(false);
    g.matchMedia = (q: string) => ({ matches: q === "(pointer: coarse)" });
    expect(touchScreen()).toBe(true);
    g.matchMedia = () => ({ matches: false });
    expect(touchScreen()).toBe(false);
  });
});
