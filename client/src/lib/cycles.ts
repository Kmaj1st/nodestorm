import type { ConceptNode, Graph } from "@nodestorm/shared";
import { findRelation, removeDependency } from "./graphOps";
import { cycleThrough } from "./paths";

/** One prerequisite link on a cycle: `from` depends on `to`. */
export interface CycleLinkInfo {
  from: ConceptNode;
  to: ConceptNode;
  /** Why the link was added (the dependency relation's explanation for that direction), if known. */
  reason: string;
}

/** The links of a cycle given as node ids [A, B, …, A] (as `cycleThrough` returns it). */
export function cycleLinks(g: Graph, cycle: string[]): CycleLinkInfo[] {
  const node = (id: string) => g.nodes.find((n) => n.id === id);
  const out: CycleLinkInfo[] = [];
  for (let i = 0; i + 1 < cycle.length; i++) {
    const from = node(cycle[i]);
    const to = node(cycle[i + 1]);
    if (!from || !to) continue;
    const rel = findRelation(g, from.id, to.id);
    // A dependency edge is written for the link it was created for (a = the dependent). When two concepts need each
    // other they share that one edge, and its other direction only restates the first link backwards — not a reason
    // for this one — so it is left out rather than mislead the AI.
    const reason = !rel
      ? ""
      : rel.a === from.id
        ? rel.aToB.explanation
        : rel.origin === "dependency"
          ? ""
          : rel.bToA.explanation;
    out.push({ from, to, reason });
  }
  return out;
}

/** Remove these "from needs to" links (dependsOn and their dependency edges). */
export function removeLinks(g: Graph, links: { from: ConceptNode; to: ConceptNode }[]): Graph {
  return links.reduce((acc, l) => removeDependency(acc, l.from.id, l.to.id), g);
}

/** A cycle that still runs through any of these nodes, or null once they are all acyclic. */
export function remainingCycle(g: Graph, ids: string[]): string[] | null {
  for (const id of ids) {
    const c = cycleThrough(g, id);
    if (c) return c;
  }
  return null;
}

/**
 * Which link to drop when there is no (usable) AI answer: the one the latest check added — the link going out of
 * `newestFrom`, the concept just analysed — since that check is what closed the cycle; otherwise the closing link.
 */
export function fallbackLinkIndex(links: CycleLinkInfo[], newestFrom?: string): number {
  const i = newestFrom ? links.findIndex((l) => l.from.id === newestFrom) : -1;
  return i >= 0 ? i : links.length - 1;
}
