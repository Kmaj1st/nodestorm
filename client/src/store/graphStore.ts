import type { Graph, GraphExport } from "@nodestorm/shared";
import { create } from "zustand";
import { createJSONStorage, persist } from "zustand/middleware";
import { buildExample, EXAMPLES } from "../lib/examples";
import { fork, merge } from "../lib/graphOps";
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
  settingsOpen: boolean;
  /** Node whose meaning the user is being asked to pick ("what do you mean?" dialog). */
  clarifying: { graphId: string; nodeId: string } | null;
  /** Node whose learning path is highlighted on the canvas (everything else is dimmed). */
  highlight: { graphId: string; nodeId: string } | null;
  /** Undo/redo stacks per graph id (in memory only). */
  history: Record<string, hist.History<Graph>>;
}

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

export interface BusyTask {
  label: string;
  startedAt: number;
}

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
  setBusy(key: string, label: string | null): void;
  setHighlight(h: State["highlight"]): void;
  setToast(msg: string | null): void;
  switchTo(graphId: string): void;
  newProject(name?: string): void;
  switchProject(projectId: string): void;
  renameProject(projectId: string, name: string): void;
  duplicateProject(projectId: string): void;
  deleteProject(projectId: string): void;
  /** Build the Group theory example into the active (empty) graph as one undo step. */
  loadExample(): void;
  forkActive(): void;
  mergeSandbox(sandboxId: string): void;
  discardSandbox(sandboxId: string): void;
  /** The current project (main graph first, then its sandboxes) as a nodestorm/v1 file. */
  exportJson(): string;
  /** Add a file's graphs as a new project and switch to it, repairing what it can. */
  importJson(text: string): { name: string; fixes: string[] };
  reset(): void;
}

export type GraphStore = State & Actions;

type Workspace = proj.Workspace;

function initial(): Workspace {
  return proj.createProject({ graphs: {}, projects: {}, projectId: "", activeId: "" }, "My brainstorm");
}

const workspace = (s: Workspace): Workspace => ({ graphs: s.graphs, projects: s.projects, projectId: s.projectId, activeId: s.activeId });
/** Fresh UI state after switching projects. */
const cleared = { selection: [], inspect: null, highlight: null } satisfies Partial<State>;

/** Move through a graph's history. A check restored as "checking" with no task running is marked failed. */
function travel(s: State, id: string, step: typeof hist.undo<Graph>): Pick<State, "graphs" | "history"> | null {
  const g = s.graphs[id];
  const r = g && step(s.history[id] ?? hist.emptyHistory<Graph>(), g);
  if (!r) return null;
  // Busy key format of analyzeNode (lib/actions.ts).
  const stale = (n: Graph["nodes"][number]) => n.status === "checking" && !s.busy[`analyze:${id}:${n.id}`];
  const nodes = r.present.nodes.map((n) =>
    stale(n) ? { ...n, status: "error" as const, error: "The check was interrupted by undo/redo. Retry to run it again." } : n,
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
      settingsOpen: false,
      clarifying: null,
      history: {},
      highlight: null,

      mutate(fn, graphId, opts = {}) {
        const id = graphId ?? get().activeId;
        const g = get().graphs[id];
        if (!g) return; // graph was discarded while an AI call was in flight
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
      setBusy(key, label) {
        const busy = { ...get().busy };
        if (label) busy[key] = { label, startedAt: busy[key]?.startedAt ?? Date.now() };
        else delete busy[key];
        set({ busy });
      },
      setToast: (toast) => set({ toast }),
      setHighlight: (highlight) => set({ highlight }),
      switchTo: (activeId) => set({ activeId, selection: [], inspect: null }),

      newProject: (name) => set({ ...proj.createProject(workspace(get()), name), ...cleared }),
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
        if (p?.name.startsWith(proj.DEFAULT_PROJECT_NAME)) get().renameProject(p.id, proj.uniqueProjectName(get(), data.name));
      },

      forkActive() {
        const { graphs, activeId, projects, projectId } = get();
        const src = graphs[activeId];
        const n = proj.projectGraphs(get(), projects[projectId]).filter((g) => g.parentId).length + 1;
        const sb = fork(src, `Sandbox ${n}`);
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
            n.error = "The check was interrupted (page closed or reloaded). Retry to run it again.";
          }
        }
      },
    },
  ),
);

export const activeGraph = (s: GraphStore) => s.graphs[s.activeId];
export const currentProject = (s: GraphStore) => s.projects[s.projectId];
export const canUndo = (s: GraphStore) => !!s.history[s.activeId]?.past.length;
export const canRedo = (s: GraphStore) => !!s.history[s.activeId]?.future.length;
