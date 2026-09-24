import type { ConceptNode } from "@nodestorm/shared";

const WORD_BREAK = /[\s\-_(/]/;

/**
 * How well `query` matches `text` (higher is better), or null if it doesn't. Substrings beat scattered
 * letters, earlier and word-start matches beat later ones, and shorter texts win ties.
 */
export function fuzzyScore(query: string, text: string): number | null {
  const q = query.trim().toLowerCase();
  const t = text.toLowerCase();
  if (!q) return 0;
  const at = t.indexOf(q);
  if (at >= 0) {
    const wordStart = at === 0 || WORD_BREAK.test(t[at - 1]);
    return 1000 - at * 2 + (wordStart ? 100 : 0) - (t.length - q.length) * 0.1;
  }
  // Letters in order, possibly with gaps: reward runs and word starts.
  let score = 0;
  let ti = 0;
  let run = 0;
  for (const ch of q) {
    if (ch === " ") continue;
    const found = t.indexOf(ch, ti);
    if (found < 0) return null;
    run = found === ti ? run + 1 : 0;
    const wordStart = found === 0 || WORD_BREAK.test(t[found - 1]);
    score += 10 + run * 5 + (wordStart ? 15 : 0) - (found - ti);
    ti = found + 1;
  }
  return score - t.length * 0.1;
}

/** Concepts matching the query by name or alias, best first. */
export function searchNodes(nodes: ConceptNode[], query: string, limit = 8): ConceptNode[] {
  const scored: { n: ConceptNode; s: number }[] = [];
  for (const n of nodes) {
    const scores = [n.name, ...n.aliases].map((t) => fuzzyScore(query, t)).filter((s): s is number => s !== null);
    if (scores.length) scored.push({ n, s: Math.max(...scores) });
  }
  return scored.sort((a, b) => b.s - a.s).slice(0, limit).map((x) => x.n);
}
