import type { ConceptNode as CN } from "@nodestorm/shared";
import { Handle, Position, type Node, type NodeProps } from "@xyflow/react";
import { memo } from "react";

export type ConceptFlowNode = Node<{ concept: CN }, "concept">;

const badge: Record<CN["status"], string> = {
  ok: "ready",
  blocked: "blocked",
  checking: "checking…",
  error: "error",
};

function ConceptNodeView({ data, selected }: NodeProps<ConceptFlowNode>) {
  const c = data.concept;
  return (
    <div className={`concept concept--${c.status}${selected ? " concept--selected" : ""}`} data-testid={`node-${c.name}`}>
      {/* Edges are drawn node-to-node ("floating"); handles only exist because React Flow requires them. */}
      <Handle type="target" position={Position.Top} className="concept__handle" isConnectable={false} />
      <Handle type="source" position={Position.Bottom} className="concept__handle" isConnectable={false} />
      <div className="concept__head">
        <span className="concept__name">{c.name}</span>
        <span className={`concept__badge concept__badge--${c.status}`}>{badge[c.status]}</span>
      </div>
      {c.definition && <div className="concept__def">{c.definition}</div>}
      {c.missingDeps.length > 0 && (
        <div className="concept__missing">
          missing: {c.missingDeps.map((d) => d.name).join(", ")}
        </div>
      )}
    </div>
  );
}

export const ConceptNode = memo(ConceptNodeView);
