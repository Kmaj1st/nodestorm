import type { Graph, GraphExport } from "@nodestorm/shared";
import { create } from "zustand";
import { createJSONStorage, persist } from "zustand/middleware";
import { t } from "../i18n";
import { buildExample, EXAMPLES } from "../lib/examples";
import { fork, merge, uid } from "../lib/graphOps";
import { repairImport } from "../lib/importRepair";
import * as hist from "../lib/history";
import * as proj from "../lib/projects";

export type Inspect =
  | { kind: "node"; id: string }
  | { kind: "edge"; relationId: string; dir: "aToB" | "bToA" }
  | null;

interface State {
  /** Every graph of every project, by id (see lib/projects.ts). */
  graphs: Record<string, Graph>;
  projects: Record<string, proj.Project>;
  /** The current project; `activeId` is one of its graphs. */
  projectId: string;
  activeId: string;
  // UI state (not persisted)
  selection: string[];
  inspect: Inspect;
  busy: Record<string, BusyTask>; // running AI tasks by key
  toast: string | null;
  /** "info" for confirmations and summaries; "error" (default) for failures. */
  toastKind: ToastKind;
  settingsOpen: boolean;
  /** Node whose meaning the user is being asked to pick ("what do you mean?" dialog). */
  clarifying: { graphId: string; nodeId: string } | null;
  /** Node whose learning path is highlighted on the canvas (everything else is dimmed). */
  highlight: { graphId: string; nodeId: string } | null;
  /** Undo/redo stacks per graph id (in memory only). */
  history: Record<string, hist.History<Graph>>;
  /**
   * A shared graph opened from a link (read-only viewer mode). It is shown as the active graph `id` in `graphs`
   * but is never persisted and can't be edited; `returnId` is the user's own graph to go back to.
   */
  view: { id: string; name: string; returnId: string; kind?: ViewKind } | null;
}

/** What the read-only viewer shows: a graph from a share link, or an earlier version of a project (Versions). */
export type ViewKind = "share" | "snapshot";

/**
 * How a mutation shows up in undo history:
 * - "step" (default): a new undo step; steps with the same `key` in a row are coalesced into one.
 * - "merge": folded into the previous step (follow-up bookkeeping of a user action).
 * - "background": not a step at all. Used for AI progress and results (status spinners, prerequisites):
 *   the change is also applied to every snapshot, so undoing never resurrects a stale "checking" state.
 */
export interface MutateOptions {
  history?: "step" | "merge" | "background";
  key?: string;
}

export type ToastKind = "error" | "info";

export interface BusyTask {
  label: string;
  startedAt: number;
  /** "queued" while its AI call waits for a free slot (see lib/aiQueue.ts); absent means running. */
  state?: "queued" | "running";
}

/** Abort signal of each busy task, so the AI queue can mark the task it belongs to as queued (not UI state). */
const busySignals = new Map<string, AbortSignal>();

interface Actions {
  /** Apply a pure graph operation to a specific graph (defaults to the active one). */
  mutate(fn: (g: Graph) => Graph, graphId?: string, opts?: MutateOptions): void;
  undo(graphId?: string): void;
  redo(graphId?: string): void;
  setSelection(ids: string[]): void;
  setInspect(i: Inspect): void;
  setSettingsOpen(open: boolean): void;
  setClarifying(c: State["clarifying"]): void;
  /** Show, relabel (e.g. progress; keeps the start time) or clear (null) a running task. */
  setBusy(key: string, label: string | null, signal?: AbortSignal): void;
  /** Mark the busy task that owns `signal` as queued or running. */
  setBusyState(signal: AbortSignal | undefined, state: "queued" | "running"): void;
  setHighlight(h: State["highlight"]): void;
  setToast(msg: string | null, kind?: ToastKind): void;
  switchTo(graphId: string): void;
  newProject(name?: string): void;
  switchProject(projectId: string): void;
  renameProject(projectId: string, name: string): void;
  duplicateProject(projectId: string): void;
  deleteProject(projectId: string): void;
  /** Build the Group theory example into the active (empty) graph as one undo step. */
  loadExample(): void;
  /** Copy the active graph into a new sandbox (named `name`, else "Sandbox n") and switch to it. */
  forkActive(name?: string): void;
  mergeSandbox(sandboxId: string): void;
  discardSandbox(sandboxId: string): void;
  /** The current project (main graph first, then its sandboxes) as a nodestorm/v1 file. */
  exportJson(): string;
  /** Add a file's graphs as a new project and switch to it, repairing what it can. */
  importJson(text: string): { name: string; fixes: string[] };
  /** Add graphs (main first, e.g. a restored version) as a new project with fresh ids and switch to it. Returns its name. */
  addProject(graphs: Graph[], name: string): string;
  /** Replace a project's graphs with a restored version and open it. Its undo stacks are cleared. */
  restoreProject(projectId: string, graphs: Graph[]): void;
  /** Show a shared graph read-only (see `view`). Replaces a shared graph that is already open. */
  openView(graph: Graph, name: string, kind?: ViewKind): void;
  /** Leave the viewer, back to the user's own graph. */
  closeView(): void;
  /** Add the shared graph as a new project (fresh ids) and switch to it. Returns the project's name. */
  saveViewCopy(): string | null;
  reset(): void;
}

