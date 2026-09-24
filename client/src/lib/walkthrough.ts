import type { ConceptNode, DirRel, Graph } from "@nodestorm/shared";
import { studyOrder } from "./export";
import { findCycles, learningPath } from "./paths";

/**
 * Slides for the walkthrough (presentation) mode: one per concept in study order, prerequisites first. Pure and
 * read-only, like the other study formats (export.ts, flashcards.ts) whose order it shares.
 */

/** One direction of a relation, seen from the slide's concept: "→ other" is what it does to `other`, "← other" the
 * reverse. */
export interface SlideRelation {
  dir: "out" | "in";
  otherId: string;
  otherName: string;
  kind: string;
  explanation: string;
}

export interface Slide {
  id: string;
  name: string;
  definition: string;
  /** Direct in-graph prerequisites ("builds on"). */
  buildsOn: { id: string; name: string }[];
  relations: SlideRelation[];
  /** The saved "Explain more" answer, reduced to what fits a slide. */
  explanation?: { summary: string; keyPoints: string[] };
  notes?: string;
  /** Prerequisites the AI named that aren't in the graph. */
  missing: { name: string; reason: string }[];
}

export interface Walkthrough {
  slides: Slide[];
  /** A dependency cycle was cut to produce the order, so it is only approximate. */
  cyclic: boolean;
}

/** Slides for the learning path of `rootId` (ending with it), or for the whole graph when there is none. */
export function buildWalkthrough(g: Graph, rootId?: string): Walkthrough {
  const byId = new Map(g.nodes.map((n) => [n.id, n]));
  let order: ConceptNode[];
  let cyclic: boolean;
  if (rootId && byId.has(rootId)) {
    const path = learningPath(g, rootId);
    order = path.steps.flatMap((s) => (s.kind === "node" ? [byId.get(s.id)!] : []));
    cyclic = path.cyclic;
  } else {
    order = studyOrder(g);
    cyclic = findCycles(g).length > 0;
  }
  return { slides: order.map((n) => slideFor(g, n, byId)), cyclic };
}

const hasText = (d: DirRel) => Boolean(d.kind.trim() || d.explanation.trim());

function slideFor(g: Graph, n: ConceptNode, byId: Map<string, ConceptNode>): Slide {
  const relations: SlideRelation[] = [];
  for (const r of g.relations) {
    if (r.a === r.b || (r.a !== n.id && r.b !== n.id)) continue;
    const mine = r.a === n.id;
    const other = byId.get(mine ? r.b : r.a);
    if (!other) continue;
    const [out, back] = mine ? [r.aToB, r.bToA] : [r.bToA, r.aToB];
    const at = { otherId: other.id, otherName: other.name };
    if (hasText(out)) relations.push({ dir: "out", ...at, kind: out.kind, explanation: out.explanation });
    if (hasText(back)) relations.push({ dir: "in", ...at, kind: back.kind, explanation: back.explanation });
  }
  const buildsOn = [...new Set(n.dependsOn)]
    .filter((d) => d !== n.id && byId.has(d))
    .map((d) => ({ id: d, name: byId.get(d)!.name }));
  const ex = n.explanation;
  return {
    id: n.id,
    name: n.name,
    definition: n.definition,
    buildsOn,
    relations,
    explanation: ex ? { summary: ex.summary, keyPoints: ex.keyPoints.filter((k) => k.trim()) } : undefined,
    notes: n.notes?.trim() ? n.notes : undefined,
    missing: n.missingDeps.map((m) => ({ name: m.name, reason: m.reason })),
  };
}
