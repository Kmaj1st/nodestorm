import type { Graph } from "@nodestorm/shared";
import { create } from "zustand";
import { t } from "../i18n";
import {
  DEFAULT_VIEW,
  hideIds,
  kindFilterOf,
  parseHidden,
  pruneHidden,
  sanitizeView,
  showIds,
  visibleParts,
  type HiddenMap,
  type ViewPrefs,
  type Visible,
} from "../lib/view";
import { viewport } from "../lib/viewport";
import { isViewing, useGraphStore, type GraphStore } from "./graphStore";

/**
 * Canvas view state: filters (remembered per browser), concepts hidden by hand (remembered for the browser tab's
 * session) and focus mode (not remembered). The graph data itself is never changed by any of this.
 */

const KEY = "nodestorm-view";
const HIDDEN_KEY = "nodestorm-hidden";

function loadHidden(): HiddenMap {
  try {
    const v = sessionStorage.getItem(HIDDEN_KEY);
    return v ? parseHidden(JSON.parse(v)) : {};
  } catch {
    return {}; // storage blocked or garbled
  }
}

function saveHidden(hidden: HiddenMap) {
  try {
    if (Object.keys(hidden).length) sessionStorage.setItem(HIDDEN_KEY, JSON.stringify(hidden));
    else sessionStorage.removeItem(HIDDEN_KEY);
  } catch {
    /* hidden concepts just come back on a reload */
  }
}

function load(): ViewPrefs {
  try {
    const v = localStorage.getItem(KEY);
    return v ? sanitizeView(JSON.parse(v)) : DEFAULT_VIEW;
  } catch {
    return DEFAULT_VIEW; // storage blocked or garbled
  }
}

export interface Focus {
  graphId: string;
  nodeId: string;
}

interface ViewState extends ViewPrefs {
  /** Focus mode: only this concept and its neighbourhood (within `hops`) are shown. */
  focus: Focus | null;
  /** The 3D view is open (not remembered: it is a dialog). */
  view3d: boolean;
  /** Concepts hidden by hand, per graph (see lib/view.ts HiddenMap). Hide with `hideConcepts`: it also deselects. */
  hidden: HiddenMap;
  /** What the last hiding did, for screen readers (HiddenBar's status line). */
  hiddenSaid: string;
  /**
   * "Select several" (not remembered): taps and clicks on concepts add them to the selection or take them out, as
   * Shift/Ctrl-click does, so Mix and Derive can be reached without a keyboard (GraphCanvas.tsx). It ends when another
   * graph or project opens (see the subscription below) and can't start in the read-only viewer.
   */
  selecting: boolean;
  setPrefs(patch: Partial<ViewPrefs>): void;
  setFocus(focus: Focus | null): void;
  setView3d(open: boolean): void;
  setSelecting(on: boolean): void;
  setHidden(hidden: HiddenMap): void;
  /** Show concepts of a graph again: `ids`, or all of them. */
  show(graphId: string, ids?: readonly string[]): void;
}

export const useView = create<ViewState>()((set, get) => ({
  ...load(),
  focus: null,
  view3d: false,
  hidden: loadHidden(),
  hiddenSaid: "",
  selecting: false,
  setPrefs(patch) {
    const { origins, edgeLabels, todoOnly, hops, kinds, layout, physics } = { ...get(), ...patch };
    const prefs = sanitizeView({ origins, edgeLabels, todoOnly, hops, kinds, layout, physics });
    try {
      localStorage.setItem(KEY, JSON.stringify(prefs));
    } catch {
      /* the choice just won't survive a reload */
    }
    set(prefs);
  },
  setFocus: (focus) => set({ focus }),
  setView3d: (view3d) => set({ view3d }),
  setSelecting: (on) => set({ selecting: on && !isViewing(useGraphStore.getState()) }),
  setHidden(hidden) {
    if (hidden === get().hidden) return;
    saveHidden(hidden);
    set({ hidden });
  },
  show: (graphId, ids) => get().setHidden(showIds(get().hidden, graphId, ids)),
}));

