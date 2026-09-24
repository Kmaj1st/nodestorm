import {
  CancelledError,
  findByName,
  toBrief,
  type DerivedProposal,
  type Graph,
  type NameCandidate,
  type Sense,
} from "@nodestorm/shared";
import { useGraphStore } from "../store/graphStore";
import { useSettings } from "../store/settingsStore";
import { api, NeedsSetupError } from "./api";
import * as ops from "./graphOps";

/**
 * Async flows that combine AI calls with graph mutations. Each binds to the graph it started in.
 * AI progress and results of a concept check are "background" mutations: they are not undo steps, and they
 * also land in the undo snapshots, so undo/redo keeps what the AI found (see MutateOptions).
 */

const store = () => useGraphStore.getState();
const graph = (id: string) => store().graphs[id];

/** Report an AI failure; a missing key opens Settings instead of just complaining. */
function reportError(e: unknown, prefix = "") {
  if (e instanceof NeedsSetupError) store().setSettingsOpen(true);
  store().setToast(prefix + (e instanceof Error ? e.message : String(e)));
}

const controllers = new Map<string, AbortController>();

/** Cancel a running AI task (status-bar ✕, dialog Cancel). */
export function cancelTask(key: string) {
  controllers.get(key)?.abort();
}

interface BusyHandlers {
  onError?: (e: unknown) => void;
  onCancel?: () => void;
}

/**
 * Run an AI call as a visible, cancellable task. Returns undefined when it failed or was cancelled
 * (the handlers decide what the user sees; by default errors become a toast and cancels are silent).
 */
async function withBusy<T>(
  key: string,
  label: string,
  fn: (signal: AbortSignal) => Promise<T>,
  handlers: BusyHandlers = {},
): Promise<T | undefined> {
  controllers.get(key)?.abort(); // a newer run of the same task supersedes the old one
  const ctrl = new AbortController();
  controllers.set(key, ctrl);
  store().setBusy(key, label);
  try {
    return await fn(ctrl.signal);
  } catch (e) {
    if (e instanceof CancelledError || ctrl.signal.aborted) handlers.onCancel?.();
    else if (handlers.onError) handlers.onError(e);
    else reportError(e);
    return undefined;
  } finally {
    if (controllers.get(key) === ctrl) {
      controllers.delete(key);
      store().setBusy(key, null);
    }
  }
}

const analyzeKey = (graphId: string, nodeId: string) => `analyze:${graphId}:${nodeId}`;

/**
 * Work out a node: if it has no definition, ask the AI what the name means (and let the user pick when
 * it is ambiguous); then check its prerequisites. Also used for "Retry" and "Re-check".
 */
export async function analyzeNode(nodeId: string, graphId = store().activeId, hint?: string) {
  const find = () => graph(graphId)?.nodes.find((n) => n.id === nodeId);
  const node = find();
  if (!node) return;
  const key = analyzeKey(graphId, nodeId);
  const bg = (fn: (g: Graph) => Graph) => store().mutate(fn, graphId, { history: "background" });
  const set = (patch: Parameters<typeof ops.updateNode>[2]) => bg((g) => ops.updateNode(g, nodeId, patch));
  // Results are applied even if the node was deleted meanwhile: that is a no-op now, but undoing the delete
  // brings the node back with the result instead of a spinner that never stops.
  const handlers: BusyHandlers = {
    onError: (e) => {
      const msg = e instanceof Error ? e.message : String(e);
      bg((g) => ops.setNodeError(g, nodeId, msg));
      reportError(e, `${node.name}: `);
    },
    onCancel: () => bg((g) => ops.setNodeError(g, nodeId, "Check cancelled. Retry to run it again.")),
  };
  set({ status: "checking", error: undefined });

  const clarify = useSettings.getState().clarify;
  if (!node.definition.trim() && clarify.enabled) {
    const g = graph(graphId);
    const res = await withBusy(
      key,
      `Working out what “${node.name}” means…`,
      (signal) =>
        api.clarify(
          { name: node.name, hint, context: g.nodes.filter((n) => n.id !== nodeId).map(toBrief), count: clarify.options },
          signal,
        ),
      handlers,
    );
    if (!res) return;
    if (res.ambiguous) {
      set({ status: "unclear", senses: res.senses });
      if (!find()) return;
      store().setClarifying({ graphId, nodeId });
      return; // continues in chooseSense once the user picks a meaning
    }
    if (res.senses[0]?.definition) set({ definition: res.senses[0].definition });
  }

  const current = find();
  if (!current) return;
  const g = graph(graphId);
  const res = await withBusy(
    key,
    `Checking prerequisites of ${current.name}…`,
    (signal) =>
      api.deps({ node: toBrief(current), existing: g.nodes.filter((n) => n.id !== nodeId).map(toBrief) }, signal),
    handlers,
  );
  if (res) bg((g) => ops.applyDeps(g, nodeId, res.prerequisites));
}

