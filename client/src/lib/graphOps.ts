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
import { t } from "../i18n";

/** Pure graph operations. Every function returns a new Graph and never mutates its input. */

export const uid = (prefix: string) =>
  `${prefix}_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`;

export function emptyGraph(name = "Main"): Graph {
  return { id: uid("g"), name, nodes: [], relations: [] };
}

export interface NewNodeInput {
  name: string;
  definition?: string;
  aliases?: string[];
  position?: { x: number; y: number };
  kind?: ConceptKind | null;
}

const forward: Record<DepRole, string> = {
  uses: "uses definition of",
  derives: "derives",
  assumes: "assumes",
};
const backward: Record<DepRole, string> = {
  uses: "is used by",
  derives: "is derived by",
  assumes: "is assumed by",
};

export function depRelation(dependent: ConceptNode, prereq: ConceptNode, role: DepRole, reason: string) {
  return {
    aToB: { kind: forward[role], explanation: reason },
    bToA: { kind: backward[role], explanation: `${prereq.name} is a prerequisite of ${dependent.name}: ${reason}` },
  };
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
  if (n.status === "checking" || n.status === "error" || n.status === "unclear") return n;
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
    aliases: input.aliases ?? [],
    status: "checking",
    // The requested position is only a preference: the node goes to the nearest spot that overlaps nothing.
    position: findFreeSpot(g.nodes.map((n) => n.position), input.position ?? defaultPosition(g)),
    dependsOn: [],
    missingDeps: [],
  };
  if (input.kind) node.kind = input.kind;
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
const GAP = 40;

/**
 * The free spot (top-left) closest to `target` where a node overlaps none of `occupied` (other nodes' top-left
 * corners). Candidates are tried on rings of growing radius around the target, so the result is (roughly) the nearest.
 */
export function findFreeSpot(occupied: XY[], target: XY, size = NODE_SIZE): XY {
  const w = size.w + GAP;
  const h = size.h + GAP;
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

/** Apply the AI's prerequisite list to a node: link what exists, record what is missing. */
export function applyDeps(g: Graph, nodeId: string, prereqs: Prerequisite[]): Graph {
  const self = g.nodes.find((n) => n.id === nodeId);
  if (!self) return g;
  const selfKey = normalizeName(self.name);
  const missing: ConceptNode["missingDeps"] = [];
  let out = g;
  for (const p of prereqs) {
    if (normalizeName(p.name) === selfKey) continue;
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
  return { ...g, nodes: g.nodes.map((n) => (n.id === nodeId ? { ...n, ...patch } : n)) };
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
  const d = depRelation(prereq, dependent, "uses", `${prereq.name} builds on ${dependent.name}.`);
  const flipped: Relation = { ...rel, a: prereqId, b: dependentId, aToB: d.aToB, bToA: d.bToA };
  return { ...out, relations: g.relations.map((r) => (r.id === rel.id ? flipped : r)) };
}

/** Point everything that referenced `fromId` at `toId` instead, then drop `fromId`. */
export function redirectNode(g: Graph, fromId: string, toId: string): Graph {
  const swap = (id: string) => (id === fromId ? toId : id);
  const relations: Relation[] = [];
  for (const r of g.relations) {
    const moved = { ...r, a: swap(r.a), b: swap(r.b) };
    if (moved.a === moved.b || relations.some((x) => findRelation({ ...g, relations: [x] }, moved.a, moved.b))) continue;
    relations.push(moved);
  }
  const nodes = g.nodes
    .filter((n) => n.id !== fromId)
    .map((n) => ({ ...n, dependsOn: [...new Set(n.dependsOn.map(swap))].filter((d) => d !== n.id) }));
  return { ...g, nodes, relations };
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
  // Old name becomes an alias; the new name itself is never an alias, and aliases stay unique.
  const aliases: string[] = [];
  for (const a of [...node.aliases, node.name]) {
    const k = normalizeName(a);
    if (k !== normalizeName(name) && !aliases.some((b) => normalizeName(b) === k)) aliases.push(a);
  }
  return { graph: satisfyMissing(updateNode(g, nodeId, { name, aliases }), nodeId) };
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
  for (const n of sandbox.nodes) {
    if (parentIds.has(n.id)) continue;
    const twin = findByName(parent.nodes, n.name) ?? n.aliases.map((a) => findByName(parent.nodes, a)).find(Boolean);
    if (twin) sb = redirectNode(sb, n.id, twin.id);
  }

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
