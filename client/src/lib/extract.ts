import { findByName, normalizeName, type ConceptKind, type ConceptNode, type DepRole, type DirRel, type ExtractResponse, type Graph, type SourceRef } from "@nodestorm/shared";
import * as ops from "./graphOps";
import { layeredLayout } from "./layout";

/**
 * "Extract from text": the review list built from the AI's answer, and how the accepted part goes into the graph.
 * Pure functions only; the dialog is panels/ExtractDialog.tsx and the AI call and insert live in actions.ts.
 */

/** A candidate concept under review. */
export interface ExtractItem {
  /** The name the AI gave it: relations refer to the candidate by this name, even after the user renames it. */
  source: string;
  name: string;
  definition: string;
  aliases: string[];
  quote?: string;
  /** What the AI says it is (definition, theorem…); carried onto the new concept. */
  kind?: ConceptKind | null;
  /** Add it to the graph. A candidate that duplicates an existing concept is never added: it links to that one. */
  include: boolean;
}

/** A candidate relation, or a prerequisite link when `role` is set (`from` needs `to`). */
export interface ExtractLink {
  from: string;
  to: string;
  aToB: DirRel;
  bToA: DirRel;
  role?: DepRole;
  include: boolean;
}

export interface ExtractReview {
  items: ExtractItem[];
  links: ExtractLink[];
  /** Recorded as the source of the new concepts' definitions (the AI, or the imported paper). */
  origin?: SourceRef;
}

/** The existing concept a candidate duplicates (by its name or one of its aliases), if any. */
export function duplicateOf(g: Graph, item: Pick<ExtractItem, "name" | "aliases">): ConceptNode | undefined {
  return findByName(g.nodes, item.name) ?? item.aliases.map((a) => findByName(g.nodes, a)).find(Boolean);
}

/**
 * The review list for an extraction: every candidate is ticked unless it duplicates a concept already in the graph
 * (then it links to that concept instead); every relation and prerequisite is ticked. Repeated names are merged.
 */
export function buildReview(g: Graph, res: ExtractResponse): ExtractReview {
  const items: ExtractItem[] = [];
  for (const c of res.concepts) {
    const name = c.name.trim();
    if (!name || findByName(items, name)) continue;
    const item = { source: name, name, definition: c.definition.trim(), aliases: c.aliases, quote: c.quote ?? undefined, kind: c.kind ?? null };
    items.push({ ...item, include: !duplicateOf(g, item) });
  }
  const links: ExtractLink[] = [
    ...res.prerequisites.map((p) => {
      const dir = depDirections(p.dependent, p.prerequisite, p.role, p.reason);
      return { from: p.dependent, to: p.prerequisite, ...dir, role: p.role, include: true };
    }),
    ...res.relations.map((r) => ({ from: r.from, to: r.to, aToB: r.aToB, bToA: r.bToA, include: true })),
  ];
  return { items, links };
}

/** The two directions of a prerequisite link, as graphOps.depRelation words them. */
const depDirections = ops.depKinds;

/** What a name in a relation stands for: a candidate (by its original or current name) or an existing concept. */
export type Endpoint = { kind: "item"; index: number } | { kind: "existing"; node: ConceptNode } | null;

export function resolveEndpoint(g: Graph, items: ExtractItem[], name: string): Endpoint {
  const key = normalizeName(name);
  const index = items.findIndex((it) => normalizeName(it.source) === key || normalizeName(it.name) === key);
  if (index >= 0) {
    const dup = duplicateOf(g, items[index]);
    if (dup) return { kind: "existing", node: dup };
    return items[index].include && items[index].name.trim() ? { kind: "item", index } : null;
  }
  const node = findByName(g.nodes, name);
  return node ? { kind: "existing", node } : null;
}

/** A link can be added when both of its ends will be in the graph and they are different concepts. */
export function linkUsable(g: Graph, items: ExtractItem[], link: Pick<ExtractLink, "from" | "to">): boolean {
  const a = resolveEndpoint(g, items, link.from);
  const b = resolveEndpoint(g, items, link.to);
  const key = (e: NonNullable<Endpoint>) => (e.kind === "item" ? `item:${e.index}` : `node:${e.node.id}`);
  return Boolean(a && b && key(a) !== key(b));
}

/** Candidates that will become new concepts. */
export const newItems = (g: Graph, items: ExtractItem[]) =>
  items.map((it, index) => ({ it, index })).filter(({ it }) => it.include && it.name.trim() && !duplicateOf(g, it));

