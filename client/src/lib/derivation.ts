import {
  findByName,
  normalizeName,
  type CheckStepResponse,
  type Graph,
  type RefChunk,
  type SourceRef,
  type StepVerdict,
  type TutorConcept,
} from "@nodestorm/shared";
import { applyExtraction, duplicateOf, type ExtractReview } from "./extract";
import { uid, updateNode } from "./graphOps";

/**
 * "Derive together": a derivation session (the problem, the learner's steps, the tutor's checks and hints) and how
 * its results go into the graph. Pure functions only; storage is lib/docDb.ts, the panel is panels/derive/.
 */

/** A passage the tutor cited, resolved to its document and page when the call was made. */
export interface Citation {
  n: number;
  docId: string;
  title: string;
  page: number;
}

export interface StepCheck {
  verdict: StepVerdict;
  comment: string;
  missing: string[];
  cites: Citation[];
  concepts: TutorConcept[];
  solved: boolean;
}

export interface DerivStep {
  id: string;
  text: string;
  check?: StepCheck;
}

export interface Hint {
  id: string;
  text: string;
  cites: Citation[];
  concepts: TutorConcept[];
  /** How many steps there were when it was given: hints for the same next step get stronger. */
  atStep: number;
}

export interface Problem {
  statement: string;
  /** The sheet's number for it ("2(b)"). */
  label?: string;
  source?: { docId: string; title: string; page?: number };
}

export interface Derivation {
  id: string;
  projectId: string;
  problem: Problem;
  steps: DerivStep[];
  hints: Hint[];
  createdAt: number;
  updatedAt: number;
}

/** Longest problem statement and step the tutor tasks accept (characters), and most earlier steps sent. */
export const MAX_PROBLEM = 4000;
export const MAX_STEP = 4000;
export const MAX_STEPS_SENT = 60;

/** A statement cut to what the tutor accepts (a whole page used as the problem can be longer). */
export function clampStatement(s: string): string {
  const t = s.trim();
  return t.length > MAX_PROBLEM ? `${t.slice(0, MAX_PROBLEM - 2).trimEnd()} …` : t;
}

export function newDerivation(projectId: string, problem: Problem, now = Date.now()): Derivation {
  return { id: uid("d"), projectId, problem: { ...problem, statement: clampStatement(problem.statement) }, steps: [], hints: [], createdAt: now, updatedAt: now };
}

/** The earlier steps as the tutor gets them: the most recent ones, each within the length limit. */
export const stepsForTutor = (steps: DerivStep[]) => steps.slice(-MAX_STEPS_SENT).map((s) => s.text.slice(0, MAX_STEP));

const touch = (d: Derivation, patch: Partial<Derivation>): Derivation => ({ ...d, ...patch, updatedAt: Date.now() });

export function addStep(d: Derivation, text: string): { derivation: Derivation; id: string } {
  const step = { id: uid("s"), text: text.trim() };
  return { derivation: touch(d, { steps: [...d.steps, step] }), id: step.id };
}

/** Editing a step drops its check (it was about the old text), and the checks after it, which built on it. */
export function editStep(d: Derivation, id: string, text: string): Derivation {
  const at = d.steps.findIndex((s) => s.id === id);
  if (at < 0 || d.steps[at].text === text.trim()) return d;
  return touch(d, {
    steps: d.steps.map((s, i) => (i === at ? { id: s.id, text: text.trim() } : i > at ? { id: s.id, text: s.text } : s)),
  });
}

/** Removing a step also drops the checks after it. */
export function removeStep(d: Derivation, id: string): Derivation {
  const at = d.steps.findIndex((s) => s.id === id);
  if (at < 0) return d;
  return touch(d, {
    steps: d.steps.filter((s) => s.id !== id).map((s, i) => (i >= at ? { id: s.id, text: s.text } : s)),
    hints: d.hints.filter((h) => h.atStep <= at),
  });
}

export function setCheck(d: Derivation, id: string, check: StepCheck): Derivation {
  return touch(d, { steps: d.steps.map((s) => (s.id === id ? { ...s, check } : s)) });
}

