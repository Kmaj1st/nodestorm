import type { Relation } from "@nodestorm/shared";
import { useInternalNode, useStore, type Edge, type EdgeProps, type InternalNode, type ReactFlowState } from "@xyflow/react";
import { memo, useLayoutEffect, useState } from "react";
import { createPortal } from "react-dom";
import { useT } from "../i18n";
import { isUnrelated } from "../lib/graphOps";
import { useGraphStore } from "../store/graphStore";
import { useView } from "../store/viewStore";

/** `cycle`: this is a dependency link on a dependency cycle (drawn as a warning). */
export type RelationFlowEdge = Edge<{ relation: Relation; cycle?: boolean }, "bi">;

type Pt = { x: number; y: number };

function center(n: InternalNode): Pt {
  const { x, y } = n.internals.positionAbsolute;
  return { x: x + (n.measured.width ?? 0) / 2, y: y + (n.measured.height ?? 0) / 2 };
}

/** Where the segment from the node's center towards `toward` leaves its bounding box. */
function borderPoint(n: InternalNode, toward: Pt, pad = 4): Pt {
  const c = center(n);
  const w = (n.measured.width ?? 0) / 2 + pad;
  const h = (n.measured.height ?? 0) / 2 + pad;
  const dx = toward.x - c.x;
  const dy = toward.y - c.y;
  if (dx === 0 && dy === 0) return c;
  const t = Math.min(w / Math.abs(dx || 1e-9), h / Math.abs(dy || 1e-9));
  return { x: c.x + dx * t, y: c.y + dy * t };
}

const HEAD = 14;

const domNodeOf = (st: ReactFlowState) => st.domNode;
/** Below this zoom the labels are too small to read and only cost rendering time (big graphs), so they're left out. */
const LABEL_MIN_ZOOM = 0.45;
const zoomedOut = (st: ReactFlowState) => st.transform[2] < LABEL_MIN_ZOOM;

/**
 * The layer edge labels are portalled into. React Flow's <EdgeLabelRenderer> finds it with querySelector inside
 * a store selector, i.e. once per edge on *every* store update; with hundreds of edges that dominated each
 * status update and drag frame. Here the lookup runs once per edge, when it mounts (and again after the
 * commit in case the layer wasn't in the DOM yet).
 */
function useLabelLayer() {
  const dom = useStore(domNodeOf);
  const find = () => dom?.querySelector<HTMLElement>(".react-flow__edgelabel-renderer") ?? null;
  const [layer, setLayer] = useState(find);
  useLayoutEffect(() => {
    const el = find();
    if (el !== layer) setLayer(el);
  }, [dom]); // only when React Flow's root element changes
  return layer;
}

/**
 * Arrowhead with its tip at `tip`, pointing along angle `ang`. Wide invisible hit area for easy clicking.
 * It is also a keyboard button (Tab to it, Enter/Space opens that direction in the inspector).
 */
function Arrow({ tip, ang, active, kind, onClick, testId, label, tone }: {
  tip: Pt; ang: number; active: boolean; kind: string; onClick: () => void; testId: string; label: string;
  /** Colour class: the relation's origin, or "unrelated" when Mix found nothing either way. */
  tone: string;
}) {
  const back = { x: tip.x - Math.cos(ang) * HEAD, y: tip.y - Math.sin(ang) * HEAD };
  const nx = -Math.sin(ang) * (HEAD / 2);
  const ny = Math.cos(ang) * (HEAD / 2);
  const pts = `${tip.x},${tip.y} ${back.x + nx},${back.y + ny} ${back.x - nx},${back.y - ny}`;
  const none = kind === "none";
  return (
    <g
      className={`arrow arrow--${tone}${active ? " arrow--active" : ""}${none && tone !== "unrelated" ? " arrow--none" : ""}`}
      onClick={(e) => { e.stopPropagation(); onClick(); }}
      onKeyDown={(e) => {
        if (e.key !== "Enter" && e.key !== " ") return;
        e.preventDefault();
        e.stopPropagation();
        onClick();
      }}
      role="button"
      tabIndex={0}
      aria-label={label}
      aria-pressed={active}
      data-testid={testId}
    >
      <circle cx={tip.x - Math.cos(ang) * 8} cy={tip.y - Math.sin(ang) * 8} r={16} className="arrow__hit" />
      <polygon points={pts} className="arrow__head" />
    </g>
  );
}

