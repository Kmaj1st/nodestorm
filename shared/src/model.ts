import { z } from "zod";

// ---------- Graph model ----------

export const DepRole = z.enum(["uses", "derives", "assumes"]);
export type DepRole = z.infer<typeof DepRole>;

export const MissingDep = z.object({
  name: z.string(),
  reason: z.string(),
  role: DepRole,
});
export type MissingDep = z.infer<typeof MissingDep>;

/** "unclear": the name has several meanings and the user hasn't picked one yet. */
export const NodeStatus = z.enum(["ok", "blocked", "checking", "unclear", "error"]);
export type NodeStatus = z.infer<typeof NodeStatus>;

/** How an "Explain more" answer is pitched. */
export const ExplainLevel = z.enum(["intuitive", "rigorous", "example-driven"]);
export type ExplainLevel = z.infer<typeof ExplainLevel>;

/** A longer AI explanation of one concept (the "explain" task's answer). */
export const Explanation = z.object({
  summary: z.string().min(1),
  intuition: z.string().default(""),
  keyPoints: z.array(z.string()).default([]),
  examples: z.array(z.object({ title: z.string(), body: z.string() })).default([]),
  pitfalls: z.array(z.string()).default([]),
  /** Sources described in words (a textbook chapter, a classic paper…), never URLs the model could invent. */
  furtherReading: z.array(z.object({ title: z.string(), hint: z.string().default("") })).default([]),
});
export type Explanation = z.infer<typeof Explanation>;

/** The latest explanation stored on a node, with how and when it was asked for. */
export const NodeExplanation = Explanation.extend({
  level: ExplainLevel,
  createdAt: z.number(),
});
export type NodeExplanation = z.infer<typeof NodeExplanation>;

/**
 * How well the user knows a concept, from "Quiz me" self-grades (see client/src/lib/quiz.ts): `score` is 0 (didn't
 * know) … 1 (knew it), a running average of the grades; `reviews` counts them and `reviewedAt` is the last one (ms).
 */
export const Mastery = z.object({
  score: z.number().min(0).max(1),
  reviews: z.number().int().min(1),
  reviewedAt: z.number(),
});
export type Mastery = z.infer<typeof Mastery>;

/**
 * What sort of statement a concept is, for the formal sciences: a definition, a result (theorem, lemma, proposition,
 * corollary), an axiom, a conjecture, an example, a piece of notation, or anything else ("other": ideas, techniques,
 * whole fields). Optional on a node: most brainstorms never set it.
 */
export const ConceptKind = z.enum([
  "definition",
  "theorem",
  "lemma",
  "proposition",
  "corollary",
  "axiom",
  "conjecture",
  "example",
  "notation",
  "other",
]);
export type ConceptKind = z.infer<typeof ConceptKind>;

/** Kinds that have hypotheses and a conclusion, so "Theorem anatomy" applies to them. */
export const THEOREM_KINDS: readonly ConceptKind[] = ["theorem", "lemma", "proposition", "corollary", "conjecture"];
export const isTheoremLike = (kind: ConceptKind | null | undefined): boolean => !!kind && THEOREM_KINDS.includes(kind);

/**
 * A kind in an AI answer: case-insensitive, and an unknown or missing value becomes null instead of failing the
 * whole answer (older prompts, and models that invent "remark" or "principle").
 */
export const AiConceptKind = z
  .preprocess((v) => (typeof v === "string" ? v.trim().toLowerCase() : v), ConceptKind.nullish())
  .catch(null);

/** One hypothesis of a theorem-like statement, why it is there, and what goes wrong without it. */
export const AnatomyHypothesis = z.object({
  text: z.string().default(""),
  whyNeeded: z.string().default(""),
  counterexampleIfDropped: z.string().default(""),
});
export type AnatomyHypothesis = z.infer<typeof AnatomyHypothesis>;

/** "Theorem anatomy": a theorem taken apart (the "anatomy" task's answer). */
export const TheoremAnatomy = z.object({
  hypotheses: z.array(AnatomyHypothesis).default([]),
  conclusion: z.string().trim().min(1),
  /** A sketch of the proof in a few sentences, never a full proof. */
  proofIdea: z.string().default(""),
  examples: z.array(z.string()).default([]),
  nonExamples: z.array(z.string()).default([]),
});
export type TheoremAnatomy = z.infer<typeof TheoremAnatomy>;

/** The latest anatomy stored on a node, with when it was asked for. */
export const NodeAnatomy = TheoremAnatomy.extend({ createdAt: z.number() });
export type NodeAnatomy = z.infer<typeof NodeAnatomy>;

