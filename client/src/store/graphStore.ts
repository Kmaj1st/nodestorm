import { GraphExport, type Graph } from "@nodestorm/shared";
import { create } from "zustand";
import { createJSONStorage, persist } from "zustand/middleware";
import { emptyGraph, fork, merge } from "../lib/graphOps";
import * as hist from "../lib/history";

export type Inspect =
  | { kind: "node"; id: string }
  | { kind: "edge"; relationId: string; dir: "aToB" | "bToA" }
  | null;

interface State {
  graphs: Record<string, Graph>;
  mainId: string;
  activeId: string;
  // UI state (not persisted)
  selection: string[];
  inspect: Inspect;
  busy: Record<string, BusyTask>; // running AI tasks by key
  toast: string | null;
  settingsOpen: boolean;
  /** Node whose meaning the user is being asked to pick ("what do you mean?" dialog). */
  clarifying: { graphId: string; nodeId: string } | null;
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
  setBusy(key: string, label: string | null): void;
  setToast(msg: string | null): void;
  switchTo(graphId: string): void;
  forkActive(): void;
  mergeSandbox(sandboxId: string): void;
  discardSandbox(sandboxId: string): void;
  exportJson(): string;
  importJson(text: string): void;
  reset(): void;
}

export type GraphStore = State & Actions;

function initial(): Pick<State, "graphs" | "mainId" | "activeId"> {
  const g = emptyGraph();
  return { graphs: { [g.id]: g }, mainId: g.id, activeId: g.id };
}

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
        if (label) busy[key] = { label, startedAt: Date.now() };
        else delete busy[key];
        set({ busy });
      },
      setToast: (toast) => set({ toast }),
      switchTo: (activeId) => set({ activeId, selection: [], inspect: null }),

      forkActive() {
        const { graphs, activeId } = get();
        const src = graphs[activeId];
        const n = Object.values(graphs).filter((g) => g.parentId).length + 1;
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
        const { graphs, activeId, mainId } = get();
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
        const { graphs, mainId } = get();
        // Main graph first so import knows which one is the root.
        const ordered = [graphs[mainId], ...Object.values(graphs).filter((g) => g.id !== mainId)];
        const doc: GraphExport = { format: "nodestorm/v1", graphs: ordered };
        return JSON.stringify(doc, null, 2);
      },
      importJson(text) {
        const doc = GraphExport.parse(JSON.parse(text));
        if (!doc.graphs.length) throw new Error("File contains no graphs");
        const graphs = Object.fromEntries(doc.graphs.map((g) => [g.id, g]));
        const main = doc.graphs.find((g) => !g.parentId) ?? doc.graphs[0];
        set({ graphs, mainId: main.id, activeId: main.id, selection: [], inspect: null, history: {} });
      },
      reset: () => set({ ...initial(), selection: [], inspect: null, history: {} }),
    }),
    {
      name: "nodestorm",
      version: 1,
      storage: createJSONStorage(() => localStorage),
      partialize: (s) => ({ graphs: s.graphs, mainId: s.mainId, activeId: s.activeId }),
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
export const canUndo = (s: GraphStore) => !!s.history[s.activeId]?.past.length;
export const canRedo = (s: GraphStore) => !!s.history[s.activeId]?.future.length;
