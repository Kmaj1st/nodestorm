import { providerMeta } from "@nodestorm/shared";
import { getNodesBounds, getViewportForBounds, useReactFlow } from "@xyflow/react";
import { useEffect, useRef, useState } from "react";
import { t as tr, useT, type MessageKey } from "../i18n";
import { mix, tidy } from "../lib/actions";
import { exportFileName, toMarkdown, toMermaid } from "../lib/export";
import { projectGraphs } from "../lib/projects";
import { activeGraph, canRedo, canUndo, currentProject, isViewing, useGraphStore } from "../store/graphStore";
import { useQuiz } from "../store/quizStore";
import { isReady, useSettings } from "../store/settingsStore";
import { ExtractDialog, ShareDialog, VersionsDialog } from "./lazy";
import { ProjectMenu } from "./ProjectMenu";
import { FocusButton, ViewMenu } from "./ViewMenu";

/**
 * One row at ≥1200px: project · history · primary actions (Add, Mix, Derive) · canvas tools as icon buttons
 * (Tidy, Find, Focus, View) · graph/sandbox · Settings and the File menu (import, export, share). Merge back and
 * Discard live in the sandbox banner (App.tsx), and the theme and interface language in Settings.
 */
export function Toolbar({ onAdd, onDerive, onFind }: { onAdd: () => void; onDerive: () => void; onFind: () => void }) {
  const t = useT();
  const s = useGraphStore();
  const graph = useGraphStore(activeGraph);
  const undoable = useGraphStore(canUndo);
  const redoable = useGraphStore(canRedo);
  // A shared graph opened from a link is read-only: only viewing, finding and exporting remain.
  const viewing = useGraphStore(isViewing);
  const settings = useSettings();
  // On small screens the less-used groups fold away behind a menu button (see .toolbar__more in styles.css).
  const [moreOpen, setMoreOpen] = useState(false);
  const ready = isReady(settings);
  const meta = providerMeta(settings.provider);
  const model =
    (settings.connection === "browser" ? settings.configs[settings.provider]?.model : settings.serverModels[settings.provider]) ||
    (settings.connection === "browser" ? meta.defaultModel : t("toolbar.serverDefault"));

  const selected = graph.nodes.filter((n) => s.selection.includes(n.id));
  // Blocked (missing deps) and unclear (meaning not chosen) concepts can't be mixed or derived from yet.
  const blocked = selected.filter((n) => n.status === "blocked" || n.status === "unclear");
  const busyMix = Object.keys(s.busy).some((k) => k.startsWith("mix:"));
  const canMix = selected.length === 2 && blocked.length === 0 && !busyMix;
  const canDerive = selected.length >= 1 && blocked.length === 0;
  const blockReason = blocked.length ? t("toolbar.blockReason", { names: blocked.map((n) => n.name).join(", ") }) : undefined;

  // The graph selector lists only the current project's graphs: its main graph, then its sandboxes.
  const [main, ...sandboxes] = projectGraphs(s, s.projects[s.projectId]);

  return (
    <header className={`toolbar${moreOpen ? " toolbar--open" : ""}`}>
      <h1 className="toolbar__brand">NodeStorm</h1>
      {viewing ? (
        <span className="toolbar__shared">{t(s.view?.kind === "snapshot" ? "toolbar.versionPreview" : "toolbar.sharedGraph")}</span>
      ) : (
        <ProjectMenu />
      )}

      {!viewing && (
        <div className="toolbar__group toolbar__history">
          <button onClick={() => s.undo()} disabled={!undoable} title={t("toolbar.undoTitle")} aria-label={t("toolbar.undo")}>↶</button>
          <button onClick={() => s.redo()} disabled={!redoable} title={t("toolbar.redoTitle")} aria-label={t("toolbar.redo")}>↷</button>
        </div>
      )}

      {!viewing && <div className="toolbar__group">
        <button className="primary" onClick={onAdd} data-tour="add">{t("toolbar.add")}</button>
        <button
          data-tour="mix" // data-tour: what the guided tour points at (panels/Onboarding.tsx)
          onClick={() => mix(selected[0].id, selected[1].id)}
          disabled={!canMix}
          title={blockReason ?? (selected.length !== 2 ? t("toolbar.mixSelectTwo") : t("toolbar.mixTitle"))}
        >
          {busyMix ? t("toolbar.mixing") : t("toolbar.mix")}
        </button>
        <button onClick={onDerive} disabled={!canDerive} title={blockReason ?? t("toolbar.deriveTitle")}>
          {t("toolbar.derive")}
        </button>
      </div>}

      {/* Canvas tools: compact icon buttons, named by aria-label and explained by their tooltips. */}
      <div className="toolbar__group toolbar__tools" role="group" aria-label={t("toolbar.tools")}>
        {!viewing && (
          <button className="icon-btn" onClick={tidy} disabled={graph.nodes.length < 2} title={t("toolbar.tidyTitle")} aria-label={t("toolbar.tidy")}>
            ⊞
          </button>
        )}
        <button className="icon-btn" onClick={onFind} disabled={!graph.nodes.length} title={t("toolbar.findTitle")} aria-label={t("toolbar.find")}>
          🔍
        </button>
        <FocusButton />
        <ViewMenu />
      </div>

      <button
        className="toolbar__menu"
        aria-label={t("toolbar.more")}
        aria-expanded={moreOpen}
        aria-controls="toolbar-more"
        onClick={() => setMoreOpen(!moreOpen)}
      >
        ☰
      </button>

      <div className="toolbar__more" id="toolbar-more">
        {!viewing && <div className="toolbar__group" role="group" aria-label={t("toolbar.sandbox")}>
          <select className="graph-select" value={s.activeId} onChange={(e) => s.switchTo(e.target.value)} aria-label={t("toolbar.graph")}>
            <option value={main.id}>{t("toolbar.mainGraph")}</option>
            {sandboxes.map((g) => (
              <option key={g.id} value={g.id}>🧪 {g.name}</option>
            ))}
          </select>
          <button className="icon-btn" onClick={s.forkActive} data-tour="fork" title={t("toolbar.forkTitle")} aria-label={t("toolbar.fork")}>
            🧪+
          </button>
        </div>}

        <div className="toolbar__group toolbar__right">
          {/* Settings: the AI status while editing; a plain gear in the read-only viewer, which never calls the AI. */}
          <button
            className={viewing ? "icon-btn" : ready ? "ai-button" : "ai-button ai-button--warn"}
            onClick={() => s.setSettingsOpen(true)}
            data-tour="settings"
            // The button shows just the model; the tooltip adds the provider.
            title={`${ready && !viewing ? `${meta.label} · ${model}\n` : ""}${t("toolbar.settingsTitle")}`}
            aria-label={t("toolbar.settings")}
          >
            ⚙{viewing ? null : ready ? <> {model.split("/").pop()}</> : <> {t("toolbar.setUpAi")}</>}
          </button>
          <FileMenu />
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

/** A menu entry: `head` starts a labelled section of the menu. */
type Item = { label: MessageKey; title: MessageKey; head?: MessageKey; action: () => void | Promise<void> };

/**
 * "File ▾": import a project from JSON, or concepts from a text (Extract from text); save and restore versions of the
 * project (Versions); export the current project as JSON, or the active graph as Markdown notes, Mermaid or a PNG
 * image; and share the graph as a link. In the read-only viewer only export and share remain.
 */
function FileMenu() {
  const t = useT();
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const { getNodes } = useReactFlow();
  const setToast = useGraphStore((st) => st.setToast);
  const exportJson = useGraphStore((st) => st.exportJson);
  const importJson = useGraphStore((st) => st.importJson);
  const graph = useGraphStore(activeGraph);
  const project = useGraphStore(currentProject);
  const view = useGraphStore((st) => (isViewing(st) ? st.view : null));
  // Name of what's on screen: the shared graph's in the viewer, else the current project's.
  const projectName = view?.name ?? project.name;
  const [sharing, setSharing] = useState(false);
  const [extracting, setExtracting] = useState(false);
  // "Versions…" opens the list; "Save snapshot…" the same dialog with its label field focused.
  const [versions, setVersions] = useState<"list" | "save" | null>(null);

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

  const doImport = async (file: File) => {
    try {
      const { name, fixes } = importJson(await file.text());
      const repairs = fixes.length ? ` ${tr("file.importRepairs", { fixes: fixes.join("; ") })}` : "";
      setToast(tr("file.imported", { name }) + repairs, "info");
    } catch (e) {
      setToast(tr("file.importFailed", { error: e instanceof Error ? e.message : String(e) }));
    }
  };

  const base = exportFileName(graph);
  const run = (fn: () => void | Promise<void>) => async () => {
    setOpen(false);
    try {
      await fn();
    } catch (e) {
      setToast(tr("file.exportFailed", { error: e instanceof Error ? e.message : String(e) }));
    }
  };

  const items: Item[] = [
    ...(view
      ? []
      : ([
          { label: "file.import", title: "file.importTitle", action: () => fileRef.current?.click() },
          { label: "file.extract", title: "file.extractTitle", action: () => setExtracting(true) },
          { label: "file.quiz", title: "file.quizTitle", action: () => useQuiz.getState().openQuiz() },
          { label: "file.snapshot", title: "file.snapshotTitle", action: () => setVersions("save") },
          { label: "file.versions", title: "file.versionsTitle", action: () => setVersions("list") },
        ] satisfies Item[])),
    {
      head: "file.exportHead",
      label: view ? "file.jsonGraph" : "file.jsonProject",
      title: view ? "file.jsonGraphTitle" : "file.jsonProjectTitle",
      action: () => download(`${exportFileName({ ...graph, name: projectName })}.json`, text(exportJson(), "application/json")),
    },
    {
      label: "file.markdown",
      title: "file.markdownTitle",
      action: () => download(`${base}.md`, text(toMarkdown(graph), "text/markdown")),
    },
    {
      label: "file.mermaid",
      title: "file.mermaidTitle",
      action: async () => {
        const src = toMermaid(graph);
        download(`${base}.mmd`, text(src, "text/plain"));
        const copied = await navigator.clipboard?.writeText(src).then(() => true, () => false);
        setToast(tr(copied ? "file.mermaidCopied" : "file.mermaidDownloaded"), "info");
      },
    },
    {
      label: "file.png",
      title: "file.pngTitle",
      action: async () => {
        const nodes = getNodes();
        const viewportEl = document.querySelector<HTMLElement>(".react-flow__viewport");
        if (!nodes.length || !viewportEl) return setToast(tr("file.nothingToCapture"), "info");
        // Render the full graph (not just what's on screen) at 1:1, as in React Flow's "download image" example.
        const bounds = getNodesBounds(nodes);
        const width = Math.min(4096, Math.ceil(bounds.width) + 160);
        const height = Math.min(4096, Math.ceil(bounds.height) + 160);
        const vp = getViewportForBounds(bounds, width, height, 0.2, 1, 0.05);
        const { toPng } = await import("html-to-image"); // only needed here, so a chunk of its own
        const url = await toPng(viewportEl, {
          backgroundColor: getComputedStyle(document.documentElement).getPropertyValue("--bg").trim() || "#fff",
          width,
          height,
          style: { width: `${width}px`, height: `${height}px`, transform: `translate(${vp.x}px, ${vp.y}px) scale(${vp.zoom})` },
        });
        download(`${base}.png`, url);
      },
    },
    { head: "file.share", label: "file.share", title: "file.shareTitle", action: () => setSharing(true) },
  ];

  return (
    <div className="menu" ref={ref}>
      <button aria-haspopup="menu" aria-expanded={open} onClick={() => setOpen(!open)} data-tour="file">{t("file.menu")}</button>
      {open && (
        <div className="menu__list" role="menu" aria-label={t("file.menuLabel")}>
          {items.map((it, i) => (
            <div key={it.label} role="none" className="menu__section">
              {/* A heading for the export formats; a plain separator before Share. */}
              {it.head && i > 0 && <hr className="menu__sep" />}
              {it.head && it.head !== it.label && <div className="menu__head" role="presentation">{t(it.head)}</div>}
              <button role="menuitem" title={t(it.title)} onClick={run(it.action)}>{t(it.label)}</button>
            </div>
          ))}
        </div>
      )}
      <input
        ref={fileRef}
        type="file"
        accept="application/json"
        hidden
        onChange={(e) => { const f = e.target.files?.[0]; if (f) void doImport(f); e.target.value = ""; }}
      />
      {extracting && !view && <ExtractDialog onClose={() => setExtracting(false)} />}
      {versions && !view && <VersionsDialog focusSave={versions === "save"} onClose={() => setVersions(null)} />}
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
