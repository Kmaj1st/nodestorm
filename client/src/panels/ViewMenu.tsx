import type { RelationOrigin } from "@nodestorm/shared";
import { Box, ChevronDown, Eye, Focus, Magnet } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { useT, type MessageKey } from "../i18n";
import { KIND_LABEL } from "../lib/kinds";
import { isFiltered, KIND_FILTERS, kindFilterOf, type CanvasLayout } from "../lib/view";
import { PHYSICS_MAX_NODES } from "../graph/usePhysics";
import { activeGraph, useGraphStore } from "../store/graphStore";
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

/** Toolbar "Physics" toggle: relations become springs and cards push apart, so the graph sorts itself. */
export function PhysicsButton() {
  const t = useT();
  const on = useView((v) => v.physics);
  const tooBig = useGraphStore((s) => activeGraph(s).nodes.length > PHYSICS_MAX_NODES);
  return (
    <button
      onClick={() => useView.getState().setPrefs({ physics: !on })}
      disabled={tooBig}
      aria-pressed={on && !tooBig}
      className={`icon-btn${on && !tooBig ? " small-btn--on" : ""}`}
      title={tooBig ? t("physics.titleTooBig", { n: PHYSICS_MAX_NODES }) : t(on ? "physics.titleOn" : "physics.titleOff")}
      aria-label={t("physics.button")}
      data-testid="physics-button"
    >
      <Icon icon={Magnet} />
    </button>
  );
}

const LAYOUTS: { value: CanvasLayout; label: MessageKey; title: MessageKey }[] = [
  { value: "flat", label: "layers.flat", title: "layers.flatTitle" },
  { value: "layered", label: "layers.layered", title: "layers.layeredTitle" },
];

/** "View" popover: which relation kinds to draw, edge labels, and the to-do view. Remembered per browser. */
export function ViewMenu() {
  const t = useT();
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const view = useView();
  const filtered = isFiltered(view);
  // Kind filters for the kinds this graph uses, plus any that are hidden now (so they can be shown again). A graph
  // without any kinds gets no kind section at all.
  const graph = useGraphStore(activeGraph);
  const used = new Set(graph.nodes.map(kindFilterOf));
  const kinds = used.size === 1 && used.has("none") && view.kinds.none
    ? []
    : KIND_FILTERS.filter((k) => used.has(k) || !view.kinds[k]);

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
          <fieldset className="view-menu__layout">
            <legend className="view-menu__head">{t("layers.layout")}</legend>
            {LAYOUTS.map((l) => (
              <label key={l.value} className="check" title={t(l.title)}>
                <input type="radio" name="canvas-layout" checked={view.layout === l.value} onChange={() => view.setPrefs({ layout: l.value })} />
                {t(l.label)}
              </label>
            ))}
            <button
              className="small-btn view-menu__3d"
              onClick={() => {
                setOpen(false);
                view.setView3d(true);
              }}
              title={t("layers.open3dTitle")}
              disabled={!graph.nodes.length}
            >
              <Icon icon={Box} size={14} />
              {t("layers.open3d")}
            </button>
          </fieldset>
          <hr className="menu__sep" />
          <div className="view-menu__head">{t("view.showRelations")}</div>
          {KINDS.map((k) => (
            <label key={k.origin} className="check" title={t(k.title)}>
              <input
                type="checkbox"
                checked={view.origins[k.origin]}
                onChange={(e) => view.setPrefs({ origins: { ...view.origins, [k.origin]: e.target.checked } })}
              />
              <span className={`edge-swatch edge-swatch--${k.origin}`} aria-hidden="true" />
              {t(k.label)}
            </label>
          ))}
          {/* Not a filter (these are Mix links): a legend entry for the colour of a "no relation found" link. */}
          <div className="view-menu__legend">
            <span className="edge-swatch edge-swatch--unrelated" aria-hidden="true" />
            {t("view.unrelated")}
          </div>
          {kinds.length > 0 && (
            <>
              <hr className="menu__sep" />
              <div className="view-menu__head" title={t("view.kindsTitle")}>{t("view.showKinds")}</div>
              <div className="view-menu__kinds">
                {kinds.map((k) => (
                  <label key={k} className="check">
                    <input
                      type="checkbox"
                      checked={view.kinds[k]}
                      onChange={(e) => view.setPrefs({ kinds: { ...view.kinds, [k]: e.target.checked } })}
                    />
                    {t(k === "none" ? "view.untyped" : KIND_LABEL[k])}
                  </label>
                ))}
              </div>
            </>
          )}
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
