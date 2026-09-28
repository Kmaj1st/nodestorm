import { providerMeta } from "@nodestorm/shared";
import { getNodesBounds, getViewportForBounds, useReactFlow } from "@xyflow/react";
import {
  BookA,
  ChevronDown,
  Drama,
  FileCode,
  FileJson,
  FileText,
  GitBranchPlus,
  GraduationCap,
  History,
  Image,
  Layers,
  LayoutGrid,
  Link,
  Menu,
  PenLine,
  Plus,
  Presentation,
  Redo2,
  Save,
  ScanText,
  Search,
  Settings,
  Shuffle,
  Sigma,
  Sparkles,
  Undo2,
  Upload,
  Workflow,
  type LucideIcon,
} from "lucide-react";
import { useEffect, useRef, useState, type KeyboardEvent as ReactKeyboardEvent } from "react";
import { listJoin, t as tr, useT, type MessageKey } from "../i18n";
import { mix, tidy } from "../lib/actions";
import { errorMessage } from "../lib/errors";
import { exportFileName, toMarkdown, toMermaid } from "../lib/export";
import { graphDisplayName } from "../lib/graphOps";
import { providerName } from "../lib/online";
import { projectGraphs } from "../lib/projects";
import { activeGraph, canRedo, canUndo, currentProject, isViewing, useGraphStore } from "../store/graphStore";
import { useAbsurd } from "../store/absurdStore";
import { closeDerivePanel, openDerivePanel, useDeriveOpen } from "../store/deriveOpen";
import { useQuiz } from "../store/quizStore";
import { useWalkthrough } from "../store/walkthroughStore";
import { isReady, useSettings } from "../store/settingsStore";
import type { ExtractReview } from "../lib/extract";
import { ExtractDialog, FlashcardsDialog, GlossaryDialog, ShareDialog, VersionsDialog } from "./lazy";
import { ProjectMenu } from "./ProjectMenu";
import { FocusButton, PhysicsButton, ViewMenu } from "./ViewMenu";
import { useView } from "../store/viewStore";
import { Icon } from "../ui/Icon";

