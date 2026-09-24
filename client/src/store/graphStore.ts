import { GraphExport, type Graph } from "@nodestorm/shared";
import { create } from "zustand";
import { createJSONStorage, persist } from "zustand/middleware";
import { emptyGraph, fork, merge } from "../lib/graphOps";

export type Inspect =
  | { kind: "node"; id: string }
  | { kind: "edge"; relationId: string; dir: "aToB" | "bToA" }
  | null;

interface State {
  graphs: Record<string, Graph>;
  mainId: string;
  activeId: string;
  provider: string | null;
  // UI state (not persisted)
  selection: string[];
  inspect: Inspect;
  busy: Record<string, string>; // key -> label of running AI tasks
  toast: string | null;
}

interface Actions {
  /** Apply a pure graph operation to a specific graph (defaults to the active one). */
  mutate(fn: (g: Graph) => Graph, graphId?: string): void;
  setSelection(ids: string[]): void;
  setInspect(i: Inspect): void;
  setProvider(id: string | null): void;
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

export const useGraphStore = create<GraphStore>()(
  persist(
    (set, get) => ({
      ...initial(),
      provider: null,
      selection: [],
      inspect: null,
      busy: {},
      toast: null,

      mutate(fn, graphId) {
        const id = graphId ?? get().activeId;
        const g = get().graphs[id];
        if (!g) return; // graph was discarded while an AI call was in flight
        set({ graphs: { ...get().graphs, [id]: fn(g) } });
      },
      setSelection: (selection) => set({ selection }),
      setInspect: (inspect) => set({ inspect }),
      setProvider: (provider) => set({ provider }),
      setBusy(key, label) {
        const busy = { ...get().busy };
        if (label) busy[key] = label;
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
        // Sandboxes forked from this one are re-parented onto its parent.
        for (const g of Object.values(rest)) if (g.parentId === sandboxId) rest[g.id] = { ...g, parentId: parent.id };
        set({ graphs: rest, activeId: parent.id, selection: [], inspect: null });
      },
      discardSandbox(sandboxId) {
        const { graphs, activeId, mainId } = get();
        const sb = graphs[sandboxId];
        if (!sb?.parentId) return;
        const rest = { ...graphs };
        delete rest[sandboxId];
        for (const g of Object.values(rest)) if (g.parentId === sandboxId) rest[g.id] = { ...g, parentId: sb.parentId };
        const nextActive = activeId === sandboxId ? (rest[sb.parentId] ? sb.parentId : mainId) : activeId;
        set({ graphs: rest, activeId: nextActive, selection: [], inspect: null });
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
        set({ graphs, mainId: main.id, activeId: main.id, selection: [], inspect: null });
      },
      reset: () => set({ ...initial(), selection: [], inspect: null }),
    }),
    {
      name: "nodestorm",
      version: 1,
      storage: createJSONStorage(() => localStorage),
      partialize: (s) => ({ graphs: s.graphs, mainId: s.mainId, activeId: s.activeId, provider: s.provider }),
      // Nodes left mid-check when the page closed would otherwise spin forever.
      onRehydrateStorage: () => (state) => {
        if (!state) return;
        for (const g of Object.values(state.graphs)) {
          for (const n of g.nodes) if (n.status === "checking") n.status = n.missingDeps.length ? "blocked" : "ok";
        }
      },
    },
  ),
);

export const activeGraph = (s: GraphStore) => s.graphs[s.activeId];
