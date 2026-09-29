import {
  findByName,
  normalizeName,
  type ConceptKind,
  type ConceptNode,
  type DepRole,
  type SourceRef,
  type DirRel,
  type Graph,
  type Prerequisite,
  type Relation,
  type RelationOrigin,
} from "@nodestorm/shared";
import { t, type MessageKey } from "../i18n";

/** Pure graph operations. Every function returns a new Graph and never mutates its input. */

export const uid = (prefix: string) =>
  `${prefix}_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`;

/** The stored name of a project's main graph (never shown as is: see graphDisplayName). */
const MAIN_NAME = "Main";

export function emptyGraph(name = MAIN_NAME): Graph {
  return { id: uid("g"), name, nodes: [], relations: [] };
}

/**
 * What a graph is called on screen and in exports: its name, except a main graph stored as "Main" (or unnamed),
 * which is "Main graph" in the interface language. The stored name stays as it is.
 */
export const graphDisplayName = (g: Pick<Graph, "name" | "parentId">) =>
  !g.parentId && (!g.name.trim() || g.name === MAIN_NAME) ? t("toolbar.mainGraph") : g.name;

export interface NewNodeInput {
  name: string;
  definition?: string;
  aliases?: string[];
  position?: { x: number; y: number };
  kind?: ConceptKind | null;
  /** Where the definition came from (an encyclopedia, the AI, a document, or the user). */
  source?: SourceRef;
}

/** A definition the user wrote or edited themselves. */
export const OWN_SOURCE: SourceRef = { site: "you", title: "" };

/**
 * Labels of a prerequisite link: one active label from the dependent ("using", never "is used by"); the prerequisite's
 * side is "none", so the link reads as a single arrow. They are written in the interface language of the moment.
 */
export const DEP_KIND: Record<DepRole, MessageKey> = {
  uses: "rel.dep.uses",
  derives: "rel.dep.derives",
  assumes: "rel.dep.assumes",
};

/** The two directions of a prerequisite link between two names. */
export function depKinds(dependent: string, prereq: string, role: DepRole, reason: string) {
  return {
    aToB: { kind: t(DEP_KIND[role]), explanation: reason },
    bToA: { kind: "none", explanation: t("rel.prereqOf", { prereq, dependent, reason }) },
  };
}

/** What may be typed for "no relation this way", in either interface language: stored as the keyword "none". */
const NONE_WORDS = new Set(["none", "无", "没有", "无关系", "没有关系", "不相关"]);

/** A relation kind as typed by the user, with "none" (or 无, 没有…) turned into the stored keyword "none". */
export const typedKind = (typed: string) => (NONE_WORDS.has(typed.trim().toLowerCase()) ? "none" : typed.trim());

/** Mix looked and found no relation in either direction (both sides "none"). */
export const isUnrelated = (r: Pick<Relation, "aToB" | "bToA">) => r.aToB.kind.trim() === "none" && r.bToA.kind.trim() === "none";

export function depRelation(dependent: ConceptNode, prereq: ConceptNode, role: DepRole, reason: string) {
  return depKinds(dependent.name, prereq.name, role, reason);
}

export function findRelation(g: Graph, x: string, y: string): Relation | undefined {
  return g.relations.find((r) => (r.a === x && r.b === y) || (r.a === y && r.b === x));
}

/**
 * Create or replace the relation between a and b. If one exists in the opposite
 * orientation, the directions are swapped so aToB always means "a does to b".
 */
export function upsertRelation(
  g: Graph,
  a: string,
  b: string,
  aToB: DirRel,
  bToA: DirRel,
  origin: RelationOrigin = "mix",
): Graph {
  const existing = findRelation(g, a, b);
  if (!existing) {
    return { ...g, relations: [...g.relations, { id: uid("r"), a, b, aToB, bToA, origin }] };
  }
  const flipped = existing.a !== a;
  const updated: Relation = {
    ...existing,
    aToB: flipped ? bToA : aToB,
    bToA: flipped ? aToB : bToA,
    // A mixed/derived relation is richer than an automatic dependency link; keep the richer origin.
    origin: origin === "dependency" ? existing.origin : origin,
  };
  return { ...g, relations: g.relations.map((r) => (r.id === existing.id ? updated : r)) };
}

