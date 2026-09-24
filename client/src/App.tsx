import { ReactFlowProvider } from "@xyflow/react";
import { useEffect, useState } from "react";
import { GraphCanvas } from "./graph/GraphCanvas";
import { AddNodeDialog } from "./panels/AddNodeDialog";
import { DeriveDialog } from "./panels/DeriveDialog";
import { Inspector } from "./panels/Inspector";
import { Toolbar } from "./panels/Toolbar";
import { activeGraph, useGraphStore } from "./store/graphStore";

export function App() {
  const [adding, setAdding] = useState(false);
  const [deriveFrom, setDeriveFrom] = useState<string[] | null>(null);
  const graph = useGraphStore(activeGraph);
  const selection = useGraphStore((s) => s.selection);
  const busy = useGraphStore((s) => s.busy);
  const toast = useGraphStore((s) => s.toast);
  const setToast = useGraphStore((s) => s.setToast);

  useEffect(() => {
    if (!toast) return;
    const t = setTimeout(() => setToast(null), 6000);
    return () => clearTimeout(t);
  }, [toast, setToast]);

  const busyLabels = Object.values(busy);

  return (
    <ReactFlowProvider>
      <div className="app">
        <Toolbar onAdd={() => setAdding(true)} onDerive={() => setDeriveFrom(selection)} />
        {graph.parentId && (
          <div className="sandbox-banner" data-testid="sandbox-banner">
            🧪 Sandbox mode — <b>{graph.name}</b>. Changes here don't affect the original graph until you merge back.
          </div>
        )}
        <main className="main">
          <GraphCanvas />
          <Inspector />
        </main>
        {busyLabels.length > 0 && <div className="status">{busyLabels.join(" · ")}</div>}
        {toast && <div className="toast" onClick={() => setToast(null)}>{toast}</div>}
        {adding && <AddNodeDialog onClose={() => setAdding(false)} />}
        {deriveFrom && <DeriveDialog anchorIds={deriveFrom} onClose={() => setDeriveFrom(null)} />}
      </div>
    </ReactFlowProvider>
  );
}
