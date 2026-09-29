import type { Graph } from "@nodestorm/shared";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { cancelTask, installAllKey, installAllMissing } from "../src/lib/actions";
import * as ops from "../src/lib/graphOps";
import { useGraphStore } from "../src/store/graphStore";
import { useSettings } from "../src/store/settingsStore";

// Drives the real install-all flow (store + actions) against the offline mock provider.

// The stores persist to localStorage; give them an in-memory one (hoisted above the imports).
// Web search as in the offline demo: a page defining any name (see fakeWebSearch.ts).
vi.mock("../src/lib/webSearch", () => import("./fakeWebSearch"));
vi.mock("../src/lib/webSearchReady", () => import("./fakeWebSearch"));

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
const byName = (name: string) => graph().nodes.find((n) => n.name === name);

/** Add a node and give it these missing prerequisites without asking the AI. */
function seed(name: string, missing: string[]) {
  let id = "";
  store().mutate((g) => {
    const r = ops.addNode(g, { name });
    id = r.id;
    return ops.applyDeps(r.graph, r.id, missing.map((m) => ({ name: m, role: "uses", reason: "test", matchesExisting: null })));
  });
  return id;
}

beforeEach(() => {
  store().reset();
  useSettings.setState({
    autoRate: true, // these tests follow the AI's rating of the sources (off by default)
    connection: "browser", provider: "mock", installAll: { maxDepth: 3, maxNodes: 15 } });
});

describe("install all missing", () => {
  it("installs breadth-first through several levels until nothing is missing", async () => {
    const root = seed("Quotient Group", ["Normal Subgroup"]);
    const report = (await installAllMissing(root))!;
    expect(report.installed).toEqual(["Normal Subgroup", "Subgroup", "Group"]);
    expect(report.depth).toBe(3);
    expect(report.limit).toBeNull();
    for (const n of ["Quotient Group", "Normal Subgroup", "Subgroup", "Group"]) expect(byName(n)?.status).toBe("ok");
    expect(Object.keys(store().busy)).toEqual([]); // the status-bar task is gone
  });

  it("stops at the depth limit and reports what is left", async () => {
    useSettings.setState({ installAll: { maxDepth: 2, maxNodes: 15 } });
    const report = (await installAllMissing(seed("Quotient Group", ["Normal Subgroup"])))!;
    expect(report.installed).toEqual(["Normal Subgroup", "Subgroup"]);
    expect(report).toMatchObject({ limit: "depth", leftOver: ["Group"] });
    expect(byName("Subgroup")?.status).toBe("blocked");
  });

  it("stops at the node cap", async () => {
    useSettings.setState({ installAll: { maxDepth: 3, maxNodes: 1 } });
    const report = (await installAllMissing(seed("Quotient Group", ["Normal Subgroup"])))!;
    expect(report.installed).toEqual(["Normal Subgroup"]);
    expect(report).toMatchObject({ limit: "nodes", leftOver: ["Subgroup"] });
  });

  it("cancelling stops the whole run, including checks in flight", async () => {
    const root = seed("Quotient Group", ["Normal Subgroup"]);
    const run = installAllMissing(root);
    cancelTask(installAllKey(store().activeId, root));
    const report = (await run)!;
    expect(report.cancelled).toBe(true);
    expect(report.installed).toEqual(["Normal Subgroup"]);
    expect(byName("Normal Subgroup")?.status).toBe("error");
    expect(byName("Subgroup")).toBeUndefined();
    expect(Object.keys(store().busy)).toEqual([]);
  });

  it("skips and reports ambiguous concepts without opening the meaning dialog", async () => {
    const report = (await installAllMissing(seed("Mixed Bag", ["Expectation", "Subgroup"])))!;
    expect(report.unclear).toEqual(["Expectation"]);
    expect(report.installed).toEqual(["Expectation", "Subgroup", "Group"]);
    expect(byName("Expectation")?.status).toBe("unclear");
    expect(byName("Group")?.status).toBe("ok");
    expect(store().clarifying).toBeNull();
    expect(store().toast).toContain("Pick a meaning for: Expectation");
  });
});