function BiRelationEdgeView({ id, source, target, data }: EdgeProps<RelationFlowEdge>) {
  const tr = useT(); // `t` is the target node here
  const s = useInternalNode(source);
  const t = useInternalNode(target);
  // Only the direction of *this* relation that is open, so opening one relation doesn't re-render every edge.
  const activeDir = useGraphStore((st) =>
    st.inspect?.kind === "edge" && st.inspect.relationId === data?.relation.id ? st.inspect.dir : null,
  );
  const setInspect = useGraphStore((st) => st.setInspect);
  // A boolean selector: edges re-render when the zoom crosses the threshold, not on every zoom step.
  const tooSmall = useStore(zoomedOut);
  const labelsOn = useView((v) => v.edgeLabels) && !tooSmall;
  const labelLayer = useLabelLayer();
  if (!s || !t || !data) return null;
  const rel = data.relation;
  const unrelated = isUnrelated(rel);
  const tone = unrelated ? "unrelated" : rel.origin;
  const nameOf = (n: InternalNode) => (n.data as { concept?: { name: string } }).concept?.name ?? "?";
  const [aName, bName] = [nameOf(s), nameOf(t)];
  // The stored keyword "none" is read out in the interface language.
  const shown = (kind: string) => (kind.trim() === "none" ? tr("edge.unrelatedLabel") : kind);

  const p1 = borderPoint(s, center(t)); // end at A
  const p2 = borderPoint(t, center(s)); // end at B
  const ang = Math.atan2(p2.y - p1.y, p2.x - p1.x);
  const open = (dir: "aToB" | "bToA") => setInspect({ kind: "edge", relationId: rel.id, dir });

  // Labels sit near the arrowhead they describe, nudged off the line so the arrowheads stay clickable.
  // On short edges they'd cover the arrowheads, so they're hidden (the inspector still shows them).
  const len = Math.hypot(p2.x - p1.x, p2.y - p1.y);
  const showLabels = labelsOn && len > 170;
  const off = { x: -Math.sin(ang) * 14, y: Math.cos(ang) * 14 };
  const lerp = (k: number) => ({ x: p1.x + (p2.x - p1.x) * k + off.x, y: p1.y + (p2.y - p1.y) * k + off.y });
  const nearB = lerp(0.7);
  const nearA = lerp(0.3);

  return (
    <>
      <path id={id} d={`M${p1.x},${p1.y} L${p2.x},${p2.y}`} className={`relation relation--${rel.origin}${unrelated ? " relation--unrelated" : ""}${data.cycle ? " relation--cycle" : ""}`} />
      <Arrow
        tip={p2} ang={ang} active={activeDir === "aToB"} kind={rel.aToB.kind} onClick={() => open("aToB")} tone={tone}
        testId={`arrow-${rel.id}-aToB`}
        label={unrelated ? tr("edge.unrelated", { a: aName, b: bName }) : tr("edge.arrow", { a: aName, b: bName, kind: shown(rel.aToB.kind) })}
      />
      <Arrow
        tip={p1} ang={ang + Math.PI} active={activeDir === "bToA"} kind={rel.bToA.kind} onClick={() => open("bToA")} tone={tone}
        testId={`arrow-${rel.id}-bToA`}
        label={unrelated ? tr("edge.unrelated", { a: bName, b: aName }) : tr("edge.arrow", { a: bName, b: aName, kind: shown(rel.bToA.kind) })}
      />
      {labelLayer &&
        showLabels &&
        createPortal(
          (unrelated
            ? [{ dir: "aToB" as const, at: lerp(0.5), kind: tr("edge.unrelatedLabel") }]
            : [
                { dir: "aToB" as const, at: nearB, kind: rel.aToB.kind },
                { dir: "bToA" as const, at: nearA, kind: rel.bToA.kind },
              ]
          ).map(({ dir, at, kind }) =>
            kind === "none" ? null : (
              <button
                key={dir}
                className={`edge-label nodrag nopan${unrelated ? " edge-label--unrelated" : ""}${activeDir === dir ? " edge-label--active" : ""}`}
                style={{ transform: `translate(-50%, -50%) translate(${at.x}px, ${at.y}px)` }}
                onClick={() => open(dir)}
                title={tr(dir === "aToB" ? "edge.aToB" : "edge.bToA")}
                tabIndex={-1} // the arrowheads are the keyboard stops; these just repeat them for the mouse
              >
                {kind}
              </button>
            ),
          ),
          labelLayer,
        )}
    </>
  );
}

export const BiRelationEdge = memo(BiRelationEdgeView);