/**
 * One row at ≥1200px: project · history · primary actions (Add, Mix, Derive) · canvas tools as icon buttons
 * (Tidy, Find, Focus, Physics, View) · graph/sandbox · Settings and the File menu (import, export, share). Merge back and
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
  const selecting = useView((v) => v.selecting);
  const mixHint = selecting ? t("toolbar.mixPickTwo", { n: selected.length }) : t("toolbar.mixSelectTwo");
  const blockReason = blocked.length ? t("toolbar.blockReason", { names: listJoin(blocked.map((n) => n.name)) }) : undefined;

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
          <button className="icon-btn" onClick={() => s.undo()} disabled={!undoable} title={t("toolbar.undoTitle")} aria-label={t("toolbar.undo")}>
            <Icon icon={Undo2} />
          </button>
          <button className="icon-btn" onClick={() => s.redo()} disabled={!redoable} title={t("toolbar.redoTitle")} aria-label={t("toolbar.redo")}>
            <Icon icon={Redo2} />
          </button>
        </div>
      )}

      {!viewing && <div className="toolbar__group toolbar__actions">
        <button className="primary" onClick={onAdd} data-tour="add"><Icon icon={Plus} />{t("toolbar.add")}</button>
        <button
          data-tour="mix" // data-tour: what the guided tour points at (panels/Onboarding.tsx)
          onClick={async (e) => {
            // The button is disabled while mixing, which drops the focus: give it back when the relation is in.
            const button = e.currentTarget;
            await mix(selected[0].id, selected[1].id);
            if (document.activeElement === document.body) button.focus();
          }}
          disabled={!canMix}
          title={blockReason ?? (selected.length !== 2 ? mixHint : t("toolbar.mixTitle"))}
        >
          {busyMix ? <span className="spinner" aria-hidden="true" /> : <Icon icon={Shuffle} />}
          {busyMix ? t("toolbar.mixing") : t("toolbar.mix")}
        </button>
        {/* Mix's playful sibling: the same two concepts (or any two typed in), linked by an absurd chain of true facts. */}
        <button
          className="icon-btn"
          onClick={() => useAbsurd.getState().openAbsurd()}
          title={t("toolbar.absurdTitle")}
          aria-label={t("toolbar.absurd")}
          data-testid="absurd-chain"
        >
          <Icon icon={Drama} />
        </button>
        <button onClick={onDerive} disabled={!canDerive} title={blockReason ?? t(selected.length ? "toolbar.deriveTitle" : "toolbar.deriveSelect")}>
          <Icon icon={Sparkles} />
          {t("toolbar.derive")}
        </button>
        <DeriveTogetherButton />
      </div>}

      {/* Canvas tools: compact icon buttons, named by aria-label and explained by their tooltips. */}
      <div className="toolbar__group toolbar__tools" role="group" aria-label={t("toolbar.tools")}>
        {!viewing && (
          <button className="icon-btn" onClick={tidy} disabled={graph.nodes.length < 2} title={t("toolbar.tidyTitle")} aria-label={t("toolbar.tidy")}>
            <Icon icon={LayoutGrid} />
          </button>
        )}
        <button className="icon-btn" onClick={onFind} disabled={!graph.nodes.length} title={t("toolbar.findTitle")} aria-label={t("toolbar.find")}>
          <Icon icon={Search} />
        </button>
        <FocusButton />
        <PhysicsButton />
        <ViewMenu />
      </div>

      <button
        className="toolbar__menu icon-btn"
        title={t("toolbar.more")}
        aria-label={t("toolbar.more")}
        aria-expanded={moreOpen}
        aria-controls="toolbar-more"
        onClick={() => setMoreOpen(!moreOpen)}
      >
        <Icon icon={Menu} />
      </button>

      <div className="toolbar__more" id="toolbar-more">
        {!viewing && <div className="toolbar__group toolbar__sandbox" role="group" aria-label={t("toolbar.sandbox")}>
          <select className="graph-select" value={s.activeId} onChange={(e) => s.switchTo(e.target.value)} aria-label={t("toolbar.graph")}>
            <option value={main.id}>{graphDisplayName(main)}</option>
            {sandboxes.length > 0 && (
              <optgroup label={t("toolbar.sandbox")}>
                {sandboxes.map((g) => <option key={g.id} value={g.id}>{g.name}</option>)}
              </optgroup>
            )}
          </select>
          <button className="icon-btn" onClick={() => s.forkActive()} data-tour="fork" title={t("toolbar.forkTitle")} aria-label={t("toolbar.fork")}>
            <Icon icon={GitBranchPlus} />
          </button>
        </div>}

        <div className="toolbar__group toolbar__right">
          {/* Settings: the AI status while editing; a plain gear in the read-only viewer, which never calls the AI. */}
          <button
            className={viewing ? "icon-btn" : ready ? "ai-button" : "ai-button ai-button--warn"}
            onClick={() => s.setSettingsOpen(true)}
            data-tour="settings"
            // The button shows just the model; the tooltip adds the provider.
            title={`${ready && !viewing ? `${providerName(settings.provider)} · ${model}\n` : ""}${t("toolbar.settingsTitle")}`}
            aria-label={t("toolbar.settings")}
          >
            {viewing ? (
              <Icon icon={Settings} />
            ) : (
              // A status chip: a dot (green once a provider is set up, amber before) and the model, or "Set up AI".
              <>
                <span className={`status-dot status-dot--${ready ? "ok" : "warn"}`} aria-hidden="true" />
                <span className="ai-button__label">{ready ? model.split("/").pop() : t("toolbar.setUpAi")}</span>
              </>
            )}
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

/** The concept open in the inspector, else the only selected one (as "Quiz me…" picks its learning path). */
function selectedId() {
  const s = useGraphStore.getState();
  return s.inspect?.kind === "node" ? s.inspect.id : s.selection.length === 1 ? s.selection[0] : undefined;
}

/** A menu entry: `head` starts a labelled section of the menu. */
type Item = { label: MessageKey; title: MessageKey; icon: LucideIcon; head?: MessageKey; action: () => void | Promise<void> };