export const ConceptNode = z.object({
  id: z.string(),
  name: z.string(),
  definition: z.string(),
  aliases: z.array(z.string()),
  status: NodeStatus,
  position: z.object({ x: z.number(), y: z.number() }),
  /** Ids of nodes this node depends on (satisfied prerequisites). */
  dependsOn: z.array(z.string()),
  /** Prerequisites the AI found that are not yet in the graph. */
  missingDeps: z.array(MissingDep),
  error: z.string().optional(),
  /** Candidate meanings offered while the node is "unclear". */
  senses: z.array(z.lazy(() => Sense)).optional(),
  /** The latest "Explain more" answer. */
  explanation: NodeExplanation.optional(),
  /** The user's own free-text notes (Markdown-ish plain text). */
  notes: z.string().optional(),
  /** Quiz progress. Personal study data, so share links leave it out (see packGraph in client/src/lib/share.ts). */
  mastery: Mastery.optional(),
  /** Where the concept came from: an imported document and page (see "Derive together"). */
  source: z.lazy(() => SourceRef).optional(),
  /** Definition, theorem, lemma…: set by the AI's check (only while unset) or by hand in the inspector. */
  kind: ConceptKind.optional(),
  /** The latest "Theorem anatomy" answer (theorem-like kinds). AI study material, like `explanation`. */
  anatomy: NodeAnatomy.optional(),
});
export type ConceptNode = z.infer<typeof ConceptNode>;

/** One direction of a relation: what the source node does to the target node. */
export const DirRel = z.object({
  kind: z.string(),
  explanation: z.string(),
});
export type DirRel = z.infer<typeof DirRel>;

/** Where a relation came from: Mix ⇄, a dependency check, a Derive ✦ proposal, or Extract from text. */
export const RelationOrigin = z.enum(["mix", "dependency", "derive", "extract"]);
export type RelationOrigin = z.infer<typeof RelationOrigin>;

export const Relation = z.object({
  id: z.string(),
  a: z.string(),
  b: z.string(),
  aToB: DirRel,
  bToA: DirRel,
  origin: RelationOrigin.default("mix"),
});
export type Relation = z.infer<typeof Relation>;

export const Graph = z.object({
  id: z.string(),
  name: z.string(),
  nodes: z.array(ConceptNode),
  relations: z.array(Relation),
  /** Set for sandboxes: the graph this one was forked from. */
  parentId: z.string().optional(),
  forkedAt: z.number().optional(),
});
export type Graph = z.infer<typeof Graph>;

export const GraphExport = z.object({
  format: z.literal("nodestorm/v1"),
  /** The exported project (older files have none; import then names the project after the main graph). */
  project: z.object({ name: z.string() }).optional(),
  /** Main graph first, then its sandboxes. */
  graphs: z.array(Graph),
});
export type GraphExport = z.infer<typeof GraphExport>;

/** A place in an imported document. */
export const SourceRef = z.object({
  title: z.string().max(300),
  page: z.number().int().min(1).optional(),
});
export type SourceRef = z.infer<typeof SourceRef>;

// ---------- AI task I/O ----------

/** Lightweight description of a node sent to the AI as context. */
export const NodeBrief = z.object({
  name: z.string(),
  definition: z.string().default(""),
  aliases: z.array(z.string()).default([]),
});
export type NodeBrief = z.infer<typeof NodeBrief>;

export const NameRequest = z.object({
  description: z.string().min(1),
  context: z.array(NodeBrief).default([]),
});
export type NameRequest = z.infer<typeof NameRequest>;

export const NameCandidate = z.object({
  name: z.string(),
  definition: z.string(),
  aliases: z.array(z.string()).default([]),
  kind: AiConceptKind,
});
export type NameCandidate = z.infer<typeof NameCandidate>;

export const NameResponse = z.object({
  candidates: z.array(NameCandidate).min(1),
});
export type NameResponse = z.infer<typeof NameResponse>;

export const RelateRequest = z.object({ a: NodeBrief, b: NodeBrief });
export type RelateRequest = z.infer<typeof RelateRequest>;

export const RelateResponse = z.object({ aToB: DirRel, bToA: DirRel });
export type RelateResponse = z.infer<typeof RelateResponse>;

export const DepsRequest = z.object({
  node: NodeBrief,
  existing: z.array(NodeBrief).default([]),
});
export type DepsRequest = z.infer<typeof DepsRequest>;

