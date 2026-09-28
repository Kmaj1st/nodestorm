import {
  ABSURD_AVOID_MAX,
  ABSURD_AVOID_NAME_MAX,
  BRIEF_LIST_MAX,
  CancelledError,
  clipText,
  findByName,
  HINT_MAX,
  NAME_MAX,
  normalizeName,
  type AbsurdChainResponse,
  type AbsurdStyle,
  toBrief,
  toBriefs,
  type DerivedProposal,
  type ExplainLevel,
  type ExplainVoice,
  type ConceptNode,
  type Graph,
  type NameCandidate,
  type QuizStyle,
  type FormalDecl,
  type Sense,
  type SourceRef,
  providerMeta,
  loogleDeclaration,
  findPapers as searchPapers,
  SiteBlockedError,
} from "@nodestorm/shared";
import { listJoin, t } from "../i18n";
import { useGraphStore } from "../store/graphStore";
import { autoSnapshot } from "../store/snapshotStore";
import { hiddenIn, useView } from "../store/viewStore";
import { isReady, useSettings } from "../store/settingsStore";
import { api, NeedsSetupError } from "./api";
import { errorMessage } from "./errors";
import { applyAbsurdChain, sandboxName, type AbsurdStop } from "./absurd";
import { applyExtraction, buildReview, mentionedIn, type ExtractReview } from "./extract";
import * as ops from "./graphOps";
import { layeredLayout } from "./layout";
import { lookupDefinitions, lookupReady, type Site } from "./lookup";
import { autoPick, cachedSources, forgetSources, gatherSources, sourceRef, sourcesAsSenses } from "./sources";
import { searchReady } from "./webSearch";
import { isOnline } from "./online";
import { withoutHidden } from "./view";
import { viewport } from "./viewport";
import * as cycles from "./cycles";
import * as paths from "./paths";
import { updateMastery, type Grade } from "./quiz";

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
  store().setToast(prefix + errorMessage(e));
}

/**
 * The shared-graph viewer never calls the AI (the link's recipient may not have, or want to spend, a key).
 * Only calls for that graph are refused: work still running on the user's own graphs carries on.
 */
export function inViewer(graphId: string): boolean {
  if (graphId !== store().view?.id) return false;
  store().setToast(t("api.viewer"), "info");
  return true;
}

const controllers = new Map<string, AbortController>();