export type GraphStore = State & Actions;

type Workspace = proj.Workspace;

function initial(): Workspace {
  return proj.createProject({ graphs: {}, projects: {}, projectId: "", activeId: "" }, t("project.default"));
}

/** The user's own data: without a shared graph that is open in the viewer (so it's never saved or exported). */
function workspace(s: Workspace & Partial<Pick<State, "view">>): Workspace {
  const v = s.view;
  if (!v) return { graphs: s.graphs, projects: s.projects, projectId: s.projectId, activeId: s.activeId };
  const graphs = { ...s.graphs };
  delete graphs[v.id];
  return { graphs, projects: s.projects, projectId: s.projectId, activeId: s.activeId === v.id ? v.returnId : s.activeId };
}
/** Fresh UI state after switching projects (which also leaves the viewer: `workspace` drops the shared graph). */
const cleared = { selection: [], inspect: null, highlight: null, view: null } satisfies Partial<State>;

/** Move through a graph's history. A check restored as "checking" with no task running is marked failed. */
function travel(s: State, id: string, step: typeof hist.undo<Graph>): Pick<State, "graphs" | "history"> | null {
  const g = s.graphs[id];
  const r = g && step(s.history[id] ?? hist.emptyHistory<Graph>(), g);
  if (!r) return null;
  // Busy key format of analyzeNode (lib/actions.ts).
  const stale = (n: Graph["nodes"][number]) => n.status === "checking" && !s.busy[`analyze:${id}:${n.id}`];
  const nodes = r.present.nodes.map((n) =>
    stale(n) ? { ...n, status: "error" as const, error: t("task.undoInterrupted") } : n,
  );
  return { graphs: { ...s.graphs, [id]: { ...r.present, nodes } }, history: { ...s.history, [id]: r.history } };
}

