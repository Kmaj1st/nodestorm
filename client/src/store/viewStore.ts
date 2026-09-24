import type { Graph } from "@nodestorm/shared";
import { create } from "zustand";
import { t } from "../i18n";
import { DEFAULT_VIEW, kindFilterOf, sanitizeView, visibleParts, type ViewPrefs, type Visible } from "../lib/view";
import { viewport } from "../lib/viewport";
import { useGraphStore, type GraphStore } from "./graphStore";

/**
 * Canvas view state: filters (remembered per browser) and focus mode (not remembered).
 * The graph data itself is never changed by any of this.
 */

const KEY = "nodestorm-view";

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
  setPrefs(patch: Partial<ViewPrefs>): void;
  setFocus(focus: Focus | null): void;
}

export const useView = create<ViewState>()((set, get) => ({
  ...load(),
  focus: null,
  setPrefs(patch) {
    const { origins, edgeLabels, todoOnly, hops, kinds } = { ...get(), ...patch };
    const prefs = sanitizeView({ origins, edgeLabels, todoOnly, hops, kinds });
    try {
      localStorage.setItem(KEY, JSON.stringify(prefs));
    } catch {
      /* the choice just won't survive a reload */
    }
    set(prefs);
  },
  setFocus: (focus) => set({ focus }),
}));

/** The focus that applies to `graph` (focus mode is per graph: switching graphs shows everything). */
export function activeFocus(v: Pick<ViewState, "focus" | "hops">, graph: Graph) {
  const f = v.focus;
  return f && f.graphId === graph.id && graph.nodes.some((n) => n.id === f.nodeId) ? { nodeId: f.nodeId, hops: v.hops } : null;
}

/** What the canvas shows of the active graph right now (for code outside React, e.g. the Delete key). */
export function visibleNow(s: GraphStore = useGraphStore.getState()): Visible {
  const v = useView.getState();
  const g = s.graphs[s.activeId];
  return visibleParts(g, v, activeFocus(v, g));
}

/**
 * Select a concept of the active graph and centre the view on it (Find, the notation glossary). A concept the to-do
 * view or a kind filter hides would be selected but invisible, so those filters are turned off first, with a notice.
 * (In focus mode that's not needed: selecting moves the focus to it.)
 */
export function goToConcept(id: string) {
  const s = useGraphStore.getState();
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

// Selecting another concept while focused re-centres the focus on it.
useGraphStore.subscribe((s, prev) => {
  const f = useView.getState().focus;
  if (!f || s.selection === prev.selection || f.graphId !== s.activeId) return;
  const target = focusTarget(s);
  if (target && target !== f.nodeId) useView.getState().setFocus({ graphId: s.activeId, nodeId: target });
});