/** Cancel a running AI task (status-bar close button, dialog Cancel). */
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
export async function withBusy<T>(
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

/** "Set up AI to check prerequisites" is said once per page load, not for every looked-up concept. */
let noAiNoticeShown = false;

const analyzeKey = (graphId: string, nodeId: string) => `analyze:${graphId}:${nodeId}`;

const cycleText = (graphId: string, ids: string[]) =>
  ids.map((id) => graph(graphId)?.nodes.find((n) => n.id === id)?.name ?? "?").join(" → ");

interface AnalyzeOptions {
  /** Part of a batch (install-all): don't open the "what do you mean?" dialog or warn about cycles; the batch reports. */
  quiet?: boolean;
}

/**
 * Work out a node: if it has no definition, take one from the sources (see gatherSources), or let the user choose;
 * then check its prerequisites with the AI. Also used for "Retry" and "Re-check".
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
      const msg = errorMessage(e);
      bg((g) => ops.setNodeError(g, nodeId, msg));
      reportError(e, `${t("common.label", { label: node.name })} `);
    },
    onCancel: () => bg((g) => ops.setNodeError(g, nodeId, t("task.cancelled"))),
  };
  set({ status: "checking", error: undefined });

  // No definition yet: the sources (encyclopedias, wikis and the web), rated by the AI when one is set up. The most
  // reliable passage is taken as it stands, a source's own words recorded with that source; otherwise the concept
  // waits for the user to choose (or write) one. The AI never writes the definition.
  let lookedUp = false;
  if (!node.definition.trim()) {
    let cancelled = false;
    const found = lookupReady() || searchReady()
      ? await withBusy(
          key,
          t("task.sources", { name: node.name }),
          (signal) =>
            gatherSources(node.name, {
              signal,
              hint,
              context: relatedNames(graph(graphId), nodeId),
              onChecking: () => store().setBusy(key, t("task.assess", { name: node.name }), undefined, "rating"),
            }),
          { onError: () => {}, onCancel: () => void ((cancelled = true), handlers.onCancel?.()) },
        )
      : undefined;
    if (cancelled) return;
    const pick = found && autoPick(found);
    if (pick) {
      const cur = find();
      const alias = pick.name?.trim() && normalizeName(pick.name) !== normalizeName(node.name) ? [pick.name.trim()] : [];
      set({ definition: pick.passage, source: sourceRef(pick), aliases: [...new Set([...(cur?.aliases ?? node.aliases), ...alias])] });
      lookedUp = true;
    } else {
      // Sources, but none to take as it stands: the user chooses in the pop-up. Nothing found: the concept needs a
      // definition (its badge opens the pop-up), and no pop-up interrupts.
      set({ status: "unclear", senses: sourcesAsSenses(found?.sources ?? [], node.name) });
      if (!find()) return;
      if (!opts.quiet && found?.sources.length) store().setClarifying({ graphId, nodeId, sources: found });
      return; // continues in chooseSense once the user picks a passage or writes a definition
    }
  }
  // Without AI set up, a definition from a source is still worth keeping: finish here instead of opening Settings.
  // (Not for "Check with AI" on a concept waiting for that: the user asked for the AI.)
  const fromSource = lookedUp || Boolean(find()?.source?.url && find()?.definition.trim());
  if (fromSource && node.status !== "pending" && !isReady(useSettings.getState())) {
    set({ status: "ok" });
    if (!noAiNoticeShown) {
      noAiNoticeShown = true;
      store().setToast(t("toast.lookupNoAi"), "info");
    }
    return;
  }

  const current = find();
  if (!current) return;
  // A basic concept is taken as given: no prerequisite check, so no AI call for it.
  if (current.basic) {
    set({ status: "ok", error: undefined });
    return;
  }
  const g = graph(graphId);
  const res = await withBusy(
    key,
    t("task.deps", { name: current.name }),
    (signal) =>
      api.deps({ node: toBrief(current), existing: toBriefs(g.nodes.filter((n) => n.id !== nodeId)) }, signal),
    handlers,
  );
  if (!res) return;
  bg((g) => ops.suggestKind(ops.applyDeps(g, nodeId, res.prerequisites), nodeId, res.kind));
  // A prerequisite that (transitively) needs this node back is almost always a wrong AI answer.
  const cycle = find() ? paths.cycleThrough(graph(graphId), nodeId) : null;
  if (cycle && !opts.quiet) {
    if (useSettings.getState().autoResolveCycles) void resolveCycle(graphId, cycle, { newestFrom: nodeId });
    else store().setToast(t("toast.cycle", { chain: cycleText(graphId, cycle) }));
  }
}

/**
 * Break a dependency cycle ([A, B, …, A] as node ids): the AI picks the wrong link(s) from the reasons each link was
 * added with; without a usable answer, the link `newestFrom`'s check just added goes. Removing is one undo step.
 * Repeats (a few times at most) while the same concepts are still on a cycle.
 */
export async function resolveCycle(
  graphId: string,
  cycle: string[],
  opts: { newestFrom?: string; /** Return the notice instead of showing it (a batch shows one summary). */ silent?: boolean } = {},
): Promise<string | null> {
  if (inViewer(graphId)) return null;
  const ids = [...new Set(cycle)];
  const removed: string[] = [];
  const reasons: string[] = [];
  let current: string[] | null = cycle;
  for (let round = 0; current && round < 3; round++) {
    const g = graph(graphId);
    if (!g) return null;
    const links = cycles.cycleLinks(g, current);
    if (links.length < 2) break;
    const chain = cycleText(graphId, current);
    const req = {
      links: links.map((l) => ({ from: toBrief(l.from), to: toBrief(l.to), reason: clipText(l.reason, HINT_MAX) })),
    };
    let cancelled = false;
    const res = await withBusy(
      `cycle:${graphId}:${[...current].sort().join(",")}`,
      t("task.resolveCycle", { chain }),
      (signal) => api.resolveCycle(req, signal),
      // An AI failure (offline, no key, bad answer) falls back to the newest link; a cancel leaves the cycle alone.
      { onError: () => {}, onCancel: () => void (cancelled = true) },
    );
    if (cancelled || !graph(graphId)) return null;
    let pick = (res?.remove ?? []).map((i) => links[i]).filter(Boolean);
    let reason = res?.reason ?? "";
    if (!pick.length) {
      pick = [links[cycles.fallbackLinkIndex(links, opts.newestFrom)]];
      reason = t("cycle.fallbackReason");
    }
    store().mutate((g) => cycles.removeLinks(g, pick), graphId);
    removed.push(...pick.map((l) => t("cycle.link", { from: l.from.name, to: l.to.name })));
    if (reason) reasons.push(reason);
    current = cycles.remainingCycle(graph(graphId), ids);
  }
  if (!removed.length) return null;
  const notice = t("cycle.resolved", { links: listJoin(removed), reason: reasons.join(" ") });
  if (!opts.silent) store().setToast(notice, "info");
  return notice;
}

export const relookupKey = (graphId: string, nodeId: string) => `relookup:${graphId}:${nodeId}`;

/**
 * "Look up in…": replace the definition (one undo step) with one from an encyclopedia, even when the concept is
 * already defined. `from` picks the site ("proofwiki", "wikipedia" with Wikidata…); without it, the enabled sites in
 * order. Several meanings go to the sources pop-up; nothing found leaves the concept as it is and says so.
 */
export async function relookup(nodeId: string, graphId = store().activeId, from?: Site) {
  if (inViewer(graphId)) return;
  const node = graph(graphId)?.nodes.find((n) => n.id === nodeId);
  if (!node) return;
  const clarify = useSettings.getState().clarify;
  if (from ? !isOnline() : !lookupReady()) return void store().setToast(t("toast.lookupUnavailable"), "info");
  forgetSources(node.name); // a fresh look: the sources pop-up doesn't reopen what was found before
  const senses = await withBusy(relookupKey(graphId, nodeId), t("task.lookup", { name: node.name }), (signal) =>
    lookupDefinitions(node.name, clarify.enabled ? clarify.options : 1, signal, { fresh: true, ...(from ? { sites: [from] } : {}) }),
  );
  if (!senses) return;
  if (!senses.length) return void store().setToast(t("toast.lookupNothing", { name: node.name }), "info");
  const found = senses.map(lookedUpSense);
  if ((found.length > 1 || !senses[0].exact) && clarify.enabled) {
    // Keep the old name for chooseSense to compare against; the choice replaces definition and source.
    store().mutate((g) => ops.updateNode(g, nodeId, { status: "unclear", senses: found }), graphId);
    store().setClarifying({ graphId, nodeId });
    return;
  }
  const [s] = found;
  store().mutate((g) => ops.updateNode(g, nodeId, { definition: s.definition, source: s.source }), graphId);
}

/**
 * "Look up in… → Search the web and compare": every source for an existing concept (encyclopedias, wikis, the web),
 * rated by the AI when one is set up, in the sources pop-up. Choosing there replaces the definition (one undo step).
 * For a concept waiting for a definition ("Search again", or its badge when nothing was gathered yet), the pop-up
 * chooses as when it was added. `fresh`: skip what was found before (the menu and "Search again"). `requery`: the web
 * search engines are asked again too, past their cache ("Search again" only: it uses search quota).
 */
export async function compareSources(nodeId: string, graphId = store().activeId, opts: { fresh?: boolean; requery?: boolean; ifOpen?: boolean } = {}) {
  if (inViewer(graphId)) return;
  const node = graph(graphId)?.nodes.find((n) => n.id === nodeId);
  if (!node) return;
  if (!isOnline()) return void store().setToast(t("toast.lookupUnavailable"), "info");
  const key = relookupKey(graphId, nodeId);
  const found = await withBusy(key, t("task.sources", { name: node.name }), (signal) =>
    gatherSources(node.name, {
      signal,
      fresh: opts.fresh,
      requery: opts.requery,
      context: relatedNames(graph(graphId), nodeId),
      onChecking: () => store().setBusy(key, t("task.assess", { name: node.name }), undefined, "rating"),
    }),
  );
  const cur = graph(graphId)?.nodes.find((n) => n.id === nodeId);
  if (!found || !cur) return;
  // Gathered for a pop-up that was open (its badge): not shown again once the user closed it or opened another.
  const open = store().clarifying;
  if (opts.ifOpen && (open?.graphId !== graphId || open.nodeId !== nodeId)) return;
  // A concept still waiting for a definition ("Search again" in the pop-up) keeps what was found to choose from.
  const waiting = cur.status === "unclear";
  if (waiting) store().mutate((g) => ops.updateNode(g, nodeId, { senses: sourcesAsSenses(found.sources, cur.name) }), graphId, { history: "background" });
  store().setClarifying({ graphId, nodeId, sources: found, replace: !waiting });
}

/**
 * A waiting concept's badge (or the inspector's "Choose a definition…"): the sources pop-up, with what was gathered
 * lately for its name when that is cached (rated, no new search). Otherwise the pop-up opens on the passages stored on
 * the concept (an Install in ask-first mode stores an encyclopedia's only) and gathers every source, the web and the
 * AI's rating included, while it says "Searching…".
 */
export function openSources(nodeId: string, graphId = store().activeId) {
  const node = graph(graphId)?.nodes.find((n) => n.id === nodeId);
  if (!node) return;
  store().setClarifying({ graphId, nodeId });
  if (store().view?.id === graphId || cachedSources(node.name) || store().busy[relookupKey(graphId, nodeId)]) return;
  if (isOnline() && (lookupReady() || searchReady())) void compareSources(nodeId, graphId, { ifOpen: true });
}

/** A definition chosen in the sources pop-up for a concept that already had one: replaces it (one undo step). */
export function replaceDefinition(graphId: string, nodeId: string, choice: { definition: string; source: SourceRef }) {
  store().mutate((g) => ops.updateNode(g, nodeId, { definition: choice.definition.trim(), source: choice.source }), graphId);
  store().setClarifying(null);
  store().setInspect({ kind: "node", id: nodeId });
}

/**
 * Names of concepts that tell which meaning of a concept's name is meant: those linked to it first, then the rest of
 * the graph (at most 40).
 */
export function relatedNames(g: Graph | undefined, nodeId: string): string[] {
  if (!g) return [];
  const node = g.nodes.find((n) => n.id === nodeId);
  const linked = new Set([
    ...(node?.dependsOn ?? []),
    ...g.nodes.filter((n) => n.dependsOn.includes(nodeId)).map((n) => n.id),
    ...g.relations.flatMap((r) => (r.a === nodeId ? [r.b] : r.b === nodeId ? [r.a] : [])),
  ]);
  const others = g.nodes.filter((n) => n.id !== nodeId);
  return [...others.filter((n) => linked.has(n.id)), ...others.filter((n) => !linked.has(n.id))].slice(0, 40).map((n) => n.name);
}

export const mathlibKey = (graphId: string, nodeId: string) => `mathlib:${graphId}:${nodeId}`;

/**
 * "Find in Mathlib": the AI names Lean 4 declarations that may formalise the concept, and each is checked against
 * Mathlib with Loogle; only the ones that exist are kept (with their type, module and docstring). Stored on the
 * node like an explanation: not an undo step.
 */
export async function findInMathlib(nodeId: string, graphId = store().activeId) {
  if (inViewer(graphId)) return;
  const g = graph(graphId);
  const node = g?.nodes.find((n) => n.id === nodeId);
  if (!node) return;
  const res = await withBusy(mathlibKey(graphId, nodeId), t("task.mathlib", { name: node.name }), async (signal) => {
    const { candidates } = await api.mathlib({ node: toBrief(node), context: toBriefs(g.nodes.filter((n) => n.id !== nodeId), 80) }, signal);
    // All names at once; one that can't be checked (timeout, Loogle down) doesn't throw away the others.
    const found = await Promise.all(
      candidates.map((c) =>
        loogleDeclaration(c.name, { signal }).catch((e) => {
          if (signal.aborted) throw e;
          return undefined;
        }),
      ),
    );
    const decls: FormalDecl[] = [];
    const unverified: string[] = [];
    const unchecked: string[] = [];
    found.forEach((d, i) => {
      const c = candidates[i];
      if (d) decls.push({ ...d, ...(c.why ? { why: c.why } : {}) });
      else if (d === null) unverified.push(c.name);
      else unchecked.push(c.name);
    });
    if (unchecked.length && unchecked.length === candidates.length) throw new Error(t("formal.unreachable"));
    return { decls, unverified, ...(unchecked.length ? { unchecked } : {}), checkedAt: Date.now() };
  });
  if (!res) return;
  store().mutate((g) => (g.nodes.some((n) => n.id === nodeId) ? ops.updateNode(g, nodeId, { formal: res }) : g), graphId, { history: "background" });
  if (!res.decls.length) store().setToast(t("formal.none", { name: node.name }), "info");
}

export const papersKey = (graphId: string, nodeId: string) => `papers:${graphId}:${nodeId}`;

/** How many papers "Find papers" lists. */
export const PAPERS_MAX = 8;

/**
 * "Find papers": published works about the concept, from OpenAlex (real literature, unlike an AI's reading list).
 * A one-word name is told apart by its prerequisites ("Kernel" next to "Group homomorphism"). Needs no AI. Stored on
 * the node like a Mathlib result: not an undo step, not in share links.
 */
export async function findPapers(nodeId: string, graphId = store().activeId) {
  if (inViewer(graphId)) return;
  const g = graph(graphId);
  const node = g?.nodes.find((n) => n.id === nodeId);
  if (!node) return;
  const byId = new Map(g.nodes.map((n) => [n.id, n]));
  const context = [
    ...node.dependsOn.map((id) => byId.get(id)?.name).filter((n): n is string => !!n),
    ...node.missingDeps.map((d) => d.name),
  ].slice(0, 4);
  const res = await withBusy(papersKey(graphId, nodeId), t("task.papers", { name: node.name }), async (signal) => {
    try {
      const r = await searchPapers({ name: node.name, context, max: PAPERS_MAX }, { signal });
      return { ...r, checkedAt: Date.now() };
    } catch (e) {
      if (!(e instanceof SiteBlockedError)) throw e;
      // OpenAlex answers 429 when the free daily allowance of the user's network is spent (it resets at midnight UTC).
      throw new Error(t(/rate limited/.test(e.message) ? "papers.limit" : "papers.unreachable"));
    }
  });
  if (!res) return;
  store().mutate((g) => (g.nodes.some((n) => n.id === nodeId) ? ops.updateNode(g, nodeId, { papers: res }) : g), graphId, { history: "background" });
  if (!res.works.length) store().setToast(t("papers.none", { name: node.name }), "info");
}

/** The user picked a source's passage (or wrote a definition) for a concept waiting for one. */
export function chooseSense(graphId: string, nodeId: string, sense: Pick<Sense, "name" | "definition" | "source" | "kind">) {
  let id = nodeId;
  let merged = false;
  // The chosen definition waits for "Check with AI"; when Settings says to use the AI right away, the prerequisite
  // check follows at once.
  const wait = askFirst();
  store().mutate((g) => {
    const r = ops.applySense(g, nodeId, sense);
    id = r.id;
    merged = r.merged;
    return wait && !r.merged ? ops.updateNode(r.graph, r.id, { status: "pending" }) : r.graph;
  }, graphId);
  store().setClarifying(null);
  store().setInspect({ kind: "node", id });
  if (merged) store().setToast(t("toast.senseMerged", { name: sense.name }), "info");
  else if (!wait) void analyzeNode(id, graphId);
}

/**
 * The user's go-ahead for the AI on a concept: "Check with AI" (its prerequisites). Without an AI set up, Settings
 * opens and the concept stays as it is.
 */
export function checkWithAi(nodeId: string, graphId = store().activeId): boolean {
  if (!isReady(useSettings.getState())) {
    store().setToast(t("toast.setUpAi"), "info");
    store().setSettingsOpen(true);
    return false;
  }
  void analyzeNode(nodeId, graphId);
  return true;
}

/** Settings: show what the look-ups found and use the AI only when asked (the default), instead of right away. */
export const askFirst = () => useSettings.getState().newConcepts !== "auto";

/** A looked-up meaning as a sense to choose from. */
const lookedUpSense = (s: { name: string; domain: string; definition: string; source?: SourceRef }): Sense => ({
  name: s.name,
  domain: s.domain,
  definition: s.definition,
  source: s.source,
});

/** The meanings to choose from came from the encyclopedias and wikis (or none were found), not from the AI. */
export const sensesLookedUp = (senses: readonly Sense[] | undefined) =>
  !senses?.length || senses.every((s) => Boolean(s.source?.site) && s.source!.site !== "AI");

type Stale = "defined" | "renamed";

/**
 * A look-up (no AI) started for a concept: `set` writes its result only while the concept is still the one it was
 * started for (still "checking", under the same name, no definition written meanwhile), in the graph and in undo
 * snapshots. `run` says whether it ended by itself (false: a newer task on this concept superseded it and owns the
 * outcome); `stale` tells what changed meanwhile.
 */
async function lookUpFor<T>(
  nodeId: string,
  graphId: string,
  fn: (name: string, signal: AbortSignal) => Promise<T>,
  label = (name: string) => t("task.lookup", { name }),
) {
  const node = graph(graphId)?.nodes.find((n) => n.id === nodeId);
  if (!node) return null;
  const startName = normalizeName(node.name);
  const same = (n: ConceptNode) => n.status === "checking" && normalizeName(n.name) === startName && !n.definition.trim();
  const set = (patch: Parameters<typeof ops.updateNode>[2]) =>
    store().mutate(
      (g) => {
        const n = g.nodes.find((x) => x.id === nodeId);
        return n && same(n) ? ops.updateNode(g, nodeId, patch) : g;
      },
      graphId,
      { history: "background" },
    );
  store().mutate((g) => ops.updateNode(g, nodeId, { status: "checking", error: undefined }), graphId, { history: "background" });
  let ended = false;
  const res = await withBusy(analyzeKey(graphId, nodeId), label(node.name), (signal) => fn(node.name, signal), {
    onError: () => void (ended = true),
    onCancel: () => void (ended = true),
  });
  const cur = graph(graphId)?.nodes.find((n) => n.id === nodeId);
  // Renamed or given a definition while this ran (it is still "checking", waiting for this look-up).
  const stale: Stale | null = cur && cur.status === "checking" && !same(cur) ? (cur.definition.trim() ? "defined" : "renamed") : null;
  return { res, run: res !== undefined || ended, set, cur, stale };
}

/** A look-up's concept that changed meanwhile: a definition typed waits for "Check with AI"; a new name is looked up. */
function afterStale(nodeId: string, graphId: string, stale: Stale, again: () => void) {
  if (stale === "defined") store().mutate((g) => ops.updateNode(g, nodeId, { status: "pending" }), graphId, { history: "background" });
  else again();
}

/**
 * A new concept's sources: every enabled encyclopedia and wiki, and the web search engines, rated by the AI when one
 * is set up (see gatherSources). The concept waits as "unclear" with what was found (maybe nothing), and the sources
 * pop-up opens with it (unless `quiet`). A result for a concept renamed or undone meanwhile isn't written over it.
 */
export async function lookUpChoices(nodeId: string, graphId = store().activeId, opts: { quiet?: boolean } = {}) {
  if (inViewer(graphId)) return;
  const key = analyzeKey(graphId, nodeId);
  const r = await lookUpFor(
    nodeId,
    graphId,
    (name, signal) =>
      gatherSources(name, {
        signal,
        context: relatedNames(graph(graphId), nodeId),
        onChecking: () => store().setBusy(key, t("task.assess", { name }), undefined, "rating"),
      }),
    (name) => t("task.sources", { name }),
  );
  if (!r?.run) return;
  if (r.stale) return afterStale(nodeId, graphId, r.stale, () => void lookUpChoices(nodeId, graphId, opts));
  r.set({ status: "unclear", senses: sourcesAsSenses(r.res?.sources ?? [], r.cur?.name ?? "") });
  if (!r.res || opts.quiet || !r.cur) return;
  store().setClarifying({ graphId, nodeId, sources: r.res });
}

/**
 * An installed prerequisite, without the AI: an encyclopedia page of exactly its name is taken (waiting for "Check
 * with AI"); anything else leaves it "unclear" with what was found, its badge one click from choosing.
 */
async function defineInstalled(nodeId: string, graphId: string) {
  if (inViewer(graphId)) return;
  const r = await lookUpFor(nodeId, graphId, (name, signal) => lookupDefinitions(name, useSettings.getState().clarify.options, signal));
  if (!r?.run) return;
  if (r.stale) return afterStale(nodeId, graphId, r.stale, () => void defineInstalled(nodeId, graphId));
  const found = r.res ?? [];
  const exact = found.filter((s) => s.exact);
  if (exact.length === 1 && found.length === 1) {
    const [s] = exact;
    const aliases = r.cur?.aliases ?? [];
    const alias = s.name.trim() && r.cur && normalizeName(s.name) !== normalizeName(r.cur.name) ? [s.name.trim()] : [];
    r.set({ definition: s.definition, source: s.source, aliases: [...new Set([...aliases, ...alias])], status: "pending" });
  } else r.set({ status: "unclear", senses: found.map(lookedUpSense) });
}

/** The source recorded for a definition the AI wrote: "AI" with the provider and model it came from. */
export function aiSource(): SourceRef {
  const s = useSettings.getState();
  const meta = providerMeta(s.provider);
  const model = (s.connection === "browser" ? s.configs[s.provider]?.model : s.serverModels[s.provider]) || meta.defaultModel || "";
  return { site: "AI", title: (model ? `${meta.label} · ${model}` : meta.label).slice(0, 300) };
}

/**
 * Add a concept. Typed by the user (the default), it goes by Settings' "ask first": a name alone opens what the
 * look-ups found, a typed definition waits for "Check with AI". `ai`: the AI already wrote it at the user's request
 * ("Describe it", a derived concept), so its prerequisites are checked right away.
 */
export function addConcept(input: ops.NewNodeInput, graphId = store().activeId, hint?: string, opts: { ai?: boolean } = {}): string {
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
  } else if (opts.ai || !askFirst()) {
    void analyzeNode(id, graphId, hint);
  } else if (input.definition?.trim()) {
    store().mutate((g) => ops.updateNode(g, id, { status: "pending" }), graphId, { history: "merge" });
  } else {
    void lookUpChoices(id, graphId);
  }
  store().setInspect({ kind: "node", id });
  if (graphId === store().activeId) viewport.reveal(id);
  return id;
}

