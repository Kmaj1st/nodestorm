import { create } from "zustand";
import type { Problem } from "../lib/derivation";
import { useGraphStore } from "./graphStore";

/**
 * Whether the "Derive together" panel is open, and the buttons' way to open or close it, apart from the panel's store
 * (deriveStore.ts: documents, PDF import, search index, tutor), which loads with the panel's own chunk.
 */

export const useDeriveOpen = create<{ open: boolean }>()(() => ({ open: false }));

const loadDerive = () => import("./deriveStore");

/** Open the panel (on a new session for `problem`, if given). */
export async function openDerivePanel(opts?: { problem?: Problem }) {
  const { useDerive } = await loadDerive();
  await useDerive.getState().openPanel(opts);
}

export function closeDerivePanel() {
  if (useDeriveOpen.getState().open) void loadDerive().then(({ useDerive }) => useDerive.getState().close());
}

/** A deleted project's documents and sessions go too, whether or not the panel was ever opened. */
useGraphStore.subscribe((s, prev) => {
  const gone = Object.keys(prev.projects).filter((id) => !s.projects[id]);
  if (gone.length) void import("../lib/docDb").then((db) => gone.forEach((id) => db.deleteProjectData(id).catch(() => undefined)));
});
