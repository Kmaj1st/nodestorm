import {
  CancelledError,
  findByName,
  toBrief,
  type DerivedProposal,
  type ExplainLevel,
  type Graph,
  type NameCandidate,
  type Sense,
} from "@nodestorm/shared";
import { t } from "../i18n";
import { useGraphStore } from "../store/graphStore";
import { useSettings } from "../store/settingsStore";
import { api, NeedsSetupError } from "./api";
import { applyExtraction, type ExtractReview } from "./extract";
import * as ops from "./graphOps";
import { layeredLayout } from "./layout";
import { viewport } from "./viewport";
import * as paths from "./paths";

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

/**
 * The shared-graph viewer never calls the AI (the link's recipient may not have, or want to spend, a key).
 * Only calls for that graph are refused: work still running on the user's own graphs carries on.
 */
function inViewer(graphId: string): boolean {
  if (graphId !== store().view?.id) return false;
  store().setToast(t("api.viewer"), "info");
  return true;
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
  store().setBusy(key, null); // restart the clock if this superseded an older run
  store().setBusy(key, label, ctrl.signal);
  try {
    const res = await fn(ctrl.signal);
    // An answer that arrives after the user cancelled is dropped, like one that never came.
    if (ctrl.signal.aborted) throw new CancelledError();
    return res;
  } catch (e) {
    if (e instanceof CancelledError || ctrl.signal.aborted) {
      // Superseded by a newer run of the same task: that run owns the outcome, so this one stays silent.
      if (controllers.get(key) === ctrl) handlers.onCancel?.();
    }
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

const cycleText = (graphId: string, ids: string[]) =>
  ids.map((id) => graph(graphId)?.nodes.find((n) => n.id === id)?.name ?? "?").join(" → ");

interface AnalyzeOptions {
  /** Part of a batch (install-all): don't open the "what do you mean?" dialog or warn about cycles; the batch reports. */
  quiet?: boolean;
}

/**
 * Work out a node: if it has no definition, ask the AI what the name means (and let the user pick when
 * it is ambiguous); then check its prerequisites. Also used for "Retry" and "Re-check".
 */
export async function analyzeNode(nodeId: string, graphId = store().activeId, hint?: string, opts: AnalyzeOptions = {}) {
  if (inViewer(graphId)) return;
  const find = () => graph(graphId)?.nodes.find((n) => n.id === nodeId);
  const node = find();
  if (!node) return;
  const key = analyzeKey(graphId, nodeId);
  // Background results are also written into undo snapshots. Skip snapshots of a different concept: one still
  // waiting for its meaning to be chosen, or known by a name this check wasn't started for (a rename keeps the
  // old name as an alias, so renamed snapshots still match).
  const startName = node.name;
  const startedUnclear = node.status === "unclear";
  const sameConcept = (g: Graph) => {
    const n = g.nodes.find((x) => x.id === nodeId);
    return !n || ((startedUnclear || n.status !== "unclear") && Boolean(findByName([n], startName)));
  };
  const bg = (fn: (g: Graph) => Graph) =>
    store().mutate((g) => (sameConcept(g) ? fn(g) : g), graphId, { history: "background" });
  const set = (patch: Parameters<typeof ops.updateNode>[2]) => bg((g) => ops.updateNode(g, nodeId, patch));
  // Results are applied even if the node was deleted meanwhile: that is a no-op now, but undoing the delete
  // brings the node back with the result instead of a spinner that never stops.
  const handlers: BusyHandlers = {
    onError: (e) => {
      const msg = e instanceof Error ? e.message : String(e);
      bg((g) => ops.setNodeError(g, nodeId, msg));
      reportError(e, `${node.name}: `);
    },
    onCancel: () => bg((g) => ops.setNodeError(g, nodeId, t("task.cancelled"))),
  };
  set({ status: "checking", error: undefined });

  const clarify = useSettings.getState().clarify;
  if (!node.definition.trim() && clarify.enabled) {
    const g = graph(graphId);
    const res = await withBusy(
      key,
      t("task.clarify", { name: node.name }),
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
      if (!opts.quiet) store().setClarifying({ graphId, nodeId });
      return; // continues in chooseSense once the user picks a meaning
    }
    if (res.senses[0]?.definition) set({ definition: res.senses[0].definition });
  }

  const current = find();
  if (!current) return;
  const g = graph(graphId);
  const res = await withBusy(
    key,
    t("task.deps", { name: current.name }),
    (signal) =>
      api.deps({ node: toBrief(current), existing: g.nodes.filter((n) => n.id !== nodeId).map(toBrief) }, signal),
    handlers,
  );
  if (!res) return;
  bg((g) => ops.applyDeps(g, nodeId, res.prerequisites));
  // A prerequisite that (transitively) needs this node back is almost always a wrong AI answer.
  const cycle = find() ? paths.cycleThrough(graph(graphId), nodeId) : null;
  if (cycle && !opts.quiet) {
    store().setToast(t("toast.cycle", { chain: cycleText(graphId, cycle) }));
  }
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
  if (merged) store().setToast(t("toast.senseMerged", { name: sense.name }), "info");
  else void analyzeNode(id, graphId);
}

export function addConcept(input: ops.NewNodeInput, graphId = store().activeId, hint?: string): string {
  let id = "";
  let existed = false;
  // Without a preferred spot, new concepts go where the user is looking (addNode then avoids overlaps).
  const c = input.position ? undefined : viewport.center();
  const position = input.position ?? (c && { x: c.x - ops.NODE_SIZE.w / 2, y: c.y - ops.NODE_SIZE.h / 2 });
  store().mutate((g) => {
    const r = ops.addNode(g, { ...input, position });
    id = r.id;
    existed = r.existed;
    return r.graph;
  }, graphId);
  if (existed) {
    store().setToast(t("toast.exists", { name: input.name }), "info");
  } else {
    void analyzeNode(id, graphId, hint);
  }
  store().setInspect({ kind: "node", id });
  if (graphId === store().activeId) viewport.reveal(id);
  return id;
}

/** "Tidy": lay the active graph out in layers, prerequisites above their dependents. */
export function tidy() {
  store().mutate((g) => ops.setPositions(g, layeredLayout(g)));
  viewport.fit();
}

export function suggestNames(description: string) {
  if (inViewer(store().activeId)) return Promise.resolve(undefined);
  const g = graph(store().activeId);
  return withBusy("name", t("task.name"), (signal) =>
    api.name({ description, context: g.nodes.map(toBrief) }, signal).then((r) => r.candidates),
  );
}

export function addCandidate(c: NameCandidate) {
  return addConcept({ name: c.name, definition: c.definition, aliases: c.aliases });
}

/**
 * Create a missing dependency near its dependent, which satisfies (and links) it. Doesn't analyze the new node.
 * `index` spreads siblings apart; it defaults to the dependency's position in the dependent's missing list.
 */
function placeDep(graphId: string, dependentId: string, depName: string, index?: number) {
  const dependent = graph(graphId).nodes.find((n) => n.id === dependentId);
  const dep = dependent?.missingDeps.find((d) => d.name === depName);
  const at = index ?? (dependent && dep ? dependent.missingDeps.indexOf(dep) : 0);
  // The dependent tells the AI which meaning is meant, so installs rarely need a "what do you mean?".
  const hint = dependent && dep ? `Needed by "${dependent.name}" (${dep.role}): ${dep.reason}` : undefined;
  let id = "";
  let existed = false;
  store().mutate((g) => {
    const r = ops.addNode(g, { name: depName, position: ops.installPosition(g, dependentId, at) });
    id = r.id;
    existed = r.existed;
    // If the concept already existed under this name, addNode didn't run satisfyMissing for it.
    return existed ? ops.satisfyMissing(r.graph, id) : r.graph;
  }, graphId);
  return { id, existed, hint };
}

/** "Install" a missing dependency: create it near the dependent node, which satisfies the dependency. */
export function installDep(dependentId: string, depName: string) {
  const graphId = store().activeId;
  const r = placeDep(graphId, dependentId, depName);
  if (r.existed) store().setToast(t("toast.exists", { name: depName }), "info");
  else {
    viewport.reveal(r.id);
    void analyzeNode(r.id, graphId, r.hint);
  }
  store().setInspect({ kind: "node", id: dependentId });
  return r.id;
}

export interface InstallReport {
  /** Names of the concepts added, in install order. */
  installed: string[];
  /** Deepest level of prerequisites installed (1 = the node's own missing dependencies). */
  depth: number;
  /** Installed concepts whose meaning is ambiguous: not followed further until the user picks one. */
  unclear: string[];
  /** Installed concepts whose check failed or was cancelled. */
  failed: string[];
  /** Missing prerequisites left alone because a limit was reached. */
  leftOver: string[];
  limit: "depth" | "nodes" | null;
  /** Dependency cycles now involving the run's concepts, as "A → B → A". */
  cycles: string[];
  cancelled: boolean;
}

export const installAllKey = (graphId: string, nodeId: string) => `installAll:${graphId}:${nodeId}`;

/**
 * Install every missing dependency of a node, then theirs, breadth-first, until nothing is missing or the
 * depth / node limits from Settings are reached. One cancellable status-bar task covers the whole run, and
 * cancelling it also cancels the checks in flight. Ambiguous (unclear) concepts are skipped and reported.
 */
export async function installAllMissing(rootId: string, graphId = store().activeId): Promise<InstallReport | undefined> {
  if (inViewer(graphId)) return undefined;
  const find = (id: string) => graph(graphId)?.nodes.find((n) => n.id === id);
  const root = find(rootId);
  if (!root) return;
  const { maxDepth, maxNodes } = useSettings.getState().installAll;
  const report: InstallReport = {
    installed: [], depth: 0, unclear: [], failed: [], leftOver: [], limit: null, cycles: [], cancelled: false,
  };
  const key = installAllKey(graphId, rootId);
  const label = () =>
    t("task.installAll", { name: root.name, n: report.installed.length, level: Math.max(report.depth, 1), max: maxDepth });
  const touched = new Set([rootId]);
  const inflight = new Set<string>();

  await withBusy(
    key,
    label(),
    async (signal) => {
      signal.addEventListener("abort", () => inflight.forEach(cancelTask));
      let frontier = [rootId];
      for (let depth = 1; frontier.length; depth++) {
        const wanted = frontier.flatMap((id) => (find(id)?.missingDeps ?? []).map((d) => ({ dependentId: id, name: d.name })));
        if (!wanted.length) break;
        if (depth > maxDepth) {
          report.limit = "depth";
          report.leftOver = [...new Set(wanted.map((w) => w.name))];
          break;
        }
        report.depth = depth;
        const added: { id: string; hint?: string }[] = [];
        const perDependent = new Map<string, number>();
        for (const w of wanted) {
          // An earlier install may already have satisfied this one (same name needed twice).
          if (!find(w.dependentId)?.missingDeps.some((d) => d.name === w.name)) continue;
          if (report.installed.length >= maxNodes) {
            report.limit = "nodes";
            if (!report.leftOver.includes(w.name)) report.leftOver.push(w.name);
            continue;
          }
          const index = perDependent.get(w.dependentId) ?? 0;
          perDependent.set(w.dependentId, index + 1);
          const r = placeDep(graphId, w.dependentId, w.name, index);
          if (r.existed) continue;
          report.installed.push(w.name);
          touched.add(r.id);
          added.push(r);
        }
        store().setBusy(key, label());
        // Siblings are checked in parallel; the next level starts once they're all done.
        await Promise.all(
          added.map(async (a) => {
            const k = analyzeKey(graphId, a.id);
            inflight.add(k);
            try {
              await analyzeNode(a.id, graphId, a.hint, { quiet: true });
            } finally {
              inflight.delete(k);
            }
          }),
        );
        if (signal.aborted) throw new CancelledError();
        frontier = [];
        for (const a of added) {
          const n = find(a.id);
          if (n?.status === "unclear") report.unclear.push(n.name);
          else if (n?.status === "error") report.failed.push(n.name);
          else if (n) frontier.push(n.id);
        }
      }
    },
    { onCancel: () => void (report.cancelled = true) },
  );

  const g = graph(graphId);
  if (!g) return report;
  const seen = new Set<string>();
  for (const id of touched) {
    const cycle = paths.cycleThrough(g, id);
    if (!cycle || cycle.some((c) => seen.has(c))) continue;
    cycle.forEach((c) => seen.add(c));
    report.cycles.push(cycleText(graphId, cycle));
  }
  store().setToast(installSummary(root.name, report, maxDepth), report.failed.length ? "error" : "info");
  return report;
}

function installSummary(name: string, r: InstallReport, maxDepth: number): string {
  const n = r.installed.length;
  const parts = [
    r.cancelled
      ? t("install.cancelled", { n })
      : n
        ? t("install.done", { n, name, depth: r.depth })
        : t("install.nothing", { name }),
  ];
  if (r.unclear.length) parts.push(t("install.unclear", { names: r.unclear.join(", ") }));
  if (r.failed.length) parts.push(t("install.failed", { names: r.failed.join(", ") }));
  if (r.limit === "depth") parts.push(t("install.depthLimit", { max: maxDepth, names: r.leftOver.join(", ") }));
  if (r.limit === "nodes") parts.push(t("install.nodeLimit", { n, names: r.leftOver.join(", ") }));
  if (r.cycles.length) parts.push(t("install.cycles", { cycles: r.cycles.join("; ") }));
  return parts.join(" ");
}

export async function mix(aId: string, bId: string) {
  if (inViewer(store().activeId)) return;
  const graphId = store().activeId;
  const g = graph(graphId);
  const a = g.nodes.find((n) => n.id === aId);
  const b = g.nodes.find((n) => n.id === bId);
  if (!a || !b) return;
  const res = await withBusy(`mix:${aId}:${bId}`, t("task.mix", { a: a.name, b: b.name }), (signal) =>
    api.relate({ a: toBrief(a), b: toBrief(b) }, signal),
  );
  if (!res) return;
  // The user asked for this relation, so it is an undo step (skipped if either end was deleted meanwhile).
  const both = (g: Graph) => g.nodes.some((n) => n.id === aId) && g.nodes.some((n) => n.id === bId);
  store().mutate((g) => (both(g) ? ops.upsertRelation(g, aId, bId, res.aToB, res.bToA, "mix") : g), graphId);
  const rel = ops.findRelation(graph(graphId), aId, bId);
  if (rel) store().setInspect({ kind: "edge", relationId: rel.id, dir: rel.a === aId ? "aToB" : "bToA" });
}

export const explainKey = (graphId: string, nodeId: string) => `explain:${graphId}:${nodeId}`;

/**
 * "Explain more": ask the AI for a longer explanation of a concept at the chosen level, given its prerequisites and
 * relations. The answer is stored on the node as a background change (like other AI results, not an undo step).
 */
export async function explainNode(nodeId: string, level: ExplainLevel, graphId = store().activeId) {
  if (inViewer(graphId)) return;
  const g = graph(graphId);
  const node = g?.nodes.find((n) => n.id === nodeId);
  if (!node) return;
  const name = (id: string) => g.nodes.find((n) => n.id === id)?.name;
  const relations = g.relations.flatMap((r) => {
    if (r.a !== nodeId && r.b !== nodeId) return [];
    const mine = r.a === nodeId;
    const other = name(mine ? r.b : r.a);
    return other ? [{ other, toOther: mine ? r.aToB : r.bToA, fromOther: mine ? r.bToA : r.aToB }] : [];
  });
  const prerequisites = g.nodes.filter((n) => node.dependsOn.includes(n.id)).map(toBrief);
  const res = await withBusy(explainKey(graphId, nodeId), t("task.explain", { name: node.name }), (signal) =>
    api.explain({ node: toBrief(node), prerequisites, relations, level }, signal),
  );
  if (!res) return;
  store().mutate(
    (g) => ops.updateNode(g, nodeId, { explanation: { ...res, level, createdAt: Date.now() } }),
    graphId,
    { history: "background" },
  );
}

export function derive(selectedIds: string[], goal?: string) {
  if (inViewer(store().activeId)) return Promise.resolve(undefined);
  const g = graph(store().activeId);
  const selected = g.nodes.filter((n) => selectedIds.includes(n.id));
  return withBusy("derive", t("task.derive"), (signal) =>
    api.derive({ selected: selected.map(toBrief), context: g.nodes.map(toBrief), goal }, signal).then((r) => r.proposals),
  );
}

/** "Extract from text": ask the AI for candidate concepts and relations in a pasted text (see ExtractDialog). */
export function extractFromText(text: string, focus?: string) {
  const g = graph(store().activeId);
  return withBusy("extract", t("task.extract"), (signal) =>
    api.extract({ text, existing: g.nodes.map(toBrief), focus: focus?.trim() || undefined }, signal),
  );
}

/**
 * Add the accepted part of an extraction as ONE undo step, near the middle of the view, then check the new
 * concepts' prerequisites. Those checks go through the AI queue (Settings → parallel AI calls) and run quietly:
 * a concept with several meanings waits as "unclear" instead of opening a dialog per concept.
 */
export function insertExtraction(review: ExtractReview, graphId = store().activeId) {
  let added: string[] = [];
  const before = graph(graphId)?.relations.length ?? 0;
  store().mutate((g) => {
    const r = applyExtraction(g, review, viewport.center());
    added = r.added;
    return r.graph;
  }, graphId);
  const links = (graph(graphId)?.relations.length ?? 0) - before;
  for (const id of added) void analyzeNode(id, graphId, undefined, { quiet: true });
  store().setToast(t("extract.done", { n: added.length, links }), "info");
  if (added.length && graphId === store().activeId) viewport.reveal(added[0]);
  return added;
}

export function acceptProposal(p: DerivedProposal, anchorIds: string[]) {
  const graphId = store().activeId;
  const g = graph(graphId);
  const anchors = g.nodes.filter((n) => anchorIds.includes(n.id));
  const cx = anchors.reduce((s, n) => s + n.position.x, 0) / Math.max(anchors.length, 1);
  const cy = Math.max(...anchors.map((n) => n.position.y), 0);
  // Preferred spot: below the anchors; addNode shifts it to the nearest free place.
  const id = addConcept({ name: p.name, definition: p.definition, aliases: p.aliases, position: { x: cx, y: cy + 200 } }, graphId);
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