const NONE: readonly string[] = [];
/** Selector: the concepts hidden by hand in graph `graphId` (a stable empty list when there are none). */
export const hiddenIn = (graphId: string) => (v: Pick<ViewState, "hidden">) => v.hidden[graphId] ?? NONE;

/** The focus that applies to `graph` (focus mode is per graph: switching graphs shows everything). */
export function activeFocus(v: Pick<ViewState, "focus" | "hops">, graph: Graph) {
  const f = v.focus;
  return f && f.graphId === graph.id && graph.nodes.some((n) => n.id === f.nodeId) ? { nodeId: f.nodeId, hops: v.hops } : null;
}

/** What the canvas shows of the active graph right now (for code outside React, e.g. the Delete key). */
export function visibleNow(s: GraphStore = useGraphStore.getState()): Visible {
  const v = useView.getState();
  const g = s.graphs[s.activeId];
  return visibleParts(g, v, activeFocus(v, g), new Set(hiddenIn(s.activeId)(v)));
}

/**
 * Hide concepts of the active graph from the canvas (a view choice, not an edit). They leave the selection, the
 * inspector closes if it shows one of them (or a relation of one), and focus mode ends if it is centred on one.
 * Returns how many were hidden.
 */
export function hideConcepts(ids: readonly string[], { quiet = false } = {}): number {
  const s = useGraphStore.getState();
  const g = s.graphs[s.activeId];
  const already = hiddenIn(s.activeId)(useView.getState());
  const hide = ids.filter((id) => !already.includes(id) && g?.nodes.some((n) => n.id === id));
  if (!hide.length) return 0;
  keepFocus(hide);
  // Deselect first: selecting (or inspecting) a hidden concept shows it again (see the subscription below).
  if (s.selection.some((id) => hide.includes(id))) s.setSelection(s.selection.filter((id) => !hide.includes(id)));
  const ins = s.inspect;
  const rel = ins?.kind === "edge" ? g.relations.find((r) => r.id === ins.relationId) : undefined;
  if ((ins?.kind === "node" && hide.includes(ins.id)) || (rel && (hide.includes(rel.a) || hide.includes(rel.b)))) s.setInspect(null);
  const v = useView.getState();
  if (v.focus?.graphId === s.activeId && hide.includes(v.focus.nodeId)) v.setFocus(null);
  v.setHidden(hideIds(v.hidden, s.activeId, hide));
  if (!quiet) {
    const name = g.nodes.find((n) => n.id === hide[0])?.name ?? "";
    useView.setState({ hiddenSaid: hide.length === 1 ? t("hide.saidOne", { name }) : t("hide.saidMany", { n: hide.length }) });
  }
  return hide.length;
}

/**
 * Hiding removes the focused concept's card, or closes the inspector whose Hide button had the focus: the focus would
 * fall to the page. From the canvas it goes on to the next concept still shown (in the canvas's order), otherwise to
 * the "N hidden" button in the canvas corner, where they can be shown again.
 */
function keepFocus(hide: readonly string[]) {
  if (typeof document === "undefined") return;
  const had = document.activeElement;
  const cards = [...document.querySelectorAll<HTMLElement>(".react-flow__node[data-id]")];
  const from = had ? cards.findIndex((c) => c.contains(had)) : -1;
  const next = from < 0 ? undefined : [...cards.slice(from + 1), ...cards.slice(0, from)].find((c) => !hide.includes(c.dataset.id ?? ""));
  const nextId = next?.dataset.id;
  requestAnimationFrame(() => {
    const now = document.activeElement;
    if (now && now !== document.body && now.isConnected) return; // still somewhere (a menu item, the canvas)
    const card = nextId ? document.querySelector<HTMLElement>(`.react-flow__node[data-id="${CSS.escape(nextId)}"]`) : null;
    (card ?? document.querySelector<HTMLElement>('[data-testid="hidden-count"]'))?.focus();
  });
}

