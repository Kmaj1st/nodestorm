import type { Graph, GraphExport } from "@nodestorm/shared";
import { repairImport } from "./importRepair";
import { projectGraphs, type Workspace } from "./projects";

/**
 * Version snapshots ("restore points") of a project: pure logic only. A snapshot is the project's graphs (main graph
 * and sandboxes) as a nodestorm/v1 JSON document, so it is read back through import repair and stays loadable when
 * the schema changes. Storage is lib/snapshotDb.ts (IndexedDB), and the store that ties both to the app is
 * store/snapshotStore.ts.
 */

/** Why an automatic snapshot was taken: before a bulk change, or periodically while editing. */
export type AutoReason = "installAll" | "extract" | "deriveTogether" | "merge" | "discard" | "tidy" | "restore" | "periodic";

/** What the Versions list shows about a snapshot; its data is stored separately and only loaded when needed. */
export interface SnapshotMeta {
  id: string;
  projectId: string;
  createdAt: number;
  /** Named snapshots are kept until deleted; automatic ones are pruned (see planPrune). */
  kind: "auto" | "named";
  reason?: AutoReason;
  label?: string;
  /** Counts of the main graph, and how many sandboxes the project had. */
  concepts: number;
  relations: number;
  sandboxes: number;
  /** Length of the stored JSON (characters), for the size budget. */
  size: number;
  /** Fingerprint of the stored JSON: an unchanged project isn't snapshotted twice in a row. */
  hash: string;
}

export interface Captured {
  data: string;
  hash: string;
  concepts: number;
  relations: number;
  sandboxes: number;
}

/** Keep the last 20 automatic snapshots of each project, plus every named one. */
export const MAX_AUTO = 20;
/** Total size of all snapshots (characters of JSON). Only automatic snapshots are evicted to stay under it. */
export const SIZE_BUDGET = 20_000_000;
/** Periodic snapshots while editing: at most one per 10 minutes, and only after a change. */
export const PERIODIC_MS = 10 * 60_000;

/** 32-bit FNV-1a of a string, as 8 hex digits: enough to tell "unchanged" from "changed". */
export function hashString(s: string): string {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return (h >>> 0).toString(16).padStart(8, "0");
}

/** The project's graphs as a nodestorm/v1 document, main graph first (like exportJson). Null for an unknown project. */
export function capture(ws: Pick<Workspace, "graphs" | "projects">, projectId: string): Captured | null {
  const p = ws.projects[projectId];
  if (!p) return null;
  const graphs = projectGraphs(ws, p);
  if (!graphs.length) return null;
  const doc: GraphExport = { format: "nodestorm/v1", project: { name: p.name }, graphs };
  const data = JSON.stringify(doc);
  // Quiz mastery isn't versioned (restore keeps the current one), so grading alone must not look like a change.
  const withoutMastery = JSON.stringify(doc, (key, value) => (key === "mastery" ? undefined : value));
  const main = graphs[0];
  return {
    data,
    hash: hashString(withoutMastery),
    concepts: main.nodes.length,
    relations: main.relations.length,
    sandboxes: graphs.length - 1,
  };
}

/**
 * Read a snapshot back: through import repair, so data written by older (or newer) versions still loads. Returns the
 * graphs main first; throws when the data holds no graph at all.
 */
export function readSnapshot(data: string): { graphs: Graph[]; name?: string; fixes: string[] } {
  const { doc, fixes } = repairImport(JSON.parse(data));
  return { graphs: doc.graphs, name: doc.project?.name, fixes };
}

/**
 * Which snapshots to delete: those of projects that no longer exist, automatic ones beyond the newest `maxAuto` of
 * each project, and then the oldest automatic ones until everything fits the size budget. Named snapshots are only
 * deleted with their project.
 */