function withStatus(n: ConceptNode): ConceptNode {
  if (n.status === "checking" || n.status === "error" || n.status === "unclear" || n.status === "pending") return n;
  return { ...n, status: n.missingDeps.length ? "blocked" : "ok" };
}

/** Link `dependent` to `prereq`: record dependsOn and add a dependency relation (kept if one exists already). */
export function link(g: Graph, dependentId: string, prereqId: string, role: DepRole, reason: string): Graph {
  const dependent = g.nodes.find((n) => n.id === dependentId)!;
  const prereq = g.nodes.find((n) => n.id === prereqId)!;
  const nodes = g.nodes.map((n) =>
    n.id === dependentId && !n.dependsOn.includes(prereqId) ? { ...n, dependsOn: [...n.dependsOn, prereqId] } : n,
  );
  const rel = depRelation(dependent, prereq, role, reason);
  const g2 = { ...g, nodes };
  return findRelation(g2, dependentId, prereqId) ? g2 : upsertRelation(g2, dependentId, prereqId, rel.aToB, rel.bToA, "dependency");
}

/**
 * Any node waiting on a missing dependency with this node's name (or alias) gets it satisfied.
 * This is what "installing" a node means.
 */
export function satisfyMissing(g: Graph, installedId: string): Graph {
  const installed = g.nodes.find((n) => n.id === installedId);
  if (!installed) return g;
  let out = g;
  for (const n of g.nodes) {
    if (n.id === installedId) continue;
    const hits = n.missingDeps.filter((d) => findByName([installed], d.name));
    if (!hits.length) continue;
    out = {
      ...out,
      nodes: out.nodes.map((m) =>
        m.id === n.id ? withStatus({ ...m, missingDeps: m.missingDeps.filter((d) => !hits.includes(d)) }) : m,
      ),
    };
    for (const d of hits) out = link(out, n.id, installedId, d.role, d.reason);
  }
  return out;
}

export function addNode(g: Graph, input: NewNodeInput): { graph: Graph; id: string; existed: boolean } {
  const dup = findByName(g.nodes, input.name);
  if (dup) return { graph: g, id: dup.id, existed: true };
  const node: ConceptNode = {
    id: uid("n"),
    name: input.name.trim(),
    definition: input.definition?.trim() ?? "",
    aliases: freeAliases(g, null, input.name, input.aliases ?? []),
    status: "checking",
    // The requested position is only a preference: the node goes to the nearest spot that overlaps nothing.
    position: findFreeSpot(g.nodes.map((n) => n.position), input.position ?? defaultPosition(g)),
    dependsOn: [],
    missingDeps: [],
  };
  if (input.kind) node.kind = input.kind;
  if (input.source && node.definition) node.source = input.source;
  const graph = satisfyMissing({ ...g, nodes: [...g.nodes, node] }, node.id);
  return { graph, id: node.id, existed: false };
}

export function defaultPosition(g: Graph) {
  const i = g.nodes.length;
  return { x: 80 + (i % 3) * 360, y: 80 + Math.floor(i / 3) * 240 };
}

type XY = { x: number; y: number };

/** Approximate on-canvas footprint of a concept node (positions are its top-left corner). */
export const NODE_SIZE = { w: 220, h: 110 };
/**
 * Space added to NODE_SIZE between the origins of neighbouring cards, by the layered layout and for a new concept's
 * spot. Taller cards (a kind tag, a name on three lines: up to about 175 high) still keep a real gap.
 */
export const LAYOUT_GAP = { x: 60, y: 90 };

/**
 * The free spot (top-left) closest to `target` where a node overlaps none of `occupied` (other nodes' top-left
 * corners), as far from them as the layered layout's rows and columns. Candidates are tried on rings of growing
 * radius around the target, so the result is (roughly) the nearest.
 */