export const Prerequisite = z.object({
  name: z.string(),
  role: DepRole,
  reason: z.string(),
  /** Name of an existing node the model believes this prerequisite corresponds to. */
  matchesExisting: z.string().nullish(),
});
export type Prerequisite = z.infer<typeof Prerequisite>;

export const DepsResponse = z.object({
  prerequisites: z.array(Prerequisite),
  /** What sort of statement the analysed concept is (null when the model can't tell or gives none). */
  kind: AiConceptKind,
});
export type DepsResponse = z.infer<typeof DepsResponse>;

/** One possible meaning of an ambiguous name, e.g. "Expectation (probability)". */
export const Sense = z.object({
  name: z.string(),
  domain: z.string(),
  definition: z.string(),
  kind: AiConceptKind,
});
export type Sense = z.infer<typeof Sense>;

export const ClarifyRequest = z.object({
  name: z.string().min(1),
  /** Extra context, e.g. why a dependent node needs this concept. */
  hint: z.string().optional(),
  context: z.array(NodeBrief).default([]),
  /** How many meanings to offer when the name is ambiguous. */
  count: z.number().int().min(2).max(10).default(3),
});
export type ClarifyRequest = z.infer<typeof ClarifyRequest>;

export const ClarifyResponse = z.object({
  /** False when the name (in this graph's context) has one clear meaning — then senses[0] is it. */
  ambiguous: z.boolean(),
  senses: z.array(Sense).min(1),
});
export type ClarifyResponse = z.infer<typeof ClarifyResponse>;

export const DeriveRequest = z.object({
  selected: z.array(NodeBrief).min(1),
  context: z.array(NodeBrief).default([]),
  goal: z.string().optional(),
});
export type DeriveRequest = z.infer<typeof DeriveRequest>;

export const DerivedProposal = z.object({
  name: z.string(),
  definition: z.string(),
  aliases: z.array(z.string()).default([]),
  kind: AiConceptKind,
  /** How the proposal relates to the selected nodes (by name). */
  links: z.array(
    z.object({
      to: z.string(),
      fromNew: DirRel,
      toNew: DirRel,
    }),
  ),
});
export type DerivedProposal = z.infer<typeof DerivedProposal>;

export const DeriveResponse = z.object({
  proposals: z.array(DerivedProposal),
});
export type DeriveResponse = z.infer<typeof DeriveResponse>;

/** One relation of the explained concept, seen from it: what it does to `other`, and what `other` does to it. */
export const ExplainRelation = z.object({
  other: z.string(),
  toOther: DirRel,
  fromOther: DirRel,
});
export type ExplainRelation = z.infer<typeof ExplainRelation>;

export const ExplainRequest = z.object({
  node: NodeBrief,
  /** Its prerequisites that are in the graph. */
  prerequisites: z.array(NodeBrief).default([]),
  relations: z.array(ExplainRelation).default([]),
  level: ExplainLevel.default("intuitive"),
});
export type ExplainRequest = z.infer<typeof ExplainRequest>;

export const ExplainResponse = Explanation;
export type ExplainResponse = Explanation;

export const AnatomyRequest = z.object({
  node: NodeBrief.extend({ kind: ConceptKind.optional() }),
  /** Its prerequisites that are in the graph. */
  prerequisites: z.array(NodeBrief).default([]),
});
export type AnatomyRequest = z.infer<typeof AnatomyRequest>;

export const AnatomyResponse = TheoremAnatomy;
export type AnatomyResponse = TheoremAnatomy;

/**
 * What a quiz question asks: "recall" the concept itself, "apply" it to a small concrete case, or "connect" it to one
 * of its prerequisites (how the concept builds on it).
 */
export const QuizStyle = z.enum(["recall", "apply", "connect"]);
export type QuizStyle = z.infer<typeof QuizStyle>;

export const QuizRequest = z.object({
  node: NodeBrief.extend({ notes: z.string().max(4000).optional() }),
  /** Its prerequisites that are in the graph (a "connect" question picks one of them). */
  prerequisites: z.array(NodeBrief).default([]),
  style: QuizStyle.default("recall"),
  /** Ask for four choices with one correct answer instead of a free-recall question. */
  multipleChoice: z.boolean().default(false),
});
export type QuizRequest = z.infer<typeof QuizRequest>;

