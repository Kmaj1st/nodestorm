import type { Graph } from "@nodestorm/shared";
import { LAYOUT_GAP, NODE_SIZE } from "./graphOps";

/**
 * Layered ("Sugiyama-style") auto-layout. Prerequisites sit in rows above the concepts that depend on them;
 * within a row, nodes are ordered next to the neighbours they are related to (any relation attracts).
 * Pure: returns a position (top-left) per node id and never touches the graph.
 */

export interface LayoutOptions {
  /** Horizontal distance between node origins. */
  dx?: number;
  /** Vertical distance between rows. */
  dy?: number;
  /** A layer with more nodes than this wraps onto extra rows. */
  maxPerRow?: number;
}

/**
 * Layer index per node: 0 for nodes with no prerequisites, otherwise one below its deepest prerequisite.
 * Dependency cycles are broken where the depth-first walk first meets them (the closing edge is ignored).
 */
export function dependencyLayers(g: Graph): Map<string, number> {
  const byId = new Map(g.nodes.map((n) => [n.id, n]));
  const layer = new Map<string, number>();
  const onStack = new Set<string>();
  const visit = (id: string): number => {
    const known = layer.get(id);
    if (known !== undefined) return known;
    if (onStack.has(id)) return -1; // back edge of a cycle: doesn't constrain
    onStack.add(id);
    let depth = 0;
    for (const p of byId.get(id)?.dependsOn ?? []) if (byId.has(p) && p !== id) depth = Math.max(depth, visit(p) + 1);
    onStack.delete(id);
    layer.set(id, depth);
    return depth;
  };
  for (const n of g.nodes) visit(n.id);
  return layer;
}

export function layeredLayout(g: Graph, opts: LayoutOptions = {}): Map<string, { x: number; y: number }> {
  const { dx = NODE_SIZE.w + LAYOUT_GAP.x, dy = NODE_SIZE.h + LAYOUT_GAP.y, maxPerRow = 6 } = opts;
  const layer = dependencyLayers(g);
  const depth = Math.max(-1, ...layer.values()) + 1;
  const rows: string[][] = Array.from({ length: depth }, () => []);
  for (const n of g.nodes) rows[layer.get(n.id)!].push(n.id);

  const neighbours = new Map<string, string[]>(g.nodes.map((n) => [n.id, []]));
  for (const r of g.relations) {
    if (r.a === r.b || !neighbours.has(r.a) || !neighbours.has(r.b)) continue;
    neighbours.get(r.a)!.push(r.b);
    neighbours.get(r.b)!.push(r.a);
  }

  // Crossing reduction: sweep down then up a few times, sorting each row by the mean slot of its
  // neighbours in the row it is being aligned to. Nodes without such neighbours keep their slot.
  const slot = new Map<string, number>();
  const index = (row: string[]) => row.forEach((id, i) => slot.set(id, i - (row.length - 1) / 2));
  rows.forEach(index);
  const reorder = (row: string[], ref: Set<string>) => {
    const key = new Map<string, number>();
    for (const id of row) {
      const ns = neighbours.get(id)!.filter((n) => ref.has(n));
      key.set(id, ns.length ? ns.reduce((s, n) => s + slot.get(n)!, 0) / ns.length : slot.get(id)!);
    }
    row.sort((a, b) => key.get(a)! - key.get(b)!);
    index(row);
  };
  for (let pass = 0; pass < 4; pass++) {
    for (let i = 1; i < depth; i++) reorder(rows[i], new Set(rows[i - 1]));
    for (let i = depth - 2; i >= 0; i--) reorder(rows[i], new Set(rows[i + 1]));
  }

  // Place rows top to bottom, centred on x = 0; wide layers wrap so the layout stays readable.
  const out = new Map<string, { x: number; y: number }>();
  let y = 0;
  for (const row of rows) {
    for (let start = 0; start < row.length; start += maxPerRow) {
      const chunk = row.slice(start, start + maxPerRow);
      chunk.forEach((id, i) => out.set(id, { x: (i - (chunk.length - 1) / 2) * dx, y }));
      y += dy;
    }
  }
  return out;
}

/** Geometry of the layered (2.5D) view: rows one per dependency depth, each shifted right like stacked sheets. */
export const LAYERED = { dy: NODE_SIZE.h + 120, shear: 80, gap: 36 };

/**
 * Where each concept is drawn in the layered view: on its layer's row (y = layer × dy) at its own x, shifted by the
 * layer's shear. Cards that would overlap on a row are spread apart (keeping their order and the row's centre), so the
 * view is readable before any layout; stored positions are untouched. Pure.
 */
export function layeredView(g: Graph, layers = dependencyLayers(g)): Map<string, { x: number; y: number }> {
  const rows = new Map<number, { id: string; x: number }[]>();
  for (const n of g.nodes) {
    const l = layers.get(n.id) ?? 0;
    (rows.get(l) ?? rows.set(l, []).get(l)!).push({ id: n.id, x: n.position.x });
  }
  const out = new Map<string, { x: number; y: number }>();
  for (const [l, row] of rows) {
    row.sort((a, b) => a.x - b.x || (a.id < b.id ? -1 : 1));
    const xs = row.map((r) => r.x);
    for (let i = 1; i < xs.length; i++) xs[i] = Math.max(xs[i], xs[i - 1] + NODE_SIZE.w + LAYERED.gap);
    const shift = (row.reduce((s, r) => s + r.x, 0) - xs.reduce((s, x) => s + x, 0)) / row.length;
    row.forEach((r, i) => out.set(r.id, { x: Math.round(xs[i] + shift + l * LAYERED.shear), y: l * LAYERED.dy }));
  }
  return out;
}

/** The stored x for a card shown at `x` on `layer` in the layered view (its stored y is left alone). */
export const fromLayered = (x: number, layer: number) => Math.round(x - layer * LAYERED.shear);
