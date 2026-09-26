import type { Graph } from "@nodestorm/shared";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { addConcept, cancelTask, installAllMissing, resolveCycle } from "../src/lib/actions";
import { cycleLinks, fallbackLinkIndex, remainingCycle, removeLinks } from "../src/lib/cycles";
import * as ops from "../src/lib/graphOps";
import { cycleThrough } from "../src/lib/paths";
import { useGraphStore } from "../src/store/graphStore";
import { useSettings } from "../src/store/settingsStore";

// Automatic dependency-cycle resolution, driven through the real store + actions with the offline mock AI.

// Web search as in the offline demo: a page defining any name (see fakeWebSearch.ts).
vi.mock("../src/lib/webSearch", () => import("./fakeWebSearch"));

vi.hoisted(() => {
  const data = new Map<string, string>();
  (globalThis as { localStorage?: unknown }).localStorage = {
    getItem: (k: string) => data.get(k) ?? null,
    setItem: (k: string, v: string) => void data.set(k, v),
    removeItem: (k: string) => void data.delete(k),
  };
});

const store = () => useGraphStore.getState();
const graph = (): Graph => store().graphs[store().activeId];
const byName = (name: string) => graph().nodes.find((n) => n.name === name)!;
const settle = () => new Promise((r) => setTimeout(r, 20));
const idle = async () => {
  for (let i = 0; i < 100 && Object.keys(store().busy).length; i++) await settle();
};
const needs = (from: string, to: string) => byName(from).dependsOn.includes(byName(to).id);

/** Two concepts that need each other (Alpha needs Beta, Beta needs Alpha), without asking the AI. */
function seedCycle(): string[] {
  store().mutate((g) => {
    const a = ops.addNode(g, { name: "Alpha", definition: "short" });
    const b = ops.addNode(a.graph, { name: "Beta", definition: "a much longer definition than Alpha's" });
    let out = ops.applyDeps(b.graph, a.id, [{ name: "Beta", role: "uses", reason: "because", matchesExisting: null }]);
    out = ops.applyDeps(out, b.id, [{ name: "Alpha", role: "uses", reason: "also because", matchesExisting: null }]);
    return out;
  });
  return cycleThrough(graph(), byName("Alpha").id)!;
}

beforeEach(() => {
  store().reset();
  useSettings.setState({
    newConcepts: "auto", // these tests follow the automatic flow (lookupFlow.test.ts has the asking one)
    connection: "browser",
    provider: "mock",
    autoResolveCycles: true,
    clarify: { enabled: true, options: 3 },
    installAll: { maxDepth: 3, maxNodes: 15 },
  });
});

describe("cycle helpers", () => {
  it("lists a cycle's links with the reasons they were added", () => {
    const cycle = seedCycle();
    const links = cycleLinks(graph(), cycle);
    expect(links.map((l) => `${l.from.name}>${l.to.name}`)).toEqual(["Alpha>Beta", "Beta>Alpha"]);
    expect(links[0].reason).toBe("because");
    // The pair shares the dependency edge created for Alpha → Beta; its other direction isn't Beta's reason.
    expect(links[1].reason).toBe("");
  });

  it("removing one link breaks the cycle; the fallback prefers the newest link", () => {
    const cycle = seedCycle();
    const links = cycleLinks(graph(), cycle);
    expect(remainingCycle(removeLinks(graph(), [links[0]]), [byName("Alpha").id])).toBeNull();
    expect(fallbackLinkIndex(links, byName("Beta").id)).toBe(1);
    expect(fallbackLinkIndex(links)).toBe(links.length - 1);
  });
});

describe("resolving cycles", () => {
  it("a check that closes a cycle resolves it automatically, as one undoable step", async () => {
    addConcept({ name: "Chicken" });
    await idle();
    addConcept({ name: "Egg" }); // the mock: Egg needs Chicken, Chicken needs Egg
    await idle();
    expect(cycleThrough(graph(), byName("Egg").id)).toBeNull();
    // The mock drops the link to the "bigger" idea: Chicken needs Egg goes, Egg needs Chicken stays.
    expect(needs("Chicken", "Egg")).toBe(false);
    expect(needs("Egg", "Chicken")).toBe(true);
    expect(store().toast).toMatch(/Broke a dependency cycle/);
    store().undo();
    expect(cycleThrough(graph(), byName("Egg").id)).not.toBeNull(); // Ctrl+Z brings the link back
  });

  it("only warns when automatic resolution is off", async () => {
    useSettings.setState({ autoResolveCycles: false });
    addConcept({ name: "Chicken" });
    await idle();
    addConcept({ name: "Egg" });
    await idle();
    expect(cycleThrough(graph(), byName("Egg").id)).not.toBeNull();
    expect(store().toast).toMatch(/cycle/i);
  });

  it("falls back to the newest link when the AI can't answer", async () => {
    const cycle = seedCycle();
    useSettings.setState({ provider: "siliconflow" }); // no key: the AI call fails
    await resolveCycle(store().activeId, cycle, { newestFrom: byName("Beta").id });
    expect(needs("Beta", "Alpha")).toBe(false);
    expect(needs("Alpha", "Beta")).toBe(true);
    expect(store().toast).toMatch(/latest check added/);
  });

  it("a cancel leaves the cycle alone", async () => {
    const cycle = seedCycle();
    const pending = resolveCycle(store().activeId, cycle);
    cancelTask(Object.keys(store().busy)[0]);
    expect(await pending).toBeNull();
    expect(cycleThrough(graph(), byName("Alpha").id)).not.toBeNull();
  });

  it("is refused for a shared graph in the viewer", async () => {
    const cycle = seedCycle();
    store().openView(structuredClone(graph()), "Shared");
    expect(await resolveCycle(store().activeId, cycle)).toBeNull();
    expect(cycleThrough(graph(), cycle[0])).not.toBeNull();
  });

  it("install-all resolves the cycles its run created and says so in its summary", async () => {
    const root = (() => {
      let id = "";
      store().mutate((g) => {
        const r = ops.addNode(g, { name: "Omelette", definition: "eggs, beaten and fried" });
        id = r.id;
        return ops.applyDeps(r.graph, r.id, [{ name: "Egg", role: "uses", reason: "made of eggs", matchesExisting: null }]);
      });
      return id;
    })();
    const report = (await installAllMissing(root))!;
    expect(report.installed).toEqual(expect.arrayContaining(["Egg", "Chicken"]));
    expect(cycleThrough(graph(), byName("Egg").id)).toBeNull();
    expect(report.cycles).toEqual([]);
    expect(store().toast).toMatch(/Broke a dependency cycle/);
  });
});