export const QuizResponse = z.object({
  question: z.string().trim().min(1),
  answer: z.string().trim().min(1),
  hints: z.array(z.string()).default([]),
  /** Multiple choice only: exactly four options and the index of the right one (tasks.quiz drops malformed sets). */
  choices: z.array(z.string()).nullish(),
  correctIndex: z.number().int().nullish(),
});
export type QuizResponse = z.infer<typeof QuizResponse>;

/** One "from needs to" prerequisite link on a dependency cycle, with the reason it was added. */
export const CycleLink = z.object({
  from: NodeBrief,
  to: NodeBrief,
  reason: z.string().default(""),
});
export type CycleLink = z.infer<typeof CycleLink>;

/** A dependency cycle (A needs B … needs A) to break: the links in order, each "from" needing "to". */
export const ResolveCycleRequest = z.object({
  links: z.array(CycleLink).min(2).max(12),
});
export type ResolveCycleRequest = z.infer<typeof ResolveCycleRequest>;

export const ResolveCycleResponse = z.object({
  /** Indexes (into `links`) of the links that are wrong and should be removed; at least one. */
  remove: z.array(z.number().int().min(0)).min(1),
  /** One or two sentences on why, shown to the user. */
  reason: z.string(),
});
export type ResolveCycleResponse = z.infer<typeof ResolveCycleResponse>;

/** Longest text "Extract from text" accepts (characters): a few pages, which fits every provider's context. */
export const EXTRACT_MAX_CHARS = 12_000;

export const ExtractRequest = z.object({
  text: z
    .string()
    .trim()
    .min(1, "Paste some text to extract concepts from.")
    .max(EXTRACT_MAX_CHARS, `The text is too long: at most ${EXTRACT_MAX_CHARS} characters per extraction.`),
  /** The graph's concepts, so the model reuses their exact names. */
  existing: z.array(NodeBrief).default([]),
  /** Optional hint on what to pick out, e.g. "only the theorems". */
  focus: z.string().max(500).optional(),
});
export type ExtractRequest = z.infer<typeof ExtractRequest>;

export const ExtractedConcept = z.object({
  name: z.string().trim().min(1),
  definition: z.string().default(""),
  aliases: z.array(z.string()).default([]),
  /** A short excerpt of the text that supports the concept. */
  quote: z.string().nullish(),
  kind: AiConceptKind,
});
export type ExtractedConcept = z.infer<typeof ExtractedConcept>;

/** A relation the text states, by concept name (an extracted concept or one already in the graph). */
export const ExtractedRelation = z.object({
  from: z.string(),
  to: z.string(),
  aToB: DirRel,
  bToA: DirRel,
});
export type ExtractedRelation = z.infer<typeof ExtractedRelation>;

/** "`dependent` needs `prerequisite`", where the text says so. */
export const ExtractedPrerequisite = z.object({
  dependent: z.string(),
  prerequisite: z.string(),
  role: DepRole,
  reason: z.string().default(""),
});
export type ExtractedPrerequisite = z.infer<typeof ExtractedPrerequisite>;

export const ExtractResponse = z.object({
  concepts: z.array(ExtractedConcept),
  relations: z.array(ExtractedRelation).default([]),
  prerequisites: z.array(ExtractedPrerequisite).default([]),
});
export type ExtractResponse = z.infer<typeof ExtractResponse>;

// ---------- Derive together ----------

/** Largest page image `readPage` accepts (base64 characters, about 6 MB of JPEG). */
export const PAGE_IMAGE_MAX = 8_000_000;

/** Read a scanned page: its text, formulas as LaTeX. */
export const ReadPageRequest = z.object({
  mediaType: z.enum(["image/jpeg", "image/png", "image/webp"]),
  data: z.string().min(1).max(PAGE_IMAGE_MAX, "The page image is too large."),
});
export type ReadPageRequest = z.infer<typeof ReadPageRequest>;

export const ReadPageResponse = z.object({ text: z.string().default("") });
export type ReadPageResponse = z.infer<typeof ReadPageResponse>;

/** Longest stretch of a problem sheet `splitProblems` reads at once (characters). */
export const PROBLEMS_MAX_CHARS = 12_000;

export const SplitProblemsRequest = z.object({
  /** Pages of the sheet, in order. */
  pages: z
    .array(z.object({ page: z.number().int().min(1), text: z.string() }))
    .min(1)
    .refine(
      (ps) => ps.reduce((n, p) => n + p.text.length, 0) <= PROBLEMS_MAX_CHARS,
      `Too much text: at most ${PROBLEMS_MAX_CHARS} characters at a time.`,
    ),
});
export type SplitProblemsRequest = z.infer<typeof SplitProblemsRequest>;