/**
 * Where the new concepts go: laid out in layers among themselves (prerequisites above), as a block centred on
 * `anchor` (or below the graph when there is none). addNode then nudges each one to the nearest free spot.
 */
function placement(g: Graph, items: ExtractItem[], links: ExtractLink[], anchor?: { x: number; y: number }) {
  const fresh = newItems(g, items);
  const tmpId = (i: number) => `x${i}`;
  const onlyNew = (name: string) => {
    const e = resolveEndpoint(g, items, name);
    return e?.kind === "item" ? tmpId(e.index) : null;
  };
  const tmp: Graph = {
    ...ops.emptyGraph(),
    nodes: fresh.map(({ it, index }) => ({
      id: tmpId(index), name: it.name, definition: "", aliases: [], status: "ok", position: { x: 0, y: 0 }, missingDeps: [],
      dependsOn: links.filter((l) => l.include && l.role && onlyNew(l.from) === tmpId(index)).map((l) => onlyNew(l.to)).filter((x): x is string => !!x),
    })),
    relations: [],
  };
  const pos = layeredLayout(tmp, { maxPerRow: 4 });
  const ys = [...pos.values()].map((p) => p.y);
  const height = ys.length ? Math.max(...ys) + ops.NODE_SIZE.h : 0;
  const at =
    anchor ??
    (g.nodes.length
      ? { x: g.nodes.reduce((s, n) => s + n.position.x, 0) / g.nodes.length, y: Math.max(...g.nodes.map((n) => n.position.y)) + 300 + height / 2 }
      : { x: 300, y: 200 + height / 2 });
  const out = new Map<number, { x: number; y: number }>();
  for (const { index } of fresh) {
    const p = pos.get(tmpId(index))!;
    out.set(index, { x: at.x + p.x - ops.NODE_SIZE.w / 2, y: at.y - height / 2 + p.y });
  }
  return out;
}

/**
 * Put the accepted part of a review into the graph: new concepts (tidily placed), then prerequisite links, then
 * relations (origin "extract"). A relation never overwrites one the user already has between the same two concepts,
 * other than an automatic dependency link. Returns the ids of the concepts it added.
 */
export function applyExtraction(
  g: Graph,
  review: ExtractReview,
  anchor?: { x: number; y: number },
): { graph: Graph; added: string[] } {
  const { items, links } = review;
  const positions = placement(g, items, links, anchor);
  const usable = links.filter((l) => l.include && linkUsable(g, items, l));
  const ids = new Map<number, string>();
  const added: string[] = [];
  let out = g;
  for (const { it, index } of newItems(g, items)) {
    const r = ops.addNode(out, { name: it.name, definition: it.definition, aliases: it.aliases, kind: it.kind, source: review.origin, position: positions.get(index) });
    ids.set(index, r.id);
    if (!r.existed) added.push(r.id);
    out = r.graph;
  }
  const idOf = (name: string) => {
    const e = resolveEndpoint(g, items, name);
    return e?.kind === "existing" ? e.node.id : e ? ids.get(e.index) : undefined;
  };
  for (const l of usable.filter((l) => l.role)) {
    const [a, b] = [idOf(l.from), idOf(l.to)];
    if (a && b && a !== b) out = ops.link(out, a, b, l.role!, l.aToB.explanation);
  }
  for (const l of usable.filter((l) => !l.role)) {
    const [a, b] = [idOf(l.from), idOf(l.to)];
    if (!a || !b || a === b) continue;
    const existing = ops.findRelation(out, a, b);
    if (existing && existing.origin !== "dependency") continue;
    out = ops.upsertRelation(out, a, b, l.aToB, l.bToA, "extract");
  }
  return { graph: out, added };
}

/**
 * Concepts in the graph that a concept's definition names (by name or alias, as a whole word, outside formulas),
 * other than itself: the offline part of "Suggest connections".
 */
export function mentionedIn(g: Graph, node: ConceptNode): ConceptNode[] {
  const text = ` ${node.definition.replace(/\$[^$]*\$/g, " ").toLowerCase().replace(/[^\p{L}\p{N}]+/gu, " ")} `;
  return g.nodes.filter(
    (n) =>
      n.id !== node.id &&
      [n.name, ...n.aliases].some((name) => {
        const w = name.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, " ").trim();
        return w.length >= 3 && (text.includes(` ${w} `) || text.includes(` ${w}s `));
      }),
  );
}
