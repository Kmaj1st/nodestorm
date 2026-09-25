import { ConceptKind, RelationOrigin, type ConceptNode, type Graph, type Relation } from "@nodestorm/shared";

/**
 * What part of a graph the canvas shows: view filters (edge kinds, "to-do" concepts) and focus mode
 * (one concept and its neighbourhood). Pure functions only; the state lives in store/viewStore.ts.
 */

export const MAX_HOPS = 3;

/** View preferences, remembered per browser. */
export interface ViewPrefs {
  /** Which relation kinds are drawn, by `Relation.origin`. */
  origins: Record<RelationOrigin, boolean>;
  /** Show the relation texts next to the arrowheads. */
  edgeLabels: boolean;
  /** To-do view: hide concepts that are ready, leaving the ones that need attention. */
  todoOnly: boolean;
  /** Focus mode radius (1…MAX_HOPS). */
  hops: number;
  /** Which concepts are drawn, by `ConceptNode.kind` ("none" for concepts without one). */
  kinds: Record<KindFilter, boolean>;
  /** "layered": concepts stand on stacked plates, one per dependency depth (the 2.5D view). */
  layout: CanvasLayout;
  /** Physics: relations are springs and cards push each other apart, so the graph sorts itself. */
  physics: boolean;
}

export type CanvasLayout = "flat" | "layered";

/** A kind filter: one per concept kind, plus "none" for concepts whose kind isn't set. */
export type KindFilter = ConceptKind | "none";
export const KIND_FILTERS: readonly KindFilter[] = [...ConceptKind.options, "none"];

export const kindFilterOf = (n: Pick<ConceptNode, "kind">): KindFilter => n.kind ?? "none";

export const DEFAULT_VIEW: ViewPrefs = {
  origins: { dependency: true, mix: true, derive: true, extract: true },
  edgeLabels: true,
  todoOnly: false,
  hops: 1,
  kinds: Object.fromEntries(KIND_FILTERS.map((k) => [k, true])) as ViewPrefs["kinds"],
  layout: "flat",
  physics: false,
};

/** Accept whatever was stored (older, newer or hand-edited) and fall back to defaults field by field. */
export function sanitizeView(raw: unknown): ViewPrefs {
  const v = raw && typeof raw === "object" ? (raw as Record<string, unknown>) : {};
  const o = v.origins && typeof v.origins === "object" ? (v.origins as Record<string, unknown>) : {};
  const bool = (x: unknown, d: boolean) => (typeof x === "boolean" ? x : d);
  const origins = Object.fromEntries(
    RelationOrigin.options.map((k) => [k, bool(o[k], DEFAULT_VIEW.origins[k])]),
  ) as ViewPrefs["origins"];
  const hops = typeof v.hops === "number" && Number.isFinite(v.hops) ? Math.min(MAX_HOPS, Math.max(1, Math.round(v.hops))) : 1;
  const k = v.kinds && typeof v.kinds === "object" ? (v.kinds as Record<string, unknown>) : {};
  const kinds = Object.fromEntries(KIND_FILTERS.map((x) => [x, bool(k[x], true)])) as ViewPrefs["kinds"];
  const layout: CanvasLayout = v.layout === "layered" ? "layered" : "flat";
  return { origins, edgeLabels: bool(v.edgeLabels, true), todoOnly: bool(v.todoOnly, false), hops, kinds, layout, physics: bool(v.physics, false) };
}

/** True when some filter hides part of the graph (focus mode aside). */
export const isFiltered = (p: ViewPrefs) =>
  p.todoOnly || RelationOrigin.options.some((k) => !p.origins[k]) || KIND_FILTERS.some((k) => !p.kinds[k]);

/** Concepts within `hops` relation steps of `root` (including `root`), following the given relations. */
export function neighbourhood(relations: Pick<Relation, "a" | "b">[], root: string, hops: number): Set<string> {
  const adj = new Map<string, string[]>();
  const add = (x: string, y: string) => {
    const list = adj.get(x);
    if (list) list.push(y);
    else adj.set(x, [y]);
  };
  for (const r of relations) {
    add(r.a, r.b);
    add(r.b, r.a);
  }
  const seen = new Set([root]);
  let frontier = [root];
  // Breadth-first, one ring per hop.
  for (let h = 0; h < hops && frontier.length; h++) {
    const next: string[] = [];
    for (const v of frontier) {
      for (const w of adj.get(v) ?? []) {
        if (seen.has(w)) continue;
        seen.add(w);
        next.push(w);
      }
    }
    frontier = next;
  }
  return seen;
}

export interface Visible {
  nodes: Set<string>;
  relations: Set<string>;
}

