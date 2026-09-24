import type { ConceptNode as CN } from "@nodestorm/shared";
import { Handle, Position, type Node, type NodeProps } from "@xyflow/react";
import { memo } from "react";
import { useT, type MessageKey } from "../i18n";
import { analyzeNode } from "../lib/actions";
import { isViewing, useGraphStore } from "../store/graphStore";
import { MasteryDot } from "./MasteryDot";

export type ConceptFlowNode = Node<{ concept: CN; inCycle?: boolean }, "concept">;

const badge: Record<CN["status"], MessageKey> = {
  ok: "state.ok",
  blocked: "state.blocked",
  checking: "state.checking",
  unclear: "badge.unclear",
  error: "badge.error",
};

function ConceptNodeView({ data, selected }: NodeProps<ConceptFlowNode>) {
  const t = useT();
  const c = data.concept;
  const graphId = useGraphStore((s) => s.activeId);
  const setClarifying = useGraphStore((s) => s.setClarifying);
  // Error and unclear badges are buttons: retry, or reopen the "what do you mean?" dialog.
  // In the read-only share viewer the badges are plain labels (not buttons you can Tab to).
  const viewing = useGraphStore(isViewing);
  const action = viewing
    ? undefined
    : c.status === "error"
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
        <span className="concept__name">{c.name}{c.mastery && <MasteryDot mastery={c.mastery} name={c.name} />}</span>
        {action ? (
          <button
            className={`concept__badge concept__badge--${c.status} nodrag`}
            onClick={(e) => {
              e.stopPropagation();
              action();
            }}
            title={c.error}
            aria-label={t(c.status === "error" ? "badge.retryAria" : "badge.chooseAria", { name: c.name })}
          >
            {t(badge[c.status])}
          </button>
        ) : (
          <span className={`concept__badge concept__badge--${c.status}`}>{t(badge[c.status])}</span>
        )}
      </div>
      {c.definition && <div className="concept__def">{c.definition}</div>}
      {c.missingDeps.length > 0 && (
        <div className="concept__missing">
          {t("badge.missing", { names: c.missingDeps.map((d) => d.name).join(", ") })}
        </div>
      )}
      {data.inCycle && (
        <div className="concept__cycle" title={t("badge.cycleTitle")}>
          {t("badge.cycle")}
        </div>
      )}
    </div>
  );
}

export const ConceptNode = memo(ConceptNodeView);
