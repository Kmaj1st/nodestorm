import { ChevronLeft, ChevronRight, ChevronsLeft, ChevronsRight, LocateFixed, X } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import { Icon } from "../ui/Icon";
import { useT } from "../i18n";
import { viewport } from "../lib/viewport";
import { buildWalkthrough } from "../lib/walkthrough";
import { activeGraph, useGraphStore } from "../store/graphStore";
import { MathText } from "./MathText";
import { Modal } from "./Modal";
import "./walkthrough.css";

/**
 * Walkthrough (presentation) mode: a full-screen overlay with one slide per concept in study order, prerequisites
 * first, for a concept's learning path (`rootId`) or the whole graph. Read-only, so it works in the share viewer too.
 * ←/→, PageUp/PageDown, Space/Shift+Space, Home and End move between slides; Escape closes it (Modal).
 */
export function WalkthroughDialog({ rootId, onClose }: { rootId?: string; onClose: () => void }) {
  const t = useT();
  const graph = useGraphStore(activeGraph);
  const { slides, cyclic } = useMemo(() => buildWalkthrough(graph, rootId), [graph, rootId]);
  const [at, setAt] = useState(0);
  const i = Math.min(at, Math.max(0, slides.length - 1)); // the graph may shrink behind the overlay (undo elsewhere)
  const slide = slides[i];
  const count = slides.length;
  const go = (to: number) => setAt(Math.max(0, Math.min(count - 1, to)));
  // Start with focus on the slide (not the ✕ button, where Space would close the overlay); Modal keeps it there.
  const slideRef = useRef<HTMLElement>(null);
  useEffect(() => slideRef.current?.focus(), []);
  const rootName = rootId ? graph.nodes.find((n) => n.id === rootId)?.name : undefined;

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.defaultPrevented || e.altKey || e.ctrlKey || e.metaKey) return;
      const target = e.target as HTMLElement | null;
      // Space and Enter keep pressing a focused button; fields (none today) keep their keys.
      if (target?.closest("input, textarea, select")) return;
      if ((e.key === " " || e.key === "Enter") && target?.closest("button, a")) return;
      const moves: Record<string, number | undefined> = {
        ArrowRight: i + 1, PageDown: i + 1, ArrowLeft: i - 1, PageUp: i - 1, Home: 0, End: count - 1,
        " ": e.shiftKey ? i - 1 : i + 1,
      };
      const to = moves[e.key];
      if (to === undefined) return;
      e.preventDefault();
      setAt(Math.max(0, Math.min(count - 1, to)));
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [i, count]);

  const showOnCanvas = (id: string) => {
    onClose();
    // After the overlay is gone, so the canvas can measure itself.
    requestAnimationFrame(() => viewport.focus(id));
  };
  const inSlides = new Map(slides.map((s, n) => [s.id, n]));

  return (
    <Modal label={rootName ? t("walk.dialogPath", { name: rootName }) : t("walk.dialog")} onClose={onClose} className="walk">
      <header className="walk__bar">
        <span className="walk__title">{rootName ? t("walk.dialogPath", { name: rootName }) : t("walk.dialog")}</span>
        {count > 0 && (
          <span className="walk__progress" aria-live="polite" data-testid="walk-progress">
            {t("walk.progress", { i: i + 1, n: count })}
          </span>
        )}
        <button className="walk__close icon-btn" onClick={onClose} aria-label={t("common.close")} title={t("common.close")}>
          <Icon icon={X} />
        </button>
      </header>

      {!slide ? (
        <p className="walk__empty">{t("walk.empty")}</p>
      ) : (
        <article className="walk__slide" ref={slideRef} tabIndex={-1} data-testid="walk-slide">
          <h2 className="walk__name" data-testid="walk-name">{slide.name}</h2>
          <p className={`walk__def${slide.definition.trim() ? "" : " muted"}`}>
            {slide.definition.trim() ? <MathText text={slide.definition} /> : t("walk.noDefinition")}
          </p>

          {slide.buildsOn.length > 0 && (
            <section>
              <h3>{t("walk.buildsOn")}</h3>
              <ul className="walk__chips">
                {slide.buildsOn.map((d) => (
                  <li key={d.id}>
                    {inSlides.has(d.id) ? (
                      <button className="walk__chip" onClick={() => go(inSlides.get(d.id)!)}>{d.name}</button>
                    ) : <span className="walk__chip">{d.name}</span>}
                  </li>
                ))}
              </ul>
            </section>
          )}

          {slide.missing.length > 0 && (
            <section className="walk__missing" data-testid="walk-missing">
              <h3>{t("walk.missing")}</h3>
              <ul>
                {slide.missing.map((m) => (
                  <li key={m.name}><strong>{m.name}</strong>{m.reason && <> — <MathText text={m.reason} /></>}</li>
                ))}
              </ul>
            </section>
          )}

          {slide.relations.length > 0 && (
            <section>
              <h3>{t("walk.relations")}</h3>
              <ul className="walk__rels">
                {slide.relations.map((r, n) => (
                  <li key={n}>
                    <span className="walk__arrow">{r.dir === "out" ? "→" : "←"}</span> <strong>{r.otherName}</strong>
                    {r.kind && <>: {r.kind}</>}
                    {r.explanation && <> — <MathText text={r.explanation} /></>}
                  </li>
                ))}
              </ul>
            </section>
          )}

          {slide.explanation && (
            <section>
              <h3>{t("walk.explained")}</h3>
              <p><MathText text={slide.explanation.summary} /></p>
              {slide.explanation.keyPoints.length > 0 && (
                <ul>{slide.explanation.keyPoints.map((k, n) => <li key={n}><MathText text={k} /></li>)}</ul>
              )}
            </section>
          )}

          {slide.notes && (
            <section>
              <h3>{t("walk.notes")}</h3>
              <p className="walk__notes">{slide.notes}</p>
            </section>
          )}

          {cyclic && <p className="warn small">{t("path.cyclic")}</p>}
        </article>
      )}

      <footer className="walk__nav">
        <button onClick={() => go(0)} disabled={i === 0}><Icon icon={ChevronsLeft} />{t("walk.first")}</button>
        <button onClick={() => go(i - 1)} disabled={i === 0} data-testid="walk-prev"><Icon icon={ChevronLeft} />{t("walk.prev")}</button>
        {slide && <button onClick={() => showOnCanvas(slide.id)} data-testid="walk-show"><Icon icon={LocateFixed} />{t("walk.show")}</button>}
        <button className="primary" onClick={() => go(i + 1)} disabled={i >= count - 1} data-testid="walk-next">
          {t("walk.next")}<Icon icon={ChevronRight} />
        </button>
        <button onClick={() => go(count - 1)} disabled={i >= count - 1}>{t("walk.last")}<Icon icon={ChevronsRight} /></button>
      </footer>
      <p className="walk__keys muted small">{t("walk.keys")}</p>
    </Modal>
  );
}
