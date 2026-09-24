import { ReactFlowProvider } from "@xyflow/react";
import { useEffect, useState } from "react";
import { GraphCanvas } from "./graph/GraphCanvas";
import { removeNode, removeRelation } from "./lib/graphOps";
import { decodeShare, shareToken } from "./lib/share";
import { AddNodeDialog } from "./panels/AddNodeDialog";
import { DeriveDialog } from "./panels/DeriveDialog";
import { FindDialog } from "./panels/FindDialog";
import { Inspector } from "./panels/Inspector";
import { SenseDialog } from "./panels/SenseDialog";
import { SettingsDialog } from "./panels/SettingsDialog";
import { StatusBar } from "./panels/StatusBar";
import { Toolbar } from "./panels/Toolbar";
import { activeGraph, isViewing, useGraphStore } from "./store/graphStore";
import { toggleFocus, useView, visibleNow } from "./store/viewStore";

export function App() {
  const [adding, setAdding] = useState(false);
  const [deriveFrom, setDeriveFrom] = useState<string[] | null>(null);
  const [finding, setFinding] = useState(false);
  const graph = useGraphStore(activeGraph);
  const selection = useGraphStore((s) => s.selection);
  const toast = useGraphStore((s) => s.toast);
  const toastKind = useGraphStore((s) => s.toastKind);
  const setToast = useGraphStore((s) => s.setToast);
  const settingsOpen = useGraphStore((s) => s.settingsOpen);
  const setSettingsOpen = useGraphStore((s) => s.setSettingsOpen);
  const viewing = useGraphStore(isViewing);

  // A share link (#share=…) opens its graph read-only, on load and when a link is pasted into this tab.
  useEffect(() => {
    const open = () => void openShareLink();
    open();
    window.addEventListener("hashchange", open);
    return () => window.removeEventListener("hashchange", open);
  }, []);

  // Undo/redo, Delete, and F / Esc for focus mode. React Flow's own delete key is off (GraphCanvas) so deletions
  // go through history.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      // Leave keys alone while typing, and while a dialog is open.
      const t = e.target instanceof Element ? e.target : null;
      if (t?.closest("input, textarea, select, [contenteditable=true], .modal")) return;
      const s = useGraphStore.getState();
      const mod = e.ctrlKey || e.metaKey;
      const key = e.key.toLowerCase();
      if (mod && !e.altKey && (key === "z" || key === "y")) {
        e.preventDefault();
        if (key === "y" || e.shiftKey) s.redo();
        else s.undo();
      } else if (e.key === "Escape" && useView.getState().focus) {
        // Menus and popovers close on Escape themselves; don't also leave focus mode behind them.
        if (t?.closest(".menu, .popover")) return;
        useView.getState().setFocus(null);
      } else if (key === "f" && !mod && !e.altKey) {
        // Focus mode, from the canvas only (like Delete).
        if (t && t !== document.body && !t.closest(".react-flow")) return;
        e.preventDefault();
        toggleFocus();
      } else if ((e.key === "Delete" || e.key === "Backspace") && !mod) {
        // Only from the canvas (or nothing focused): not while a menu, popover or inspector button has focus.
        if (t && t !== document.body && !t.closest(".react-flow")) return;
        // Only what the canvas shows: concepts and relations hidden by focus mode or a filter are never deleted.
        const shown = visibleNow(s);
        const selected = s.selection.filter((id) => shown.nodes.has(id));
        // An open relation wins over the node selection (clicking an arrowhead doesn't deselect nodes).
        const ins = s.inspect;
        if (ins?.kind === "edge" && shown.relations.has(ins.relationId)) s.mutate((g) => removeRelation(g, ins.relationId));
        else if (selected.length) s.mutate((g) => selected.reduce(removeNode, g));
        else return;
        e.preventDefault();
        s.setSelection([]);
        s.setInspect(null);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  useEffect(() => {
    if (!toast) return;
    const t = setTimeout(() => setToast(null), 6000);
    return () => clearTimeout(t);
  }, [toast, setToast]);

  // Ctrl/Cmd+K opens "find concept" from anywhere (and toggles it closed again).
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        setFinding((f) => !f);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  return (
    <ReactFlowProvider>
      <div className={`app${viewing ? " app--viewing" : ""}`}>
        <Toolbar onAdd={() => setAdding(true)} onDerive={() => setDeriveFrom(selection)} onFind={() => setFinding(true)} />
        {viewing && <ViewerBanner />}
        {graph.parentId && (
          <div className="sandbox-banner" data-testid="sandbox-banner">
            🧪 Sandbox mode — <b>{graph.name}</b>. Changes here don't affect the original graph until you merge back.
          </div>
        )}
        <main className="main">
          <GraphCanvas />
          <InspectorSheet />
        </main>
        <StatusBar />
        {toast && (
          <div
            className={`toast toast--${toastKind}`}
            role={toastKind === "error" ? "alert" : "status"}
            onClick={() => setToast(null)}
          >
            <span>{toast}</span>
            <button className="toast__close" aria-label="Dismiss">✕</button>
          </div>
        )}
        {adding && <AddNodeDialog onClose={() => setAdding(false)} />}
        <SenseDialog />
        {settingsOpen && <SettingsDialog onClose={() => setSettingsOpen(false)} />}
        {finding && <FindDialog onClose={() => setFinding(false)} />}
        {deriveFrom && <DeriveDialog anchorIds={deriveFrom} onClose={() => setDeriveFrom(null)} />}
      </div>
    </ReactFlowProvider>
  );
}

/** Remove the share link from the address bar (without a reload or a new history entry). */
function clearShareHash() {
  if (shareToken(location.hash) !== null) history.replaceState(null, "", location.pathname + location.search);
}

/** Open the graph in the page's #share= link, if any. A bad link leaves the user's own work on screen. */
async function openShareLink() {
  const token = shareToken(location.hash);
  if (token === null) return;
  const s = useGraphStore.getState();
  try {
    const { graph, name, fixes } = await decodeShare(token);
    // The hash may have changed while decoding (another link pasted): the newer one wins.
    if (shareToken(location.hash) !== token) return;
    s.openView(graph, name);
    // Replaces any earlier message (e.g. about a broken link opened before this one).
    s.setToast(fixes.length ? `The shared graph was repaired: ${fixes.join("; ")}.` : null, "info");
  } catch (e) {
    clearShareHash();
    s.setToast(`Couldn't open the shared link. ${e instanceof Error ? e.message : e} Your own projects are unchanged.`);
  }
}

/** Shown while a shared graph is open read-only: save it as a project of your own, or go back to your work. */
function ViewerBanner() {
  const view = useGraphStore((s) => s.view);
  const saveCopy = () => {
    const s = useGraphStore.getState();
    const name = s.saveViewCopy();
    clearShareHash();
    if (name) s.setToast(`Saved as a new project “${name}”. Your other projects are unchanged.`, "info");
  };
  const close = () => {
    useGraphStore.getState().closeView();
    clearShareHash();
  };
  return (
    <div className="viewer-banner" data-testid="viewer-banner" role="status">
      <span>
        👁 Viewing a shared graph{view?.name ? <> — <b>{view.name}</b></> : null}. Save a copy to edit.
      </span>
      <span className="viewer-banner__actions">
        <button className="primary" onClick={saveCopy}>Save a copy</button>
        <button onClick={close} title="Close the shared graph and go back to your own projects">Close</button>
      </span>
    </div>
  );
}

const SMALL_SCREEN = "(max-width: 800px)";

/**
 * The inspector. On small screens (see styles.css) it is a bottom sheet under the canvas that can be
 * collapsed; it starts collapsed there and opens whenever something is selected.
 */
function InspectorSheet() {
  const inspect = useGraphStore((s) => s.inspect);
  const [open, setOpen] = useState(() => !window.matchMedia?.(SMALL_SCREEN).matches);
  useEffect(() => {
    if (inspect) setOpen(true);
  }, [inspect]);
  return (
    <div className={`sheet${open ? "" : " sheet--closed"}`}>
      <button className="sheet__toggle" aria-expanded={open} aria-controls="inspector-sheet" onClick={() => setOpen(!open)}>
        {open ? "▾ Hide details" : "▴ Show details"}
      </button>
      <div className="sheet__content" id="inspector-sheet">
        <Inspector />
      </div>
    </div>
  );
}