/**
 * "Tidy": lay the active graph out in layers, prerequisites above their dependents. Concepts hidden by hand are left
 * out and keep their places (the layout is for what is on the canvas).
 */
export function tidy() {
  autoSnapshot("tidy"); // moves every concept at once
  const hidden = new Set(hiddenIn(store().activeId)(useView.getState()));
  store().mutate((g) => ops.setPositions(g, layeredLayout(withoutHidden(g, hidden))));
  viewport.fit();
}

export function suggestNames(description: string) {
  if (inViewer(store().activeId)) return Promise.resolve(undefined);
  const g = graph(store().activeId);
  return withBusy("name", t("task.name"), (signal) =>
    api.name({ description: clipText(description.trim(), HINT_MAX), context: toBriefs(g.nodes) }, signal).then((r) => r.candidates),
  );
}

export function addCandidate(c: NameCandidate) {
  return addConcept({ name: c.name, definition: c.definition, aliases: c.aliases, kind: c.kind, source: aiSource() }, undefined, undefined, { ai: true });
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
    if (askFirst()) void defineInstalled(r.id, graphId);
    else void analyzeNode(r.id, graphId, r.hint);
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
  // A restore point: the run may add many concepts, and AI results that arrive later are no undo steps.
  if (root.missingDeps.length) autoSnapshot("installAll", graphId);
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
  const found: string[][] = [];
  for (const id of touched) {
    const cycle = paths.cycleThrough(g, id);
    if (!cycle || cycle.some((c) => seen.has(c))) continue;
    cycle.forEach((c) => seen.add(c));
    found.push(cycle);
  }
  const autoResolve = useSettings.getState().autoResolveCycles && !report.cancelled;
  // Resolved cycles are reported by resolveCycle's own notice; only unresolved ones go into the summary.
  if (!autoResolve) report.cycles.push(...found.map((c) => cycleText(graphId, c)));
  const resolved: string[] = [];
  if (autoResolve) {
    for (const cycle of found) {
      const notice = await resolveCycle(graphId, cycle, { silent: true });
      if (notice) resolved.push(notice);
    }
  }
  const summary = [installSummary(root.name, report, maxDepth), ...resolved].join(" ");
  store().setToast(summary, report.failed.length ? "error" : "info");
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
  if (r.unclear.length) parts.push(t("install.unclear", { names: listJoin(r.unclear) }));
  if (r.failed.length) parts.push(t("install.failed", { names: listJoin(r.failed) }));
  if (r.limit === "depth") parts.push(t("install.depthLimit", { max: maxDepth, names: listJoin(r.leftOver) }));
  if (r.limit === "nodes") parts.push(t("install.nodeLimit", { n, names: listJoin(r.leftOver) }));
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
  // Kept as a "no relation" link (its own colour on the canvas), so the pair isn't mixed again by mistake.
  if (rel && ops.isUnrelated(rel)) store().setToast(t("mix.unrelated", { a: a.name, b: b.name }), "info");
}

