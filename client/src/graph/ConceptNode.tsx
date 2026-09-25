import type { ConceptNode as CN } from "@nodestorm/shared";
import { Handle, Position, type Node, type NodeProps } from "@xyflow/react";
import { CircleDashed, Pin, RotateCcw, TriangleAlert } from "lucide-react";
import { memo } from "react";
import { useT, type MessageKey } from "../i18n";
import { analyzeNode, checkWithAi } from "../lib/actions";
import { isViewing, useGraphStore } from "../store/graphStore";
import { MathText } from "../panels/MathText";
import { Icon } from "../ui/Icon";
import { KindTag } from "./KindTag";
import { MasteryDot } from "./MasteryDot";

export type ConceptFlowNode = Node<{ concept: CN; inCycle?: boolean }, "concept">;

const badge: Record<CN["status"], MessageKey> = {
  ok: "state.ok",
  blocked: "state.blocked",
  checking: "state.checking",
  unclear: "badge.unclear",
  error: "badge.error",
  pending: "badge.pending",
};

function ConceptNodeView({ data, selected }: NodeProps<ConceptFlowNode>) {
  const t = useT();
  const c = data.concept;
  const graphId = useGraphStore((s) => s.activeId);
  const setClarifying = useGraphStore((s) => s.setClarifying);
  // Error, unclear and pending badges are buttons: retry, reopen the "what do you mean?" dialog, or check with the AI.
  // In the read-only share viewer the badges are plain labels (not buttons you can Tab to).
  const viewing = useGraphStore(isViewing);
  const action = viewing
    ? undefined
    : c.status === "error"
      ? () => analyzeNode(c.id, graphId)
      : c.status === "unclear"
        ? () => setClarifying({ graphId, nodeId: c.id })
        : c.status === "pending"
          ? () => checkWithAi(c.id, graphId)
          : undefined;
  // An unclear concept with nothing to choose from yet needs a definition, not a choice.
  const label: MessageKey = c.status === "unclear" && !c.senses?.length ? "badge.noDefinition" : badge[c.status];
  const aria: MessageKey = c.status === "error" ? "badge.retryAria" : c.status === "pending" ? "badge.pendingAria" : "badge.chooseAria";
  return (
    <div
      className={`concept concept--${c.status}${data.inCycle ? " concept--cycle" : ""}${selected ? " concept--selected" : ""}`}
      data-testid={`node-${c.name}`}
    >
      {/* Edges are drawn node-to-node ("floating"); handles only exist because React Flow requires them. */}
      <Handle type="target" position={Position.Top} className="concept__handle" isConnectable={false} />
      <Handle type="source" position={Position.Bottom} className="concept__handle" isConnectable={false} />
      {c.pinned && (
        <span className="concept__pin" title={t("physics.pinnedTitle")} role="img" aria-label={t("physics.pinned")}>
          <Icon icon={Pin} size={12} />
        </span>
      )}
      {c.kind && <div className="concept__kind"><KindTag kind={c.kind} /></div>}
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
            aria-label={t(aria, { name: c.name })}
          >
            <StatusMark status={c.status} />
            {t(label)}
            {c.status === "error" && <Icon icon={RotateCcw} size={12} />}
          </button>
        ) : (
          <span className={`concept__badge concept__badge--${c.status}`}><StatusMark status={c.status} />{t(label)}</span>
        )}
      </div>
      {c.definition && <div className="concept__def"><MathText text={c.definition} inline /></div>}
      {c.missingDeps.length > 0 && (
        <div className="concept__missing">
          <Icon icon={CircleDashed} size={12} />
          <span>{t("badge.missing", { names: c.missingDeps.map((d) => d.name).join(", ") })}</span>
        </div>
      )}
      {data.inCycle && (
        <div className="concept__cycle" title={t("badge.cycleTitle")}>
          <Icon icon={TriangleAlert} size={12} />
          <span>{t("badge.cycle")}</span>
        </div>
      )}
    </div>
  );
}

/** The dot at the start of a status pill; a small spinner while the AI is checking. Decoration only. */
export function StatusMark({ status }: { status: CN["status"] }) {
  return status === "checking" ? <span className="spinner spinner--xs" aria-hidden="true" /> : <span className="pill__dot" aria-hidden="true" />;
}

export const ConceptNode = memo(ConceptNodeView);
