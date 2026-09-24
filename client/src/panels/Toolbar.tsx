import { providerMeta } from "@nodestorm/shared";
import { getNodesBounds, getViewportForBounds, useReactFlow } from "@xyflow/react";
import { toPng } from "html-to-image";
import { useEffect, useRef, useState } from "react";
import { mix, tidy } from "../lib/actions";
import { exportFileName, toMarkdown, toMermaid } from "../lib/export";
import { projectGraphs } from "../lib/projects";
import { useTheme, type ThemePref } from "../lib/theme";
import { activeGraph, canRedo, canUndo, currentProject, isViewing, useGraphStore } from "../store/graphStore";
import { isReady, useSettings } from "../store/settingsStore";
import { ProjectMenu } from "./ProjectMenu";
import { ShareDialog } from "./ShareDialog";
import { FocusButton, ViewMenu } from "./ViewMenu";

export function Toolbar({ onAdd, onDerive, onFind }: { onAdd: () => void; onDerive: () => void; onFind: () => void }) {
  const s = useGraphStore();
  const graph = useGraphStore(activeGraph);
  const undoable = useGraphStore(canUndo);
  const redoable = useGraphStore(canRedo);
  // A shared graph opened from a link is read-only: only viewing, finding and exporting remain.
  const viewing = useGraphStore(isViewing);
  const settings = useSettings();
  const fileRef = useRef<HTMLInputElement>(null);
  const theme = useTheme();
  // On small screens the less-used groups fold away behind a menu button (see .toolbar__more in styles.css).
  const [moreOpen, setMoreOpen] = useState(false);
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

  // The graph selector lists only the current project's graphs: its main graph, then its sandboxes.
  const [main, ...sandboxes] = projectGraphs(s, s.projects[s.projectId]);

  const doImport = async (file: File) => {
    try {
      const { name, fixes } = s.importJson(await file.text());
      const repairs = fixes.length ? ` Repairs: ${fixes.join("; ")}.` : "";
      s.setToast(`Imported as a new project “${name}”. Your other projects are unchanged.${repairs}`, "info");
    } catch (e) {
      s.setToast(`Import failed: ${e instanceof Error ? e.message : e}`);
    }
  };

  return (
    <header className={`toolbar${moreOpen ? " toolbar--open" : ""}`}>
      <div className="toolbar__brand">NodeStorm</div>
      {viewing ? <span className="toolbar__shared">Shared graph</span> : <ProjectMenu />}

      {!viewing && (
        <div className="toolbar__group toolbar__history">
          <button onClick={() => s.undo()} disabled={!undoable} title="Undo (Ctrl+Z)" aria-label="Undo">↶</button>
          <button onClick={() => s.redo()} disabled={!redoable} title="Redo (Ctrl+Shift+Z)" aria-label="Redo">↷</button>
        </div>
      )}

      {!viewing && <div className="toolbar__group">
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
      </div>}

      <div className="toolbar__group">
        {!viewing && (
          <button onClick={tidy} disabled={graph.nodes.length < 2} title="Arrange in layers: prerequisites above what depends on them">
            Tidy
          </button>
        )}
        <button onClick={onFind} disabled={!graph.nodes.length} title="Find a concept (Ctrl+K)" aria-label="Find concept">
          🔍
        </button>
        <FocusButton />
        <ViewMenu />
      </div>

      <button
        className="toolbar__menu"
        aria-label="More tools"
        aria-expanded={moreOpen}
        aria-controls="toolbar-more"
        onClick={() => setMoreOpen(!moreOpen)}
      >
        ☰
      </button>

      <div className="toolbar__more" id="toolbar-more">
        {!viewing && <div className="toolbar__group">
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
        </div>}

        <div className="toolbar__group toolbar__right">
          {!viewing && (
            <button
              className={ready ? "ai-button" : "ai-button ai-button--warn"}
              onClick={() => s.setSettingsOpen(true)}
              title="AI settings"
              aria-label="AI settings"
            >
              ⚙ {ready ? <>{meta.label} · <span className="muted">{model.split("/").pop()}</span></> : "Set up AI"}
            </button>
          )}
          <ExportMenu />
          {!viewing && <button onClick={() => fileRef.current?.click()}>Import</button>}
          <input
            ref={fileRef}
            type="file"
            accept="application/json"
            hidden
            onChange={(e) => { const f = e.target.files?.[0]; if (f) void doImport(f); e.target.value = ""; }}
          />
          <select
            value={theme.pref}
            onChange={(e) => theme.setPref(e.target.value as ThemePref)}
            aria-label="Theme"
            title="Colour theme (Auto follows your system)"
          >
            <option value="auto">◐ Auto</option>
            <option value="light">☀ Light</option>
            <option value="dark">☾ Dark</option>
          </select>
        </div>
      </div>
    </header>
  );
}