/** The user picked (or wrote) a meaning for an ambiguous node. */
export function chooseSense(graphId: string, nodeId: string, sense: Pick<Sense, "name" | "definition">) {
  let id = nodeId;
  let merged = false;
  store().mutate((g) => {
    const r = ops.applySense(g, nodeId, sense);
    id = r.id;
    merged = r.merged;
    return r.graph;
  }, graphId);
  store().setClarifying(null);
  store().setInspect({ kind: "node", id });
  if (merged) store().setToast(`“${sense.name}” is already in the graph — linked to the existing concept.`);
  else void analyzeNode(id, graphId);
}

export function addConcept(input: ops.NewNodeInput, graphId = store().activeId, hint?: string): string {
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
    void analyzeNode(id, graphId, hint);
  }
  store().setInspect({ kind: "node", id });
  return id;
}

export function suggestNames(description: string) {
  const g = graph(store().activeId);
  return withBusy("name", "Finding a name…", (signal) =>
    api.name({ description, context: g.nodes.map(toBrief) }, signal).then((r) => r.candidates),
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
  const dep = dependent?.missingDeps.find((d) => d.name === depName);
  const index = dependent?.missingDeps.indexOf(dep!) ?? 0;
  // The dependent tells the AI which meaning is meant, so installs rarely need a "what do you mean?".
  const hint = dependent && dep ? `Needed by "${dependent.name}" (${dep.role}): ${dep.reason}` : undefined;
  const id = addConcept({ name: depName, position: ops.installPosition(g, dependentId, index) }, graphId, hint);
  // If the concept already existed under this name, addNode didn't run satisfyMissing for it.
  // Folded into the add's undo step when there was one.
  const history = g.nodes.some((n) => n.id === id) ? "step" : "merge";
  store().mutate((g) => ops.satisfyMissing(g, id), graphId, { history });
  store().setInspect({ kind: "node", id: dependentId });
  return id;
}

export async function mix(aId: string, bId: string) {
  const graphId = store().activeId;
  const g = graph(graphId);
  const a = g.nodes.find((n) => n.id === aId);
  const b = g.nodes.find((n) => n.id === bId);
  if (!a || !b) return;
  const res = await withBusy(`mix:${aId}:${bId}`, `Relating ${a.name} ⇄ ${b.name}…`, (signal) =>
    api.relate({ a: toBrief(a), b: toBrief(b) }, signal),
  );
  if (!res) return;
  // The user asked for this relation, so it is an undo step (skipped if either end was deleted meanwhile).
  const both = (g: Graph) => g.nodes.some((n) => n.id === aId) && g.nodes.some((n) => n.id === bId);
  store().mutate((g) => (both(g) ? ops.upsertRelation(g, aId, bId, res.aToB, res.bToA, "mix") : g), graphId);
  const rel = ops.findRelation(graph(graphId), aId, bId);
  if (rel) store().setInspect({ kind: "edge", relationId: rel.id, dir: rel.a === aId ? "aToB" : "bToA" });
}

export function derive(selectedIds: string[], goal?: string) {
  const g = graph(store().activeId);
  const selected = g.nodes.filter((n) => selectedIds.includes(n.id));
  return withBusy("derive", "Deriving…", (signal) =>
    api.derive({ selected: selected.map(toBrief), context: g.nodes.map(toBrief), goal }, signal).then((r) => r.proposals),
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
  }, graphId, { history: g.nodes.some((n) => n.id === id) ? "step" : "merge" }); // one undo step with the add
  return id;
}
