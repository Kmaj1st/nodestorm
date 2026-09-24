import type { Graph } from "@nodestorm/shared";
import { IDBFactory } from "fake-indexeddb";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { installAllMissing, tidy } from "../src/lib/actions";
import * as ops from "../src/lib/graphOps";
import * as proj from "../src/lib/projects";
import {
  capture,
  diffSummary,
  hashString,
  isSame,
  keepMastery,
  periodicDue,
  PERIODIC_MS,
  planPrune,
  readSnapshot,
  type SnapshotMeta,
} from "../src/lib/snapshots";
import { activeGraph, useGraphStore } from "../src/store/graphStore";
import { useSettings } from "../src/store/settingsStore";
import {
  deleteSnapshot,
  periodicTick,
  reloadSnapshots,
  restoreAsNew,
  restoreSnapshot,
  takeSnapshot,
  useSnapshots,
} from "../src/store/snapshotStore";

// The stores persist to localStorage; give them an in-memory one (hoisted above the imports).
vi.hoisted(() => {
  const data = new Map<string, string>();
  (globalThis as { localStorage?: unknown }).localStorage = {
    getItem: (k: string) => data.get(k) ?? null,
    setItem: (k: string, v: string) => void data.set(k, v),
    removeItem: (k: string) => void data.delete(k),
  };
});

const store = () => useGraphStore.getState();
const names = (g: Graph) => g.nodes.map((n) => n.name).sort();

function graphOf(...concepts: string[]): Graph {
  let g = ops.emptyGraph();
  for (const name of concepts) g = ops.addNode(g, { name }).graph;
  return g;
}

let seq = 0;
function meta(p: Partial<SnapshotMeta>): SnapshotMeta {
  seq++;
  return {
    id: `s${seq}`, projectId: "p1", createdAt: seq, kind: "auto", reason: "periodic",
    concepts: 0, relations: 0, sandboxes: 0, size: 10, hash: String(seq), ...p,
  };
}

