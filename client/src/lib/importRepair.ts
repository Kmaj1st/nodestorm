import {
  ConceptKind,
  DepRole,
  GraphExport,
  Mastery,
  SourceRef,
  NodeFormal,
  NodePapers,
  NodeAnatomy,
  ExplainVoice,
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
import { t } from "../i18n";
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
    fixes.add(t("repair.wrappedList"));
  } else if (isObj(raw) && Array.isArray(raw.graphs)) {
    list = raw.graphs;
    if (raw.format !== "nodestorm/v1") fixes.add(typeof raw.format === "string" ? t("repair.readFormat", { format: raw.format }) : t("repair.readUntagged"));
  } else if (isObj(raw) && Array.isArray(raw.nodes)) {
    list = [raw];
    fixes.add(t("repair.wrappedGraph"));
  } else {
    throw new Error(t("file.notNodestorm"));
  }

  const graphs: Graph[] = [];
  const seen = new Set<string>();
  for (const g of list) {
    if (!isObj(g)) { fixes.add(t("repair.droppedNonGraph")); continue; }
    const graph = repairGraph(g, fixes);
    if (seen.has(graph.id)) { fixes.add(t("repair.droppedDupGraph")); continue; }
    seen.add(graph.id);
    graphs.push(graph);
  }
  if (!graphs.length) throw new Error(t("file.noGraphs"));

  // Exactly one root: the first graph without a (valid) parent. Sandboxes of missing graphs hang off it.
  const main = graphs.find((g) => !g.parentId) ?? graphs[0];
  if (main.parentId) { delete main.parentId; fixes.add(t("repair.madeMain")); }
  for (const g of graphs) {
    if (g !== main && g.parentId && (!seen.has(g.parentId) || g.parentId === g.id)) {
      g.parentId = main.id;
      fixes.add(t("repair.reattached"));
    }
  }
  // Keep the main graph first, as exportJson does.
  const ordered = [main, ...graphs.filter((g) => g !== main)];
  // The project name is optional (files from before projects have none); a malformed one is just ignored.
  const name = isObj(raw) && isObj(raw.project) && typeof raw.project.name === "string" ? raw.project.name.trim() : "";
  const project = name ? { project: { name } } : {};
  return { doc: GraphExport.parse({ format: "nodestorm/v1", ...project, graphs: ordered }), fixes: fixes.list() };
}

function repairGraph(g: Record<string, unknown>, fixes: Fixes): Graph {
  const nodes: ConceptNode[] = [];
  const ids = new Set<string>();
  const rawNodes = Array.isArray(g.nodes) ? g.nodes : [];
  rawNodes.forEach((n, i) => {
    const node = repairNode(n, i, fixes);
    if (!node) return;
    if (ids.has(node.id)) { fixes.add(t("repair.droppedDupConcept")); return; }
    ids.add(node.id);
    nodes.push(node);
  });
  for (const n of nodes) {
    const kept = n.dependsOn.filter((d) => ids.has(d) && d !== n.id);
    if (kept.length !== n.dependsOn.length) fixes.add(t("repair.droppedDeps"), n.dependsOn.length - kept.length);
    n.dependsOn = [...new Set(kept)];
  }

  const relations: Relation[] = [];
  const relIds = new Set<string>();
  for (const r of Array.isArray(g.relations) ? g.relations : []) {
    if (!isObj(r) || typeof r.a !== "string" || typeof r.b !== "string" || !ids.has(r.a) || !ids.has(r.b) || r.a === r.b) {
      fixes.add(t("repair.droppedRelations"));
      continue;
    }
    let id = str(r.id);
    if (!id || relIds.has(id)) { if (id) fixes.add(t("repair.renamedRelation")); id = uid("r"); }
    relIds.add(id);
    const origin = RelationOrigin.safeParse(r.origin);
    if (r.origin !== undefined && !origin.success) fixes.add(t("repair.resetOrigin"));
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
    name: str(g.name) || t("repair.importedGraph"),
    nodes,
    relations,
  };
  if (typeof g.parentId === "string" && g.parentId) graph.parentId = g.parentId;
  if (typeof g.forkedAt === "number" && Number.isFinite(g.forkedAt)) graph.forkedAt = g.forkedAt;
  return graph;
}

function repairNode(n: unknown, index: number, fixes: Fixes): ConceptNode | null {
  if (!isObj(n) || !str(n.name).trim()) { fixes.add(t("repair.droppedNameless")); return null; }
  let status = NodeStatus.safeParse(n.status).success ? (n.status as NodeStatus) : "ok";
  if (n.status !== undefined && status !== n.status) fixes.add(t("repair.resetStatus"));
  let error = typeof n.error === "string" ? n.error : undefined;
  if (status === "checking") {
    // Like reload: a check can't be resumed from a file.
    status = "error";
    error = t("repair.interrupted");
  }
  const pos = isObj(n.position) && num(n.position.x) && num(n.position.y) ? { x: n.position.x, y: n.position.y } : null;
  if (!pos) fixes.add(t("repair.placed"));
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
    let raw = n.explanation;
    // A narrator this version doesn't know (or a malformed one) falls back to the plain voice; the text is kept.
    if (isObj(raw) && raw.voice !== undefined && !ExplainVoice.safeParse(raw.voice).success) {
      const { voice: _unknown, ...rest } = raw;
      raw = rest;
      fixes.add(t("repair.resetVoices"));
    }
    const ex = NodeExplanation.safeParse(raw);
    if (ex.success) node.explanation = ex.data;
    else fixes.add(t("repair.droppedExplanations"));
  }
  if (typeof n.notes === "string") {
    if (n.notes) node.notes = n.notes;
  } else if (n.notes !== undefined) fixes.add(t("repair.droppedNotes"));
  if (n.formal !== undefined) {
    const f = NodeFormal.safeParse(n.formal);
    if (f.success) node.formal = f.data;
    else fixes.add(t("repair.droppedFormal"));
  }
  if (n.papers !== undefined) {
    const p = NodePapers.safeParse(n.papers);
    if (p.success) node.papers = p.data;
    else fixes.add(t("repair.droppedPapers"));
  }
  if (n.source !== undefined) {
    const src = SourceRef.safeParse(n.source);
    if (src.success) node.source = src.data;
    else fixes.add(t("repair.droppedSource"));
  }
  if (n.kind !== undefined && n.kind !== null) {
    // Older files have no kind; a file edited by hand may say "Theorem" or something unknown.
    const kind = ConceptKind.safeParse(typeof n.kind === "string" ? n.kind.trim().toLowerCase() : n.kind);
    if (kind.success) node.kind = kind.data;
    else fixes.add(t("repair.droppedKind"));
  }
  if (n.anatomy !== undefined) {
    const an = NodeAnatomy.safeParse(n.anatomy);
    if (an.success) node.anatomy = an.data;
    else fixes.add(t("repair.droppedAnatomy"));
  }
  if (n.mastery !== undefined) {
    const m = Mastery.safeParse(n.mastery);
    if (m.success) node.mastery = m.data;
    else fixes.add(t("repair.droppedMastery"));
  }
  // Nothing left to block on / choose from: don't leave the node stuck.
  if (node.status === "blocked" && !missingDeps.length) node.status = "ok";
  if (node.status === "unclear" && !node.senses) node.status = "ok";
  return node;
}

function dirRel(d: unknown, fixes: Fixes): DirRel {
  if (isObj(d) && typeof d.kind === "string") return { kind: d.kind, explanation: str(d.explanation) };
  fixes.add(t("repair.filledDirections"));
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
