import { useEffect } from "react";
import { useGraphStore } from "../store/graphStore";
import { useWalkthrough } from "../store/walkthroughStore";
// Loaded lazily like the other dialogs: most sessions never present a graph.
import { WalkthroughDialog } from "./lazy";

/** Mounts the walkthrough while it is open; it closes when another graph is shown. Works in the share viewer too. */
export function WalkthroughHost() {
  const open = useWalkthrough((s) => s.open);
  const close = useWalkthrough((s) => s.closeWalkthrough);
  const activeId = useGraphStore((s) => s.activeId);
  const stale = !!open && open.graphId !== activeId;
  useEffect(() => {
    if (stale) close();
  }, [stale, close]);
  if (!open || stale) return null;
  return <WalkthroughDialog key={`${open.graphId}:${open.rootId ?? ""}`} rootId={open.rootId} onClose={close} />;
}
