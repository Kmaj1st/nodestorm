import type { ProvidersResponse } from "@nodestorm/shared";
import { useEffect, useRef, useState } from "react";
import { mix } from "../lib/actions";
import { api, setProvider as setApiProvider } from "../lib/api";
import { activeGraph, useGraphStore } from "../store/graphStore";

export function Toolbar({ onAdd, onDerive }: { onAdd: () => void; onDerive: () => void }) {
  const s = useGraphStore();
  const graph = useGraphStore(activeGraph);
  const [providers, setProviders] = useState<ProvidersResponse | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    api.providers().then(setProviders).catch(() => setProviders(null));
  }, []);
  useEffect(() => setApiProvider(s.provider), [s.provider]);

  const selected = graph.nodes.filter((n) => s.selection.includes(n.id));
  const blocked = selected.filter((n) => n.status === "blocked");
  const busyMix = Object.keys(s.busy).some((k) => k.startsWith("mix:"));
  const canMix = selected.length === 2 && blocked.length === 0 && !busyMix;
  const canDerive = selected.length >= 1 && blocked.length === 0;
  const blockReason = blocked.length ? `Install missing dependencies of ${blocked.map((n) => n.name).join(", ")} first` : undefined;

  const sandboxes = Object.values(s.graphs).filter((g) => g.parentId);
  const main = s.graphs[s.mainId];

  const doExport = () => {
    const blob = new Blob([s.exportJson()], { type: "application/json" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = `nodestorm-${new Date().toISOString().slice(0, 10)}.json`;
    a.click();
    URL.revokeObjectURL(a.href);
  };
  const doImport = async (file: File) => {
    try {
      s.importJson(await file.text());
    } catch (e) {
      s.setToast(`Import failed: ${e instanceof Error ? e.message : e}`);
    }
  };

  return (
    <header className="toolbar">
      <div className="toolbar__brand">NodeStorm</div>

      <div className="toolbar__group">
        <button className="primary" onClick={onAdd}>+ Add concept</button>
        <button
          onClick={() => mix(selected[0].id, selected[1].id)}
          disabled={!canMix}
          title={blockReason ?? (selected.length !== 2 ? "Select exactly two concepts (Shift-click)" : "Find how these two relate")}
        >
          {busyMix ? "Mixing…" : "Mix ⇄"}
        </button>
        <button onClick={onDerive} disabled={!canDerive} title={blockReason ?? "Propose new concepts from the selection"}>
          Derive ✦
        </button>
      </div>

      <div className="toolbar__group">
        <select value={s.activeId} onChange={(e) => s.switchTo(e.target.value)} aria-label="Graph">
          <option value={main.id}>Main graph</option>
          {sandboxes.map((g) => (
            <option key={g.id} value={g.id}>🧪 {g.name}</option>
          ))}
        </select>
        <button onClick={s.forkActive} title="Copy the current graph into a sandbox">Fork sandbox</button>
        {graph.parentId && (
          <>
            <button onClick={() => s.mergeSandbox(graph.id)} title="Merge this sandbox into the graph it was forked from">Merge back</button>
            <button className="danger" onClick={() => confirm(`Discard ${graph.name}?`) && s.discardSandbox(graph.id)}>Discard</button>
          </>
        )}
      </div>

      <div className="toolbar__group toolbar__right">
        <select
          value={s.provider ?? ""}
          onChange={(e) => s.setProvider(e.target.value || null)}
          aria-label="AI provider"
          title="AI provider"
        >
          <option value="">
            AI: default{providers ? ` (${providers.providers.find((p) => p.id === providers.default)?.label})` : ""}
          </option>
          {providers?.providers.map((p) => (
            <option key={p.id} value={p.id} disabled={!p.configured}>
              {p.label} · {p.model}{p.configured ? "" : " (no key)"}
            </option>
          ))}
        </select>
        <button onClick={doExport}>Export</button>
        <button onClick={() => fileRef.current?.click()}>Import</button>
        <input
          ref={fileRef}
          type="file"
          accept="application/json"
          hidden
          onChange={(e) => { const f = e.target.files?.[0]; if (f) void doImport(f); e.target.value = ""; }}
        />
      </div>
    </header>
  );
}