export const explainKey = (graphId: string, nodeId: string) => `explain:${graphId}:${nodeId}`;

/**
 * "Explain more": ask the AI for a longer explanation of a concept at the chosen level, given its prerequisites and
 * relations. The answer is stored on the node as a background change (like other AI results, not an undo step).
 */
export async function explainNode(nodeId: string, level: ExplainLevel, graphId = store().activeId, voice: ExplainVoice = "plain") {
  if (inViewer(graphId)) return;
  const g = graph(graphId);
  const node = g?.nodes.find((n) => n.id === nodeId);
  if (!node) return;
  const name = (id: string) => g.nodes.find((n) => n.id === id)?.name;
  const relations = g.relations.flatMap((r) => {
    if (r.a !== nodeId && r.b !== nodeId) return [];
    const mine = r.a === nodeId;
    const other = name(mine ? r.b : r.a);
    return other ? [{ other: clipText(other, NAME_MAX), toOther: mine ? r.aToB : r.bToA, fromOther: mine ? r.bToA : r.aToB }] : [];
  }).slice(0, BRIEF_LIST_MAX);
  const prerequisites = toBriefs(g.nodes.filter((n) => node.dependsOn.includes(n.id)));
  const res = await withBusy(explainKey(graphId, nodeId), t("task.explain", { name: node.name }), (signal) =>
    api.explain({ node: toBrief(node), prerequisites, relations, level, voice }, signal),
  );
  if (!res) return;
  // Built once: a background change is applied to every undo snapshot too, and they must all get the same value.
  const explanation = { ...res, level, ...(voice !== "plain" ? { voice } : {}), createdAt: Date.now() };
  store().mutate(
    (g) => ops.updateNode(g, nodeId, { explanation }),
    graphId,
    { history: "background" },
  );
}

