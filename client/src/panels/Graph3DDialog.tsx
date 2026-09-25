import { RotateCcw } from "lucide-react";
import { useEffect, useMemo, useRef, useState, type KeyboardEvent } from "react";
import { useLang, useT } from "../i18n";
import { dependencyLayers } from "../lib/layout";
import { useTheme } from "../lib/theme";
import { activeGraph, useGraphStore } from "../store/graphStore";
import { goToConcept } from "../store/viewStore";
import { Icon } from "../ui/Icon";
import { createScene, themeColors, type Scene3D } from "../graph3d/scene";
import { Modal } from "./Modal";

const reducedMotion = () => typeof matchMedia === "function" && matchMedia("(prefers-reduced-motion: reduce)").matches;

/**
 * "3D view": the active graph's dependency layers as stacked plates in 3D (graph3d/scene.ts). Look-only: drag to
 * rotate, scroll to zoom, right-drag to pan, arrow keys and +/- too; clicking a concept (on a card, or in the list of
 * layers beside it) closes the view and opens that concept on the canvas.
 */
export function Graph3DDialog({ onClose }: { onClose: () => void }) {
  const t = useT();
  const graph = useGraphStore(activeGraph);
  const theme = useTheme((s) => s.theme);
  const lang = useLang();
  const canvas = useRef<HTMLCanvasElement>(null);
  const scene = useRef<Scene3D | null>(null);
  const [hover, setHover] = useState<string | null>(null);
  const [failed, setFailed] = useState(false);
  const layers = useMemo(() => dependencyLayers(graph), [graph]);
  const byLayer = useMemo(() => {
    const out: { l: number; nodes: typeof graph.nodes }[] = [];
    for (const n of graph.nodes) {
      const l = layers.get(n.id) ?? 0;
      (out[l] ??= { l, nodes: [] }).nodes.push(n);
    }
    return out.filter(Boolean).map((x) => ({ ...x, nodes: [...x.nodes].sort((a, b) => a.name.localeCompare(b.name)) }));
  }, [graph, layers]);

  const open = (id: string) => {
    onClose();
    // After the dialog is gone, so the canvas can centre on it.
    requestAnimationFrame(() => goToConcept(id));
  };
  const openRef = useRef(open);
  openRef.current = open;

  // The scene is rebuilt when the graph or the theme changes (colours come from the CSS variables).
  useEffect(() => {
    if (!canvas.current) return;
    try {
      scene.current = createScene({
        canvas: canvas.current,
        graph,
        layers,
        colors: themeColors(),
        labels: { layer: (n) => (n === 0 ? t("layers.foundations") : t("layers.layer", { n })) },
        reducedMotion: reducedMotion(),
        onPick: (id) => openRef.current(id),
        onHover: setHover,
      });
      setFailed(false);
    } catch (e) {
      console.warn("3D view unavailable:", e);
      setFailed(true);
    }
    return () => {
      scene.current?.dispose();
      scene.current = null;
    };
  }, [graph, layers, theme, lang, t]);

  const onKey = (e: KeyboardEvent) => {
    const s = scene.current;
    if (!s) return;
    const step = 0.12;
    const act: Record<string, () => void> = {
      ArrowLeft: () => s.rotate(-step, 0),
      ArrowRight: () => s.rotate(step, 0),
      ArrowUp: () => s.rotate(0, -step),
      ArrowDown: () => s.rotate(0, step),
      "+": () => s.zoom(0.85),
      "=": () => s.zoom(0.85),
      "-": () => s.zoom(1.18),
      "0": () => s.resetView(),
    };
    const fn = act[e.key];
    if (fn) {
      e.preventDefault();
      fn();
    }
  };

  return (
    <Modal label={t("view3d.title")} title={t("view3d.title")} onClose={onClose} className="graph3d">
      <div className="graph3d__body">
        <div className="graph3d__stage">
          {failed ? (
            <p className="graph3d__failed" role="alert">{t("view3d.noWebgl")}</p>
          ) : (
            <canvas
              ref={canvas}
              className="graph3d__canvas"
              tabIndex={0}
              onKeyDown={onKey}
              role="img"
              aria-label={t("view3d.canvasLabel", { n: graph.nodes.length, layers: byLayer.length })}
              data-testid="graph3d-canvas"
            />
          )}
          <div className="graph3d__hud">
            <span className="graph3d__hint small">{hover ?? t("view3d.hint")}</span>
            <button className="small-btn" onClick={() => scene.current?.resetView()} title={t("view3d.resetTitle")}>
              <Icon icon={RotateCcw} size={14} />
              {t("view3d.reset")}
            </button>
          </div>
        </div>
        {/* The same concepts as a list: every one reachable without the canvas (keyboard, screen readers). */}
        <nav className="graph3d__list" aria-label={t("view3d.listLabel")}>
          {byLayer.map(({ l, nodes }) => (
            <section key={l}>
              <h3 className="graph3d__layer">{l === 0 ? t("layers.foundations") : t("layers.layer", { n: l })}</h3>
              <ul>
                {nodes.map((n) => (
                  <li key={n.id}>
                    <button className="link" onClick={() => open(n.id)}>{n.name}</button>
                  </li>
                ))}
              </ul>
            </section>
          ))}
          {!byLayer.length && <p className="muted small">{t("view3d.empty")}</p>}
        </nav>
      </div>
    </Modal>
  );
}
