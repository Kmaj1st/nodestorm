// zod/mini: the functional API, which bundlers tree-shake (the classic method API put ~60 kB more into the app's main
// chunk). scripts/zod-mini-codemod.mts converts classic-style schemas.
import * as z from "zod/mini";
import en from "zod/v4/locales/en.js";

// English issue messages, as the classic API sets up on import (zod/mini has none: every issue would say "Invalid
// input"). The AI is shown them when its answer doesn't match (runStructured), and the server returns them.
z.config(en());

// ---------- Graph model ----------

export const DepRole = z.enum(["uses", "derives", "assumes"]);
export type DepRole = z.infer<typeof DepRole>;

/** A role in an AI answer: case-insensitive ("Uses", " DERIVES "); an unknown one still makes the answer malformed. */
export const AiDepRole = z.pipe(z.transform((v) => (typeof v === "string" ? v.trim().toLowerCase() : v)), DepRole);

export const MissingDep = z.object({
  name: z.string(),
  reason: z.string(),
  role: DepRole,
});
export type MissingDep = z.infer<typeof MissingDep>;

/**
 * "unclear": the name has several meanings (or none found yet) and the user hasn't picked one. "pending": it has a
 * definition, but its prerequisites haven't been checked (the AI is asked only when the user says so).
 */
export const NodeStatus = z.enum(["ok", "blocked", "checking", "unclear", "error", "pending"]);
export type NodeStatus = z.infer<typeof NodeStatus>;

/** How an "Explain more" answer is pitched. */
export const ExplainLevel = z.enum(["intuitive", "rigorous", "example-driven"]);
export type ExplainLevel = z.infer<typeof ExplainLevel>;

/**
 * Who narrates an "Explain more" answer: "plain" (the default) or a parody narrator. A voice only changes the telling;
 * the content stays correct and at the chosen level (see VOICE_GUIDE in ai/prompts.ts).
 */
export const ExplainVoice = z.enum([
  "plain",
  "nature-documentary",
  "sports-commentator",
  "noir-detective",
  "medieval-scholar",
  "infomercial",
  "shakespearean",
]);
export type ExplainVoice = z.infer<typeof ExplainVoice>;

/** A longer AI explanation of one concept (the "explain" task's answer). */
export const Explanation = z.object({
  summary: z.string().check(z.minLength(1)),
  intuition: z._default(z.string(), ""),
  keyPoints: z._default(z.array(z.string()), []),
  examples: z._default(z.array(z.object({ title: z.string(), body: z.string() })), []),
  pitfalls: z._default(z.array(z.string()), []),
  /** Sources described in words (a textbook chapter, a classic paper…), never URLs the model could invent. */
  furtherReading: z._default(z.array(z.object({ title: z.string(), hint: z._default(z.string(), "") })), []),
});
export type Explanation = z.infer<typeof Explanation>;

/** The latest explanation stored on a node, with how and when it was asked for. */
export const NodeExplanation = z.extend(Explanation, {
  level: ExplainLevel,
  /** Absent in data from before voices existed, and for plain explanations. */
  voice: z.optional(ExplainVoice),
  createdAt: z.number(),
});
export type NodeExplanation = z.infer<typeof NodeExplanation>;

/**
 * How well the user knows a concept, from "Quiz me" self-grades (see client/src/lib/quiz.ts): `score` is 0 (didn't
 * know) … 1 (knew it), a running average of the grades; `reviews` counts them and `reviewedAt` is the last one (ms).
 */
