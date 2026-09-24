import type { RelationOrigin } from "@nodestorm/shared";
import { ChevronDown, Eye, Focus } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { useT, type MessageKey } from "../i18n";
import { isFiltered } from "../lib/view";
import { useGraphStore } from "../store/graphStore";
import { focusTarget, toggleFocus, useView } from "../store/viewStore";
import { Icon } from "../ui/Icon";

const KINDS: { origin: RelationOrigin; label: MessageKey; title: MessageKey }[] = [
  { origin: "dependency", label: "view.dependency", title: "view.dependencyTitle" },
  { origin: "mix", label: "view.mix", title: "view.mixTitle" },
  { origin: "derive", label: "view.derive", title: "view.deriveTitle" },
  { origin: "extract", label: "view.extract", title: "view.extractTitle" },
];

/** Toolbar "Focus" toggle: show only the selected concept and its neighbourhood (F on the canvas, Esc leaves). */
export function FocusButton() {
  const t = useT();
  const activeId = useGraphStore((s) => s.activeId);
  const target = useGraphStore(focusTarget);
  const on = useView((v) => v.focus?.graphId === activeId);
  return (
    <button
      onClick={toggleFocus}
      disabled={!on && !target}
      aria-pressed={on}
      className={`icon-btn${on ? " small-btn--on" : ""}`}
      title={t(on ? "focus.titleOn" : target ? "focus.titleOff" : "focus.titleNone")}
      aria-label={t("focus.button")}
    >
      <Icon icon={Focus} />
    </button>
  );
}

/** "View" popover: which relation kinds to draw, edge labels, and the to-do view. Remembered per browser. */
export function ViewMenu() {
  const t = useT();
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const view = useView();
  const filtered = isFiltered(view);

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

  return (
    <div className="menu" ref={ref}>
      <button
        aria-haspopup="dialog"
        aria-expanded={open}
        onClick={() => setOpen(!open)}
        className={`icon-btn view-button${filtered ? " small-btn--on" : ""}`}
        title={t(filtered ? "view.titleFiltered" : "view.title")}
        aria-label={t(filtered ? "view.buttonFiltered" : "view.button")}
      >
        <Icon icon={Eye} />
        {/* A dot while a filter hides part of the graph (the name says so too). */}
        {filtered && <span className="view-button__dot" data-testid="view-filtered" aria-hidden="true" />}
        <Icon icon={ChevronDown} size={12} />
      </button>
      {open && (
        <div className="menu__list view-menu" role="dialog" aria-label={t("view.button")}>
          <div className="view-menu__head">{t("view.showRelations")}</div>
          {KINDS.map((k) => (
            <label key={k.origin} className="check" title={t(k.title)}>
              <input
                type="checkbox"
                checked={view.origins[k.origin]}
                onChange={(e) => view.setPrefs({ origins: { ...view.origins, [k.origin]: e.target.checked } })}
              />
              {t(k.label)}
            </label>
          ))}
          <hr className="menu__sep" />
          <label className="check">
            <input type="checkbox" checked={view.edgeLabels} onChange={(e) => view.setPrefs({ edgeLabels: e.target.checked })} />
            {t("view.labels")}
          </label>
          <label className="check" title={t("view.todoTitle")}>
            <input type="checkbox" checked={view.todoOnly} onChange={(e) => view.setPrefs({ todoOnly: e.target.checked })} />
            {t("view.todo")}
          </label>
        </div>
      )}
    </div>
  );
}