export const useGraphStore = create<GraphStore>()(
  persist(
    (set, get) => ({
      ...initial(),
      selection: [],
      inspect: null,
      busy: {},
      toast: null,
      toastKind: "error",
      settingsOpen: false,
      clarifying: null,
      history: {},
      highlight: null,
      view: null,

      mutate(fn, graphId, opts = {}) {
        const id = graphId ?? get().activeId;
        const g = get().graphs[id];
        if (!g) return; // graph was discarded while an AI call was in flight
        if (id === get().view?.id) return; // a shared graph is read-only
        const next = fn(g);
        const mode = opts.history ?? "step";
        // A background change still reaches the snapshots when it is a no-op now (e.g. its node was deleted).
        if (next === g && mode !== "background") return;
        const h = get().history[id] ?? hist.emptyHistory<Graph>();
        const nh = mode === "step" ? hist.record(h, g, opts.key) : mode === "background" ? hist.rebase(h, fn) : h;
        set({ graphs: { ...get().graphs, [id]: next }, history: { ...get().history, [id]: nh } });
      },
      undo(graphId) {
        const next = travel(get(), graphId ?? get().activeId, hist.undo);
        if (next) set(next);
      },
      redo(graphId) {
        const next = travel(get(), graphId ?? get().activeId, hist.redo);
        if (next) set(next);
      },
      setSelection: (selection) => set({ selection }),
      setInspect: (inspect) => set({ inspect }),
      setSettingsOpen: (settingsOpen) => set({ settingsOpen }),
      setClarifying: (clarifying) => set({ clarifying }),
      setBusy(key, label, signal) {
        const busy = { ...get().busy };
        // A relabel (progress text) keeps the task's start time, queued/running state and signal.
        if (label) busy[key] = { ...busy[key], label, startedAt: busy[key]?.startedAt ?? Date.now() };
        else delete busy[key];
        if (!label) busySignals.delete(key);
        else if (signal) busySignals.set(key, signal);
        set({ busy });
      },
      setBusyState(signal, state) {
        const key = [...busySignals].find(([, s]) => s === signal)?.[0];
        const task = key && get().busy[key];
        if (!key || !task || (task.state ?? "running") === state) return;
        // Time spent waiting in the queue isn't the AI being slow; count from when the call really starts.
        const startedAt = state === "running" ? Date.now() : task.startedAt;
        set({ busy: { ...get().busy, [key]: { ...task, state, startedAt } } });
      },
      setToast: (toast, toastKind = "error") => set({ toast, toastKind }),
      setHighlight: (highlight) => set({ highlight }),
      switchTo: (activeId) => set({ activeId, selection: [], inspect: null }),

      newProject(name) {
        const ws = workspace(get());
        set({ ...proj.createProject(ws, name ?? proj.uniqueProjectName(ws, t("project.untitled"))), ...cleared });
      },
      switchProject: (id) => set({ ...proj.switchProject(workspace(get()), id), ...cleared }),
      renameProject: (id, name) => set(proj.renameProject(workspace(get()), id, name)),
      duplicateProject: (id) => set({ ...proj.duplicateProject(workspace(get()), id), ...cleared }),
      deleteProject(id) {
        const before = get();
        const p = before.projects[id];
        if (!p) return;
        // Undo stacks of the deleted graphs go too (deleting a project can't be undone; the UI confirms first).
        const history = { ...before.history };
        for (const g of proj.projectGraphs(before, p)) delete history[g.id];
        const next = proj.deleteProject(workspace(before), id);
        set(next.projectId === before.projectId ? { ...next, history } : { ...next, history, ...cleared });
      },
      loadExample() {
        const data = EXAMPLES.groupTheory;
        get().mutate((g) => (g.nodes.length ? g : buildExample(g, data)));
        // A project that was never named takes the example's name.
        const p = get().projects[get().projectId];
        if (p && [proj.DEFAULT_PROJECT_NAME, t("project.untitled")].some((d) => p.name.startsWith(d))) get().renameProject(p.id, proj.uniqueProjectName(get(), data.name));
      },

      forkActive(name) {
        if (isViewing(get())) return;
        const { graphs, activeId, projects, projectId } = get();
        const src = graphs[activeId];
        const n = proj.projectGraphs(get(), projects[projectId]).filter((g) => g.parentId).length + 1;
        const sb = fork(src, name?.trim() || t("sandbox.name", { n }));
        set({ graphs: { ...graphs, [sb.id]: sb }, activeId: sb.id, selection: [], inspect: null });
      },
      mergeSandbox(sandboxId) {
        const { graphs } = get();
        const sb = graphs[sandboxId];
        const parent = sb?.parentId ? graphs[sb.parentId] : undefined;
        if (!sb || !parent) return;
        const rest = { ...graphs, [parent.id]: merge(parent, sb) };
        delete rest[sandboxId];
        // The merge is one undo step in the parent (undoing it doesn't bring the sandbox back).
        const history = { ...get().history, [parent.id]: hist.record(get().history[parent.id] ?? hist.emptyHistory(), parent) };
        delete history[sandboxId];
        // Sandboxes forked from this one are re-parented onto its parent.
        for (const g of Object.values(rest)) if (g.parentId === sandboxId) rest[g.id] = { ...g, parentId: parent.id };
        set({ graphs: rest, history, activeId: parent.id, selection: [], inspect: null });
      },
      discardSandbox(sandboxId) {
        const { graphs, activeId, projects, projectId } = get();
        const mainId = projects[projectId].mainId;
        const sb = graphs[sandboxId];
        if (!sb?.parentId) return;
        const rest = { ...graphs };
        delete rest[sandboxId];
        for (const g of Object.values(rest)) if (g.parentId === sandboxId) rest[g.id] = { ...g, parentId: sb.parentId };
        const nextActive = activeId === sandboxId ? (rest[sb.parentId] ? sb.parentId : mainId) : activeId;
        const history = { ...get().history };
        delete history[sandboxId];
        set({ graphs: rest, history, activeId: nextActive, selection: [], inspect: null });
      },

      exportJson() {
        const { view, graphs: all } = get();
        if (isViewing(get())) {
          const { parentId: _p, forkedAt: _f, ...graph } = all[view!.id];
          return JSON.stringify({ format: "nodestorm/v1", project: { name: view!.name }, graphs: [graph] } satisfies GraphExport, null, 2);
        }
        const project = get().projects[get().projectId];
        // Main graph first (projectGraphs' order) so import knows which one is the root.
        const graphs = proj.projectGraphs(get(), project);
        const doc: GraphExport = { format: "nodestorm/v1", project: { name: project.name }, graphs };
        return JSON.stringify(doc, null, 2);
      },
      importJson(text) {
        const { doc, fixes } = repairImport(JSON.parse(text));
        // Importing never overwrites anything: the file becomes a new project (with fresh ids) next to the others.
        const next = proj.importProject(workspace(get()), doc.graphs, doc.project?.name);
        set({ ...next, ...cleared });
        return { name: next.projects[next.projectId].name, fixes };
      },
      addProject(graphs, name) {
        const next = proj.importProject(workspace(get()), graphs, name);
        set({ ...next, ...cleared });
        return next.projects[next.projectId].name;
      },
      restoreProject(projectId, graphs) {
        const before = get();
        const p = before.projects[projectId];
        if (!p) return;
        // Undo steps belong to the replaced graphs; the way back is the "before restore" snapshot (Versions).
        const history = { ...before.history };
        for (const g of proj.projectGraphs(before, p)) delete history[g.id];
        set({ ...proj.replaceProjectGraphs(workspace(before), projectId, graphs), history, ...cleared });
      },
      openView(graph, name, kind = "share") {
        const ws = workspace(get());
        const id = uid("g"); // a fresh id, so the canvas starts anew (fit view)
        set({
          graphs: { ...ws.graphs, [id]: { ...graph, id } },
          activeId: id,
          view: { id, name, returnId: ws.activeId, kind },
          selection: [],
          inspect: null,
          highlight: null,
        });
      },
      closeView() {
        if (get().view) set({ ...workspace(get()), ...cleared });
      },
      saveViewCopy() {
        const { view, graphs } = get();
        if (!isViewing(get())) return null;
        const next = proj.importProject(workspace(get()), [graphs[view!.id]], view!.name);
        set({ ...next, ...cleared });
        return next.projects[next.projectId].name;
      },
      reset: () => set({ ...initial(), ...cleared, history: {} }),
    }),
    {
      name: "nodestorm",
      // v2 added projects. A v1 state (one main graph + sandboxes) becomes the project "My brainstorm".
      version: 2,
      storage: createJSONStorage(() => localStorage),
      partialize: (s: GraphStore) => workspace(s),
      migrate: (persisted, version) => proj.migrateWorkspace(persisted, version) as GraphStore,
      // Also repairs a v2 state that lost track of a graph or project (e.g. hand-edited storage).
      merge: (persisted, current) => ({
        ...current,
        ...proj.normalizeWorkspace({ ...workspace(current), ...(persisted as Partial<Workspace>) }),
      }),
      // A check that was running when the page closed never finished: say so rather than pretend it passed.
      onRehydrateStorage: () => (state) => {
        if (!state) return;
        for (const g of Object.values(state.graphs)) {
          for (const n of g.nodes) {
            if (n.status !== "checking") continue;
            n.status = "error";
            n.error = t("task.reloadInterrupted");
          }
        }
      },
    },
  ),
);

export const activeGraph = (s: GraphStore) => s.graphs[s.activeId];
/** True while a shared graph is open in the read-only viewer. */
export const isViewing = (s: Pick<GraphStore, "view" | "activeId" | "graphs">) =>
  !!s.view && s.activeId === s.view.id && !!s.graphs[s.view.id];
export const currentProject = (s: GraphStore) => s.projects[s.projectId];
export const canUndo = (s: GraphStore) => !!s.history[s.activeId]?.past.length;
export const canRedo = (s: GraphStore) => !!s.history[s.activeId]?.future.length;
