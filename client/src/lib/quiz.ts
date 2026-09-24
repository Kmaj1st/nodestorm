import type { ConceptNode, Graph, Mastery, QuizStyle } from "@nodestorm/shared";
import { learningPath } from "./paths";

/**
 * "Quiz me" scheduling, kept pure: which concepts a quiz covers and in what order, which one to ask next, and how a
 * self-grade changes a concept's mastery. A light form of spaced repetition: every concept has a score (a running
 * average of its grades) whose strength fades with time, more slowly the more often it was reviewed.
 */

export type Grade = "knew" | "partly" | "didnt";
export const GRADES: Grade[] = ["knew", "partly", "didnt"];
const GRADE_SCORE: Record<Grade, number> = { knew: 1, partly: 0.5, didnt: 0 };

/** "mixed" lets pickStyle vary the kind of question with how well the concept is known. */
export type StylePref = QuizStyle | "mixed";

const DAY = 86_400_000;

/** The first grade sets the score; each later one moves it halfway towards the new grade. */
export function updateMastery(prev: Mastery | undefined, grade: Grade, now: number): Mastery {
  const g = GRADE_SCORE[grade];
  const score = prev ? prev.score + (g - prev.score) / 2 : g;
  return { score: Math.round(score * 1000) / 1000, reviews: (prev?.reviews ?? 0) + 1, reviewedAt: now };
}

/**
 * How well the concept is known right now, 0…1: its score, halved every "half-life" since the last review. The
 * half-life starts at a day and doubles with each review (up to 64 days), scaled by the score, so a well-known,
 * often-reviewed concept stays strong for weeks and a shaky one is due again soon.
 */
export function strength(m: Mastery, now: number): number {
  const halfLife = Math.max(0.25, m.score * 2 ** Math.min(m.reviews - 1, 6)) * DAY;
  const age = Math.max(0, now - m.reviewedAt);
  return m.score * 0.5 ** (age / halfLife);
}

export type MasteryLevel = "weak" | "fair" | "strong";

/** Three buckets for the dot on the canvas. */
export function masteryLevel(m: Mastery, now: number): MasteryLevel {
  const s = strength(m, now);
  return s >= 0.75 ? "strong" : s >= 0.4 ? "fair" : "weak";
}

/** Whole days since the last review (0 = today). */
export const daysAgo = (m: Mastery, now: number) => Math.max(0, Math.floor((now - m.reviewedAt) / DAY));

/** Lower is asked sooner: never-reviewed concepts first, then the weakest. */
const priority = (n: ConceptNode, now: number) => (n.mastery ? strength(n.mastery, now) : -1);

export type SkipReason = "blocked" | "unclear" | "checking";

export interface QuizPlan {
  /** Concepts to ask about, in study order (prerequisites first). */
  order: string[];
  /** Concepts in scope that can't be asked about yet, with why. */
  skipped: { id: string; name: string; reason: SkipReason }[];
}

/** Every concept of the graph in study order: a depth-first post-order over dependsOn (cycles are cut). */
export function studyOrder(g: Graph): string[] {
  const byId = new Map(g.nodes.map((n) => [n.id, n]));
  const out: string[] = [];
  const done = new Set<string>();
  const onStack = new Set<string>();
  const visit = (id: string) => {
    if (done.has(id) || onStack.has(id)) return;
    onStack.add(id);
    for (const d of byId.get(id)?.dependsOn ?? []) if (byId.has(d)) visit(d);
    onStack.delete(id);
    done.add(id);
    out.push(id);
  };
  for (const n of g.nodes) visit(n.id);
  return out;
}

/**
 * What a quiz covers: the whole graph, or the learning path of `rootId` (its prerequisites and itself). Blocked
 * concepts (a prerequisite is missing), unclear ones (meaning not chosen) and ones still being checked are skipped.
 */
export function quizPlan(g: Graph, rootId?: string): QuizPlan {
  const ids = rootId
    ? learningPath(g, rootId).steps.flatMap((s) => (s.kind === "node" ? [s.id] : []))
    : studyOrder(g);
  const byId = new Map(g.nodes.map((n) => [n.id, n]));
  const plan: QuizPlan = { order: [], skipped: [] };
  for (const id of ids) {
    const n = byId.get(id);
    if (!n) continue;
    if (n.status === "blocked" || n.status === "unclear" || n.status === "checking") {
      plan.skipped.push({ id, name: n.name, reason: n.status });
    } else plan.order.push(id);
  }
  return plan;
}

/** A concept known this well is not asked before the concepts that build on it. */
const KNOWN = 0.75;

/**
 * The next concept to ask about, or null when all are done. Prerequisites come first: a concept is a candidate once
 * its prerequisites in the quiz are done or already well known. Among the candidates the never-reviewed or weakest one
 * wins, ties in study order. If a dependency cycle leaves no candidate, the first remaining concept is asked.
 */
export function nextConcept(g: Graph, order: string[], done: ReadonlySet<string>, now: number): string | null {
  const byId = new Map(g.nodes.map((n) => [n.id, n]));
  const pending = order.filter((id) => !done.has(id) && byId.has(id));
  if (!pending.length) return null;
  // Prerequisites that still have to come first.
  const waiting = new Set(pending.filter((id) => priority(byId.get(id)!, now) < KNOWN));
  let best: ConceptNode | undefined;
  for (const id of pending) {
    const n = byId.get(id)!;
    if (n.dependsOn.some((d) => d !== id && waiting.has(d))) continue;
    if (!best || priority(n, now) < priority(best, now)) best = n;
  }
  return best?.id ?? pending[0];
}

/**
 * The kind of question for a concept. "mixed": recall while it is new or shaky, then alternately how it connects to a
 * prerequisite and applying it. "connect" needs a prerequisite, else it becomes recall.
 */
export function pickStyle(pref: StylePref, m: Mastery | undefined, hasPrerequisites: boolean): QuizStyle {
  if (pref === "connect" && !hasPrerequisites) return "recall";
  if (pref !== "mixed") return pref;
  if (!m || m.score < 0.5) return "recall";
  return hasPrerequisites && m.reviews % 2 === 1 ? "connect" : "apply";
}

export interface QuizResult {
  id: string;
  name: string;
  /** "skipped": the user skipped the question (or no question could be made). */
  grade: Grade | "skipped";
}

export type QuizSummary = Record<Grade | "skipped", number>;

export function summarize(results: QuizResult[]): QuizSummary {
  const out: QuizSummary = { knew: 0, partly: 0, didnt: 0, skipped: 0 };
  for (const r of results) out[r.grade]++;
  return out;
}
