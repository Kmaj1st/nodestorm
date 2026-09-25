import { BookOpen, PenLine, X } from "lucide-react";
import { useEffect, useRef } from "react";
import { useT } from "../../i18n";
import { useDerive } from "../../store/deriveStore";
import { Icon } from "../../ui/Icon";
import { Library } from "./Library";
import { Reader } from "./Reader";
import { Workspace } from "./Workspace";
import "./derive.css";

/**
 * "Derive together": a panel docked beside the graph (full screen on small screens). Not a dialog: the graph stays
 * usable, so the learner can look things up and see what they add. Library: documents, problems and sessions.
 * Workspace: the current derivation. The reader opens over either.
 */
export function DerivePanel() {
  const t = useT();
  const tab = useDerive((s) => s.tab);
  const setTab = useDerive((s) => s.setTab);
  const close = useDerive((s) => s.close);
  const reader = useDerive((s) => s.reader);
  const hasSession = useDerive((s) => Boolean(s.currentId));
  const ref = useRef<HTMLElement>(null);

  // On a small screen the panel covers the app: what it hides (toolbar, canvas, inspector) leaves the Tab order and
  // the accessibility tree, as behind a dialog. Dialogs opened from the panel are outside these, so stay usable.
  // Focus moves into the panel when it opens, so keyboard users land in it, and back to where it was when it closes.
  useEffect(() => {
    const opener = document.activeElement as HTMLElement | null;
    const query = window.matchMedia?.("(max-width: 800px)");
    const hidden = () => [...document.querySelectorAll<HTMLElement>(".app > .toolbar, .app > .main > :not(.derive-panel)")];
    const apply = () => hidden().forEach((el) => (el.inert = Boolean(query?.matches)));
    apply();
    query?.addEventListener("change", apply);
    ref.current?.focus();
    return () => {
      query?.removeEventListener("change", apply);
      hidden().forEach((el) => (el.inert = false));
      if (opener?.isConnected && (!document.activeElement || document.activeElement === document.body)) opener.focus();
    };
  }, []);

  const onKey = (e: React.KeyboardEvent) => {
    if (e.key === "Escape" && !e.defaultPrevented && !(e.target as Element).closest("textarea, input")) {
      e.preventDefault();
      if (useDerive.getState().reader) useDerive.getState().closeReader();
      else close();
    }
  };

  return (
    <aside className="derive-panel" aria-labelledby="derive-title" ref={ref} tabIndex={-1} onKeyDown={onKey} data-testid="derive-panel">
      <header className="derive-panel__header">
        <h2 id="derive-title" className="derive-panel__title">{t("dt.title")}</h2>
        <div className="derive-tabs" role="tablist" aria-label={t("dt.title")}>
          <button role="tab" aria-selected={tab === "library"} className={tab === "library" ? "derive-tab derive-tab--on" : "derive-tab"} onClick={() => setTab("library")}>
            <Icon icon={BookOpen} size={14} />
            {t("dt.tab.library")}
          </button>
          <button
            role="tab"
            aria-selected={tab === "work"}
            className={tab === "work" ? "derive-tab derive-tab--on" : "derive-tab"}
            onClick={() => setTab("work")}
            disabled={!hasSession}
            title={hasSession ? undefined : t("dt.tab.workDisabled")}
          >
            <Icon icon={PenLine} size={14} />
            {t("dt.tab.work")}
          </button>
        </div>
        <button className="icon-btn" onClick={close} aria-label={t("common.close")} title={t("common.close")}>
          <Icon icon={X} />
        </button>
      </header>
      <div className="derive-panel__body" role="tabpanel">
        {reader ? <Reader /> : tab === "work" && hasSession ? <Workspace /> : <Library />}
      </div>
    </aside>
  );
}
