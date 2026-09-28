import { ReactFlowProvider } from "@xyflow/react";
import { ChevronDown, ChevronUp, CircleAlert, Eye, FlaskConical, History, Info, X } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { GraphCanvas } from "./graph/GraphCanvas";
import { rich, t, useT } from "./i18n";
import { errorMessage } from "./lib/errors";
import { removeNode, removeRelation } from "./lib/graphOps";
import { decodeShare, shareToken } from "./lib/share";
import { Inspector } from "./panels/Inspector";
// Dialogs load on demand (their own chunks), see panels/lazy.tsx.
import { AbsurdChainDialog, AddNodeDialog, DeriveDialog, FindDialog, Graph3DDialog, SenseDialog, SettingsDialog } from "./panels/lazy";
import { OfflineBanner } from "./panels/OfflineBanner";
import { QuizHost } from "./panels/QuizHost";
import { WalkthroughHost } from "./panels/WalkthroughHost";
import { DeriveHost } from "./panels/DeriveHost";
import { Onboarding } from "./panels/Onboarding";
import { ShortcutsHelp } from "./panels/ShortcutsHelp";
import { StatusBar } from "./panels/StatusBar";
import { Toolbar } from "./panels/Toolbar";
import { UpdateNotice } from "./panels/UpdateNotice";
import { useAbsurd } from "./store/absurdStore";
import { activeGraph, isViewing, useGraphStore, type ToastKind } from "./store/graphStore";
import { autoSnapshot } from "./store/snapshotStore";
import { hideConcepts, hideOthers, toggleFocus, useView, visibleNow } from "./store/viewStore";
import { Icon } from "./ui/Icon";

export function App() {
  useT(); // re-render the shell (banners, toasts) when the interface language changes
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
  const absurd = useAbsurd((s) => s.open);
  const view3d = useView((s) => s.view3d);
  const closeAbsurd = useAbsurd((s) => s.closeAbsurd);

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
      // A dialog may be open while focus sits on <body> (e.g. between quiz cards): keys never act behind it.
      if (document.querySelector(".modal")) return;
      const s = useGraphStore.getState();
      const mod = e.ctrlKey || e.metaKey;
      const key = e.key.toLowerCase();
      if (mod && !e.altKey && (key === "z" || key === "y")) {
        e.preventDefault();
        if (key === "y" || e.shiftKey) s.redo();
        else s.undo();
      } else if (e.key === "Escape" && useView.getState().selecting) {
        // Leaves Select several first (the selection stays); a second Escape leaves focus mode.
        if (t?.closest(".menu, .popover")) return;
        useView.getState().setSelecting(false);
      } else if (e.key === "Escape" && useView.getState().focus) {
        // Menus and popovers close on Escape themselves; don't also leave focus mode behind them.
        if (t?.closest(".menu, .popover")) return;
        useView.getState().setFocus(null);
      } else if (key === "f" && !mod && !e.altKey) {
        // Focus mode, from the canvas only (like Delete).
        if (t && t !== document.body && !t.closest(".react-flow")) return;
        e.preventDefault();
        toggleFocus();
      } else if (key === "h" && !mod && !e.altKey) {
        // Hide the selected concepts (Shift+H: all the others), from the canvas only. A view choice, not an edit.
        if (t && t !== document.body && !t.closest(".react-flow")) return;
        const shown = visibleNow(s);
        const selected = s.selection.filter((id) => shown.nodes.has(id));
        if (!selected.length) return;
        e.preventDefault();
        if (e.shiftKey) hideOthers();
        else hideConcepts(selected);
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
        <OfflineBanner /><UpdateNotice /><ShortcutsHelp />
        {graph.parentId && <SandboxBanner />}
        <main className="main">
          <GraphCanvas />
          <InspectorSheet />
          <DeriveHost />
          <Onboarding />
        </main>
        <StatusBar />
        {toast && <Toast text={toast} kind={toastKind} onDismiss={() => setToast(null)} />}
        {adding && <AddNodeDialog onClose={() => setAdding(false)} />}
        <SenseDialog />
        {settingsOpen && <SettingsDialog onClose={() => setSettingsOpen(false)} />}
        {finding && <FindDialog onClose={() => setFinding(false)} />}
        {deriveFrom && <DeriveDialog anchorIds={deriveFrom} onClose={() => setDeriveFrom(null)} />}
        {absurd && !viewing && <AbsurdChainDialog {...absurd} onClose={closeAbsurd} />}
        {view3d && <Graph3DDialog onClose={() => useView.getState().setView3d(false)} />}
        <QuizHost />
        <WalkthroughHost />
      </div>
    </ReactFlowProvider>
  );
}

/**
 * A notice: bottom centre, or on a phone just under the toolbar (the bottom holds the details sheet and dialog
 * footers there, the top the toolbar's buttons). While it shows, --toast-top / --toast-bottom say how much of the
 * screen it takes from that edge, which open dialogs keep free (styles.css), so it never covers their buttons.
 */