export function findFreeSpot(occupied: XY[], target: XY, size = NODE_SIZE): XY {
  const w = size.w + LAYOUT_GAP.x;
  const h = size.h + LAYOUT_GAP.y;
  const free = (p: XY) => occupied.every((o) => Math.abs(o.x - p.x) >= w || Math.abs(o.y - p.y) >= h);
  const step = { x: w / 2, y: h / 2 };
  for (let r = 0; r <= 40; r++) {
    const ring: XY[] = [];
    for (let i = -r; i <= r; i++) {
      for (let j = -r; j <= r; j++) {
        if (Math.max(Math.abs(i), Math.abs(j)) !== r) continue;
        ring.push({ x: target.x + i * step.x, y: target.y + j * step.y });
      }
    }
    ring.sort((a, b) => Math.hypot(a.x - target.x, a.y - target.y) - Math.hypot(b.x - target.x, b.y - target.y));
    const hit = ring.find(free);
    if (hit) return hit;
  }
  return target; // absurdly crowded: give up and overlap rather than loop forever
}

/** Move several nodes at once (e.g. after an auto-layout). Unknown ids are ignored. */
export function setPositions(g: Graph, positions: Map<string, XY>): Graph {
  return { ...g, nodes: g.nodes.map((n) => (positions.has(n.id) ? { ...n, position: positions.get(n.id)! } : n)) };
}

/**
 * Apply the AI's prerequisite list to a node: link what exists, record what is missing. A basic concept takes
 * nothing from it (a check started before it was marked basic): it is just settled as checked.
 */
export function applyDeps(g: Graph, nodeId: string, prereqs: Prerequisite[]): Graph {
  const self = g.nodes.find((n) => n.id === nodeId);
  if (!self) return g;
  if (self.basic) return updateNode(g, nodeId, { missingDeps: [], status: "ok", error: undefined });
  const missing: ConceptNode["missingDeps"] = [];
  let out = g;
  for (const p of prereqs) {
    // The concept itself, by its name or an alias (installing that could never satisfy it).
    if (findByName([self], p.name)) continue;
    const others = out.nodes.filter((n) => n.id !== nodeId);
    const match = findByName(others, p.matchesExisting) ?? findByName(others, p.name);
    if (match) out = link(out, nodeId, match.id, p.role, p.reason);
    else if (!missing.some((m) => normalizeName(m.name) === normalizeName(p.name)))
      missing.push({ name: p.name, role: p.role, reason: p.reason });
  }
  return {
    ...out,
    nodes: out.nodes.map((n) =>
      n.id === nodeId ? { ...n, missingDeps: missing, status: missing.length ? "blocked" : "ok", error: undefined } : n,
    ),
  };
}

export function setNodeError(g: Graph, nodeId: string, error: string): Graph {
  return { ...g, nodes: g.nodes.map((n) => (n.id === nodeId ? { ...n, status: "error", error } : n)) };
}

export function updateNode(g: Graph, nodeId: string, patch: Partial<ConceptNode>): Graph {
  const renamed = patch.aliases !== undefined || patch.name !== undefined;
  return {
    ...g,
    nodes: g.nodes.map((n) => {
      if (n.id !== nodeId) return n;
      const next = { ...n, ...patch };
      return settleBasic(renamed ? { ...next, aliases: freeAliases(g, nodeId, next.name, next.aliases) } : next);
    }),
  };
}

/**
 * A concept's aliases that can answer for it: trimmed, not empty, not its own name, not repeated, and not the
 * name or an alias of another concept (so no name ever finds two concepts). A clashing alias is dropped; the
 * concept itself is kept.
 */
export function freeAliases(g: Graph, nodeId: string | null, name: string, aliases: readonly string[]): string[] {
  const others = g.nodes.filter((n) => n.id !== nodeId);
  const seen = new Set([normalizeName(name)]);
  const out: string[] = [];
  for (const raw of aliases) {
    const a = raw.trim();
    const k = normalizeName(a);
    if (!k || seen.has(k) || findByName(others, a)) continue;
    seen.add(k);
    out.push(a);
  }
  return out;
}

/**
 * A basic concept is never blocked and never waits for a prerequisite check ("pending"): it has no missing
 * prerequisites. Running checks, unclear meanings and errors are left alone (they are about its definition).
 */