export const SheetProblem = z.object({
  /** How the sheet numbers it ("1", "2(b)", "Exercise 4.3"). */
  label: z.string().default(""),
  statement: z.string().trim().min(1),
  page: z.number().int().min(1).nullish(),
});
export type SheetProblem = z.infer<typeof SheetProblem>;

export const SplitProblemsResponse = z.object({ problems: z.array(SheetProblem) });
export type SplitProblemsResponse = z.infer<typeof SplitProblemsResponse>;

/** A retrieved passage of a reference document; the tutor cites it as [n]. */
export const RefChunk = z.object({
  n: z.number().int().min(1),
  title: z.string().max(300),
  page: z.number().int().min(1),
  text: z.string().max(2000),
});
export type RefChunk = z.infer<typeof RefChunk>;

const TutorBase = z.object({
  problem: z.string().trim().min(1, "Choose a problem first.").max(4000),
  /** The user's steps so far, in order. */
  steps: z.array(z.string().max(4000)).max(60).default([]),
  references: z.array(RefChunk).max(8).default([]),
  /** Concepts in the graph, so the tutor uses their names. */
  context: z.array(NodeBrief).max(80).default([]),
});

export const TutorHintRequest = TutorBase.extend({
  /** 1 for the first hint on this step, higher when the user asks again: each hint may say a little more. */
  nth: z.number().int().min(1).max(10).default(1),
});
export type TutorHintRequest = z.infer<typeof TutorHintRequest>;

/** A concept the tutor refers to, which the user may add to the graph. */
export const TutorConcept = z.object({
  name: z.string().trim().min(1),
  definition: z.string().default(""),
});
export type TutorConcept = z.infer<typeof TutorConcept>;

export const TutorHintResponse = z.object({
  hint: z.string().min(1),
  /** Numbers of the references the hint relies on. */
  cites: z.array(z.number().int()).default([]),
  concepts: z.array(TutorConcept).default([]),
});
export type TutorHintResponse = z.infer<typeof TutorHintResponse>;

export const CheckStepRequest = TutorBase.extend({
  /** The step to check; `steps` holds the ones before it. */
  step: z.string().trim().min(1, "Write the step first.").max(4000),
});
export type CheckStepRequest = z.infer<typeof CheckStepRequest>;

/** "ok": valid and justified; "gap": true but a justification is missing; "error": wrong; "unclear": can't tell. */
export const StepVerdict = z.enum(["ok", "gap", "error", "unclear"]);
export type StepVerdict = z.infer<typeof StepVerdict>;

export const CheckStepResponse = z.object({
  verdict: StepVerdict,
  comment: z.string().default(""),
  /** Facts or concepts the step relies on without saying so. */
  missing: z.array(z.string()).default([]),
  cites: z.array(z.number().int()).default([]),
  /** Concepts the step uses. */
  concepts: z.array(TutorConcept).default([]),
  /** True when this step completes the derivation. */
  solved: z.boolean().default(false),
});
export type CheckStepResponse = z.infer<typeof CheckStepResponse>;

export interface ProviderInfo {
  id: string;
  label: string;
  model: string;
  configured: boolean;
}

export interface ProvidersResponse {
  default: string;
  providers: ProviderInfo[];
}

// ---------- Helpers ----------

export function normalizeName(s: string): string {
  return (
    s
      .toLowerCase()
      .normalize("NFKD")
      .replace(/[\u0300-\u036f]/g, "") // Latin accents: "Poincaré" ~ "poincare"
      // Keep letters, digits and combining marks of every script (Cyrillic, Greek, kana, Hangul, CJK…).
      .replace(/[^\p{L}\p{N}\p{M}]+/gu, " ")
      .trim()
      .replace(/([a-z])s(?=\s|$)/g, "$1") // crude plural folding for Latin words: "groups" ~ "group"
  );
}

/** Find the node matching a name via name or aliases (case/plural-insensitive). */
export function findByName<T extends { name: string; aliases?: string[] }>(
  nodes: T[],
  name: string | null | undefined,
): T | undefined {
  if (!name) return undefined;
  const key = normalizeName(name);
  if (!key) return undefined;
  return nodes.find(
    (n) => normalizeName(n.name) === key || (n.aliases ?? []).some((a) => normalizeName(a) === key),
  );
}

export function toBrief(n: { name: string; definition: string; aliases: string[] }): NodeBrief {
  return { name: n.name, definition: n.definition, aliases: n.aliases };
}