export function planPrune(
  metas: SnapshotMeta[],
  liveProjects: ReadonlySet<string>,
  { maxAuto = MAX_AUTO, budget = SIZE_BUDGET } = {},
): string[] {
  const drop = new Set<string>();
  const perProject = new Map<string, number>();
  const newestFirst = [...metas].sort((a, b) => b.createdAt - a.createdAt);
  for (const m of newestFirst) {
    if (!liveProjects.has(m.projectId)) { drop.add(m.id); continue; }
    if (m.kind !== "auto") continue;
    const n = (perProject.get(m.projectId) ?? 0) + 1;
    perProject.set(m.projectId, n);
    if (n > maxAuto) drop.add(m.id);
  }
  let total = newestFirst.reduce((sum, m) => (drop.has(m.id) ? sum : sum + m.size), 0);
  for (const m of [...newestFirst].reverse()) {
    if (total <= budget) break;
    if (m.kind !== "auto" || drop.has(m.id)) continue;
    drop.add(m.id);
    total -= m.size;
  }
  return [...drop];
}

/**
 * Is a periodic snapshot due? Only after a change (`dirtySince`), and at most one per `interval` since the project's
 * latest snapshot (or, without one, since the first change).
 */
export function periodicDue(now: number, dirtySince: number | null, lastAt: number | null, interval = PERIODIC_MS): boolean {
  if (dirtySince === null) return false;
  return now - (lastAt ?? dirtySince) >= interval;
}

export interface DiffSummary {
  /** Names of concepts in the snapshot that aren't in the current graph (restoring brings them back). */
  added: string[];
  /** Names of current concepts the snapshot doesn't have (restoring removes them). */
  removed: string[];
  /** Concepts in both whose name, definition, aliases, prerequisites or notes differ. */
  changed: string[];
  relationsAdded: number;
  relationsRemoved: number;
}

const key = (name: string) => name.trim().toLowerCase();
const relKey = (names: Map<string, string>, a: string, b: string) => [names.get(a) ?? a, names.get(b) ?? b].sort().join("\u0000");

/**
 * What restoring `snapshot` would change in `current` (both main graphs). Concepts are matched by id, else by name,
 * so a concept that was deleted and added again isn't counted twice; relations by the names of their two ends.
 */
export function diffSummary(snapshot: Graph, current: Graph): DiffSummary {
  const curById = new Map(current.nodes.map((n) => [n.id, n]));
  const curByName = new Map(current.nodes.map((n) => [key(n.name), n]));
  const matched = new Set<string>();
  const out: DiffSummary = { added: [], removed: [], changed: [], relationsAdded: 0, relationsRemoved: 0 };
  const sig = (n: Graph["nodes"][number], names: Map<string, string>) =>
    JSON.stringify([n.name, n.definition, [...n.aliases].sort(), n.dependsOn.map((d) => names.get(d) ?? d).sort(), n.notes ?? ""]);
  const snapNames = new Map(snapshot.nodes.map((n) => [n.id, key(n.name)]));
  const curNames = new Map(current.nodes.map((n) => [n.id, key(n.name)]));
  for (const n of snapshot.nodes) {
    const c = curById.get(n.id) ?? curByName.get(key(n.name));
    if (!c || matched.has(c.id)) { out.added.push(n.name); continue; }
    matched.add(c.id);
    if (sig(n, snapNames) !== sig(c, curNames)) out.changed.push(n.name);
  }
  for (const c of current.nodes) if (!matched.has(c.id)) out.removed.push(c.name);
  const snapRels = new Set(snapshot.relations.map((r) => relKey(snapNames, r.a, r.b)));
  const curRels = new Set(current.relations.map((r) => relKey(curNames, r.a, r.b)));
  for (const r of snapRels) if (!curRels.has(r)) out.relationsAdded++;
  for (const r of curRels) if (!snapRels.has(r)) out.relationsRemoved++;
  return out;
}

export const isSame = (d: DiffSummary) =>
  !d.added.length && !d.removed.length && !d.changed.length && !d.relationsAdded && !d.relationsRemoved;

/**
 * Study progress isn't part of a version: restored concepts that still exist (same id) keep their current mastery,
 * like quiz grades are never undo steps.
 */
export function keepMastery(restored: Graph[], current: Graph[]): Graph[] {
  const mastery = new Map(current.flatMap((g) => g.nodes.flatMap((n) => (n.mastery ? [[`${g.id}/${n.id}`, n.mastery] as const] : []))));
  if (!mastery.size) return restored;
  return restored.map((g) => ({
    ...g,
    nodes: g.nodes.map((n) => {
      const m = mastery.get(`${g.id}/${n.id}`);
      return m ? { ...n, mastery: m } : n;
    }),
  }));
}
