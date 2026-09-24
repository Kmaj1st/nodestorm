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
});
export type ConceptNode = z.infer<typeof ConceptNode>;

/** One direction of a relation: what the source node does to the target node. */
export const DirRel = z.object({
  kind: z.string(),
  explanation: z.string(),
});
export type DirRel = z.infer<typeof DirRel>;

export const RelationOrigin = z.enum(["mix", "dependency", "derive"]);
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
});
export type DepsResponse = z.infer<typeof DepsResponse>;

/** One possible meaning of an ambiguous name, e.g. "Expectation (probability)". */
export const Sense = z.object({
  name: z.string(),
  domain: z.string(),
  definition: z.string(),
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
  return s
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^a-z0-9一-鿿]+/g, " ")
    .trim()
    .replace(/s\b/g, ""); // crude plural folding: "groups" ~ "group"
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