describe("snapshot logic", () => {
  it("captures a project (main graph first, sandboxes too) and reads it back through import repair", () => {
    const ws = proj.createProject({ graphs: {}, projects: {}, projectId: "", activeId: "" }, "Algebra");
    const main = ops.addNode(ops.addNode(ws.graphs[ws.activeId], { name: "Group" }).graph, { name: "Ring" }).graph;
    const sb = ops.fork(main, "Try");
    const full = { ...ws, graphs: { [main.id]: main, [sb.id]: sb } };
    const cap = capture(full, ws.projectId)!;
    expect([cap.concepts, cap.relations, cap.sandboxes]).toEqual([2, 0, 1]);
    expect(cap.hash).toBe(hashString(cap.data));
    const back = readSnapshot(cap.data);
    expect(back.name).toBe("Algebra");
    expect(back.graphs.map((g) => g.id)).toEqual([main.id, sb.id]);
    expect(back.fixes).toEqual([]);
    expect(capture(full, "nope")).toBeNull();
  });

  it("repairs old snapshot data instead of failing (missing fields, dangling links)", () => {
    const old = JSON.stringify({ graphs: [{ id: "g1", nodes: [{ id: "a", name: "Group", dependsOn: ["gone"] }], relations: [{ a: "a", b: "gone" }] }] });
    const { graphs, fixes } = readSnapshot(old);
    expect(graphs[0].nodes[0]).toMatchObject({ name: "Group", dependsOn: [], aliases: [], status: "ok" });
    expect(graphs[0].relations).toEqual([]);
    expect(fixes.length).toBeGreaterThan(0);
    expect(() => readSnapshot("{}")).toThrow();
  });

  it("keeps the newest automatic snapshots per project and every named one", () => {
    const metas = [
      ...Array.from({ length: 5 }, () => meta({ projectId: "p1" })),
      meta({ projectId: "p1", kind: "named", label: "keep" }),
      ...Array.from({ length: 3 }, () => meta({ projectId: "p2" })),
    ];
    const drop = planPrune(metas, new Set(["p1", "p2"]), { maxAuto: 3 });
    // The two oldest automatic snapshots of p1 go; p2 has only 3, the named one stays.
    expect(drop.sort()).toEqual([metas[0].id, metas[1].id].sort());
  });

  it("drops snapshots of deleted projects, and old automatic ones to fit the size budget", () => {
    const named = meta({ kind: "named", size: 50 });
    const autos = Array.from({ length: 4 }, () => meta({ size: 30 }));
    const orphan = meta({ projectId: "gone", kind: "named" });
    const drop = planPrune([named, ...autos, orphan], new Set(["p1"]), { budget: 120 });
    // 50 + 4×30 = 170 > 120: the two oldest automatic ones go (named ones never do).
    expect(drop.sort()).toEqual([orphan.id, autos[0].id, autos[1].id].sort());
    expect(planPrune([meta({ kind: "named", size: 500 })], new Set(["p1"]), { budget: 100 })).toEqual([]);
  });

  it("takes a periodic snapshot at most every 10 minutes, and only after a change", () => {
    const t0 = 1_000_000;
    expect(periodicDue(t0 + PERIODIC_MS * 5, null, t0)).toBe(false); // nothing changed
    expect(periodicDue(t0 + 60_000, t0, null)).toBe(false); // first change a minute ago
    expect(periodicDue(t0 + PERIODIC_MS, t0, null)).toBe(true);
    expect(periodicDue(t0 + PERIODIC_MS - 1, t0 + 5000, t0)).toBe(false); // latest snapshot too recent
    expect(periodicDue(t0 + PERIODIC_MS, t0 + PERIODIC_MS - 10, t0)).toBe(true); // an old snapshot, then a change
  });

  it("summarises what restoring would change", () => {
    const now = graphOf("Group", "Ring", "Field");
    let snap = structuredClone(now);
    snap = ops.removeNode(snap, snap.nodes.find((n) => n.name === "Field")!.id);
    snap = ops.addNode(snap, { name: "Module" }).graph;
    snap = ops.updateNode(snap, snap.nodes.find((n) => n.name === "Ring")!.id, { definition: "changed" });
    const [g, r] = [snap.nodes[0].id, snap.nodes[1].id];
    snap = ops.upsertRelation(snap, g, r, { kind: "k", explanation: "" }, { kind: "k", explanation: "" }, "mix");
    const d = diffSummary(snap, now);
    expect(d).toEqual({ added: ["Module"], removed: ["Field"], changed: ["Ring"], relationsAdded: 1, relationsRemoved: 0 });
    expect(isSame(diffSummary(now, structuredClone(now)))).toBe(true);
    // A concept deleted and added again (new id, same name) isn't counted as both removed and added.
    const readded = graphOf("Group", "Ring", "Field");
    expect(isSame(diffSummary(readded, now))).toBe(true);
  });

  it("keeps current mastery on restored concepts", () => {
    const now = graphOf("Group");
    const mastery = { score: 0.9, reviews: 2, reviewedAt: 5 };
    const current = [ops.updateNode(now, now.nodes[0].id, { mastery })];
    const [restored] = keepMastery([now], current);
    expect(restored.nodes[0].mastery).toEqual(mastery);
  });

  it("replaces a project's graphs, keeping their ids unless another project uses them", () => {
    const ws = proj.createProject({ graphs: {}, projects: {}, projectId: "", activeId: "" }, "A");
    const main = ws.graphs[ws.activeId];
    const sb = ops.fork(main, "S");
    const withSb = { ...ws, graphs: { ...ws.graphs, [sb.id]: sb } };
    const restored = { ...main, nodes: graphOf("Group").nodes };
    const next = proj.replaceProjectGraphs(withSb, ws.projectId, [restored]);
    expect(Object.keys(next.graphs)).toEqual([main.id]); // the sandbox isn't in the version
    expect(next.graphs[main.id].nodes.map((n) => n.name)).toEqual(["Group"]);
    // A version whose graph id is now another project's main graph gets fresh ids.
    const other = proj.createProject(next, "B");
    const clash = proj.replaceProjectGraphs(other, ws.projectId, [{ ...restored, id: other.activeId }]);
    const newMain = clash.projects[ws.projectId].mainId;
    expect(newMain).not.toBe(other.activeId);
    expect(clash.graphs[other.activeId]).toBeDefined();
  });
});

