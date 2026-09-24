import { create } from "zustand";
import { useGraphStore } from "./graphStore";

/** The open "Quiz me" dialog (UI state only; the progress itself is stored on the concepts as `mastery`). */
interface QuizState {
  open: {
    graphId: string;
    /** The concept whose learning path can be studied: the one asked for, else the selected one. */
    rootId?: string;
    /** Start with the learning path in scope (opened from the inspector) rather than the whole graph. */
    pathFirst: boolean;
  } | null;
  /** Open for a concept's learning path, or (no id) for the whole graph. */
  openQuiz(rootId?: string): void;
  closeQuiz(): void;
}

export const useQuiz = create<QuizState>()((set) => ({
  open: null,
  openQuiz(rootId) {
    const s = useGraphStore.getState();
    const selected = s.inspect?.kind === "node" ? s.inspect.id : s.selection.length === 1 ? s.selection[0] : undefined;
    set({ open: { graphId: s.activeId, rootId: rootId ?? selected, pathFirst: Boolean(rootId) } });
  },
  closeQuiz: () => set({ open: null }),
}));