export const anatomyKey = (graphId: string, nodeId: string) => `anatomy:${graphId}:${nodeId}`;

/**
 * "Theorem anatomy": ask the AI to take a theorem-like concept apart (hypotheses and why each is needed, conclusion,
 * proof idea, examples and non-examples). Like "Explain more", the answer is stored on the node as a background change
 * (not an undo step); cancelling it from the status bar leaves the node as it was.
 */
export async function anatomyNode(nodeId: string, graphId = store().activeId) {
  if (inViewer(graphId)) return;
  const g = graph(graphId);
  const node = g?.nodes.find((n) => n.id === nodeId);
  if (!node) return;
  const prerequisites = toBriefs(g.nodes.filter((n) => node.dependsOn.includes(n.id)));
  const res = await withBusy(anatomyKey(graphId, nodeId), t("task.anatomy", { name: node.name }), (signal) =>
    api.anatomy({ node: { ...toBrief(node), kind: node.kind }, prerequisites }, signal),
  );
  if (!res) return;
  const anatomy = { ...res, createdAt: Date.now() }; // once, for every undo snapshot (see explainNode)
  store().mutate(
    (g) => ops.updateNode(g, nodeId, { anatomy }),
    graphId,
    { history: "background" },
  );
}

export const quizKey = (graphId: string) => `quiz:${graphId}`;