/** "Hide others" (Shift+H): hide every concept of the active graph that isn't selected, and say how to undo it. */
export function hideOthers(): number {
  const s = useGraphStore.getState();
  const g = s.graphs[s.activeId];
  if (!g || !s.selection.length) return 0;
  // The toast says what happened (and is read out), so no second announcement.
  const n = hideConcepts(g.nodes.filter((c) => !s.selection.includes(c.id)).map((c) => c.id), { quiet: true });
  if (n) s.setToast(t("hide.others", { n }), "info");
  return n;
}

/**
 * Select a concept of the active graph and centre the view on it (Find, the notation glossary, the 3D view). A concept
 * hidden by hand is shown again. A concept the to-do
 * view or a kind filter hides would be selected but invisible, so those filters are turned off first, with a notice.
 * (In focus mode that's not needed: selecting moves the focus to it.)
 */
export function goToConcept(id: string) {
  const s = useGraphStore.getState();
  // A concept hidden by hand is shown again (nothing else needs to change for it).
  if (hiddenIn(s.activeId)(useView.getState()).includes(id)) useView.getState().show(s.activeId, [id]);
  const view = useView.getState();
  const node = s.graphs[s.activeId]?.nodes.find((n) => n.id === id);
  const kindHidden = node && !view.kinds[kindFilterOf(node)];
  const graph = s.graphs[s.activeId];
  // Focus mode on another graph doesn't count: only this graph's focus moves to the selected concept.
  const focused = graph ? activeFocus(view, graph) : null;
  if (!visibleNow().nodes.has(id) && (view.todoOnly || kindHidden) && !focused) {
    view.setPrefs({ todoOnly: false, ...(node && kindHidden ? { kinds: { ...view.kinds, [kindFilterOf(node)]: true } } : {}) });
    s.setToast(t("find.revealed"), "info");
  }
  // Let the canvas render the newly visible node before centring on it.
  requestAnimationFrame(() => viewport.focus(id));
}

/** The concept "Focus" applies to: the single selected one. */
export const focusTarget = (s: Pick<GraphStore, "selection">) => (s.selection.length === 1 ? s.selection[0] : null);

/** Enter focus mode on the selected concept, or leave it when it is already on. */
export function toggleFocus() {
  const s = useGraphStore.getState();
  const v = useView.getState();
  const target = focusTarget(s);
  if (v.focus && v.focus.graphId === s.activeId) v.setFocus(null);
  else if (target) v.setFocus({ graphId: s.activeId, nodeId: target });
}

// Select several belongs to the graph it was started on: opening another graph or project, or the viewer (a share
// link, a version), ends it (those all clear the selection too). Clearing the selection or editing doesn't.
useGraphStore.subscribe((s, prev) => {
  if (!useView.getState().selecting) return;
  if (s.activeId !== prev.activeId || s.projectId !== prev.projectId || s.view !== prev.view) useView.getState().setSelecting(false);
});

// Selecting another concept while focused re-centres the focus on it.
useGraphStore.subscribe((s, prev) => {
  const f = useView.getState().focus;
  if (!f || s.selection === prev.selection || f.graphId !== s.activeId) return;
  const target = focusTarget(s);
  if (target && target !== f.nodeId) useView.getState().setFocus({ graphId: s.activeId, nodeId: target });
});

// Concepts hidden by hand: forget the ones that are gone for good (deleted concepts Undo/Redo can't bring back,
// discarded graphs), and show one again when it gets selected or opened in the inspector by other means (a link in the
// inspector, the walkthrough, a new concept).
useGraphStore.subscribe((s, prev) => {
  const v = useView.getState();
  if (!Object.keys(v.hidden).length) return;
  if (s.graphs !== prev.graphs || s.history !== prev.history) v.setHidden(pruneHidden(v.hidden, s.graphs, s.history));
  if (s.selection === prev.selection && s.inspect === prev.inspect) return;
  const hidden = hiddenIn(s.activeId)(useView.getState());
  const wanted = s.inspect?.kind === "node" ? [...s.selection, s.inspect.id] : s.selection;
  const back = hidden.filter((id) => wanted.includes(id));
  if (back.length) useView.getState().show(s.activeId, back);
});
