import { normalizeName, type Graph } from "@nodestorm/shared";

/**
 * Pure read-only algorithms over the dependency structure (`dependsOn`): prerequisite closures,
 * study order and cycle detection. Nothing here changes a graph.
 */

type DepMap = Map<string, string[]>;

/** dependsOn by node id, restricted to ids that still exist. */
function depMap(g: Graph): DepMap {
  const ids = new Set(g.nodes.map((n) => n.id));
  return new Map(g.nodes.map((n) => [n.id, n.dependsOn.filter((d) => ids.has(d) && d !== n.id)]));
}

/** Every node `id` depends on, directly or indirectly (excluding `id` itself). */
export function prerequisiteClosure(g: Graph, id: string): Set<string> {
  const deps = depMap(g);
  const seen = new Set<string>();
  const stack = [...(deps.get(id) ?? [])];
  while (stack.length) {
    const d = stack.pop()!;
    if (d === id || seen.has(d)) continue;
    seen.add(d);
    stack.push(...(deps.get(d) ?? []));
  }
  return seen;
}

export type PathStep =
  | { kind: "node"; id: string; name: string }
  /** A prerequisite the AI named that isn't in the graph yet. */
  | { kind: "missing"; name: string; neededBy: string[] };

export interface LearningPath {
  /** Study order: every step comes after the steps it depends on. The target itself is last. */
  steps: PathStep[];
  /** True when a dependency cycle was cut to produce the order (the order is then only a best effort). */
  cyclic: boolean;
}

/**
 * Transitive prerequisites of `id` in a valid study order (a topological order over dependsOn,
 * prerequisites first). Missing prerequisites are placed right before the first node that needs them.
 */
export function learningPath(g: Graph, id: string): LearningPath {
  const deps = depMap(g);
  const byId = new Map(g.nodes.map((n) => [n.id, n]));
  const steps: PathStep[] = [];
  const missing = new Map<string, Extract<PathStep, { kind: "missing" }>>();
  const done = new Set<string>();
  const onStack = new Set<string>();
  let cyclic = false;

  // Depth-first post-order: a node is emitted only after everything it depends on.
  const visit = (nid: string) => {
    if (done.has(nid)) return;
    if (onStack.has(nid)) {
      cyclic = true; // back edge: skip it, otherwise no order exists
      return;
    }
    const node = byId.get(nid);
    if (!node) return;
    onStack.add(nid);
    for (const d of deps.get(nid) ?? []) visit(d);
    for (const m of node.missingDeps) {
      const key = normalizeName(m.name);
      const seen = missing.get(key);
      if (seen) seen.neededBy.push(nid);
      else {
        const step = { kind: "missing" as const, name: m.name, neededBy: [nid] };
        missing.set(key, step);
        steps.push(step);
      }
    }
    onStack.delete(nid);
    done.add(nid);
    steps.push({ kind: "node", id: nid, name: node.name });
  };
  visit(id);
  return { steps, cyclic };
}

/**
 * Dependency cycles as strongly connected components (Tarjan) with more than one node.
 * Each component is a set of nodes that (transitively) depend on each other.
 */
export function findCycles(g: Graph): string[][] {
  const deps = depMap(g);
  const index = new Map<string, number>();
  const low = new Map<string, number>();
  const stack: string[] = [];
  const onStack = new Set<string>();
  const out: string[][] = [];
  let next = 0;

  const strong = (v: string) => {
    index.set(v, next);
    low.set(v, next);
    next++;
    stack.push(v);
    onStack.add(v);
    for (const w of deps.get(v) ?? []) {
      if (!index.has(w)) {
        strong(w);
        low.set(v, Math.min(low.get(v)!, low.get(w)!));
      } else if (onStack.has(w)) {
        low.set(v, Math.min(low.get(v)!, index.get(w)!));
      }
    }
    if (low.get(v) !== index.get(v)) return;
    const comp: string[] = [];
    let w: string;
    do {
      w = stack.pop()!;
      onStack.delete(w);
      comp.push(w);
    } while (w !== v);
    if (comp.length > 1) out.push(comp);
  };
  for (const n of g.nodes) if (!index.has(n.id)) strong(n.id);
  return out;
}

export interface CycleInfo {
  /** Nodes that sit on some dependency cycle. */
  nodes: Set<string>;
  /** Dependency links on a cycle, as "dependentId>prereqId". */
  links: Set<string>;
}

export const linkKey = (dependentId: string, prereqId: string) => `${dependentId}>${prereqId}`;

/** Which nodes and dependency links take part in a cycle, for warnings on the canvas. */
export function cycleInfo(g: Graph): CycleInfo {
  const nodes = new Set<string>();
  const links = new Set<string>();
  const deps = depMap(g);
  for (const comp of findCycles(g)) {
    const inComp = new Set(comp);
    for (const v of comp) {
      nodes.add(v);
      // Within a strongly connected component every internal link lies on some cycle.
      for (const w of deps.get(v) ?? []) if (inComp.has(w)) links.add(linkKey(v, w));
    }
  }
  return { nodes, links };
}

/**
 * The shortest dependency cycle through `id`, as node ids starting and ending with `id`
 * (e.g. [A, B, A] for "A depends on B depends on A"), or null when `id` isn't on a cycle.
 */
export function cycleThrough(g: Graph, id: string): string[] | null {
  const deps = depMap(g);
  const prev = new Map<string, string>();
  const queue = [id];
  // Breadth-first over dependsOn until we get back to `id`.
  for (let i = 0; i < queue.length; i++) {
    const v = queue[i];
    for (const w of deps.get(v) ?? []) {
      if (w === id) {
        const path = [id];
        for (let at: string | undefined = v; at !== undefined && at !== id; at = prev.get(at)) path.unshift(at);
        path.unshift(id);
        return path;
      }
      if (prev.has(w)) continue;
      prev.set(w, v);
      queue.push(w);
    }
  }
  return null;
}