export const Mastery = z.object({
  score: z.number().check(z.minimum(0), z.maximum(1)),
  reviews: z.number().check(z.int(), z.minimum(1)),
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
export const AiConceptKind = z.catch(
  z.pipe(z.transform((v) => (typeof v === "string" ? v.trim().toLowerCase() : v)), z.nullish(ConceptKind)),
  null,
);

/** One hypothesis of a theorem-like statement, why it is there, and what goes wrong without it. */
export const AnatomyHypothesis = z.object({
  text: z._default(z.string(), ""),
  whyNeeded: z._default(z.string(), ""),
  counterexampleIfDropped: z._default(z.string(), ""),
});
export type AnatomyHypothesis = z.infer<typeof AnatomyHypothesis>;

/** "Theorem anatomy": a theorem taken apart (the "anatomy" task's answer). */
export const TheoremAnatomy = z.object({
  hypotheses: z._default(z.array(AnatomyHypothesis), []),
  conclusion: z.string().check(z.trim(), z.minLength(1)),
  /** A sketch of the proof in a few sentences, never a full proof. */
  proofIdea: z._default(z.string(), ""),
  examples: z._default(z.array(z.string()), []),
  nonExamples: z._default(z.array(z.string()), []),
});
export type TheoremAnatomy = z.infer<typeof TheoremAnatomy>;

/** The latest anatomy stored on a node, with when it was asked for. */
export const NodeAnatomy = z.extend(TheoremAnatomy, { createdAt: z.number() });
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
  error: z.optional(z.string()),
  /** Candidate meanings offered while the node is "unclear". */
  senses: z.optional(z.array(z.lazy(() => Sense))),
  /** The latest "Explain more" answer. */
  explanation: z.optional(NodeExplanation),
  /** The user's own free-text notes (Markdown-ish plain text). */
  notes: z.optional(z.string()),
  /** Quiz progress. Personal study data, so share links leave it out (see packGraph in client/src/lib/share.ts). */
  mastery: z.optional(Mastery),
  /** Its counterparts in Lean's Mathlib, each checked to exist (see "Find in Mathlib"). */
  formal: z.optional(z.lazy(() => NodeFormal)),
  /** Published papers about it, found on OpenAlex (see "Find papers"). Personal lookup data: not in share links. */
  papers: z.optional(z.lazy(() => NodePapers)),
  /** Where the concept came from: an imported document and page (see "Derive together"). */
  source: z.optional(z.lazy(() => SourceRef)),
  /** Definition, theorem, lemma…: set by the AI's check (only while unset) or by hand in the inspector. */
  kind: z.optional(ConceptKind),
  /** True once the user picked or cleared the kind by hand: the AI then leaves it alone (even when cleared). */
  kindByUser: z.optional(z.boolean()),
  /** Held in place by the user: Physics and its springs leave it where it is. */
  pinned: z.optional(z.boolean()),
  /**
   * A basic concept: a foundation the user takes as given. It never has missing prerequisites and no prerequisite
   * check is run for it (see setBasic in client/src/lib/graphOps.ts). Links the user made stay.
   */
  basic: z.optional(z.boolean()),
  /** The latest "Theorem anatomy" answer (theorem-like kinds). AI study material, like `explanation`. */
  anatomy: z.optional(NodeAnatomy),
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
  origin: z._default(RelationOrigin, "mix"),
});
export type Relation = z.infer<typeof Relation>;

export const Graph = z.object({
  id: z.string(),
  name: z.string(),
  nodes: z.array(ConceptNode),
  relations: z.array(Relation),
  /** Set for sandboxes: the graph this one was forked from. */
  parentId: z.optional(z.string()),
  forkedAt: z.optional(z.number()),
});
export type Graph = z.infer<typeof Graph>;

export const GraphExport = z.object({
  format: z.literal("nodestorm/v1"),
  /** The exported project (older files have none; import then names the project after the main graph). */
  project: z.optional(z.object({ name: z.string() })),
  /** Main graph first, then its sandboxes. */
  graphs: z.array(Graph),
});
export type GraphExport = z.infer<typeof GraphExport>;