export function settleBasic(n: ConceptNode): ConceptNode {
  if (!n.basic) return n;
  const status = n.status === "blocked" || n.status === "pending" ? "ok" : n.status;
  return n.missingDeps.length || status !== n.status ? { ...n, missingDeps: [], status } : n;
}

/**
 * Mark a concept as basic (taken as given: no prerequisites needed) or not. Marking drops its missing
 * prerequisites; the links it already has, found by a check or made by hand, stay. Unmarking runs nothing: a
 * concept that was "ok" becomes "not checked" (pending), so "Check prerequisites with AI" finds what it needs.
 */
export function setBasic(g: Graph, nodeId: string, basic: boolean): Graph {
  return {
    ...g,
    nodes: g.nodes.map((n) => {
      if (n.id !== nodeId || Boolean(n.basic) === basic) return n;
      if (basic) return settleBasic({ ...n, basic: true });
      const { basic: _b, ...rest } = n;
      return rest.status === "ok" ? { ...rest, status: "pending" } : rest;
    }),
  };
}

/**
 * Give a node the kind the AI found, unless it already has one: the AI fills a gap, it never overrides a kind the
 * user (or an earlier answer) chose. A null/undefined kind is a no-op.
 */
export function suggestKind(g: Graph, nodeId: string, kind: ConceptKind | null | undefined): Graph {
  const node = g.nodes.find((n) => n.id === nodeId);
  if (!kind || !node || node.kind || node.kindByUser) return g;
  return updateNode(g, nodeId, { kind });
}

/**
 * Set or clear (null) a node's kind. `byUser` (the default) remembers it was a hand choice, so a later AI check
 * doesn't fill a cleared kind back in; a chosen meaning's kind (`byUser: false`) stays open to later suggestions.
 */
export function setKind(g: Graph, nodeId: string, kind: ConceptKind | null, byUser = true): Graph {
  return {
    ...g,
    nodes: g.nodes.map((n) => {
      if (n.id !== nodeId) return n;
      const { kind: _old, kindByUser: _by, ...rest } = n;
      const by = byUser ? { kindByUser: true } : n.kindByUser ? { kindByUser: true } : {};
      return kind ? { ...rest, kind, ...by } : { ...rest, ...by };
    }),
  };
}

export function removeNode(g: Graph, nodeId: string): Graph {
  return {
    ...g,
    nodes: g.nodes.filter((n) => n.id !== nodeId).map((n) => ({ ...n, dependsOn: n.dependsOn.filter((d) => d !== nodeId) })),
    relations: g.relations.filter((r) => r.a !== nodeId && r.b !== nodeId),
  };
}

export function removeRelation(g: Graph, relationId: string): Graph {
  const rel = g.relations.find((r) => r.id === relationId);
  if (!rel) return g;
  return {
    ...g,
    relations: g.relations.filter((r) => r.id !== relationId),
    // Dropping a dependency edge also drops the dependsOn record it represented.
    nodes: g.nodes.map((n) =>
      (n.id === rel.a || n.id === rel.b) ? { ...n, dependsOn: n.dependsOn.filter((d) => d !== rel.a && d !== rel.b) } : n,
    ),
  };
}

/**
 * Drop one direction of a dependency ("dependent no longer needs prereq"), e.g. to break a cycle.
 * The dependency edge goes too, unless it still carries the reverse dependency or a mixed/derived relation.
 */
export function removeDependency(g: Graph, dependentId: string, prereqId: string): Graph {
  const nodes = g.nodes.map((n) => (n.id === dependentId ? { ...n, dependsOn: n.dependsOn.filter((d) => d !== prereqId) } : n));
  const rel = findRelation(g, dependentId, prereqId);
  const out = { ...g, nodes };
  if (!rel || rel.origin !== "dependency") return out;
  const reverse = nodes.find((n) => n.id === prereqId)?.dependsOn.includes(dependentId);
  if (!reverse) return { ...out, relations: g.relations.filter((r) => r.id !== rel.id) };
  if (rel.a === prereqId) return out; // the edge already describes the remaining direction
  // The shared edge described the removed direction; re-describe it for the one that's left.
  const prereq = nodes.find((n) => n.id === prereqId)!;
  const dependent = nodes.find((n) => n.id === dependentId)!;
  const d = depRelation(prereq, dependent, "uses", t("rel.buildsOn", { a: prereq.name, b: dependent.name }));
  const flipped: Relation = { ...rel, a: prereqId, b: dependentId, aToB: d.aToB, bToA: d.bToA };
  return { ...out, relations: g.relations.map((r) => (r.id === rel.id ? flipped : r)) };
}

