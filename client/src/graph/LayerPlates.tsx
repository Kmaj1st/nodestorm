import { ViewportPortal } from "@xyflow/react";
import { memo, useMemo } from "react";
import { useT } from "../i18n";
import { NODE_SIZE } from "../lib/graphOps";
import { LAYERED } from "../lib/layout";
import type { ConceptFlowNode } from "./ConceptNode";

/** Room around the cards on a plate. */
const MARGIN = { x: 70, y: 38 };

/**
 * The layered (2.5D) view's plates: one slanted sheet per dependency layer, stacked from the foundations (layer 0,
 * at the top) down, drawn behind the cards in flow coordinates. All plates share one width, so they read as a stack.
 */
function LayerPlatesView({ nodes, layers }: { nodes: ConceptFlowNode[]; layers: Map<string, number> }) {
  const t = useT();
  const plates = useMemo(() => {
    const shown = nodes.filter((n) => !n.hidden);
    if (!shown.length) return [];
    // The stack's extent without each layer's shear, so every plate has the same width.
    let min = Infinity;
    let max = -Infinity;
    const used = new Map<number, number>();
    for (const n of shown) {
      const l = layers.get(n.id) ?? 0;
      used.set(l, (used.get(l) ?? 0) + 1);
      min = Math.min(min, n.position.x - l * LAYERED.shear);
      max = Math.max(max, n.position.x - l * LAYERED.shear + NODE_SIZE.w);
    }
    return [...used]
      .sort((a, b) => a[0] - b[0])
      .map(([l, count]) => ({ l, count, x: min - MARGIN.x + l * LAYERED.shear, y: l * LAYERED.dy - MARGIN.y, w: max - min + 2 * MARGIN.x }));
  }, [nodes, layers]);

  return (
    <ViewportPortal>
      <div className="layer-plates" aria-hidden="true" data-testid="layer-plates">
        {plates.map((p) => (
          <div
            key={p.l}
            className={`layer-plate layer-plate--${Math.min(p.l, 5)}`}
            style={{ transform: `translate(${p.x}px, ${p.y}px)`, width: p.w, height: NODE_SIZE.h + 2 * MARGIN.y }}
            data-layer={p.l}
          >
            <span className="layer-plate__label">
              {p.l === 0 ? t("layers.foundations") : t("layers.layer", { n: p.l })}
              <span className="layer-plate__count"> · {t("layers.count", { n: p.count })}</span>
            </span>
          </div>
        ))}
      </div>
    </ViewportPortal>
  );
}

export const LayerPlates = memo(LayerPlatesView);
