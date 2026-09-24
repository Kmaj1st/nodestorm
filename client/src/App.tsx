import { ReactFlowProvider } from "@xyflow/react";
import { useEffect, useState } from "react";
import { GraphCanvas } from "./graph/GraphCanvas";
import { removeNode, removeRelation } from "./lib/graphOps";
import { AddNodeDialog } from "./panels/AddNodeDialog";
import { DeriveDialog } from "./panels/DeriveDialog";
import { FindDialog } from "./panels/FindDialog";
import { Inspector } from "./panels/Inspector";
import { SenseDialog } from "./panels/SenseDialog";
import { SettingsDialog } from "./panels/SettingsDialog";
import { StatusBar } from "./panels/StatusBar";
import { Toolbar } from "./panels/Toolbar";
import { activeGraph, useGraphStore } from "./store/graphStore";

export function App() {
  const [adding, setAdding] = useState(false);
  const [deriveFrom, setDeriveFrom] = useState<string[] | null>(null);
  const [finding, setFinding] = useState(false);
  const graph = useGraphStore(activeGraph);
  const selection = useGraphStore((s) => s.selection);
  const toast = useGraphStore((s) => s.toast);
  const setToast = useGraphStore((s) => s.setToast);
  const settingsOpen = useGraphStore((s) => s.settingsOpen);
  const setSettingsOpen = useGraphStore((s) => s.setSettingsOpen);

  // Undo/redo and Delete. React Flow's own delete key is off (GraphCanvas) so deletions go through history.
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
      } else if ((e.key === "Delete" || e.key === "Backspace") && !mod) {
        // An open relation wins over the node selection (clicking an arrowhead doesn't deselect nodes).
        const ins = s.inspect;
        if (ins?.kind === "edge") s.mutate((g) => removeRelation(g, ins.relationId));
        else if (s.selection.length) s.mutate((g) => s.selection.reduce(removeNode, g));
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
      <div className="app">
        <Toolbar onAdd={() => setAdding(true)} onDerive={() => setDeriveFrom(selection)} onFind={() => setFinding(true)} />
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
          <div className="toast" role="alert" onClick={() => setToast(null)}>
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
