import { RelationOrigin, type Graph, type Relation } from "@nodestorm/shared";

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
}

export const DEFAULT_VIEW: ViewPrefs = {
  origins: { dependency: true, mix: true, derive: true },
  edgeLabels: true,
  todoOnly: false,
  hops: 1,
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
  return { origins, edgeLabels: bool(v.edgeLabels, true), todoOnly: bool(v.todoOnly, false), hops };
}

/** True when some filter hides part of the graph (focus mode aside). */
export const isFiltered = (p: ViewPrefs) => p.todoOnly || RelationOrigin.options.some((k) => !p.origins[k]);

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
 * concept can't hide its neighbours; the focused concept itself always stays visible.
 * A relation is visible when its kind is shown and both of its ends are.
 */
export function visibleParts(g: Graph, prefs: ViewPrefs, focus?: { nodeId: string; hops: number } | null): Visible {
  const shownKinds = g.relations.filter((r) => prefs.origins[r.origin]);
  const root = focus && g.nodes.some((n) => n.id === focus.nodeId) ? focus.nodeId : null;
  const near = root ? neighbourhood(shownKinds, root, focus!.hops) : null;
  const nodes = new Set<string>();
  for (const n of g.nodes) {
    if (near && !near.has(n.id)) continue;
    if (prefs.todoOnly && n.status === "ok" && n.id !== root) continue;
    nodes.add(n.id);
  }
  const relations = new Set(shownKinds.filter((r) => nodes.has(r.a) && nodes.has(r.b)).map((r) => r.id));
  return { nodes, relations };
}

/** True when `visibleParts` would show everything, so callers can skip work. */
export const showsEverything = (prefs: ViewPrefs, focus: unknown) => !focus && !isFiltered(prefs);