export function addHint(d: Derivation, hint: Omit<Hint, "id" | "atStep">): Derivation {
  return touch(d, { hints: [...d.hints, { ...hint, id: uid("h"), atStep: d.steps.length }] });
}

/** Which hint the next one is for the current step (1 = first): each asks the tutor to say a little more. */
export function nextHintNumber(d: Derivation): number {
  return Math.min(10, d.hints.filter((h) => h.atStep === d.steps.length).length + 1);
}

/** True once a correct step has finished the derivation (and nothing after it was changed). */
export function isSolved(d: Derivation): boolean {
  const last = d.steps.at(-1)?.check;
  return Boolean(last?.solved && last.verdict === "ok");
}

/** A short title for lists: the label and the start of the statement. */
export function derivationTitle(d: Derivation, max = 80): string {
  const s = d.problem.statement.replace(/\s+/g, " ");
  const text = s.length > max ? `${s.slice(0, max - 1)}…` : s;
  return d.problem.label ? `${d.problem.label}. ${text}` : text;
}

/** Retrieved passages as the tutor sees them (numbered from 1) plus the lookup from number back to document. */
export function numberReferences(chunks: { docId: string; title: string; page: number; text: string }[]): {
  refs: RefChunk[];
  resolve: (ns: number[]) => Citation[];
} {
  const refs = chunks.map((c, i) => ({ n: i + 1, title: c.title.slice(0, 300), page: c.page, text: c.text.slice(0, 2000) }));
  const resolve = (ns: number[]) =>
    ns.flatMap((n) => {
      const c = chunks[n - 1];
      return c ? [{ n, docId: c.docId, title: c.title, page: c.page }] : [];
    });
  return { refs, resolve };
}

/** What a step check says, with its citations resolved. */
export function toStepCheck(res: CheckStepResponse, resolve: (ns: number[]) => Citation[]): StepCheck {
  return { verdict: res.verdict, comment: res.comment, missing: res.missing, cites: resolve(res.cites), concepts: res.concepts, solved: res.solved };
}

/** A concept the session mentions, with where it was cited from (the first citation next to it). */
export interface SessionConcept extends TutorConcept {
  source?: SourceRef;
}

/**
 * Every concept the tutor mentioned (in checks, as missing, and in hints), once each by name, in order. Missing
 * facts come without a definition unless the tutor also defined them.
 */
export function sessionConcepts(d: Derivation): SessionConcept[] {
  const out: SessionConcept[] = [];
  const add = (c: TutorConcept, cites: Citation[]) => {
    if (!normalizeName(c.name)) return;
    const have = findByName(out, c.name);
    if (have) {
      if (!have.definition && c.definition) have.definition = c.definition;
      return;
    }
    const cite = cites[0];
    out.push({ name: c.name.trim(), definition: c.definition, ...(cite ? { source: { title: cite.title, page: cite.page } } : {}) });
  };
  for (const s of d.steps) {
    if (!s.check) continue;
    s.check.concepts.forEach((c) => add(c, s.check!.cites));
    s.check.missing.forEach((m) => add({ name: m, definition: "" }, []));
  }
  for (const h of d.hints) h.concepts.forEach((c) => add(c, h.cites));
  return out;
}

/** One entry of the "Add to graph" review. */
export interface PlanItem {
  key: string;
  kind: "problem" | "concept";
  name: string;
  definition: string;
  source?: SourceRef;
  include: boolean;
  /** The graph already has it: it isn't added again, the problem just links to it. */
  existingId?: string;
}

export interface GraphPlan {
  items: PlanItem[];
  /** Save the steps (and verdicts) in the problem's notes. */
  keepSteps: boolean;
}

/** A default name for the problem as a concept: the sheet's label, else the start of the statement. */
export function problemName(p: Problem, max = 60): string {
  const s = p.statement.replace(/\s+/g, " ").replace(/^(show|prove|verify)( that)?\s+/i, "").replace(/[.:]$/, "");
  const text = s.length > max ? `${s.slice(0, max - 1)}…` : s;
  return text.charAt(0).toUpperCase() + text.slice(1);
}

/**
 * The review list for "Add to graph": the problem as a result, then every concept the session used. Concepts
 * already in the graph are listed as links, not new concepts. Concepts are ticked, and so is the problem.
 */
