import { ReactFlowProvider } from "@xyflow/react";
import { useEffect, useState } from "react";
import { GraphCanvas } from "./graph/GraphCanvas";
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
          <Inspector />
        </main>
        <StatusBar />
        {toast && <div className="toast" onClick={() => setToast(null)}>{toast}</div>}
        {adding && <AddNodeDialog onClose={() => setAdding(false)} />}
        <SenseDialog />
        {settingsOpen && <SettingsDialog onClose={() => setSettingsOpen(false)} />}
        {finding && <FindDialog onClose={() => setFinding(false)} />}
        {deriveFrom && <DeriveDialog anchorIds={deriveFrom} onClose={() => setDeriveFrom(null)} />}
      </div>
    </ReactFlowProvider>
  );
}