/** "Quiz me": one question about a concept, given its prerequisites in the graph (see panels/QuizDialog.tsx). */
export async function quizQuestion(nodeId: string, style: QuizStyle, multipleChoice: boolean, graphId = store().activeId) {
  if (inViewer(graphId)) return undefined;
  const g = graph(graphId);
  const node = g?.nodes.find((n) => n.id === nodeId);
  if (!node) return undefined;
  const prerequisites = toBriefs(g.nodes.filter((n) => node.dependsOn.includes(n.id)));
  return withBusy(quizKey(graphId), t("task.quiz", { name: node.name }), (signal) =>
    api.quiz({ node: { ...toBrief(node), notes: node.notes?.slice(0, 4000) }, prerequisites, style, multipleChoice }, signal),
  );
}

/**
 * Store a self-grade on the concept. Study progress is a background change: the same new value goes into every undo
 * snapshot, so undo/redo never takes it back (or replays an older one).
 */
export function gradeConcept(nodeId: string, grade: Grade, graphId = store().activeId, now = Date.now()) {
  const node = graph(graphId)?.nodes.find((n) => n.id === nodeId);
  if (!node) return;
  const mastery = updateMastery(node.mastery, grade, now);
  const has = (g: Graph) => g.nodes.some((n) => n.id === nodeId);
  store().mutate((g) => (has(g) ? ops.updateNode(g, nodeId, { mastery }) : g), graphId, { history: "background" });
}

