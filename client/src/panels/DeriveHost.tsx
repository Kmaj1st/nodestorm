import { useDerive } from "../store/deriveStore";
import { useGraphStore } from "../store/graphStore";
import { DerivePanel } from "./lazy";

/** Mounts the "Derive together" panel while it is open. The share viewer has no panel: it is for the user's own work. */
export function DeriveHost() {
  const open = useDerive((s) => s.open);
  const viewing = useGraphStore((s) => Boolean(s.view));
  if (!open || viewing) return null;
  return <DerivePanel onClose={() => useDerive.getState().close()} />;
}