/**
 * Give `into` the prerequisites of a concept folded into it (`from`: its dependsOn, already pointing at ids that
 * remain, and its missing prerequisites), so the dependency edges that move over still stand for dependsOn records.
 */
export function absorbPrerequisites(into: ConceptNode, from: Pick<ConceptNode, "dependsOn" | "missingDeps">): ConceptNode {
  const dependsOn = [...new Set([...into.dependsOn, ...from.dependsOn])].filter((d) => d !== into.id);
  const missingDeps = [...into.missingDeps];
  for (const d of from.missingDeps) {
    const key = normalizeName(d.name);
    if (findByName([into], d.name) || missingDeps.some((m) => normalizeName(m.name) === key)) continue;
    missingDeps.push(d);
  }
  if (dependsOn.length === into.dependsOn.length && missingDeps.length === into.missingDeps.length) return into;
  return withStatus({ ...into, dependsOn, missingDeps });
}

/**
 * Point everything that referenced `fromId` at `toId` instead, then drop `fromId`. `toId` takes its prerequisites,
 * and its name and aliases as aliases (those free of other concepts', see freeAliases).
 */
export function redirectNode(g: Graph, fromId: string, toId: string): Graph {
  const swap = (id: string) => (id === fromId ? toId : id);
  const relations: Relation[] = [];
  for (const r of g.relations) {
    const moved = { ...r, a: swap(r.a), b: swap(r.b) };
    if (moved.a === moved.b || relations.some((x) => findRelation({ ...g, relations: [x] }, moved.a, moved.b))) continue;
    relations.push(moved);
  }
  const from = g.nodes.find((n) => n.id === fromId);
  const nodes = g.nodes
    .filter((n) => n.id !== fromId)
    .map((n) => {
      const out = { ...n, dependsOn: [...new Set(n.dependsOn.map(swap))].filter((d) => d !== n.id) };
      return n.id === toId && from ? absorbPrerequisites(out, { dependsOn: from.dependsOn.map(swap), missingDeps: from.missingDeps }) : out;
    });
  const into = nodes.find((n) => n.id === toId);
  if (!from || !into) return { ...g, nodes, relations };
  const out = { ...g, nodes, relations };
  const aliases = freeAliases(out, toId, into.name, [...into.aliases, from.name, ...from.aliases]);
  return { ...out, nodes: nodes.map((n) => (n === into ? { ...n, aliases } : n)) };
}

/**
 * Give an ambiguous node the meaning the user picked. The name may become more specific
 * (e.g. "Expectation (probability)"); the original name is kept as an alias. If that meaning is already
 * in the graph, the node is folded into the existing one.
 */
export function applySense(
  g: Graph,
  nodeId: string,
  sense: { name: string; definition: string; source?: SourceRef; kind?: ConceptKind | null },
): { graph: Graph; id: string; merged: boolean } {
  const node = g.nodes.find((n) => n.id === nodeId);
  if (!node) return { graph: g, id: nodeId, merged: false };
  const name = sense.name.trim() || node.name;
  const dup = findByName(g.nodes.filter((n) => n.id !== nodeId), name);
  if (dup) return { graph: satisfyMissing(redirectNode(g, nodeId, dup.id), dup.id), id: dup.id, merged: true };
  const renamed = normalizeName(name) !== normalizeName(node.name);
  const aliases = renamed && !node.aliases.includes(node.name) ? [...node.aliases, node.name] : node.aliases;
  const out = updateNode(g, nodeId, {
    name,
    definition: sense.definition.trim(),
    aliases,
    // A looked-up meaning records where it came from; one the AI or the user wrote has no source.
    source: sense.source,
    senses: undefined,
    status: "checking",
    error: undefined,
  });
  // The chosen meaning's kind replaces one from the old meaning (a picked sense is a user decision).
  const typed = sense.kind ? setKind(out, nodeId, sense.kind, false) : out;
  return { graph: satisfyMissing(typed, nodeId), id: nodeId, merged: false };
}