export function derive(selectedIds: string[], goal?: string) {
  if (inViewer(store().activeId)) return Promise.resolve(undefined);
  const g = graph(store().activeId);
  const selected = g.nodes.filter((n) => selectedIds.includes(n.id));
  return withBusy("derive", t("task.derive"), (signal) =>
    api
      .derive({ selected: toBriefs(selected), context: toBriefs(g.nodes), goal: goal?.trim() ? clipText(goal.trim(), HINT_MAX) : undefined }, signal)
      .then((r) => r.proposals),
  );
}

/** "Extract from text": ask the AI for candidate concepts and relations in a pasted text (see ExtractDialog). */
export function extractFromText(text: string, focus?: string) {
  if (inViewer(store().activeId)) return Promise.resolve(undefined);
  const g = graph(store().activeId);
  return withBusy("extract", t("task.extract"), (signal) =>
    api.extract({ text, existing: toBriefs(g.nodes), focus: focus?.trim() || undefined }, signal),
  );
}

/**
 * Add the accepted part of an extraction as ONE undo step, near the middle of the view, then check the new
 * concepts' prerequisites. Those checks go through the AI queue (Settings → parallel AI calls) and run quietly:
 * a concept with several meanings waits as "unclear" instead of opening a dialog per concept.
 */
export function insertExtraction(review: ExtractReview, graphId = store().activeId, anchor?: { x: number; y: number }) {
  let added: string[] = [];
  autoSnapshot("extract", graphId);
  const before = graph(graphId)?.relations.length ?? 0;
  store().mutate((g) => {
    const r = applyExtraction(g, review, anchor ?? viewport.center());
    added = r.added;
    return r.graph;
  }, graphId);
  const links = (graph(graphId)?.relations.length ?? 0) - before;
  // The extraction came from the AI, so with one set up the new concepts are checked right away. Without one they
  // wait as "not checked" (as with "ask first"), instead of failing one by one.
  const aiReady = isReady(useSettings.getState());
  if (aiReady) for (const id of added) void analyzeNode(id, graphId, undefined, { quiet: true });
  else if (added.length) {
    const ids = new Set(added);
    store().mutate(
      (g) => ({ ...g, nodes: g.nodes.map((n) => (ids.has(n.id) ? ops.settleBasic({ ...n, status: "pending", error: undefined }) : n)) }),
      graphId,
      { history: "merge" },
    );
  }
  const done = t("extract.done", { n: added.length, links });
  store().setToast(aiReady || !added.length ? done : `${done} ${t("extract.notChecked")}`, "info");
  if (added.length && graphId === store().activeId) viewport.reveal(added[0]);
  return added;
}

export const connectKey = (graphId: string, nodeId: string) => `connect:${graphId}:${nodeId}`;

/**
 * "Suggest connections": keywords for a concept to connect to, as a review list the user picks from (the Extract
 * review). Concepts of the graph its definition names come first, found without the AI; then the AI's suggestions
 * (existing concepts by their graph name, new ones with a definition). Already linked ones are left out. Null when
 * there is nothing to suggest (a toast says so).
 */