/**
 * The concepts and relations the canvas shows. Hidden relation kinds are also left out of the focus
 * neighbourhood (what you see is what is connected). The to-do filter applies after focus, so a ready
 * concept can't hide its neighbours; the focused concept itself always stays visible. The kind filter works like
 * the to-do filter. Concepts in `hidden` (hidden by hand, see `HiddenMap`) are left out whatever else applies.
 * A relation is visible when its kind is shown and both of its ends are.
 */
export function visibleParts(
  g: Graph,
  prefs: ViewPrefs,
  focus?: { nodeId: string; hops: number } | null,
  hidden?: ReadonlySet<string> | null,
): Visible {
  // Concepts hidden by hand are simply not there: not even focus mode reaches through them.
  const shownKinds = g.relations.filter((r) => prefs.origins[r.origin] && !hidden?.has(r.a) && !hidden?.has(r.b));
  const root = focus && g.nodes.some((n) => n.id === focus.nodeId) ? focus.nodeId : null;
  const near = root ? neighbourhood(shownKinds, root, focus!.hops) : null;
  const nodes = new Set<string>();
  for (const n of g.nodes) {
    if (hidden?.has(n.id)) continue;
    if (near && !near.has(n.id)) continue;
    if (prefs.todoOnly && n.status === "ok" && n.id !== root) continue;
    if (!prefs.kinds[kindFilterOf(n)] && n.id !== root) continue;
    nodes.add(n.id);
  }
  const relations = new Set(shownKinds.filter((r) => nodes.has(r.a) && nodes.has(r.b)).map((r) => r.id));
  return { nodes, relations };
}

/** True when `visibleParts` would show everything, so callers can skip work. */
export const showsEverything = (prefs: ViewPrefs, focus: unknown, hidden?: ReadonlySet<string> | null) =>
  !focus && !isFiltered(prefs) && !hidden?.size;

/**
 * Concepts hidden by hand ("Hide" in the inspector, H on the canvas), by graph id. Only a view choice: the graph,
 * its history, exports and share links are unchanged. Kept for the browser tab's session (store/viewStore.ts).
 */
export type HiddenMap = Readonly<Record<string, readonly string[]>>;

/** Hide `ids` in graph `graphId` (already hidden ones stay once). */
export function hideIds(map: HiddenMap, graphId: string, ids: readonly string[]): HiddenMap {
  const had = map[graphId] ?? [];
  const add = ids.filter((id, i) => !had.includes(id) && ids.indexOf(id) === i);
  return add.length ? { ...map, [graphId]: [...had, ...add] } : map;
}

/** Show `ids` of graph `graphId` again, or all of its hidden concepts when `ids` is left out. */
export function showIds(map: HiddenMap, graphId: string, ids?: readonly string[]): HiddenMap {
  const had = map[graphId];
  if (!had) return map;
  const left = ids ? had.filter((id) => !ids.includes(id)) : [];
  if (left.length === had.length) return map;
  const { [graphId]: _, ...rest } = map;
  return left.length ? { ...rest, [graphId]: left } : rest;
}

/** Forget graphs and concepts that no longer exist (deleted, or a discarded sandbox). Unchanged: the same map. */
export function pruneHidden(map: HiddenMap, graphs: Readonly<Record<string, Pick<Graph, "nodes"> | undefined>>): HiddenMap {
  let out: Record<string, readonly string[]> | null = null;
  for (const [gid, ids] of Object.entries(map)) {
    const g = graphs[gid];
    const keep = g ? ids.filter((id) => g.nodes.some((n) => n.id === id)) : [];
    if (keep.length === ids.length) continue;
    out ??= { ...map };
    if (keep.length) out[gid] = keep;
    else delete out[gid];
  }
  return out ?? map;
}

/** Accept whatever was stored: anything that isn't a map of graph id → list of concept ids is dropped. */
export function parseHidden(raw: unknown): HiddenMap {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return {};
  const out: Record<string, string[]> = {};
  for (const [gid, ids] of Object.entries(raw)) {
    if (!Array.isArray(ids)) continue;
    const keep = [...new Set(ids.filter((id): id is string => typeof id === "string" && id !== ""))];
    if (keep.length) out[gid] = keep;
  }
  return out;
}

/** `g` without the concepts in `hidden` and the relations that touch them (for the 3D view and Tidy). */
export function withoutHidden(g: Graph, hidden: ReadonlySet<string>): Graph {
  if (!hidden.size) return g;
  return {
    ...g,
    nodes: g.nodes.filter((n) => !hidden.has(n.id)),
    relations: g.relations.filter((r) => !hidden.has(r.a) && !hidden.has(r.b)),
  };
}
