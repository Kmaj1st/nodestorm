import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// The theme choice: "auto" follows the system and isn't stored; a pinned theme survives a reload; <html> mirrors it.

const storage = vi.hoisted(() => {
  const data = new Map<string, string>();
  (globalThis as { localStorage?: unknown }).localStorage = {
    getItem: (k: string) => data.get(k) ?? null,
    setItem: (k: string, v: string) => void data.set(k, v),
    removeItem: (k: string) => void data.delete(k),
  };
  return data;
});

let systemDark = false;
let onSystemChange: (() => void) | undefined;
const root = { dataset: {} as Record<string, string>, style: { props: {} as Record<string, string>, setProperty(k: string, v: string) { this.props[k] = v; }, removeProperty(k: string) { delete this.props[k]; } } };

beforeEach(() => {
  storage.clear();
  systemDark = false;
  onSystemChange = undefined;
  root.dataset = {};
  root.style.props = {};
  vi.stubGlobal("window", {
    matchMedia: () => ({
      get matches() {
        return systemDark;
      },
      addEventListener: (_: string, fn: () => void) => (onSystemChange = fn),
    }),
  });
  vi.stubGlobal("document", { documentElement: root });
  vi.resetModules();
});

afterEach(() => vi.unstubAllGlobals());

const load = () => import("../src/lib/theme");

describe("theme", () => {
  it("auto follows the system, also when it changes; a pinned theme doesn't", async () => {
    systemDark = true;
    const { useTheme, initTheme } = await load();
    expect(useTheme.getState()).toMatchObject({ pref: "auto", theme: "dark" });
    initTheme();
    expect(root.dataset.theme).toBe("dark");
    systemDark = false;
    onSystemChange!();
    expect(root.dataset.theme).toBe("light");
    useTheme.getState().setPref("dark");
    expect(root.dataset.theme).toBe("dark");
    systemDark = false;
    onSystemChange!();
    expect(useTheme.getState().theme).toBe("dark");
  });

  it("a pinned theme is stored and read back on the next load; auto removes it; junk reads as auto", async () => {
    let { useTheme } = await load();
    useTheme.getState().setPref("light");
    expect(storage.get("nodestorm-theme")).toBe("light");
    vi.resetModules();
    systemDark = true;
    ({ useTheme } = await load());
    expect(useTheme.getState()).toMatchObject({ pref: "light", theme: "light" });
    useTheme.getState().setPref("auto");
    expect(storage.has("nodestorm-theme")).toBe(false);
    storage.set("nodestorm-theme", "purple");
    vi.resetModules();
    ({ useTheme } = await load());
    expect(useTheme.getState().pref).toBe("auto");
  });

  it("custom relation colours become CSS tokens on <html>, and removing one goes back to the theme's", async () => {
    const { useTheme, initTheme } = await load();
    initTheme();
    useTheme.getState().setEdgeColors({ dependency: "#AA0000", mix: "red" as never });
    expect(root.style.props).toEqual({ "--edge-dependency": "#aa0000" });
    useTheme.getState().setEdgeColors({});
    expect(root.style.props).toEqual({});
    expect(storage.has("nodestorm-edge-colors")).toBe(false);
  });
});