function Toast({ text, kind, onDismiss }: { text: string; kind: ToastKind; onDismiss: () => void }) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const root = document.documentElement.style;
    const toolbar = document.querySelector(".toolbar");
    const place = () => {
      const top = Boolean(window.matchMedia?.(SMALL_SCREEN).matches);
      el.style.top = top && toolbar ? `${toolbar.getBoundingClientRect().bottom + 8}px` : "";
      const r = el.getBoundingClientRect();
      root.setProperty("--toast-top", top ? `${Math.ceil(r.bottom) + 8}px` : "0px");
      root.setProperty("--toast-bottom", top ? "0px" : `${Math.ceil(window.innerHeight - r.top) + 8}px`);
    };
    place();
    const observer = typeof ResizeObserver === "function" ? new ResizeObserver(place) : null;
    observer?.observe(el);
    if (toolbar) observer?.observe(toolbar);
    window.addEventListener("resize", place);
    return () => {
      observer?.disconnect();
      window.removeEventListener("resize", place);
      root.removeProperty("--toast-top");
      root.removeProperty("--toast-bottom");
    };
  }, []);
  return (
    <div ref={ref} className={`toast toast--${kind}`} role={kind === "error" ? "alert" : "status"} onClick={onDismiss} data-testid="toast">
      <Icon icon={kind === "error" ? CircleAlert : Info} className="toast__icon" />
      <span className="toast__text">{text}</span>
      <button className="toast__close icon-btn" aria-label={t("common.dismiss")} title={t("common.dismiss")}>
        <Icon icon={X} size={14} />
      </button>
    </div>
  );
}

/** Remove the share link from the address bar (without a reload or a new history entry). */
function clearShareHash() {
  if (shareToken(location.hash) !== null) history.replaceState(null, "", location.pathname + location.search);
}

/** Open the graph in the page's #share= link, if any. A bad link leaves the user's own work on screen. */
async function openShareLink() {
  const token = shareToken(location.hash);
  const s = useGraphStore.getState();
  if (token === null) {
    // Back (or editing the URL) away from a share link leaves the viewer, like its Close button.
    if (isViewing(s)) s.closeView();
    return;
  }
  try {
    const { graph, name, fixes } = await decodeShare(token);
    // The hash may have changed while decoding (another link pasted): the newer one wins.
    if (shareToken(location.hash) !== token) return;
    s.openView(graph, name);
    // Replaces any earlier message (e.g. about a broken link opened before this one).
    s.setToast(fixes.length ? t("viewer.repaired", { fixes: fixes.join("; ") }) : null, "info");
  } catch (e) {
    clearShareHash();
    s.setToast(t("viewer.openFailed", { error: errorMessage(e) }));
  }
}

/**
 * Shown while a shared graph (or an earlier version previewed from Versions) is open read-only: save it as a project
 * of your own, or go back to your work.
 */
function ViewerBanner() {
  const t = useT();
  const view = useGraphStore((s) => s.view);
  const saveCopy = () => {
    const s = useGraphStore.getState();
    const name = s.saveViewCopy();
    clearShareHash();
    if (name) s.setToast(t("viewer.saved", { name }), "info");
  };
  const close = () => {
    useGraphStore.getState().closeView();
    clearShareHash();
  };
  return (
    <div className="viewer-banner banner" data-testid="viewer-banner" role="status">
      <span className="banner__text">
        <Icon icon={view?.kind === "snapshot" ? History : Eye} className="banner__icon" />
        <span>
          {view?.kind === "snapshot"
            ? rich("viewer.snapshotBanner", { name: view.name })
            : view?.name ? rich("viewer.bannerNamed", { name: view.name }) : t("viewer.banner")}
        </span>
      </span>
      <span className="banner__actions">
        <button className="primary" onClick={saveCopy}>{t("viewer.saveCopy")}</button>
        <button onClick={close} title={t("viewer.closeTitle")}>{t("common.close")}</button>
      </span>
    </div>
  );
}

/** Shown while a sandbox is active, with its actions: merge it back into its parent graph, or discard it. */
function SandboxBanner() {
  const t = useT();
  const graph = useGraphStore(activeGraph);
  const mergeSandbox = useGraphStore((s) => s.mergeSandbox);
  const discardSandbox = useGraphStore((s) => s.discardSandbox);
  return (
    <div className="sandbox-banner banner" data-testid="sandbox-banner">
      <span className="banner__text">
        <Icon icon={FlaskConical} className="banner__icon" />
        <span>{rich("sandbox.banner", { name: graph.name })}</span>
      </span>
      <span className="banner__actions">
        {/* Neither can be undone, so each leaves a restore point in Versions first. */}
        <button onClick={() => { autoSnapshot("merge"); mergeSandbox(graph.id); }} title={t("sandbox.mergeTitle")}>
          {t("sandbox.merge")}
        </button>
        <button
          className="danger"
          onClick={() => {
            if (!confirm(t("sandbox.discardConfirm", { name: graph.name }))) return;
            autoSnapshot("discard");
            discardSandbox(graph.id);
          }}
          title={t("sandbox.discardTitle")}
        >
          {t("sandbox.discard")}
        </button>
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
  const t = useT();
  const inspect = useGraphStore((s) => s.inspect);
  const [open, setOpen] = useState(() => !window.matchMedia?.(SMALL_SCREEN).matches);
  useEffect(() => {
    if (inspect) setOpen(true);
  }, [inspect]);
  // As a bottom sheet its content scrolls on its own, so it takes keyboard focus too (to scroll it with the arrow
  // keys when it holds only text, like the help shown when nothing is selected).
  const [small, setSmall] = useState(() => Boolean(window.matchMedia?.(SMALL_SCREEN).matches));
  useEffect(() => {
    const query = window.matchMedia?.(SMALL_SCREEN);
    const update = () => setSmall(query.matches);
    query?.addEventListener("change", update);
    return () => query?.removeEventListener("change", update);
  }, []);
  return (
    <div className={`sheet${open ? "" : " sheet--closed"}`}>
      <button className="sheet__toggle" aria-expanded={open} aria-controls="inspector-sheet" onClick={() => setOpen(!open)}>
        <Icon icon={open ? ChevronDown : ChevronUp} />
        {t(open ? "sheet.hide" : "sheet.show")}
      </button>
      <div
        className="sheet__content"
        id="inspector-sheet"
        {...(small && { tabIndex: 0, role: "region", "aria-label": t("sheet.label") })}
      >
        <Inspector />
      </div>
    </div>
  );
}
