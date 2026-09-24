import { create } from "zustand";
import { activeGraph, useGraphStore } from "./graphStore";

/** The open "Absurd chain" dialog and the two ends it starts with (UI state only; nothing is stored). */
interface AbsurdState {
  open: { from: string; to: string } | null;
  /**
   * Open the dialog. Without names it starts from the selection: two selected concepts become the two ends, one
   * selected (or open in the inspector) concept the start; otherwise both ends are left for the user to type.
   */
  openAbsurd(from?: string, to?: string): void;
  closeAbsurd(): void;
}

export const useAbsurd = create<AbsurdState>()((set) => ({
  open: null,
  openAbsurd(from, to) {
    const s = useGraphStore.getState();
    const nodes = activeGraph(s)?.nodes ?? [];
    const name = (id?: string) => nodes.find((n) => n.id === id)?.name ?? "";
    const one = s.inspect?.kind === "node" ? s.inspect.id : s.selection[0];
    const [a, b] = s.selection.length === 2 ? s.selection.map(name) : [name(one), ""];
    set({ open: { from: from ?? a, to: to ?? b } });
  },
  closeAbsurd: () => set({ open: null }),
}));