/**
 * "File": import a project from JSON, or concepts from a text (Extract from text); save and restore versions of the
 * project (Versions); list the graph's notation (Notation…); export the current project as JSON, or the active graph as
 * Markdown notes, a LaTeX document, Mermaid, a PNG image or flashcards; and share the graph as a link. In the
 * read-only viewer only the walkthrough, notation, export and share remain.
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
  const [texImport, setTexImport] = useState<{ review: ExtractReview; title: string } | null>(null);
  const texRef = useRef<HTMLInputElement>(null);
  const [glossary, setGlossary] = useState(false);
  // "Flashcards (Anki)…" remembers the concept selected when it was opened, for its learning-path option.
  const [flashcards, setFlashcards] = useState<{ rootId?: string } | null>(null);
  // "Versions…" opens the list; "Save snapshot…" the same dialog with its label field focused.
  const [versions, setVersions] = useState<"list" | "save" | null>(null);

  useEffect(() => {
    if (!open) return;
    const close = (e: MouseEvent | KeyboardEvent) => {
      if (e instanceof KeyboardEvent ? e.key !== "Escape" : ref.current?.contains(e.target as Node)) return;
      setOpen(false);
      // Escape hands focus back to the menu button (a click elsewhere keeps its own target).
      if (e instanceof KeyboardEvent) menuButton.current?.focus();
    };
    document.addEventListener("mousedown", close);
    document.addEventListener("keydown", close);
    return () => {
      document.removeEventListener("mousedown", close);
      document.removeEventListener("keydown", close);
    };
  }, [open]);

  // Keyboard use, as in a native menu: focus the first entry on open; arrows, Home and End move between entries.
  const list = useRef<HTMLDivElement>(null);
  const menuButton = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    if (open) list.current?.querySelector<HTMLButtonElement>('[role="menuitem"]')?.focus();
  }, [open]);
  const onMenuKey = (e: ReactKeyboardEvent) => {
    const entries = [...(list.current?.querySelectorAll<HTMLButtonElement>('[role="menuitem"]') ?? [])];
    const at = entries.indexOf(document.activeElement as HTMLButtonElement);
    const to = { ArrowDown: at + 1, ArrowUp: at - 1, Home: 0, End: entries.length - 1 }[e.key];
    if (to === undefined || !entries.length) return;
    e.preventDefault();
    entries[(to + entries.length) % entries.length].focus();
  };

  const doImport = async (file: File) => {
    try {
      const { name, fixes } = importJson(await file.text());
      const repairs = fixes.length ? ` ${tr("file.importRepairs", { fixes: fixes.join("; ") })}` : "";
      setToast(tr("file.imported", { name }) + repairs, "info");
    } catch (e) {
      setToast(tr("file.importFailed", { error: errorMessage(e) }));
    }
  };

  const base = exportFileName(graph);
  const run = (fn: () => void | Promise<void>) => async () => {
    // The item goes with the menu: the focus goes back to the menu's button, so a dialog opened from here returns it
    // there when it closes (instead of to the page).
    menuButton.current?.focus();
    setOpen(false);
    try {
      await fn();
    } catch (e) {
      setToast(tr("file.exportFailed", { error: errorMessage(e) }));
    }
  };

  const items: Item[] = [
    ...(view
      ? []
      : ([
          { head: "file.importHead", label: "file.import", title: "file.importTitle", icon: Upload, action: () => fileRef.current?.click() },
          { label: "file.extract", title: "file.extractTitle", icon: ScanText, action: () => setExtracting(true) },
          { label: "file.texImport", title: "file.texImportTitle", icon: FileCode, action: () => texRef.current?.click() },
          { head: "file.versionsHead", label: "file.snapshot", title: "file.snapshotTitle", icon: Save, action: () => setVersions("save") },
          { label: "file.versions", title: "file.versionsTitle", icon: History, action: () => setVersions("list") },
          { head: "file.studyHead", label: "file.quiz", title: "file.quizTitle", icon: GraduationCap, action: () => useQuiz.getState().openQuiz() },
          { label: "file.deriveTogether", title: "file.deriveTogetherTitle", icon: PenLine, action: () => openDerivePanel() },
          { label: "file.absurd", title: "file.absurdTitle", icon: Drama, action: () => useAbsurd.getState().openAbsurd() },
        ] satisfies Item[])),
    // Read-only, so the share viewer has them too: presenting a shared graph is a main use.
    {
      ...(view ? { head: "file.studyHead" as MessageKey } : {}),
      label: "file.walkthrough",
      title: "file.walkthroughTitle",
      icon: Presentation,
      action: () => useWalkthrough.getState().openWalkthrough(),
    },
    { label: "file.glossary", title: "file.glossaryTitle", icon: BookA, action: () => setGlossary(true) },
    {
      head: "file.exportHead",
      label: view ? "file.jsonGraph" : "file.jsonProject",
      title: view ? "file.jsonGraphTitle" : "file.jsonProjectTitle",
      icon: FileJson,
      action: () => download(`${exportFileName({ name: projectName })}.json`, text(exportJson(), "application/json")),
    },
    {
      label: "file.markdown",
      title: "file.markdownTitle",
      icon: FileText,
      action: () => download(`${base}.md`, text(toMarkdown(graph), "text/markdown")),
    },
    {
      label: "file.latex",
      title: "file.latexTitle",
      icon: Sigma,
      action: async () => {
        const { toLatex } = await import("../lib/latex"); // only needed here, so a chunk of its own
        download(`${base}.tex`, text(toLatex(graph, { title: graph.parentId ? `${projectName}: ${graph.name}` : projectName }), "application/x-tex"));
      },
    },
    {
      label: "file.mermaid",
      title: "file.mermaidTitle",
      icon: Workflow,
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
      icon: Image,
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
    { label: "flash.menu", title: "flash.menuTitle", icon: Layers, action: () => setFlashcards({ rootId: selectedId() }) },
    { head: "file.share", label: "file.share", title: "file.shareTitle", icon: Link, action: () => setSharing(true) },
  ];

  return (
    // Tabbing out of the menu closes it, so it never covers what has focus.
    <div className="menu" ref={ref} onBlur={(e) => open && e.relatedTarget && !e.currentTarget.contains(e.relatedTarget) && setOpen(false)}>
      <button ref={menuButton} className="menu-button" aria-haspopup="menu" aria-expanded={open} onClick={() => setOpen(!open)} data-tour="file">
        {t("file.menu")}
        <Icon icon={ChevronDown} size={14} className="menu-button__chevron" />
      </button>
      {open && (
        <div className="menu__list" role="menu" aria-label={t("file.menuLabel")} ref={list} onKeyDown={onMenuKey}>
          {items.map((it, i) => (
            <div key={it.label} role="none" className="menu__section">
              {/* A heading per group (import, versions, study, export); a plain separator before Share. */}
              {it.head && i > 0 && <hr className="menu__sep" />}
              {it.head && it.head !== it.label && <div className="menu__head" role="presentation">{t(it.head)}</div>}
              <button role="menuitem" title={t(it.title)} onClick={run(it.action)}>
                <Icon icon={it.icon} size={14} />
                {t(it.label)}
              </button>
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
      <input
        ref={texRef}
        type="file"
        accept=".tex,.ltx,.latex,text/x-tex,application/x-tex"
        hidden
        data-testid="tex-import"
        onChange={async (e) => {
          const f = e.target.files?.[0];
          e.target.value = "";
          if (!f) return;
          const [{ texReview }, src] = await Promise.all([import("../lib/texImport"), f.text()]);
          const r = texReview(src, { mentions: true });
          if (!r.items.length) return useGraphStore.getState().setToast(tr("texImport.none", { name: f.name }), "info");
          setTexImport({ review: r, title: r.title ?? f.name.replace(/\.[^.]+$/, "") });
        }}
      />
      {texImport && !view && <ExtractDialog initial={texImport} onClose={() => setTexImport(null)} />}
      {glossary && <GlossaryDialog graph={graph} onClose={() => setGlossary(false)} />}
      {versions && !view && <VersionsDialog focusSave={versions === "save"} onClose={() => setVersions(null)} />}
      {flashcards && (
        <FlashcardsDialog graph={graph} project={projectName} rootId={flashcards.rootId} onClose={() => setFlashcards(null)} />
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

/** Opens (or closes) the "Derive together" panel. */
function DeriveTogetherButton() {
  const t = useT();
  const open = useDeriveOpen((s) => s.open);
  return (
    <button
      aria-pressed={open}
      onClick={() => (open ? closeDerivePanel() : void openDerivePanel())}
      title={t("toolbar.deriveTogetherTitle")}
      data-testid="derive-together"
    >
      <Icon icon={PenLine} />
      <span className="toolbar__label">{t("toolbar.deriveTogether")}</span>
    </button>
  );
}
