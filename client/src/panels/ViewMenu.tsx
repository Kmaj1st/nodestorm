import type { RelationOrigin } from "@nodestorm/shared";
import { useEffect, useRef, useState } from "react";
import { isFiltered } from "../lib/view";
import { useGraphStore } from "../store/graphStore";
import { focusTarget, toggleFocus, useView } from "../store/viewStore";

const KINDS: { origin: RelationOrigin; label: string; title: string }[] = [
  { origin: "dependency", label: "Dependency links", title: "Dashed links between a concept and its prerequisites" },
  { origin: "mix", label: "Mixed relations", title: "Relations found with Mix ⇄" },
  { origin: "derive", label: "Derived relations", title: "Links from Derive ✦ proposals to what they came from" },
];

/** Toolbar "Focus" toggle: show only the selected concept and its neighbourhood (F on the canvas, Esc leaves). */
export function FocusButton() {
  const activeId = useGraphStore((s) => s.activeId);
  const target = useGraphStore(focusTarget);
  const on = useView((v) => v.focus?.graphId === activeId);
  return (
    <button
      onClick={toggleFocus}
      disabled={!on && !target}
      aria-pressed={on}
      className={on ? "small-btn--on" : undefined}
      title={on ? "Show the whole graph again (Esc)" : target ? "Show only this concept and its neighbours (F)" : "Select one concept to focus on"}
    >
      Focus
    </button>
  );
}

/** "View" popover: which relation kinds to draw, edge labels, and the to-do view. Remembered per browser. */
export function ViewMenu() {
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
        className={filtered ? "small-btn--on" : undefined}
        title={filtered ? "View filters are on: part of the graph is hidden" : "Choose what the canvas shows"}
      >
        View{filtered ? " •" : ""} ▾
      </button>
      {open && (
        <div className="menu__list view-menu" role="dialog" aria-label="View">
          <div className="view-menu__head">Show relations</div>
          {KINDS.map((k) => (
            <label key={k.origin} className="check" title={k.title}>
              <input
                type="checkbox"
                checked={view.origins[k.origin]}
                onChange={(e) => view.setPrefs({ origins: { ...view.origins, [k.origin]: e.target.checked } })}
              />
              {k.label}
            </label>
          ))}
          <hr className="menu__sep" />
          <label className="check">
            <input type="checkbox" checked={view.edgeLabels} onChange={(e) => view.setPrefs({ edgeLabels: e.target.checked })} />
            Relation labels
          </label>
          <label className="check" title="Hide concepts that are ready; show only blocked, unclear and failed ones">
            <input type="checkbox" checked={view.todoOnly} onChange={(e) => view.setPrefs({ todoOnly: e.target.checked })} />
            To-do only (hide ready concepts)
          </label>
        </div>
      )}
    </div>
  );
}
