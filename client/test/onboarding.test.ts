import { describe, expect, it } from "vitest";
import {
  availableSteps,
  loadOnboarding,
  ONBOARDING_KEY,
  onScreen,
  placePopover,
  saveOnboarding,
  shouldShowWelcome,
  TOUR_STEPS,
  type TourEnv,
} from "../src/lib/onboarding";

/** A Map-backed stand-in for localStorage; `broken` throws like blocked storage in private mode. */
function memory(broken = false) {
  const m = new Map<string, string>();
  return {
    m,
    getItem: (k: string) => {
      if (broken) throw new Error("SecurityError");
      return m.get(k) ?? null;
    },
    setItem: (k: string, v: string) => {
      if (broken) throw new Error("QuotaExceededError");
      m.set(k, v);
    },
  };
}

const env = (anchors: string[], has: string[] = []): TourEnv => ({
  hasAnchor: (a) => anchors.includes(a),
  has: (n) => has.includes(n),
});
const ids = (e: TourEnv) => availableSteps(e).map((s) => s.id);

describe("onboarding persistence", () => {
  it("reads a first visit when nothing is stored", () => {
    expect(loadOnboarding(memory())).toEqual({ welcomeDone: false, tour: null });
  });

  it("round-trips what was saved", () => {
    const s = memory();
    saveOnboarding({ welcomeDone: true, tour: "done" }, s);
    expect(JSON.parse(s.m.get(ONBOARDING_KEY)!)).toEqual({ welcomeDone: true, tour: "done" });
    expect(loadOnboarding(s)).toEqual({ welcomeDone: true, tour: "done" });
  });

  it("treats damaged or unexpected data as a first visit, keeping what is valid", () => {
    const s = memory();
    s.m.set(ONBOARDING_KEY, "{not json");
    expect(loadOnboarding(s)).toEqual({ welcomeDone: false, tour: null });
    s.m.set(ONBOARDING_KEY, JSON.stringify({ welcomeDone: "yes", tour: "later" }));
    expect(loadOnboarding(s)).toEqual({ welcomeDone: false, tour: null });
    s.m.set(ONBOARDING_KEY, JSON.stringify({ welcomeDone: true, tour: "skipped" }));
    expect(loadOnboarding(s)).toEqual({ welcomeDone: true, tour: "skipped" });
    s.m.set(ONBOARDING_KEY, "42");
    expect(loadOnboarding(s)).toEqual({ welcomeDone: false, tour: null });
  });

  it("never throws when storage is blocked", () => {
    const s = memory(true);
    expect(() => saveOnboarding({ welcomeDone: true, tour: "done" }, s)).not.toThrow();
    expect(loadOnboarding(s)).toEqual({ welcomeDone: false, tour: null });
    expect(loadOnboarding(undefined)).toEqual({ welcomeDone: false, tour: null });
  });
});

describe("welcome card", () => {
  const first = { welcomeDone: false, viewing: false, hasConcepts: false, touring: false };
  it("shows on a first visit with no concepts", () => {
    expect(shouldShowWelcome(first)).toBe(true);
  });
  it("stays away once dismissed, in the share viewer, with existing concepts, or during the tour", () => {
    expect(shouldShowWelcome({ ...first, welcomeDone: true })).toBe(false);
    expect(shouldShowWelcome({ ...first, viewing: true })).toBe(false);
    expect(shouldShowWelcome({ ...first, hasConcepts: true })).toBe(false);
    expect(shouldShowWelcome({ ...first, touring: true })).toBe(false);
  });
});

describe("tour steps", () => {
  const desktop = ["add", "mix", "fork", "file", "settings"];
  it("has the anchored steps in order, 7 on a desktop with the example loaded", () => {
    expect(ids(env(desktop, ["blocked", "relation"]))).toEqual(["add", "install", "arrow", "mix", "fork", "file", "settings"]);
    expect(TOUR_STEPS.map((s) => s.id)).toContain("more");
  });

  it("skips steps the graph has nothing for (no blocked concept, no relation)", () => {
    expect(ids(env(desktop))).toEqual(["add", "mix", "fork", "file", "settings"]);
    expect(ids(env(desktop, ["relation"]))).toEqual(["add", "arrow", "mix", "fork", "file", "settings"]);
  });

  it("points at ☰ instead of the folded buttons on phones", () => {
    // ≤800px: Fork, File and Settings are hidden in the ☰ menu, which is shown instead.
    expect(ids(env(["add", "mix", "more"], ["blocked", "relation"]))).toEqual(["add", "install", "arrow", "mix", "more"]);
  });

  it("drops a step whose anchor is missing, even when the graph would allow it", () => {
    expect(ids(env(["add", "settings"], ["blocked"]))).toEqual(["add", "install", "settings"]);
    expect(ids(env([]))).toEqual([]);
  });
});

describe("popover placement", () => {
  const view = { width: 1000, height: 800 };
  const pop = { width: 300, height: 150 };

  it("goes below its anchor, centred on it", () => {
    expect(placePopover({ left: 400, top: 20, width: 100, height: 30 }, pop, view)).toEqual({ left: 300, top: 62, side: "below" });
  });

  it("goes above when there's no room below", () => {
    expect(placePopover({ left: 400, top: 700, width: 100, height: 30 }, pop, view)).toMatchObject({ top: 538, side: "above" });
  });

  it("goes to the side of a tall anchor", () => {
    const r = placePopover({ left: 100, top: 50, width: 100, height: 700 }, pop, view);
    expect(r).toMatchObject({ left: 212, side: "right" });
  });

  it("stays inside the window near its edges", () => {
    const r = placePopover({ left: 960, top: 10, width: 30, height: 30 }, pop, view);
    expect(r.left).toBe(1000 - 300 - 8);
    const l = placePopover({ left: 0, top: 10, width: 30, height: 30 }, pop, view);
    expect(l.left).toBe(8);
  });

  it("is centred without an anchor", () => {
    expect(placePopover(null, pop, view)).toEqual({ left: 350, top: 325, side: "center" });
  });

  it("tells hidden and off-screen anchors apart from visible ones", () => {
    expect(onScreen({ left: 0, top: 0, width: 0, height: 0 }, view)).toBe(false); // display: none
    expect(onScreen({ left: -200, top: 10, width: 100, height: 20 }, view)).toBe(false);
    expect(onScreen({ left: 10, top: 900, width: 100, height: 20 }, view)).toBe(false);
    expect(onScreen({ left: 990, top: 10, width: 100, height: 20 }, view)).toBe(true); // partly visible
  });
});
