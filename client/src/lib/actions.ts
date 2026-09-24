import { findByName, toBrief, type DerivedProposal, type NameCandidate } from "@nodestorm/shared";
import { useGraphStore } from "../store/graphStore";
import { api, NeedsSetupError } from "./api";
import * as ops from "./graphOps";

/** Async flows that combine AI calls with graph mutations. Each binds to the graph it started in. */

const store = () => useGraphStore.getState();
const graph = (id: string) => store().graphs[id];

/** Report an AI failure; a missing key opens Settings instead of just complaining. */
function reportError(e: unknown, prefix = "") {
  if (e instanceof NeedsSetupError) store().setSettingsOpen(true);
  store().setToast(prefix + (e instanceof Error ? e.message : String(e)));
}

async function withBusy<T>(key: string, label: string, fn: () => Promise<T>): Promise<T | undefined> {
  store().setBusy(key, label);
  try {
    return await fn();
  } catch (e) {
    reportError(e);
    return undefined;
  } finally {
    store().setBusy(key, null);
  }
}

export async function checkDeps(nodeId: string, graphId = store().activeId) {
  const g = graph(graphId);
  const node = g?.nodes.find((n) => n.id === nodeId);
  if (!node) return;
  store().mutate((g) => ops.updateNode(g, nodeId, { status: "checking", error: undefined }), graphId);
  try {
    const res = await api.deps({
      node: toBrief(node),
      existing: g.nodes.filter((n) => n.id !== nodeId).map(toBrief),
    });
    store().mutate((g) => ops.applyDeps(g, nodeId, res.prerequisites), graphId);
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    store().mutate((g) => ops.setNodeError(g, nodeId, msg), graphId);
    reportError(e, "Dependency check failed: ");
  }
}

export function addConcept(input: ops.NewNodeInput, graphId = store().activeId): string {
  let id = "";
  let existed = false;
  store().mutate((g) => {
    const r = ops.addNode(g, input);
    id = r.id;
    existed = r.existed;
    return r.graph;
  }, graphId);
  if (existed) {
    store().setToast(`"${input.name}" is already in the graph`);
  } else {
    void checkDeps(id, graphId);
  }
  store().setInspect({ kind: "node", id });
  return id;
}

export function suggestNames(description: string) {
  const g = graph(store().activeId);
  return withBusy("name", "Finding a name…", () =>
    api.name({ description, context: g.nodes.map(toBrief) }).then((r) => r.candidates),
  );
}

export function addCandidate(c: NameCandidate) {
  return addConcept({ name: c.name, definition: c.definition, aliases: c.aliases });
}

/** "Install" a missing dependency: create it near the dependent node, which satisfies the dependency. */
export function installDep(dependentId: string, depName: string) {
  const graphId = store().activeId;
  const g = graph(graphId);
  const dependent = g.nodes.find((n) => n.id === dependentId);
  const index = dependent?.missingDeps.findIndex((d) => d.name === depName) ?? 0;
  const id = addConcept({ name: depName, position: ops.installPosition(g, dependentId, index) }, graphId);
  // If the concept already existed under this name, addNode didn't run satisfyMissing for it.
  store().mutate((g) => ops.satisfyMissing(g, id), graphId);
  store().setInspect({ kind: "node", id: dependentId });
  return id;
}

export async function mix(aId: string, bId: string) {
  const graphId = store().activeId;
  const g = graph(graphId);
  const a = g.nodes.find((n) => n.id === aId);
  const b = g.nodes.find((n) => n.id === bId);
  if (!a || !b) return;
  const res = await withBusy(`mix:${aId}:${bId}`, `Relating ${a.name} ⇄ ${b.name}…`, () =>
    api.relate({ a: toBrief(a), b: toBrief(b) }),
  );
  if (!res) return;
  store().mutate((g) => ops.upsertRelation(g, aId, bId, res.aToB, res.bToA, "mix"), graphId);
  const rel = ops.findRelation(graph(graphId), aId, bId);
  if (rel) store().setInspect({ kind: "edge", relationId: rel.id, dir: rel.a === aId ? "aToB" : "bToA" });
}

export function derive(selectedIds: string[], goal?: string) {
  const g = graph(store().activeId);
  const selected = g.nodes.filter((n) => selectedIds.includes(n.id));
  return withBusy("derive", "Deriving…", () =>
    api.derive({ selected: selected.map(toBrief), context: g.nodes.map(toBrief), goal }).then((r) => r.proposals),
  );
}

export function acceptProposal(p: DerivedProposal, anchorIds: string[]) {
  const graphId = store().activeId;
  const g = graph(graphId);
  const anchors = g.nodes.filter((n) => anchorIds.includes(n.id));
  const cx = anchors.reduce((s, n) => s + n.position.x, 0) / Math.max(anchors.length, 1);
  const cy = Math.max(...anchors.map((n) => n.position.y), 0);
  const id = addConcept(
    { name: p.name, definition: p.definition, aliases: p.aliases, position: { x: cx + (Math.random() - 0.5) * 120, y: cy + 200 } },
    graphId,
  );
  store().mutate((g) => {
    let out = g;
    for (const l of p.links) {
      const target = findByName(g.nodes, l.to);
      if (target && target.id !== id) out = ops.upsertRelation(out, id, target.id, l.fromNew, l.toNew, "derive");
    }
    return out;
  }, graphId);
  return id;
}
