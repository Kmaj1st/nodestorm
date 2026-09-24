import type { ConceptNode as CN } from "@nodestorm/shared";
import { Handle, Position, type Node, type NodeProps } from "@xyflow/react";
import { memo } from "react";
import { analyzeNode } from "../lib/actions";
import { useGraphStore } from "../store/graphStore";

export type ConceptFlowNode = Node<{ concept: CN; inCycle?: boolean }, "concept">;

const badge: Record<CN["status"], string> = {
  ok: "ready",
  blocked: "blocked",
  checking: "checking…",
  unclear: "what do you mean?",
  error: "failed – retry",
};

function ConceptNodeView({ data, selected }: NodeProps<ConceptFlowNode>) {
  const c = data.concept;
  const graphId = useGraphStore((s) => s.activeId);
  const setClarifying = useGraphStore((s) => s.setClarifying);
  // Error and unclear badges are buttons: retry, or reopen the "what do you mean?" dialog.
  const action =
    c.status === "error"
      ? () => analyzeNode(c.id, graphId)
      : c.status === "unclear"
        ? () => setClarifying({ graphId, nodeId: c.id })
        : undefined;
  return (
    <div
      className={`concept concept--${c.status}${data.inCycle ? " concept--cycle" : ""}${selected ? " concept--selected" : ""}`}
      data-testid={`node-${c.name}`}
    >
      {/* Edges are drawn node-to-node ("floating"); handles only exist because React Flow requires them. */}
      <Handle type="target" position={Position.Top} className="concept__handle" isConnectable={false} />
      <Handle type="source" position={Position.Bottom} className="concept__handle" isConnectable={false} />
      <div className="concept__head">
        <span className="concept__name">{c.name}</span>
        {action ? (
          <button
            className={`concept__badge concept__badge--${c.status} nodrag`}
            onClick={(e) => {
              e.stopPropagation();
              action();
            }}
            title={c.error}
            aria-label={c.status === "error" ? `Retry checking ${c.name}` : `Choose what you mean by ${c.name}`}
          >
            {badge[c.status]}
          </button>
        ) : (
          <span className={`concept__badge concept__badge--${c.status}`}>{badge[c.status]}</span>
        )}
      </div>
      {c.definition && <div className="concept__def">{c.definition}</div>}
      {c.missingDeps.length > 0 && (
        <div className="concept__missing">
          missing: {c.missingDeps.map((d) => d.name).join(", ")}
        </div>
      )}
      {data.inCycle && (
        <div className="concept__cycle" title="This concept is (indirectly) its own prerequisite. Open it to fix the links.">
          ⚠ dependency cycle
        </div>
      )}
    </div>
  );
}

export const ConceptNode = memo(ConceptNodeView);
