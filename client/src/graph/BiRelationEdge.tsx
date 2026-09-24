import type { Relation } from "@nodestorm/shared";
import { EdgeLabelRenderer, useInternalNode, type Edge, type EdgeProps, type InternalNode } from "@xyflow/react";
import { memo } from "react";
import { useGraphStore } from "../store/graphStore";

export type RelationFlowEdge = Edge<{ relation: Relation }, "bi">;

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

/**
 * Arrowhead with its tip at `tip`, pointing along angle `ang`. Wide invisible hit area for easy clicking.
 * It is also a keyboard button (Tab to it, Enter/Space opens that direction in the inspector).
 */
function Arrow({ tip, ang, active, kind, onClick, testId, label }: {
  tip: Pt; ang: number; active: boolean; kind: string; onClick: () => void; testId: string; label: string;
}) {
  const back = { x: tip.x - Math.cos(ang) * HEAD, y: tip.y - Math.sin(ang) * HEAD };
  const nx = -Math.sin(ang) * (HEAD / 2);
  const ny = Math.cos(ang) * (HEAD / 2);
  const pts = `${tip.x},${tip.y} ${back.x + nx},${back.y + ny} ${back.x - nx},${back.y - ny}`;
  const none = kind === "none";
  return (
    <g
      className={`arrow${active ? " arrow--active" : ""}${none ? " arrow--none" : ""}`}
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
  const s = useInternalNode(source);
  const t = useInternalNode(target);
  const inspect = useGraphStore((st) => st.inspect);
  const setInspect = useGraphStore((st) => st.setInspect);
  if (!s || !t || !data) return null;
  const rel = data.relation;
  const nameOf = (n: InternalNode) => (n.data as { concept?: { name: string } }).concept?.name ?? "?";
  const [aName, bName] = [nameOf(s), nameOf(t)];

  const p1 = borderPoint(s, center(t)); // end at A
  const p2 = borderPoint(t, center(s)); // end at B
  const ang = Math.atan2(p2.y - p1.y, p2.x - p1.x);
  const activeDir = inspect?.kind === "edge" && inspect.relationId === rel.id ? inspect.dir : null;
  const open = (dir: "aToB" | "bToA") => setInspect({ kind: "edge", relationId: rel.id, dir });

  // Labels sit near the arrowhead they describe, nudged off the line so the arrowheads stay clickable.
  // On short edges they'd cover the arrowheads, so they're hidden (the inspector still shows them).
  const len = Math.hypot(p2.x - p1.x, p2.y - p1.y);
  const showLabels = len > 170;
  const off = { x: -Math.sin(ang) * 14, y: Math.cos(ang) * 14 };
  const lerp = (k: number) => ({ x: p1.x + (p2.x - p1.x) * k + off.x, y: p1.y + (p2.y - p1.y) * k + off.y });
  const nearB = lerp(0.7);
  const nearA = lerp(0.3);

  return (
    <>
      <path id={id} d={`M${p1.x},${p1.y} L${p2.x},${p2.y}`} className={`relation relation--${rel.origin}`} />
      <Arrow
        tip={p2} ang={ang} active={activeDir === "aToB"} kind={rel.aToB.kind} onClick={() => open("aToB")}
        testId={`arrow-${rel.id}-aToB`} label={`What ${aName} does to ${bName}: ${rel.aToB.kind}`}
      />
      <Arrow
        tip={p1} ang={ang + Math.PI} active={activeDir === "bToA"} kind={rel.bToA.kind} onClick={() => open("bToA")}
        testId={`arrow-${rel.id}-bToA`} label={`What ${bName} does to ${aName}: ${rel.bToA.kind}`}
      />
      <EdgeLabelRenderer>
        {[
          { dir: "aToB" as const, at: nearB, kind: rel.aToB.kind },
          { dir: "bToA" as const, at: nearA, kind: rel.bToA.kind },
        ].map(({ dir, at, kind }) =>
          kind === "none" || !showLabels ? null : (
            <button
              key={dir}
              className={`edge-label nodrag nopan${activeDir === dir ? " edge-label--active" : ""}`}
              style={{ transform: `translate(-50%, -50%) translate(${at.x}px, ${at.y}px)` }}
              onClick={() => open(dir)}
              title={dir === "aToB" ? "What A does to B" : "What B does to A"}
              tabIndex={-1} // the arrowheads are the keyboard stops; these just repeat them for the mouse
            >
              {kind}
            </button>
          ),
        )}
      </EdgeLabelRenderer>
    </>
  );
}

export const BiRelationEdge = memo(BiRelationEdgeView);
