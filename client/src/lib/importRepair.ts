import {
  DepRole,
  GraphExport,
  NodeExplanation,
  NodeStatus,
  RelationOrigin,
  type ConceptNode,
  type DirRel,
  type Graph,
  type MissingDep,
  type Relation,
  type Sense,
} from "@nodestorm/shared";
import { uid } from "./graphOps";

/**
 * Turn whatever an imported file contains into a valid GraphExport. Files from older/newer versions
 * or hand-edited ones may miss fields, carry unknown values or reference nodes that no longer exist;
 * instead of rejecting them we fill defaults, drop what can't be salvaged and report every fix.
 * Throws only when nothing graph-like is found at all.
 */
export function repairImport(raw: unknown): { doc: GraphExport; fixes: string[] } {
  const fixes = new Fixes();
  let list: unknown[];
  if (Array.isArray(raw)) {
    list = raw;
    fixes.add("wrapped a bare list of graphs");
  } else if (isObj(raw) && Array.isArray(raw.graphs)) {
    list = raw.graphs;
    if (raw.format !== "nodestorm/v1") fixes.add(`read ${typeof raw.format === "string" ? `format "${raw.format}"` : "a file without a format tag"} as nodestorm/v1`);
  } else if (isObj(raw) && Array.isArray(raw.nodes)) {
    list = [raw];
    fixes.add("wrapped a single graph");
  } else {
    throw new Error("Not a NodeStorm file (no graphs found)");
  }

  const graphs: Graph[] = [];
  const seen = new Set<string>();
  for (const g of list) {
    if (!isObj(g)) { fixes.add("dropped an entry that isn't a graph"); continue; }
    const graph = repairGraph(g, fixes);
    if (seen.has(graph.id)) { fixes.add("dropped a graph with a duplicate id"); continue; }
    seen.add(graph.id);
    graphs.push(graph);
  }
  if (!graphs.length) throw new Error("File contains no graphs");

  // Exactly one root: the first graph without a (valid) parent. Sandboxes of missing graphs hang off it.
  const main = graphs.find((g) => !g.parentId) ?? graphs[0];
  if (main.parentId) { delete main.parentId; fixes.add("made the first sandbox the main graph (no main graph found)"); }
  for (const g of graphs) {
    if (g !== main && g.parentId && (!seen.has(g.parentId) || g.parentId === g.id)) {
      g.parentId = main.id;
      fixes.add("re-attached a sandbox whose parent graph is missing to the main graph");
    }
  }
  // Keep the main graph first, as exportJson does.
  const ordered = [main, ...graphs.filter((g) => g !== main)];
  return { doc: GraphExport.parse({ format: "nodestorm/v1", graphs: ordered }), fixes: fixes.list() };
}

function repairGraph(g: Record<string, unknown>, fixes: Fixes): Graph {
  const nodes: ConceptNode[] = [];
  const ids = new Set<string>();
  const rawNodes = Array.isArray(g.nodes) ? g.nodes : [];
  rawNodes.forEach((n, i) => {
    const node = repairNode(n, i, fixes);
    if (!node) return;
    if (ids.has(node.id)) { fixes.add("dropped a concept with a duplicate id"); return; }
    ids.add(node.id);
    nodes.push(node);
  });
  for (const n of nodes) {
    const kept = n.dependsOn.filter((d) => ids.has(d) && d !== n.id);
    if (kept.length !== n.dependsOn.length) fixes.add("dropped prerequisite links to missing concepts", n.dependsOn.length - kept.length);
    n.dependsOn = [...new Set(kept)];
  }

  const relations: Relation[] = [];
  const relIds = new Set<string>();
  for (const r of Array.isArray(g.relations) ? g.relations : []) {
    if (!isObj(r) || typeof r.a !== "string" || typeof r.b !== "string" || !ids.has(r.a) || !ids.has(r.b) || r.a === r.b) {
      fixes.add("dropped relations pointing to missing concepts");
      continue;
    }
    let id = str(r.id);
    if (!id || relIds.has(id)) { if (id) fixes.add("renamed a duplicate relation id"); id = uid("r"); }
    relIds.add(id);
    const origin = RelationOrigin.safeParse(r.origin);
    if (r.origin !== undefined && !origin.success) fixes.add("reset an unknown relation origin to “mix”");
    relations.push({
      id,
      a: r.a,
      b: r.b,
      aToB: dirRel(r.aToB, fixes),
      bToA: dirRel(r.bToA, fixes),
      origin: origin.success ? origin.data : "mix",
    });
  }

  const graph: Graph = {
    id: str(g.id) || uid("g"),
    name: str(g.name) || "Imported graph",
    nodes,
    relations,
  };
  if (typeof g.parentId === "string" && g.parentId) graph.parentId = g.parentId;
  if (typeof g.forkedAt === "number" && Number.isFinite(g.forkedAt)) graph.forkedAt = g.forkedAt;
  return graph;
}