describe("snapshot storage (IndexedDB)", () => {
  beforeEach(async () => {
    (globalThis as { indexedDB?: unknown }).indexedDB = new IDBFactory();
    await reloadSnapshots();
    store().reset();
    useSettings.setState({ connection: "browser", provider: "mock" });
    store().mutate((g) => ({ ...g, nodes: graphOf("Group", "Subgroup").nodes }));
  });

  const mine = () => useSnapshots.getState().metas.filter((m) => m.projectId === store().projectId);

  it("saves named snapshots and skips automatic ones of an unchanged project", async () => {
    const named = await takeSnapshot({ label: "  first  " });
    expect(named).toMatchObject({ kind: "named", label: "first", concepts: 2 });
    expect(await takeSnapshot({ reason: "tidy" })).toBeNull(); // same as the latest
    store().mutate((g) => ops.addNode(g, { name: "Ring" }).graph);
    expect(await takeSnapshot({ reason: "tidy" })).toMatchObject({ kind: "auto", reason: "tidy", concepts: 3 });
    expect(mine().map((m) => m.kind)).toEqual(["auto", "named"]);
    // The list survives a reload (a fresh read from IndexedDB).
    await reloadSnapshots();
    expect(mine().map((m) => m.label ?? m.reason)).toEqual(["tidy", "first"]);
  });

  it("restores a version, saving the state before it first", async () => {
    const saved = (await takeSnapshot({ label: "two" }))!;
    const group = activeGraph(store()).nodes.find((n) => n.name === "Group")!;
    store().mutate((g) => ops.removeNode(g, group.id));
    store().forkActive(); // a sandbox that the version doesn't have
    await restoreSnapshot(saved.id);
    expect(names(activeGraph(store()))).toEqual(["Group", "Subgroup"]);
    expect(activeGraph(store()).parentId).toBeUndefined();
    expect(proj.projectGraphs(store(), store().projects[store().projectId])).toHaveLength(1);
    expect(store().history[store().activeId]).toBeUndefined();
    const before = mine()[0];
    expect(before).toMatchObject({ reason: "restore", concepts: 1, sandboxes: 1 });
    // …so the restore can itself be undone.
    await restoreSnapshot(before.id);
    expect(names(activeGraph(store()))).toEqual(["Subgroup"]);
  });

  it("restores a version as a new project and deletes versions", async () => {
    const saved = (await takeSnapshot({ label: "v" }))!;
    const oldProject = store().projectId;
    const name = await restoreAsNew(saved.id, "Copy");
    expect(name).toBe("Copy");
    expect(store().projectId).not.toBe(oldProject);
    expect(names(activeGraph(store()))).toEqual(["Group", "Subgroup"]);
    await deleteSnapshot(saved.id);
    expect(useSnapshots.getState().metas).toEqual([]);
    await reloadSnapshots();
    expect(useSnapshots.getState().metas).toEqual([]);
  });

  it("snapshots automatically before install-all and tidy", async () => {
    let id = "";
    store().mutate((g) => {
      const r = ops.addNode(g, { name: "Quotient group" });
      id = r.id;
      return ops.applyDeps(r.graph, id, [{ name: "Normal subgroup", role: "uses", reason: "t", matchesExisting: null }]);
    });
    const run = installAllMissing(id);
    await run;
    await vi.waitFor(() => expect(mine()[0]).toMatchObject({ reason: "installAll", concepts: 3 }));
    tidy();
    await vi.waitFor(() => expect(mine()[0]).toMatchObject({ reason: "tidy" }));
  });

  it("periodic snapshots wait for a change", async () => {
    await takeSnapshot({ label: "base" });
    periodicTick(Date.now() + PERIODIC_MS * 2);
    await new Promise((r) => setTimeout(r, 20));
    expect(mine()).toHaveLength(1); // no change recorded (startAutoSnapshots isn't running here)
  });

  it("turns itself off without IndexedDB", async () => {
    delete (globalThis as { indexedDB?: unknown }).indexedDB;
    expect(await reloadSnapshots()).toBe(false);
    expect(useSnapshots.getState().available).toBe(false);
    expect(await takeSnapshot({ label: "x" })).toBeNull();
  });
});
