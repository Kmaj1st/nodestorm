import {
  findByName,
  normalizeName,
  type ConceptNode,
  type DepRole,
  type DirRel,
  type Graph,
  type Prerequisite,
  type Relation,
  type RelationOrigin,
} from "@nodestorm/shared";

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
  if (n.status === "checking" || n.status === "error") return n;
  return { ...n, status: n.missingDeps.length ? "blocked" : "ok" };
}

/** Link `dependent` to `prereq`: record dependsOn and add a dependency relation. */
function link(g: Graph, dependentId: string, prereqId: string, role: DepRole, reason: string): Graph {
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
    position: input.position ?? defaultPosition(g),
    dependsOn: [],
    missingDeps: [],
  };
  const graph = satisfyMissing({ ...g, nodes: [...g.nodes, node] }, node.id);
  return { graph, id: node.id, existed: false };
}

export function defaultPosition(g: Graph) {
  const i = g.nodes.length;
  return { x: 80 + (i % 3) * 360, y: 80 + Math.floor(i / 3) * 240 };
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

/** Position for an installed dependency: above the dependent, spread by index. */
export function installPosition(g: Graph, dependentId: string, index: number) {
  const d = g.nodes.find((n) => n.id === dependentId);
  const base = d?.position ?? defaultPosition(g);
  return { x: base.x + (index - 0.5) * 300, y: base.y - 240 };
}

// ---------- Sandboxes ----------

/** Deep-copy a graph as a sandbox. Node/relation ids are kept so merge-back can match them. */
export function fork(g: Graph, name: string): Graph {
  const copy: Graph = structuredClone(g);
  return { ...copy, id: uid("g"), name, parentId: g.id, forkedAt: Date.now() };
}

/**
 * Merge a sandbox into its parent. Sandbox versions win for nodes/relations that exist in both;
 * parent-only content is kept (nothing is deleted from the parent).
 */
export function merge(parent: Graph, sandbox: Graph): Graph {
  const nodes = new Map(parent.nodes.map((n) => [n.id, n]));
  for (const n of sandbox.nodes) nodes.set(n.id, n);
  const relations = new Map(parent.relations.map((r) => [r.id, r]));
  for (const r of sandbox.relations) relations.set(r.id, r);
  let out: Graph = { ...parent, nodes: [...nodes.values()], relations: [...relations.values()] };
  // A parent-only node might satisfy something the sandbox left missing (or vice versa).
  for (const n of out.nodes) out = satisfyMissing(out, n.id);
  return out;
}