function repairNode(n: unknown, index: number, fixes: Fixes): ConceptNode | null {
  if (!isObj(n) || !str(n.name).trim()) { fixes.add("dropped concepts without a name"); return null; }
  let status = NodeStatus.safeParse(n.status).success ? (n.status as NodeStatus) : "ok";
  if (n.status !== undefined && status !== n.status) fixes.add("reset unknown concept statuses to “ok”");
  let error = typeof n.error === "string" ? n.error : undefined;
  if (status === "checking") {
    // Like reload: a check can't be resumed from a file.
    status = "error";
    error = "The check was interrupted before export. Retry to run it again.";
  }
  const pos = isObj(n.position) && num(n.position.x) && num(n.position.y) ? { x: n.position.x, y: n.position.y } : null;
  if (!pos) fixes.add("placed concepts that had no position");
  const missingDeps: MissingDep[] = (Array.isArray(n.missingDeps) ? n.missingDeps : []).flatMap((d) =>
    isObj(d) && str(d.name)
      ? [{ name: str(d.name), reason: str(d.reason), role: DepRole.safeParse(d.role).success ? (d.role as DepRole) : "uses" }]
      : [],
  );
  const senses: Sense[] | undefined = Array.isArray(n.senses)
    ? n.senses.flatMap((s) => (isObj(s) && str(s.name) ? [{ name: str(s.name), domain: str(s.domain), definition: str(s.definition) }] : []))
    : undefined;
  const node: ConceptNode = {
    id: str(n.id) || uid("n"),
    name: str(n.name),
    definition: str(n.definition),
    aliases: Array.isArray(n.aliases) ? n.aliases.filter((a): a is string => typeof a === "string") : [],
    status,
    position: pos ?? { x: 80 + (index % 5) * 240, y: 80 + Math.floor(index / 5) * 160 },
    dependsOn: Array.isArray(n.dependsOn) ? n.dependsOn.filter((d): d is string => typeof d === "string") : [],
    missingDeps,
  };
  if (error) node.error = error;
  if (senses?.length) node.senses = senses;
  if (n.explanation !== undefined) {
    const ex = NodeExplanation.safeParse(n.explanation);
    if (ex.success) node.explanation = ex.data;
    else fixes.add("dropped malformed explanations");
  }
  if (typeof n.notes === "string") {
    if (n.notes) node.notes = n.notes;
  } else if (n.notes !== undefined) fixes.add("dropped notes that aren't text");
  // Nothing left to block on / choose from: don't leave the node stuck.
  if (node.status === "blocked" && !missingDeps.length) node.status = "ok";
  if (node.status === "unclear" && !node.senses) node.status = "ok";
  return node;
}

function dirRel(d: unknown, fixes: Fixes): DirRel {
  if (isObj(d) && typeof d.kind === "string") return { kind: d.kind, explanation: str(d.explanation) };
  fixes.add("filled in missing relation directions");
  return { kind: "relates to", explanation: "" };
}

/** Counts each kind of fix so the summary reads "dropped 3 relations…" rather than listing each one. */
class Fixes {
  private counts = new Map<string, number>();
  add(msg: string, n = 1) {
    this.counts.set(msg, (this.counts.get(msg) ?? 0) + n);
  }
  list(): string[] {
    return [...this.counts].map(([msg, n]) => (n > 1 ? `${msg} (×${n})` : msg));
  }
}

const isObj = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);
const str = (v: unknown): string => (typeof v === "string" ? v : "");
const num = (v: unknown): v is number => typeof v === "number" && Number.isFinite(v);