export async function suggestConnections(nodeId: string, graphId = store().activeId): Promise<ExtractReview | null> {
  if (inViewer(graphId)) return null;
  const g = graph(graphId);
  const node = g?.nodes.find((n) => n.id === nodeId);
  if (!node) return null;
  const linkedIds = new Set(g.relations.flatMap((r) => (r.a === nodeId ? [r.b] : r.b === nodeId ? [r.a] : [])));
  const mentioned = mentionedIn(g, node).filter((n) => !linkedIds.has(n.id));
  // Without AI set up, what the definition names is still worth offering (asking the AI would open Settings).
  const aiReady = isReady(useSettings.getState());
  const res = !aiReady && mentioned.length ? undefined : await withBusy(connectKey(graphId, nodeId), t("task.connect", { name: node.name }), (signal) =>
    api.connect(
      {
        node: toBrief(node),
        existing: toBriefs(g.nodes.filter((n) => n.id !== nodeId), 200),
        linked: g.nodes.filter((n) => linkedIds.has(n.id)).slice(0, 200).map((n) => n.name.slice(0, NAME_MAX)),
      },
      signal,
    ),
  );
  const none = { kind: "none", explanation: "" };
  const fromText = mentioned.map((n) => ({
    concept: { name: n.name, definition: n.definition, aliases: n.aliases, kind: n.kind ?? null },
    relation: { from: node.name, to: n.name, aToB: { kind: t("rel.dep.uses"), explanation: t("connect.mentioned", { name: n.name }) }, bToA: none },
  }));
  const fromAi = (res?.suggestions ?? []).map((s) => ({
    concept: { name: s.name, definition: s.definition, aliases: [], kind: s.kind ?? null },
    relation: { from: node.name, to: s.name, aToB: s.aToB, bToA: s.bToA },
  }));
  const all = [...fromText, ...fromAi];
  if (!all.length) {
    if (res) store().setToast(t("connect.none", { name: node.name }), "info");
    return null;
  }
  return { ...buildReview(g, { concepts: all.map((x) => x.concept), relations: all.map((x) => x.relation), prerequisites: [] }), origin: aiSource() };
}

export function acceptProposal(p: DerivedProposal, anchorIds: string[]) {
  const graphId = store().activeId;
  const g = graph(graphId);
  const anchors = g.nodes.filter((n) => anchorIds.includes(n.id));
  const cx = anchors.reduce((s, n) => s + n.position.x, 0) / Math.max(anchors.length, 1);
  const cy = Math.max(...anchors.map((n) => n.position.y), 0);
  // Preferred spot: below the anchors; addNode shifts it to the nearest free place.
  const id = addConcept(
    { name: p.name, definition: p.definition, aliases: p.aliases, kind: p.kind, source: aiSource(), position: { x: cx, y: cy + 200 } },
    graphId,
    undefined,
    { ai: true },
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

export const absurdKey = "absurd";

/**
 * "Absurd chain": ask the AI for a chain of true links from one concept to another, narrated in `style`. The ends
 * are names: a concept of the active graph (by name or alias) goes with its definition, anything else as typed.
 * The user's stops (`via`) go the same way, a custom one with the description the user wrote as its definition.
 * Nothing changes in the graph; see addAbsurdChainToSandbox.
 */
export function absurdChain(
  from: string,
  to: string,
  style: AbsurdStyle,
  hops: { min: number; max: number },
  avoid: string[] = [],
  via: AbsurdStop[] = [],
  graphId = store().activeId,
) {
  if (inViewer(graphId)) return Promise.resolve(undefined);
  const nodes = graph(graphId)?.nodes ?? [];
  const brief = (name: string, description = "") => {
    const n = findByName(nodes, name);
    return toBrief(n ?? { name: name.trim(), definition: description.trim(), aliases: [] });
  };
  const [a, b] = [brief(from), brief(to)];
  const stops = via.map((s) => brief(s.name, s.description));
  const context = toBriefs(nodes, 80);
  // Every roll adds its concepts to `avoid`: after many rolls only the latest ones go.
  const recent = avoid.slice(-ABSURD_AVOID_MAX).map((n) => clipText(n, ABSURD_AVOID_NAME_MAX));
  return withBusy(
    absurdKey,
    t("task.absurd", { a: a.name, b: b.name }),
    (signal) => api.absurdChain({ from: a, to: b, style, hops, context, avoid: recent, via: stops }, signal),
    {
      // Still missing a stop after the retry (see checkAbsurdStops): say so in the user's language.
      onError: (e) =>
        e instanceof Error && /must pass through every stop/.test(e.message) ? store().setToast(t("absurd.via.missed")) : reportError(e),
    },
  );
}

/**
 * Put an absurd chain into a new sandbox forked from the active graph and named after the chain, as one undo step
 * there, and switch to it: the user's graph only changes if they merge the sandbox back. The new concepts are then
 * checked quietly, like extracted ones (the hop that introduced each one tells the AI which meaning is meant). A new
 * custom stop of the user's (`via`) with a description keeps it as its definition (source: you).
 */
export function addAbsurdChainToSandbox(res: AbsurdChainResponse, via: AbsurdStop[] = []): string | undefined {
  const s = store();
  if (inViewer(s.activeId)) return undefined;
  s.forkActive(sandboxName(res.title));
  const sandboxId = store().activeId;
  let added: { id: string; fact: string }[] = [];
  store().mutate((g) => {
    const r = applyAbsurdChain(g, res, viewport.center(), via);
    added = r.added;
    return r.graph;
  }, sandboxId);
  for (const a of added) void analyzeNode(a.id, sandboxId, t("absurd.hint", { fact: a.fact }), { quiet: true });
  store().setToast(t("absurd.added", { n: added.length, name: graph(sandboxId)?.name ?? "" }), "info");
  viewport.fit();
  return sandboxId;
}