/** Position for an installed dependency: above the dependent, spread by index. */
export function installPosition(g: Graph, dependentId: string, index: number) {
  const d = g.nodes.find((n) => n.id === dependentId);
  const base = d?.position ?? defaultPosition(g);
  const spot = { x: base.x + (index - 0.5) * 300, y: base.y - 240 };
  // Slide sideways past nodes already there (recursive installs stack whole chains up).
  const taken = (p: { x: number; y: number }) =>
    g.nodes.some((n) => Math.abs(n.position.x - p.x) < 240 && Math.abs(n.position.y - p.y) < 160);
  for (let i = 0; i < 20 && taken(spot); i++) spot.x += 260;
  return spot;
}

// ---------- Hand edits ----------

/**
 * Rename a concept by hand. The old name is kept as an alias, and nodes waiting on a missing dependency
 * with the new name get linked. Empty names and names (or aliases) of other concepts are rejected.
 */
export function renameNode(g: Graph, nodeId: string, rawName: string): { graph: Graph; error?: string } {
  const node = g.nodes.find((n) => n.id === nodeId);
  if (!node) return { graph: g };
  const name = rawName.trim();
  if (!name) return { graph: g, error: t("node.renameEmpty") };
  if (name === node.name) return { graph: g };
  const dup = findByName(g.nodes.filter((n) => n.id !== nodeId), name);
  if (dup) return { graph: g, error: t("node.renameDuplicate", { name: dup.name }) };
  // Old name becomes an alias; the new name itself is never an alias, and aliases stay unique (updateNode).
  return { graph: satisfyMissing(updateNode(g, nodeId, { name, aliases: [...node.aliases, node.name] }), nodeId) };
}

/** Edit one direction of a relation by hand. */
export function updateRelation(g: Graph, relationId: string, dir: "aToB" | "bToA", patch: Partial<DirRel>): Graph {
  if (!g.relations.some((r) => r.id === relationId)) return g;
  return { ...g, relations: g.relations.map((r) => (r.id === relationId ? { ...r, [dir]: { ...r[dir], ...patch } } : r)) };
}

// ---------- Sandboxes ----------

/** Deep-copy a graph as a sandbox. Node/relation ids are kept so merge-back can match them. */
export function fork(g: Graph, name: string): Graph {
  const copy: Graph = structuredClone(g);
  // A check still running for the original only ever updates the original; the copy must not wait for it.
  const nodes = copy.nodes.map((n) =>
    n.status === "checking"
      ? { ...n, status: "error" as const, error: t("task.forkInterrupted") }
      : n,
  );
  return { ...copy, nodes, id: uid("g"), name, parentId: g.id, forkedAt: Date.now() };
}

/**
 * Merge a sandbox into its parent. Sandbox versions win for nodes/relations that exist in both;
 * parent-only content is kept (nothing is deleted from the parent). Concepts both sides added
 * independently (same name or alias) are folded into the parent's, so merging never duplicates them.
 */