function download(name: string, content: Blob | string) {
  const a = document.createElement("a");
  a.href = typeof content === "string" ? content : URL.createObjectURL(content);
  a.download = name;
  a.click();
  if (typeof content !== "string") setTimeout(() => URL.revokeObjectURL(a.href), 1000);
}

const text = (s: string, type: string) => new Blob([s], { type: `${type};charset=utf-8` });

/** Export dropdown: the current project as JSON, or the active graph as Markdown notes, Mermaid or a PNG image. */
function ExportMenu() {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const { getNodes } = useReactFlow();
  const setToast = useGraphStore((st) => st.setToast);
  const exportJson = useGraphStore((st) => st.exportJson);
  const graph = useGraphStore(activeGraph);
  const project = useGraphStore(currentProject);
  const view = useGraphStore((st) => (isViewing(st) ? st.view : null));
  // Name of what's on screen: the shared graph's in the viewer, else the current project's.
  const projectName = view?.name ?? project.name;
  const [sharing, setSharing] = useState(false);

  useEffect(() => {
    if (!open) return;
    const close = (e: MouseEvent | KeyboardEvent) => {
      if (e instanceof KeyboardEvent ? e.key === "Escape" : !ref.current?.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", close);
    document.addEventListener("keydown", close);
    return () => {
      document.removeEventListener("mousedown", close);
      document.removeEventListener("keydown", close);
    };
  }, [open]);

  const base = exportFileName(graph);
  const run = (fn: () => void | Promise<void>) => async () => {
    setOpen(false);
    try {
      await fn();
    } catch (e) {
      setToast(`Export failed: ${e instanceof Error ? e.message : e}`);
    }
  };

  const items: { label: string; title: string; action: () => void | Promise<void> }[] = [
    {
      label: view ? "JSON (this graph)" : "JSON (this project)",
      title: view
        ? "The shared graph. Importing it later adds it as a new project."
        : "This project's graphs, including sandboxes. Importing it later adds it as a new project.",
      action: () => download(`${exportFileName({ ...graph, name: projectName })}.json`, text(exportJson(), "application/json")),
    },
    {
      label: "Share link…",
      title: "A link that contains this graph (not its sandboxes). Nothing is uploaded: the graph travels inside the link.",
      action: () => setSharing(true),
    },
    {
      label: "Markdown notes",
      title: "Study notes for this graph: concepts in study order, prerequisites and both directions of every relation",
      action: () => download(`${base}.md`, text(toMarkdown(graph), "text/markdown")),
    },
    {
      label: "Mermaid diagram",
      title: "Flowchart text for Mermaid (GitHub, Notion, …): copied to the clipboard and downloaded",
      action: async () => {
        const src = toMermaid(graph);
        download(`${base}.mmd`, text(src, "text/plain"));
        const copied = await navigator.clipboard?.writeText(src).then(() => true, () => false);
        setToast(copied ? "Mermaid diagram copied to the clipboard and downloaded." : "Mermaid diagram downloaded (clipboard not available).", "info");
      },
    },
    {
      label: "PNG image",
      title: "A picture of the whole graph",
      action: async () => {
        const nodes = getNodes();
        const viewportEl = document.querySelector<HTMLElement>(".react-flow__viewport");
        if (!nodes.length || !viewportEl) return setToast("Nothing to capture yet: add a concept first.", "info");
        // Render the full graph (not just what's on screen) at 1:1, as in React Flow's "download image" example.
        const bounds = getNodesBounds(nodes);
        const width = Math.min(4096, Math.ceil(bounds.width) + 160);
        const height = Math.min(4096, Math.ceil(bounds.height) + 160);
        const vp = getViewportForBounds(bounds, width, height, 0.2, 1, 0.05);
        const url = await toPng(viewportEl, {
          backgroundColor: getComputedStyle(document.documentElement).getPropertyValue("--bg").trim() || "#fff",
          width,
          height,
          style: { width: `${width}px`, height: `${height}px`, transform: `translate(${vp.x}px, ${vp.y}px) scale(${vp.zoom})` },
        });
        download(`${base}.png`, url);
      },
    },
  ];

  return (
    <div className="menu" ref={ref}>
      <button aria-haspopup="menu" aria-expanded={open} onClick={() => setOpen(!open)}>Export ▾</button>
      {open && (
        <div className="menu__list" role="menu" aria-label="Export">
          {items.map((it) => (
            <button key={it.label} role="menuitem" title={it.title} onClick={run(it.action)}>{it.label}</button>
          ))}
        </div>
      )}
      {sharing && (
        <ShareDialog
          graph={graph}
          // A sandbox is shared on its own, so say which one.
          name={graph.parentId ? `${projectName} – ${graph.name}` : projectName}
          onClose={() => setSharing(false)}
        />
      )}
    </div>
  );
}
