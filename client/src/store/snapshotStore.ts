import { create } from "zustand";
import { uid } from "../lib/graphOps";
import * as db from "../lib/snapshotDb";
import { capture, keepMastery, periodicDue, planPrune, readSnapshot, type AutoReason, type SnapshotMeta } from "../lib/snapshots";
import { projectGraphs, rootOf } from "../lib/projects";
import { useGraphStore } from "./graphStore";

/**
 * Version snapshots of projects (see lib/snapshots.ts), kept in IndexedDB. Automatic ones are taken before bulk
 * changes (install-all, extract, merge, tidy, restore) and periodically while editing; named ones by the user. When
 * IndexedDB isn't available the feature turns itself off: `available` is false and the Versions dialog says so.
 */

interface SnapshotState {
  /** null until the first check. */
  available: boolean | null;
  /** Every project's snapshots, newest first. */
  metas: SnapshotMeta[];
}

export const useSnapshots = create<SnapshotState>()(() => ({ available: null, metas: [] }));

const graphs = () => useGraphStore.getState();

let ready: Promise<boolean> | null = null;
/** Check IndexedDB and load the list, once (again after a failure). */
export function loadSnapshots(): Promise<boolean> {
  ready ??= (async () => {
    try {
      if (!(await db.snapshotsAvailable())) throw new Error("unavailable");
      await refresh();
      useSnapshots.setState({ available: true });
      return true;
    } catch {
      useSnapshots.setState({ available: false, metas: [] });
      ready = null;
      return false;
    }
  })();
  return ready;
}

/** Check and load again (tests, after replacing the IndexedDB implementation). */
export async function reloadSnapshots(): Promise<boolean> {
  await db.closeSnapshotDb();
  ready = null;
  return loadSnapshots();
}

async function refresh() {
  const metas = await db.listSnapshots();
  useSnapshots.setState({ metas: metas.sort((a, b) => b.createdAt - a.createdAt) });
}

/** Writes one at a time, so pruning never races a write. */
let queue: Promise<unknown> = Promise.resolve();
function serial<T>(fn: () => Promise<T>): Promise<T> {
  const next = queue.then(fn, fn);
  queue = next.catch(() => {});
  return next;
}

/** When each project changed first since its latest snapshot (for periodic snapshots). */
const dirtySince = new Map<string, number>();

/**
 * Snapshot a project (default: the current one). The graphs are captured right away, before any following change;
 * storing happens afterwards. An automatic snapshot of a project identical to its latest snapshot is skipped.
 * Resolves to the new snapshot, or null when nothing was stored (unchanged, or IndexedDB not available).
 */
export function takeSnapshot(opts: { reason?: AutoReason; label?: string; projectId?: string } = {}): Promise<SnapshotMeta | null> {
  const projectId = opts.projectId ?? graphs().projectId;
  const cap = capture(graphs(), projectId);
  const now = Date.now();
  if (!cap) return Promise.resolve(null);
  return serial(async () => {
    if (!(await loadSnapshots())) return null;
    const latest = useSnapshots.getState().metas.find((m) => m.projectId === projectId);
    const named = opts.label !== undefined;
    if (!named && latest?.hash === cap.hash) return null;
    const meta: SnapshotMeta = {
      id: uid("s"),
      projectId,
      createdAt: Math.max(now, (latest?.createdAt ?? 0) + 1), // strictly newest, for the list's order
      kind: named ? "named" : "auto",
      concepts: cap.concepts,
      relations: cap.relations,
      sandboxes: cap.sandboxes,
      size: cap.data.length,
      hash: cap.hash,
    };
    if (named) {
      if (opts.label!.trim()) meta.label = opts.label!.trim();
    } else meta.reason = opts.reason ?? "periodic";
    await db.putSnapshot(meta, cap.data);
    dirtySince.delete(projectId);
    const all = [meta, ...useSnapshots.getState().metas];
    const drop = planPrune(all, new Set(Object.keys(graphs().projects)));
    if (drop.length) await db.deleteSnapshots(drop);
    useSnapshots.setState({ metas: all.filter((m) => !drop.includes(m.id)) });
    return meta;
  });
}

/**
 * An automatic snapshot of the project that `graphId` (default: the active graph) belongs to, before a bulk change.
 * Failures only mean there is no restore point.
 */
export function autoSnapshot(reason: AutoReason, graphId = graphs().activeId) {
  const s = graphs();
  if (graphId === s.view?.id) return; // the viewer changes nothing
  const root = rootOf(s.graphs, graphId);
  const project = Object.values(s.projects).find((p) => p.mainId === root);
  if (project) void takeSnapshot({ reason, projectId: project.id }).catch(() => {});
}

async function loadGraphs(id: string) {
  const data = await db.getSnapshotData(id);
  if (typeof data !== "string") throw new Error("snapshot data missing");
  return readSnapshot(data);
}

/** The main graph of a snapshot and its project's current main graph (for the Versions dialog's comparison). */
export async function snapshotMain(id: string) {
  return (await loadGraphs(id)).graphs[0];
}

/**
 * Replace the snapshot's project with it. The project as it is now is snapshotted first ("before restore"), so a
 * restore can itself be undone from Versions.
 */
export async function restoreSnapshot(id: string): Promise<void> {
  const meta = useSnapshots.getState().metas.find((m) => m.id === id);
  if (!meta) throw new Error("snapshot not found");
  const { graphs: restored } = await loadGraphs(id);
  const s = graphs();
  const project = s.projects[meta.projectId];
  if (!project) throw new Error("project not found");
  const before = takeSnapshot({ reason: "restore", projectId: meta.projectId }); // captured now, stored below
  s.restoreProject(meta.projectId, keepMastery(restored, projectGraphs(s, project)));
  await before;
}

/** Add the snapshot as a new project next to the others. Returns the new project's name. */
export async function restoreAsNew(id: string, name: string): Promise<string> {
  const { graphs: restored } = await loadGraphs(id);
  return graphs().addProject(restored, name);
}

export function deleteSnapshot(id: string): Promise<void> {
  return serial(async () => {
    await db.deleteSnapshots([id]);
    useSnapshots.setState({ metas: useSnapshots.getState().metas.filter((m) => m.id !== id) });
  });
}

/** Periodic check: snapshot the current project when it changed and its latest snapshot is old enough. */
export function periodicTick(now = Date.now()) {
  const s = graphs();
  const since = dirtySince.get(s.projectId) ?? null;
  const latest = useSnapshots.getState().metas.find((m) => m.projectId === s.projectId);
  if (periodicDue(now, since, latest?.createdAt ?? null)) void takeSnapshot({ reason: "periodic" }).catch(() => {});
}

let started = false;
/** Load the list and start watching for changes (main.tsx). */
export function startAutoSnapshots(intervalMs = 60_000) {
  if (started) return;
  started = true;
  void loadSnapshots();
  useGraphStore.subscribe((s, prev) => {
    if (s.graphs === prev.graphs || s.projectId !== prev.projectId) return;
    if (s.view && s.activeId === s.view.id && s.activeId !== prev.activeId) return; // opening the viewer
    if (!dirtySince.has(s.projectId)) dirtySince.set(s.projectId, Date.now());
  });
  setInterval(() => periodicTick(), intervalMs);
}