export function merge(parent: Graph, sandbox: Graph): Graph {
  const parentIds = new Set(parent.nodes.map((n) => n.id));
  let sb = sandbox;
  // Sandbox concepts folded into a parent twin, by twin id: their prerequisites go to the twin.
  const folded = new Map<string, ConceptNode[]>();
  for (const n of sandbox.nodes) {
    if (parentIds.has(n.id)) continue;
    const twin = findByName(parent.nodes, n.name) ?? n.aliases.map((a) => findByName(parent.nodes, a)).find(Boolean);
    if (!twin) continue;
    sb = redirectNode(sb, n.id, twin.id);
    folded.set(twin.id, [...(folded.get(twin.id) ?? []), n]);
  }
  // Where each folded concept went, to point their prerequisites at what remains.
  const foldedInto = new Map([...folded].flatMap(([to, list]) => list.map((n) => [n.id, to] as const)));

  const nodes = new Map(parent.nodes.map((n) => [n.id, n]));
  for (const n of sb.nodes) {
    // The sandbox is discarded after merging, so a check still running there would never report back.
    if (n.status === "checking") {
      if (!nodes.has(n.id)) nodes.set(n.id, { ...n, status: "error", error: t("task.mergeInterrupted") });
      continue;
    }
    // Quiz progress and stored AI results aren't versioned with the graph: for each, keep whichever side has the
    // newer one (the parent may have got an explanation, anatomy, Mathlib result or papers after the fork).
    const p = nodes.get(n.id);
    if (!p) {
      nodes.set(n.id, n);
      continue;
    }
    const pick = <T,>(mine: T | undefined, theirs: T | undefined, at: (x: T) => number) =>
      !mine ? theirs : !theirs ? mine : at(theirs) >= at(mine) ? theirs : mine;
    nodes.set(n.id, {
      ...n,
      mastery: pick(p.mastery, n.mastery, (m) => m.reviewedAt),
      explanation: pick(p.explanation, n.explanation, (e) => e.createdAt),
      anatomy: pick(p.anatomy, n.anatomy, (a) => a.createdAt),
      formal: pick(p.formal, n.formal, (f) => f.checkedAt),
      papers: pick(p.papers, n.papers, (x) => x.checkedAt),
      // A kind set on the parent after the fork survives a sandbox that never had one, unless the sandbox's kind
      // was picked (or cleared) by hand.
      ...(n.kindByUser ? {} : p.kind && !n.kind ? { kind: p.kind } : {}),
      ...(n.kindByUser || p.kindByUser ? { kindByUser: true } : {}),
    });
  }
  for (const [to, list] of folded) {
    const into = nodes.get(to);
    if (!into) continue;
    let out = into;
    for (const n of list) {
      out = absorbPrerequisites(out, { dependsOn: n.dependsOn.map((d) => foldedInto.get(d) ?? d), missingDeps: n.missingDeps });
      // Its names answer for the twin too (freed of other concepts' below).
      out = { ...out, aliases: [...out.aliases, n.name, ...n.aliases] };
    }
    nodes.set(to, out);
  }
  // Aliases the sandbox brought in (new or edited there, or from a folded concept) that are now another concept's
  // name or alias are dropped: the aliases the parent had win, so no name finds two concepts.
  const sbIds = new Set(sb.nodes.map((n) => n.id));
  const brought = [...nodes.values()].filter((n) => folded.has(n.id) || sbIds.has(n.id));
  const had = new Map(parent.nodes.map((n) => [n.id, new Set(n.aliases.map(normalizeName))]));
  const setAliases = (keep: (n: ConceptNode) => string[]) => {
    for (const n of brought) {
      const now = nodes.get(n.id)!;
      nodes.set(n.id, { ...now, aliases: freeAliases({ ...parent, nodes: [...nodes.values()] }, n.id, n.name, keep(n)) });
    }
  };
  if (brought.length) {
    // First only the aliases each concept had in the parent, then the new ones where still free.
    setAliases((n) => n.aliases.filter((a) => had.get(n.id)?.has(normalizeName(a))));
    setAliases((n) => n.aliases);
  }
  const relations = new Map(parent.relations.map((r) => [r.id, r]));
  for (const r of sb.relations) {
    const samePair = parent.relations.find((p) => p.id !== r.id && ((p.a === r.a && p.b === r.b) || (p.a === r.b && p.b === r.a)));
    if (samePair) continue; // both sides related the same pair: keep the parent's
    relations.set(r.id, r);
  }
  let out: Graph = { ...parent, nodes: [...nodes.values()], relations: [...relations.values()] };
  // A parent-only node might satisfy something the sandbox left missing (or vice versa).
  for (const n of out.nodes) out = satisfyMissing(out, n.id);
  return out;
}
