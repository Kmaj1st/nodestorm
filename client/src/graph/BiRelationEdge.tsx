import type { Relation } from "@nodestorm/shared";
import { useStore, useStoreApi, type Edge, type EdgeProps, type InternalNode, type ReactFlowState } from "@xyflow/react";
import { memo, useCallback, useLayoutEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { useT } from "../i18n";
import { isUnrelated } from "../lib/graphOps";
import { useGraphStore } from "../store/graphStore";
import { useView } from "../store/viewStore";

/** `cycle`: this is a dependency link on a dependency cycle (drawn as a warning). `aName`/`bName`: its concepts' names. */
export type RelationFlowEdge = Edge<{ relation: Relation; cycle?: boolean; aName: string; bName: string }, "bi">;

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

/** The line between the two cards' borders: where it ends at A (`p1`) and at B (`p2`), its angle and length. */
function geometry(s: InternalNode, t: InternalNode) {
  const p1 = borderPoint(s, center(t)); // end at A
  const p2 = borderPoint(t, center(s)); // end at B
  return { p1, p2, ang: Math.atan2(p2.y - p1.y, p2.x - p1.x), len: Math.hypot(p2.x - p1.x, p2.y - p1.y) };
}

/** On short edges the labels would cover the arrowheads, so they're hidden (the inspector still shows them). */
const LABEL_MIN_LENGTH = 170;

/**
 * Draws an arrowhead group (`Arrow`) with its tip at `tip`, pointing along angle `ang`. (Absolute coordinates rather
 * than a transform on the group: hundreds of transformed groups made every repaint of the canvas slower.)
 */
function aim(g: SVGGElement | null, tip: Pt, ang: number) {
  const hit = g?.firstElementChild;
  const head = g?.lastElementChild;
  if (!hit || !head) return;
  const back = { x: tip.x - Math.cos(ang) * HEAD, y: tip.y - Math.sin(ang) * HEAD };
  const nx = -Math.sin(ang) * (HEAD / 2);
  const ny = Math.cos(ang) * (HEAD / 2);
  hit.setAttribute("cx", String(tip.x - Math.cos(ang) * 8));
  hit.setAttribute("cy", String(tip.y - Math.sin(ang) * 8));
  head.setAttribute("points", `${tip.x},${tip.y} ${back.x + nx},${back.y + ny} ${back.x - nx},${back.y - ny}`);
}

/**
 * Arrowhead (placed by the edge through `gRef`). Wide invisible hit area for easy clicking.
 * It is also a keyboard button (Tab to it, Enter/Space opens that direction in the inspector).
 */
function Arrow({ gRef, active, kind, onClick, testId, label, tone }: {
  gRef: (el: SVGGElement | null) => void; active: boolean; kind: string; onClick: () => void; testId: string; label: string;
  /** Colour class: the relation's origin, or "unrelated" when Mix found nothing either way. */
  tone: string;
}) {
  const none = kind === "none";
  return (
    <g
      ref={gRef}
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
      <circle r={16} className="arrow__hit" />
      <polygon className="arrow__head" />
    </g>
  );
}

type Parts = { path: SVGPathElement | null; aToB: SVGGElement | null; bToA: SVGGElement | null; labels: Partial<Record<"aToB" | "bToA", HTMLElement | null>> };

/**
 * The line, arrowheads and labels are placed outside React: when a card moves (a drag, or Physics moving every card
 * each frame) the edge sets a few attributes itself instead of re-rendering, which dominated those frames on big
 * graphs. React never renders those attributes, so the two can't disagree. The edge re-renders only when its
 * relation, the open direction, the cards' names, the zoom threshold or whether its labels fit change.
 */
function BiRelationEdgeView({ id, source, target, data }: EdgeProps<RelationFlowEdge>) {
  const tr = useT(); // `t` is the target node here
  const store = useStoreApi();
  // Only the direction of *this* relation that is open, so opening one relation doesn't re-render every edge.
  const activeDir = useGraphStore((st) =>
    st.inspect?.kind === "edge" && st.inspect.relationId === data?.relation.id ? st.inspect.dir : null,
  );
  // A boolean selector: edges re-render when the zoom crosses the threshold, not on every zoom step.
  const tooSmall = useStore(zoomedOut);
  const labelsOn = useView((v) => v.edgeLabels) && !tooSmall;
  const labelLayer = useLabelLayer();
  const unrelated = data ? isUnrelated(data.relation) : false;

  const parts = useRef<Parts>({ path: null, aToB: null, bToA: null, labels: {} });
  const refs = useMemo(() => {
    const p = parts.current;
    return {
      path: (el: SVGPathElement | null) => void (p.path = el),
      aToB: (el: SVGGElement | null) => void (p.aToB = el),
      bToA: (el: SVGGElement | null) => void (p.bToA = el),
      label: {
        aToB: (el: HTMLElement | null) => void (p.labels.aToB = el),
        bToA: (el: HTMLElement | null) => void (p.labels.bToA = el),
      },
    };
  }, []);
  const [long, setLong] = useState(() => {
    const { nodeLookup } = store.getState();
    const [s, t] = [nodeLookup.get(source), nodeLookup.get(target)];
    return s && t ? geometry(s, t).len > LABEL_MIN_LENGTH : false;
  });
  const longRef = useRef(long);
  const unrelatedRef = useRef(unrelated);
  unrelatedRef.current = unrelated;
  const place = useCallback(() => {
    const { nodeLookup } = store.getState();
    const [s, t] = [nodeLookup.get(source), nodeLookup.get(target)];
    if (!s || !t) return;
    const { p1, p2, ang, len } = geometry(s, t);
    const { path, aToB, bToA, labels } = parts.current;
    path?.setAttribute("d", `M${p1.x},${p1.y} L${p2.x},${p2.y}`);
    aim(aToB, p2, ang);
    aim(bToA, p1, ang + Math.PI);
    // Labels sit near the arrowhead they describe, nudged off the line so the arrowheads stay clickable.
    const off = { x: -Math.sin(ang) * 14, y: Math.cos(ang) * 14 };
    const put = (el: HTMLElement | null | undefined, k: number) => {
      if (el) el.style.transform = `translate(-50%, -50%) translate(${p1.x + (p2.x - p1.x) * k + off.x}px, ${p1.y + (p2.y - p1.y) * k + off.y}px)`;
    };
    put(labels.aToB, unrelatedRef.current ? 0.5 : 0.7);
    put(labels.bToA, 0.3);
    // Only when it flips: a same-value setState from 600 edges each frame still costs React work.
    if (len > LABEL_MIN_LENGTH !== longRef.current) setLong((longRef.current = len > LABEL_MIN_LENGTH));
  }, [store, source, target]);
  // After every render (its elements may be new, or a label was just shown) and whenever either card moves or resizes.
  useLayoutEffect(place);
  useLayoutEffect(() => {
    // React Flow replaces a card's internal node object when it moves or is measured (what useInternalNode relies on).
    let lastS: InternalNode | undefined;
    let lastT: InternalNode | undefined;
    return store.subscribe(({ nodeLookup }) => {
      const s = nodeLookup.get(source);
      const t = nodeLookup.get(target);
      if (s === lastS && t === lastT) return;
      lastS = s;
      lastT = t;
      place();
    });
  }, [store, source, target, place]);

  // (React Flow renders an edge only while both its cards are in its store.)
  if (!data) return null;
  const { aName, bName } = data;
  const rel = data.relation;
  const tone = unrelated ? "unrelated" : rel.origin;
  // The stored keyword "none" is read out in the interface language.
  const shown = (kind: string) => (kind.trim() === "none" ? tr("edge.unrelatedLabel") : kind);
  // Read when clicked rather than subscribed to: one fewer store listener per edge on every graph change.
  const open = (dir: "aToB" | "bToA") => useGraphStore.getState().setInspect({ kind: "edge", relationId: rel.id, dir });

  return (
    <>
      <path ref={refs.path} id={id} className={`relation relation--${rel.origin}${unrelated ? " relation--unrelated" : ""}${data.cycle ? " relation--cycle" : ""}`} />
      <Arrow
        gRef={refs.aToB} active={activeDir === "aToB"} kind={rel.aToB.kind} onClick={() => open("aToB")} tone={tone}
        testId={`arrow-${rel.id}-aToB`}
        label={unrelated ? tr("edge.unrelated", { a: aName, b: bName }) : tr("edge.arrow", { a: aName, b: bName, kind: shown(rel.aToB.kind) })}
      />
      <Arrow
        gRef={refs.bToA} active={activeDir === "bToA"} kind={rel.bToA.kind} onClick={() => open("bToA")} tone={tone}
        testId={`arrow-${rel.id}-bToA`}
        label={unrelated ? tr("edge.unrelated", { a: bName, b: aName }) : tr("edge.arrow", { a: bName, b: aName, kind: shown(rel.bToA.kind) })}
      />
      {labelLayer &&
        labelsOn &&
        long &&
        createPortal(
          (unrelated
            ? [{ dir: "aToB" as const, kind: tr("edge.unrelatedLabel") }]
            : [
                { dir: "aToB" as const, kind: rel.aToB.kind },
                { dir: "bToA" as const, kind: rel.bToA.kind },
              ]
          ).map(({ dir, kind }) =>
            kind === "none" ? null : (
              <button
                key={dir}
                ref={refs.label[dir]}
                className={`edge-label nodrag nopan${unrelated ? " edge-label--unrelated" : ""}${activeDir === dir ? " edge-label--active" : ""}`}
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

/**
 * React Flow re-renders an edge whenever its cards move, passing their new coordinates, which this edge doesn't use
 * (it places itself, above): compare only what it does use.
 */
export const BiRelationEdge = memo(
  BiRelationEdgeView,
  (a: EdgeProps<RelationFlowEdge>, b: EdgeProps<RelationFlowEdge>) =>
    a.id === b.id && a.source === b.source && a.target === b.target && a.data === b.data,
);