export function buildGraphPlan(d: Derivation, g: Graph): GraphPlan {
  const src = d.problem.source;
  const problem: PlanItem = {
    key: "problem",
    kind: "problem",
    name: problemName(d.problem),
    definition: d.problem.statement,
    ...(src ? { source: { title: src.title, ...(src.page ? { page: src.page } : {}) } } : {}),
    include: true,
  };
  const concepts = sessionConcepts(d).map((c, i): PlanItem => {
    const dup = duplicateOf(g, { name: c.name, aliases: [] });
    return { key: `c${i}`, kind: "concept", name: c.name, definition: c.definition, source: c.source, include: true, ...(dup ? { existingId: dup.id } : {}) };
  });
  return { items: [problem, ...concepts], keepSteps: true };
}

const VERDICT_MD: Record<StepVerdict, string> = { ok: "correct", gap: "gap", error: "error", unclear: "unclear" };

/** The session as Markdown: the problem, each step with its verdict, and the hints. */
export function toMarkdown(d: Derivation, opts: { hints?: boolean } = {}): string {
  const lines: string[] = [];
  const src = d.problem.source;
  lines.push(`**Problem${d.problem.label ? ` ${d.problem.label}` : ""}:** ${d.problem.statement}`);
  if (src) lines.push(`*Source:* ${src.title}${src.page ? `, p. ${src.page}` : ""}`);
  lines.push("");
  d.steps.forEach((s, i) => {
    lines.push(`${i + 1}. ${s.text}${s.check ? ` — *${VERDICT_MD[s.check.verdict]}*` : ""}`);
    if (s.check && s.check.verdict !== "ok" && s.check.comment) lines.push(`   > ${s.check.comment}`);
  });
  if (isSolved(d)) lines.push("", "*Solved.*");
  if (opts.hints !== false && d.hints.length) {
    lines.push("", "**Hints:**");
    for (const h of d.hints) lines.push(`- ${h.text}`);
  }
  return lines.join("\n");
}

/**
 * Put the accepted part of a plan into the graph: new concepts are added (one layout, like Extract from text), the
 * problem depends on every concept that was ticked, sources are recorded, and the steps go into the problem's notes.
 * Returns the ids of the concepts added and of the problem (which may already have existed).
 */
export function applyGraphPlan(
  g: Graph,
  plan: GraphPlan,
  d: Derivation,
  anchor?: { x: number; y: number },
): { graph: Graph; added: string[]; problemId?: string } {
  const chosen = plan.items.filter((it) => it.include && it.name.trim());
  const problem = chosen.find((it) => it.kind === "problem");
  const review: ExtractReview = {
    // A solved problem is a proved result: a proposition.
    items: chosen.map((it) => ({
      source: it.key, name: it.name.trim(), definition: it.definition, aliases: [], include: true,
      kind: it.kind === "problem" && isSolved(d) ? ("proposition" as const) : null,
    })),
    links: problem
      ? chosen
          .filter((it) => it.kind === "concept")
          .map((it) => ({
            from: problem.key,
            to: it.key,
            aToB: { kind: "uses", explanation: "Used in the derivation." },
            bToA: { kind: "", explanation: "" },
            role: "uses" as const,
            include: true,
          }))
      : [],
  };
  const { graph, added } = applyExtraction(g, review, anchor);
  let out = graph;
  const idOf = (it: PlanItem) => findByName(out.nodes, it.name.trim())?.id;
  for (const it of chosen) {
    const id = idOf(it);
    const node = id && out.nodes.find((n) => n.id === id);
    if (!node) continue;
    const patch: Parameters<typeof updateNode>[2] = {};
    if (it.source && !node.source) patch.source = it.source;
    if (it.kind === "problem" && plan.keepSteps && d.steps.length) {
      const md = toMarkdown(d, { hints: false });
      patch.notes = node.notes?.trim() ? `${node.notes.trim()}\n\n${md}` : md;
    }
    if (Object.keys(patch).length) out = updateNode(out, id, patch);
  }
  return { graph: out, added, problemId: problem ? idOf(problem) : undefined };
}
