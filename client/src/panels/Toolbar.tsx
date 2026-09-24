import { providerMeta } from "@nodestorm/shared";
import { useRef } from "react";
import { mix, tidy } from "../lib/actions";
import { activeGraph, useGraphStore } from "../store/graphStore";
import { isReady, useSettings } from "../store/settingsStore";

export function Toolbar({ onAdd, onDerive, onFind }: { onAdd: () => void; onDerive: () => void; onFind: () => void }) {
  const s = useGraphStore();
  const graph = useGraphStore(activeGraph);
  const settings = useSettings();
  const fileRef = useRef<HTMLInputElement>(null);
  const ready = isReady(settings);
  const meta = providerMeta(settings.provider);
  const model =
    (settings.connection === "browser" ? settings.configs[settings.provider]?.model : settings.serverModels[settings.provider]) ||
    (settings.connection === "browser" ? meta.defaultModel : "server default");

  const selected = graph.nodes.filter((n) => s.selection.includes(n.id));
  // Blocked (missing deps) and unclear (meaning not chosen) concepts can't be mixed or derived from yet.
  const blocked = selected.filter((n) => n.status === "blocked" || n.status === "unclear");
  const busyMix = Object.keys(s.busy).some((k) => k.startsWith("mix:"));
  const canMix = selected.length === 2 && blocked.length === 0 && !busyMix;
  const canDerive = selected.length >= 1 && blocked.length === 0;
  const blockReason = blocked.length
    ? `Resolve ${blocked.map((n) => n.name).join(", ")} first (install missing dependencies / choose a meaning)`
    : undefined;

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
        <button onClick={tidy} disabled={graph.nodes.length < 2} title="Arrange in layers: prerequisites above what depends on them">
          Tidy
        </button>
        <button onClick={onFind} disabled={!graph.nodes.length} title="Find a concept (Ctrl+K)" aria-label="Find concept">
          🔍
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
        <button
          className={ready ? "ai-button" : "ai-button ai-button--warn"}
          onClick={() => s.setSettingsOpen(true)}
          title="AI settings"
          aria-label="AI settings"
        >
          ⚙ {ready ? <>{meta.label} · <span className="muted">{model.split("/").pop()}</span></> : "Set up AI"}
        </button>
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