/** Where something came from: a page of an imported document, or an encyclopedia entry (`site` + `url`). */
export const SourceRef = z.object({
  title: z.string().check(z.maxLength(300)),
  page: z.optional(z.number().check(z.int(), z.minimum(1))),
  /** The site a looked-up definition came from ("ProofWiki", "Wikipedia", "Fandom (minecraft)"…) and its page. */
  site: z.optional(z.string().check(z.maxLength(100))),
  url: z.optional(z.string().check(z.maxLength(2000), z.regex(/^https:\/\//, "Only https links are kept."))),
  /** The AI's rating of this source when it was chosen among others (see SourceRating); never the definition itself. */
  rating: z.optional(z.lazy(() => SourceRating)),
});
export type SourceRef = z.infer<typeof SourceRef>;

/** A Lean 4 declaration a concept corresponds to, verified to exist in Mathlib. */
export const FormalDecl = z.object({
  name: z.string().check(z.maxLength(300)),
  type: z.string().check(z.maxLength(4000)),
  module: z.string().check(z.maxLength(300)),
  doc: z.optional(z.string().check(z.maxLength(4000))),
  /** Why the AI thinks it matches. */
  why: z.optional(z.string().check(z.maxLength(500))),
});
export type FormalDecl = z.infer<typeof FormalDecl>;

export const NodeFormal = z.object({
  decls: z.array(FormalDecl).check(z.maxLength(12)),
  /** Names the AI suggested that Mathlib doesn't have (so the user sees what was checked). */
  unverified: z._default(z.array(z.string().check(z.maxLength(300))).check(z.maxLength(12)), []),
  /** Names that couldn't be checked (Loogle timed out or failed for them): neither kept nor ruled out. */
  unchecked: z.optional(z.array(z.string().check(z.maxLength(300))).check(z.maxLength(12))),
  checkedAt: z.number(),
});
export type NodeFormal = z.infer<typeof NodeFormal>;

/** A link the app may open: https only, so an imported file can't smuggle in `javascript:` or plain http. */
const HttpsUrl = z.string().check(z.maxLength(1000), z.regex(/^https:\/\/[^\s]+$/));

/** A published work about a concept, as OpenAlex lists it (see `findPapers` in shared/src/lookup/openalex.ts). */
export const PaperWork = z.object({
  /** OpenAlex work id ("W2741809807"). */
  id: z.string().check(z.regex(/^W\d{1,20}$/)),
  title: z.string().check(z.minLength(1), z.maxLength(500)),
  year: z.optional(z.number().check(z.int(), z.minimum(0), z.maximum(3000))),
  /** The first three authors, then "et al.". */
  authors: z.string().check(z.maxLength(300)),
  venue: z.optional(z.string().check(z.maxLength(300))),
  doi: z.optional(z.string().check(z.maxLength(300))),
  url: HttpsUrl,
  citedBy: z.number().check(z.int(), z.minimum(0)),
  openAccessUrl: z.optional(HttpsUrl),
});
export type PaperWork = z.infer<typeof PaperWork>;

export const NodePapers = z.object({
  works: z.array(PaperWork).check(z.maxLength(25)),
  /** The search expression that found them (OpenAlex's title-and-abstract search syntax). */
  query: z.string().check(z.maxLength(1000)),
  checkedAt: z.number(),
});
export type NodePapers = z.infer<typeof NodePapers>;

// ---------- AI task I/O ----------

/** Longest concept name a request names on its own (the concept looked up or rated, a name already linked). */
export const NAME_MAX = 300;
/** Longest definition in a NodeBrief (toBrief clips a longer one, so a real graph's request is never refused). */
export const BRIEF_DEFINITION_MAX = 4000;
/** Most aliases a NodeBrief carries. */
export const BRIEF_ALIASES_MAX = 12;
/** Most NodeBriefs in one list of a request (the graph as context, prerequisites…); see toBriefs. */
export const BRIEF_LIST_MAX = 500;
/**
 * Longest free text the user writes for a request (a description to name, a goal to derive towards) and longest hint
 * sent with one (why a dependent concept needs this one, why a prerequisite link was added).
 */
export const HINT_MAX = 2000;

/** Lightweight description of a node sent to the AI as context. */
export const NodeBrief = z.object({
  name: z.string().check(z.maxLength(NAME_MAX)),
  definition: z._default(z.string().check(z.maxLength(BRIEF_DEFINITION_MAX)), ""),
  aliases: z._default(z.array(z.string().check(z.maxLength(NAME_MAX))).check(z.maxLength(BRIEF_ALIASES_MAX)), []),
});
export type NodeBrief = z.infer<typeof NodeBrief>;
const BriefList = z.array(NodeBrief).check(z.maxLength(BRIEF_LIST_MAX));

export const NameRequest = z.object({
  description: z.string().check(z.minLength(1), z.maxLength(HINT_MAX)),
  context: z._default(BriefList, []),
});
export type NameRequest = z.infer<typeof NameRequest>;

export const NameCandidate = z.object({
  name: z.string(),
  definition: z.string(),
  aliases: z._default(z.array(z.string()), []),
  kind: AiConceptKind,
});
export type NameCandidate = z.infer<typeof NameCandidate>;

export const NameResponse = z.object({
  candidates: z.array(NameCandidate).check(z.minLength(1)),
});
export type NameResponse = z.infer<typeof NameResponse>;

export const RelateRequest = z.object({ a: NodeBrief, b: NodeBrief });
export type RelateRequest = z.infer<typeof RelateRequest>;

export const RelateResponse = z.object({ aToB: DirRel, bToA: DirRel });
export type RelateResponse = z.infer<typeof RelateResponse>;

export const DepsRequest = z.object({
  node: NodeBrief,
  existing: z._default(BriefList, []),
});
export type DepsRequest = z.infer<typeof DepsRequest>;

export const Prerequisite = z.object({
  name: z.string(),
  role: AiDepRole,
  reason: z.string(),
  /** Name of an existing node the model believes this prerequisite corresponds to. */
  matchesExisting: z.nullish(z.string()),
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
  /** Set when the meaning was looked up in an encyclopedia rather than suggested by the AI. */
  source: z.optional(z.lazy(() => SourceRef)),
  kind: AiConceptKind,
});
export type Sense = z.infer<typeof Sense>;

export const DeriveRequest = z.object({
  selected: BriefList.check(z.minLength(1)),
  context: z._default(BriefList, []),
  goal: z.optional(z.string().check(z.maxLength(HINT_MAX))),
});
export type DeriveRequest = z.infer<typeof DeriveRequest>;

export const DerivedProposal = z.object({
  name: z.string(),
  definition: z.string(),
  aliases: z._default(z.array(z.string()), []),
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
  other: z.string().check(z.maxLength(NAME_MAX)),
  toOther: DirRel,
  fromOther: DirRel,
});
export type ExplainRelation = z.infer<typeof ExplainRelation>;

export const ExplainRequest = z.object({
  node: NodeBrief,
  /** Its prerequisites that are in the graph. */
  prerequisites: z._default(BriefList, []),
  relations: z._default(z.array(ExplainRelation).check(z.maxLength(BRIEF_LIST_MAX)), []),
  level: z._default(ExplainLevel, "intuitive"),
  voice: z._default(ExplainVoice, "plain"),
});
export type ExplainRequest = z.infer<typeof ExplainRequest>;

export const ExplainResponse = Explanation;
export type ExplainResponse = Explanation;

export const AnatomyRequest = z.object({
  node: z.extend(NodeBrief, { kind: z.optional(ConceptKind) }),
  /** Its prerequisites that are in the graph. */
  prerequisites: z._default(BriefList, []),
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
  node: z.extend(NodeBrief, { notes: z.optional(z.string().check(z.maxLength(4000))) }),
  /** Its prerequisites that are in the graph (a "connect" question picks one of them). */
  prerequisites: z._default(BriefList, []),
  style: z._default(QuizStyle, "recall"),
  /** Ask for four choices with one correct answer instead of a free-recall question. */
  multipleChoice: z._default(z.boolean(), false),
});
export type QuizRequest = z.infer<typeof QuizRequest>;

export const QuizResponse = z.object({
  question: z.string().check(z.trim(), z.minLength(1)),
  answer: z.string().check(z.trim(), z.minLength(1)),
  hints: z._default(z.array(z.string()), []),
  /** Multiple choice only: exactly four options and the index of the right one (tasks.quiz drops malformed sets). */
  choices: z.nullish(z.array(z.string())),
  correctIndex: z.nullish(z.number().check(z.int())),
});
export type QuizResponse = z.infer<typeof QuizResponse>;

/** One "from needs to" prerequisite link on a dependency cycle, with the reason it was added. */
export const CycleLink = z.object({
  from: NodeBrief,
  to: NodeBrief,
  reason: z._default(z.string().check(z.maxLength(HINT_MAX)), ""),
});
export type CycleLink = z.infer<typeof CycleLink>;

/** A dependency cycle (A needs B … needs A) to break: the links in order, each "from" needing "to". */
export const ResolveCycleRequest = z.object({
  links: z.array(CycleLink).check(z.minLength(2), z.maxLength(12)),
});
export type ResolveCycleRequest = z.infer<typeof ResolveCycleRequest>;

export const ResolveCycleResponse = z.object({
  /** Indexes (into `links`) of the links that are wrong and should be removed; at least one. */
  remove: z.array(z.number().check(z.int(), z.minimum(0))).check(z.minLength(1)),
  /** One or two sentences on why, shown to the user. */
  reason: z.string(),
});
export type ResolveCycleResponse = z.infer<typeof ResolveCycleResponse>;

/** Longest definition "Formulas → LaTeX" rewrites (characters). */
export const LATEXIFY_MAX = 4000;

/** A text whose formulas are written with Unicode symbols ("φ(ab) = φ(a)φ(b)", "x² ≤ y") rather than LaTeX. */
export const LatexifyRequest = z.object({
  text: z.string().check(z.minLength(1), z.maxLength(LATEXIFY_MAX)),
});
export type LatexifyRequest = z.infer<typeof LatexifyRequest>;

export const LatexifyResponse = z.object({
  /** The same text with only its formulas rewritten as LaTeX between $…$. */
  text: z.string(),
  /** Set by the app (not the AI): the answer changed more than the formulas, so `text` is the original. */
  rejected: z.optional(z.boolean()),
});
export type LatexifyResponse = z.infer<typeof LatexifyResponse>;

/** Longest text "Extract from text" accepts (characters): a few pages, which fits every provider's context. */
export const EXTRACT_MAX_CHARS = 12_000;

export const ExtractRequest = z.object({
  text: z.string().check(
    z.trim(),
    z.minLength(1, "Paste some text to extract concepts from."),
    z.maxLength(EXTRACT_MAX_CHARS, `The text is too long: at most ${EXTRACT_MAX_CHARS} characters per extraction.`),
  ),
  /** The graph's concepts, so the model reuses their exact names. */
  existing: z._default(BriefList, []),
  /** Optional hint on what to pick out, e.g. "only the theorems". */
  focus: z.optional(z.string().check(z.maxLength(500))),
});
export type ExtractRequest = z.infer<typeof ExtractRequest>;

export const ExtractedConcept = z.object({
  name: z.string().check(z.trim(), z.minLength(1)),
  definition: z._default(z.string(), ""),
  aliases: z._default(z.array(z.string()), []),
  /** A short excerpt of the text that supports the concept. */
  quote: z.nullish(z.string()),
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
  role: AiDepRole,
  reason: z._default(z.string(), ""),
});
export type ExtractedPrerequisite = z.infer<typeof ExtractedPrerequisite>;

export const ExtractResponse = z.object({
  concepts: z.array(ExtractedConcept),
  relations: z._default(z.array(ExtractedRelation), []),
  prerequisites: z._default(z.array(ExtractedPrerequisite), []),
});
export type ExtractResponse = z.infer<typeof ExtractResponse>;

// ---------- Absurd chain (parody mode) ----------

/** How an absurd chain is narrated. The facts are sober whatever the style; only the narration changes. */
export const AbsurdStyle = z.enum(["deadpan", "conspiracy", "epic", "bureaucratic", "academic-overkill"]);
export type AbsurdStyle = z.infer<typeof AbsurdStyle>;

/** Shortest and longest chain anyone may ask for (hops, i.e. links). */
export const ABSURD_MIN_HOPS = 1;
export const ABSURD_MAX_HOPS = 7;
/** A model answer longer than this is rejected rather than shown (cleanAbsurdChain first cuts out loops). */
export const ABSURD_HARD_MAX = 10;
/** Most stops ("via") the user may put between the ends; each needs a link before it, so 6 stops fill 7 hops. */
export const ABSURD_MAX_VIA = ABSURD_MAX_HOPS - 1;
/** Most concepts of earlier rolls "Roll again" asks to avoid, and the longest name of one. */
export const ABSURD_AVOID_MAX = 40;
export const ABSURD_AVOID_NAME_MAX = 200;

/**
 * The hop range for a chain through `stops` stops: every stop needs a link before it and the end one after the last,
 * so both bounds are raised to at least stops + 1 (never past ABSURD_MAX_HOPS).
 */
export function absurdHops(hops: { min: number; max: number }, stops: number): { min: number; max: number } {
  const need = Math.min(stops + 1, ABSURD_MAX_HOPS);
  return { min: Math.max(hops.min, need), max: Math.max(hops.max, need) };
}

export const AbsurdChainRequest = z.pipe(
  z.object({
    from: NodeBrief,
    to: NodeBrief,
    style: z._default(AbsurdStyle, "deadpan"),
    hops: z._default(
      z
        .object({
          min: z.number().check(z.int(), z.minimum(ABSURD_MIN_HOPS), z.maximum(ABSURD_MAX_HOPS)),
          max: z.number().check(z.int(), z.minimum(ABSURD_MIN_HOPS), z.maximum(ABSURD_MAX_HOPS)),
        })
        .check(z.refine((h) => h.min <= h.max, "hops.min must not exceed hops.max")),
      { min: 3, max: 5 },
    ),
    /** Concepts in the graph, as background (the chain may pass through them). */
    context: z._default(z.array(NodeBrief).check(z.maxLength(80)), []),
    /** Intermediate concepts of earlier rolls, so "Roll again" takes a different route. */
    avoid: z._default(
      z.array(z.string().check(z.maxLength(ABSURD_AVOID_NAME_MAX))).check(z.maxLength(ABSURD_AVOID_MAX)),
      [],
    ),
    /**
     * The user's stops, in order: the chain passes through each one. A concept of the graph comes with its own
     * definition; a custom stop with the description the user wrote (what the stop means).
     */
    via: z._default(z.array(NodeBrief).check(z.maxLength(ABSURD_MAX_VIA)), []),
  }).check(
    z.refine((r) => normalizeName(r.from.name) !== "" && normalizeName(r.to.name) !== "", "Name both ends of the chain."),
    z.refine((r) => normalizeName(r.from.name) !== normalizeName(r.to.name), "The two ends of the chain must be different concepts."),
    z.refine((r) => r.via.every((v) => normalizeName(v.name) !== ""), "Name every stop of the chain."),
    z.refine((r) => {
      const names = [r.from, r.to, ...r.via].map((n) => normalizeName(n.name));
      return new Set(names).size === names.length;
    }, "Each stop must differ from the ends and from the other stops."),
  ),
  // Older callers ask for a hop range without thinking of stops: it grows to leave a link before every stop.
  z.transform((r) => ({ ...r, hops: absurdHops(r.hops, r.via.length) })),
);
export type AbsurdChainRequest = z.infer<typeof AbsurdChainRequest>;

/** One link of the chain: a true, checkable relation (`fact`), narrated comically (`quip`). */
export const AbsurdHop = z.object({
  from: z.string().check(z.trim(), z.minLength(1)),
  to: z.string().check(z.trim(), z.minLength(1)),
  /** Short relation label, e.g. "is solved by", "browns through". */
  kind: z._default(z.string().check(z.trim()), ""),
  /** The sober, accurate statement of the relation. */
  fact: z.string().check(z.trim(), z.minLength(1)),
  /** The funny narration of the same step. */
  quip: z._default(z.string().check(z.trim()), ""),
});
export type AbsurdHop = z.infer<typeof AbsurdHop>;

export const AbsurdChainResponse = z.object({
  title: z._default(z.string().check(z.trim()), ""),
  chain: z.array(AbsurdHop).check(z.minLength(1)),
  /** A funny closing line. */
  moral: z._default(z.string().check(z.trim()), ""),
  /** A sober note on how solid the links are (which ones are loose, if any). */
  plausibility: z._default(z.string().check(z.trim()), ""),
});
export type AbsurdChainResponse = z.infer<typeof AbsurdChainResponse>;

/** Lean 4 Mathlib names that may formalise a concept; the client checks each with Loogle before showing it. */
export const MathlibRequest = z.object({
  node: NodeBrief,
  context: z._default(z.array(NodeBrief).check(z.maxLength(80)), []),
});
export type MathlibRequest = z.infer<typeof MathlibRequest>;

export const MathlibCandidate = z.object({
  name: z.string().check(z.trim(), z.minLength(1), z.maxLength(300)),
  why: z._default(z.string(), ""),
});
export type MathlibCandidate = z.infer<typeof MathlibCandidate>;

export const MathlibResponse = z.object({ candidates: z._default(z.array(MathlibCandidate), []) });
export type MathlibResponse = z.infer<typeof MathlibResponse>;

// ---------- Suggest connections ----------

/** Keywords to connect a concept to: the concepts it most directly relates to, for the user to pick from. */
export const ConnectRequest = z.object({
  node: NodeBrief,
  /** Concepts already in the graph (a suggestion that is one of them uses its exact name). */
  existing: z._default(z.array(NodeBrief).check(z.maxLength(200)), []),
  /** Names already linked to the concept: not suggested again. */
  linked: z._default(z.array(z.string().check(z.maxLength(NAME_MAX))).check(z.maxLength(200)), []),
  count: z._default(z.number().check(z.int(), z.minimum(1), z.maximum(12)), 8),
});
export type ConnectRequest = z.infer<typeof ConnectRequest>;

export const ConnectSuggestion = z.object({
  name: z.string().check(z.trim(), z.minLength(1), z.maxLength(200)),
  /** The word or phrase in the concept's definition that points to it ("" when none does). */
  keyword: z._default(z.string(), ""),
  definition: z._default(z.string(), ""),
  kind: z.catch(z.optional(z.nullable(ConceptKind)), null),
  /** aToB: what the concept does to the suggestion; bToA: what the suggestion does to the concept. */
  aToB: DirRel,
  bToA: DirRel,
});
export type ConnectSuggestion = z.infer<typeof ConnectSuggestion>;

export const ConnectResponse = z.object({ suggestions: z._default(z.array(ConnectSuggestion), []) });
export type ConnectResponse = z.infer<typeof ConnectResponse>;

// ---------- Assess sources ----------

/** How far a source can be trusted for a concept's definition, as the AI judges it against the other sources. */
export const Reliability = z.enum(["high", "medium", "low", "unusable"]);
export type Reliability = z.infer<typeof Reliability>;

/**
 * The AI's rating kept with a definition taken from a rated source: how reliable it judged the source, its short
 * reason, and how many sources it compared. Dropped when the definition is edited by hand (the source is then "you").
 */
export const SourceRating = z.object({
  reliability: Reliability,
  reasons: z._default(z.string().check(z.maxLength(1000)), ""),
  compared: z.number().check(z.int(), z.minimum(1), z.maximum(100)),
});
export type SourceRating = z.infer<typeof SourceRating>;

/** Longest source text the AI is shown (a web page's excerpt is cut to this). */
export const ASSESS_TEXT_MAX = 2500;
/** Most sources one assessment compares. */
export const ASSESS_MAX = 10;

/** One source found for a concept's name: an encyclopedia entry or a web search result, with the text we have of it. */
export const AssessSource = z.object({
  id: z.string().check(z.minLength(1), z.maxLength(40)),
  kind: z.enum(["encyclopedia", "web"]),
  site: z.string().check(z.maxLength(200)),
  title: z._default(z.string().check(z.maxLength(300)), ""),
  url: z._default(z.string().check(z.maxLength(2000)), ""),
  text: z.string().check(z.maxLength(ASSESS_TEXT_MAX)),
});
export type AssessSource = z.infer<typeof AssessSource>;

/**
 * "Assess sources": the AI rates each source and points at the passage that defines the concept, quoted word for
 * word from that source's text. It never writes a definition itself.
 */
export const AssessRequest = z.object({
  name: z.string().check(z.minLength(1), z.maxLength(NAME_MAX)),
  /** Extra context, e.g. why a dependent concept needs this one. */
  hint: z.optional(z.string().check(z.maxLength(HINT_MAX))),
  /** Names of related concepts in the graph (which meaning is meant). */
  context: z._default(z.array(z.string().check(z.maxLength(200))).check(z.maxLength(40)), []),
  sources: z.array(AssessSource).check(z.minLength(1), z.maxLength(ASSESS_MAX)),
});
export type AssessRequest = z.infer<typeof AssessRequest>;

export const AssessRating = z.object({
  id: z.string(),
  /** Null when the answer's value isn't one of the four (the source then counts as not rated). */
  reliability: z.catch(
    z.pipe(z.transform((v) => (typeof v === "string" ? v.trim().toLowerCase() : v)), z.nullable(Reliability)),
    null,
  ),
  reasons: z._default(z.string(), ""),
  /** A short label of the meaning of the name the source describes (sources about different meanings are grouped). */
  sense: z._default(z.string(), ""),
  /** The sentence(s) of the source that define the concept, copied verbatim ("" when there is none). */
  passage: z._default(z.string(), ""),
});
export type AssessRating = z.infer<typeof AssessRating>;

export const AssessResponse = z.object({
  ratings: z._default(z.array(AssessRating), []),
  /** How far the sources agree, and where they conflict. */
  note: z._default(z.string(), ""),
});
export type AssessResponse = z.infer<typeof AssessResponse>;

// ---------- Derive together ----------

/** Largest page image `readPage` accepts (base64 characters, about 6 MB of JPEG). */
export const PAGE_IMAGE_MAX = 8_000_000;

/** Read a scanned page: its text, formulas as LaTeX. */
export const ReadPageRequest = z.object({
  mediaType: z.enum(["image/jpeg", "image/png", "image/webp"]),
  data: z.string().check(z.minLength(1), z.maxLength(PAGE_IMAGE_MAX, "The page image is too large.")),
});
export type ReadPageRequest = z.infer<typeof ReadPageRequest>;

export const ReadPageResponse = z.object({ text: z._default(z.string(), "") });
export type ReadPageResponse = z.infer<typeof ReadPageResponse>;

/** Longest stretch of a problem sheet `splitProblems` reads at once (characters). */
export const PROBLEMS_MAX_CHARS = 12_000;
/** Most pages of a problem sheet in one `splitProblems` request. */
export const PROBLEMS_MAX_PAGES = 200;

export const SplitProblemsRequest = z.object({
  /** Pages of the sheet, in order. */
  pages: z.array(z.object({ page: z.number().check(z.int(), z.minimum(1)), text: z.string() })).check(
    z.minLength(1),
    z.maxLength(PROBLEMS_MAX_PAGES),
    z.refine(
      (ps) => ps.reduce((n, p) => n + p.text.length, 0) <= PROBLEMS_MAX_CHARS,
      `Too much text: at most ${PROBLEMS_MAX_CHARS} characters at a time.`,
    ),
  ),
});
export type SplitProblemsRequest = z.infer<typeof SplitProblemsRequest>;

export const SheetProblem = z.object({
  /** How the sheet numbers it ("1", "2(b)", "Exercise 4.3"). */
  label: z._default(z.string(), ""),
  statement: z.string().check(z.trim(), z.minLength(1)),
  page: z.nullish(z.number().check(z.int(), z.minimum(1))),
});
export type SheetProblem = z.infer<typeof SheetProblem>;

export const SplitProblemsResponse = z.object({ problems: z.array(SheetProblem) });
export type SplitProblemsResponse = z.infer<typeof SplitProblemsResponse>;

/** A retrieved passage of a reference document; the tutor cites it as [n]. */
export const RefChunk = z.object({
  n: z.number().check(z.int(), z.minimum(1)),
  title: z.string().check(z.maxLength(300)),
  page: z.number().check(z.int(), z.minimum(1)),
  text: z.string().check(z.maxLength(2000)),
});
export type RefChunk = z.infer<typeof RefChunk>;

const TutorBase = z.object({
  problem: z.string().check(z.trim(), z.minLength(1, "Choose a problem first."), z.maxLength(4000)),
  /** The user's steps so far, in order. */
  steps: z._default(z.array(z.string().check(z.maxLength(4000))).check(z.maxLength(60)), []),
  references: z._default(z.array(RefChunk).check(z.maxLength(8)), []),
  /** Concepts in the graph, so the tutor uses their names. */
  context: z._default(z.array(NodeBrief).check(z.maxLength(80)), []),
});

export const TutorHintRequest = z.extend(TutorBase, {
  /** 1 for the first hint on this step, higher when the user asks again: each hint may say a little more. */
  nth: z._default(z.number().check(z.int(), z.minimum(1), z.maximum(10)), 1),
});
export type TutorHintRequest = z.infer<typeof TutorHintRequest>;

/** A concept the tutor refers to, which the user may add to the graph. */
export const TutorConcept = z.object({
  name: z.string().check(z.trim(), z.minLength(1)),
  definition: z._default(z.string(), ""),
});
export type TutorConcept = z.infer<typeof TutorConcept>;

export const TutorHintResponse = z.object({
  hint: z.string().check(z.minLength(1)),
  /** Numbers of the references the hint relies on. */
  cites: z._default(z.array(z.number().check(z.int())), []),
  concepts: z._default(z.array(TutorConcept), []),
});
export type TutorHintResponse = z.infer<typeof TutorHintResponse>;

export const CheckStepRequest = z.extend(TutorBase, {
  /** The step to check; `steps` holds the ones before it. */
  step: z.string().check(z.trim(), z.minLength(1, "Write the step first."), z.maxLength(4000)),
});
export type CheckStepRequest = z.infer<typeof CheckStepRequest>;

/** "ok": valid and justified; "gap": true but a justification is missing; "error": wrong; "unclear": can't tell. */
export const StepVerdict = z.enum(["ok", "gap", "error", "unclear"]);
export type StepVerdict = z.infer<typeof StepVerdict>;

export const CheckStepResponse = z.object({
  verdict: StepVerdict,
  comment: z._default(z.string(), ""),
  /** Facts or concepts the step relies on without saying so. */
  missing: z._default(z.array(z.string()), []),
  cites: z._default(z.array(z.number().check(z.int())), []),
  /** Concepts the step uses. */
  concepts: z._default(z.array(TutorConcept), []),
  /** True when this step completes the derivation. */
  solved: z._default(z.boolean(), false),
});
export type CheckStepResponse = z.infer<typeof CheckStepResponse>;

/** An earlier tutor check of step `step` (1-based), passed to the referee so it can build on it. */
export const StepCheckBrief = z.object({
  step: z.number().check(z.int(), z.minimum(1)),
  verdict: StepVerdict,
  comment: z._default(z.string().check(z.maxLength(1000)), ""),
  /** The tutor said this step completes the solution. */
  solved: z._default(z.boolean(), false),
});
export type StepCheckBrief = z.infer<typeof StepCheckBrief>;

/** "Reviewer 2": a pedantic (but accurate) referee report on the derivation so far. */
export const RefereeRequest = z.extend(TutorBase, {
  checks: z._default(z.array(StepCheckBrief).check(z.maxLength(60)), []),
});
export type RefereeRequest = z.infer<typeof RefereeRequest>;

export const RefereeVerdict = z.enum(["accept", "minor revisions", "major revisions", "reject"]);
export type RefereeVerdict = z.infer<typeof RefereeVerdict>;
export const RefereeSeverity = z.enum(["fatal", "major", "minor", "pedantic"]);
export type RefereeSeverity = z.infer<typeof RefereeSeverity>;

/** Enum values from a model, case-insensitive ("Major Revisions", "major_revisions"). */
const lenientWords = (v: unknown) => (typeof v === "string" ? v.trim().toLowerCase().replace(/[\s_-]+/g, " ") : v);

export const RefereePoint = z.object({
  /** The step it is about (1-based), or none for the derivation as a whole. */
  // A step the model numbers 0 (or oddly) is read as "the derivation as a whole", not an error for the report.
  step: z.pipe(
    z.transform((v) => (typeof v === "number" && Number.isInteger(v) && v >= 1 ? v : undefined)),
    z.optional(z.number().check(z.int(), z.minimum(1))),
  ),
  severity: z.catch(z.pipe(z.transform(lenientWords), RefereeSeverity), "minor"),
  comment: z.string().check(z.trim(), z.minLength(1)),
});
export type RefereePoint = z.infer<typeof RefereePoint>;

export const RefereeResponse = z.object({
  verdict: z.pipe(z.transform(lenientWords), RefereeVerdict),
  summary: z.string().check(z.trim(), z.minLength(1)),
  points: z._default(z.array(RefereePoint), []),
  grudgingPraise: z._default(z.string(), ""),
});
export type RefereeResponse = z.infer<typeof RefereeResponse>;

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

/**
 * Symbols that change what a name means: math and other symbols (\p{S}: "+", "∇", "∫", "~"…) and a few marks
 * Unicode files as punctuation (# * ′ ″ ‴ † ‡ %), so "C", "C++" and "C#", or "f" and "f′", stay different
 * concepts. Other punctuation (hyphens, underscores, dots, "!", quotes, brackets) only separates words.
 */
const MEANINGFUL_SYMBOL = /([\p{S}#*′″‴⁗†‡%])/gu;

export function normalizeName(s: string): string {
  const folded = s
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, ""); // Latin accents: "Poincaré" ~ "poincare"
  return (
    folded
      // Each meaningful symbol is a word of its own, so "a+b" ~ "a + b" and "C ++" ~ "C++".
      .replace(MEANINGFUL_SYMBOL, " $1 ")
      // Keep letters, digits and combining marks of every script (Cyrillic, Greek, kana, Hangul, CJK…) and the
      // symbols above; punctuation alone ("!!!", "-") counts as no name.
      .replace(/[^\p{L}\p{N}\p{M}\p{S}#*′″‴⁗†‡%]+/gu, " ")
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

/** `s` cut to at most `max` characters, ending in "…" when cut (never in the middle of a surrogate pair). */
export function clipText(s: string, max: number): string {
  if (s.length <= max) return s;
  let end = Math.max(0, max - 1);
  const c = s.charCodeAt(end - 1);
  if (c >= 0xd800 && c <= 0xdbff) end--;
  return `${s.slice(0, end).trimEnd()}…`;
}

/**
 * A concept as a request describes it, within NodeBrief's caps: a longer name or definition is clipped (marked
 * with "…"), and only the first aliases go. One parameter only, so `nodes.map(toBrief)` stays safe.
 */
export function toBrief(n: Briefable): NodeBrief {
  return briefWithin(n, BRIEF_DEFINITION_MAX);
}

type Briefable = { name: string; definition: string; aliases: string[] };

function briefWithin(n: Briefable, definitionMax: number): NodeBrief {
  return {
    name: clipText(n.name, NAME_MAX),
    definition: clipText(n.definition ?? "", Math.min(definitionMax, BRIEF_DEFINITION_MAX)),
    aliases: (n.aliases ?? []).slice(0, BRIEF_ALIASES_MAX).map((a) => clipText(a, NAME_MAX)),
  };
}

/** Characters of definitions one list of briefs carries at most, so a big graph's request stays well under 1 MB. */
const BRIEF_LIST_CHARS = 200_000;

/**
 * A list of concepts for a request: the first `max` (at most BRIEF_LIST_MAX), each through toBrief. On a big graph
 * the definitions are clipped shorter, so the whole list stays within about BRIEF_LIST_CHARS characters.
 */
export function toBriefs(
  nodes: readonly Briefable[],
  max = BRIEF_LIST_MAX,
): NodeBrief[] {
  const list = nodes.slice(0, Math.min(max, BRIEF_LIST_MAX));
  const perDefinition = Math.max(200, Math.floor(BRIEF_LIST_CHARS / Math.max(1, list.length)));
  return list.map((n) => briefWithin(n, perDefinition));
}
