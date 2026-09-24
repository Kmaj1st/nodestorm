import { create } from "zustand";
import { useGraphStore } from "./graphStore";

/** The open walkthrough (presentation) overlay: UI state only, it never changes a graph. */
interface WalkthroughState {
  /** `rootId`: walk through that concept's learning path; none: the whole graph in study order. */
  open: { graphId: string; rootId?: string } | null;
  openWalkthrough(rootId?: string): void;
  closeWalkthrough(): void;
}

export const useWalkthrough = create<WalkthroughState>()((set) => ({
  open: null,
  openWalkthrough: (rootId) => set({ open: { graphId: useGraphStore.getState().activeId, rootId } }),
  closeWalkthrough: () => set({ open: null }),
}));
