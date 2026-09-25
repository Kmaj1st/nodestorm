import { Network } from "lucide-react";
import { useState } from "react";
import { useT } from "../../i18n";
import { sourceLabel } from "../../lib/export";
import { buildGraphPlan, type GraphPlan, type PlanItem } from "../../lib/derivation";
import { graphDisplayName } from "../../lib/graphOps";
import { useDerive } from "../../store/deriveStore";
import { useGraphStore } from "../../store/graphStore";
import { Icon } from "../../ui/Icon";
import { MathText } from "../MathText";
import { Modal } from "../Modal";

/**
 * "Add to graph": the learner picks what of the derivation goes into the graph. The problem becomes a concept that
 * depends on every ticked concept; concepts already in the graph are linked, not added again.
 */
export function AddToGraphDialog({ onClose }: { onClose: () => void }) {
  const t = useT();
  const d = useDerive((s) => s.sessions.find((x) => x.id === s.currentId))!;
  const graph = useGraphStore((s) => s.graphs[s.activeId]);
  const [plan, setPlan] = useState<GraphPlan>(() => buildGraphPlan(d, graph));
  const setItem = (key: string, patch: Partial<PlanItem>) =>
    setPlan({ ...plan, items: plan.items.map((it) => (it.key === key ? { ...it, ...patch } : it)) });
  const problem = plan.items.find((it) => it.kind === "problem")!;
  const concepts = plan.items.filter((it) => it.kind === "concept");
  const count = plan.items.filter((it) => it.include && it.name.trim()).length;

  const add = () => {
    useDerive.getState().addToGraph(plan);
    onClose();
  };

  return (
    <Modal label={t("dt.add.title")} title={t("dt.add.title")} onClose={onClose} className="extract">
      <p className="muted small">{t("dt.add.intro", { graph: graphDisplayName(graph) })}</p>

      <h4 className="extract__head">{t("dt.add.result")}</h4>
      <ul className="extract__list">
        <Item item={problem} onChange={(p) => setItem(problem.key, p)} />
      </ul>
      <label className="check small">
        <input type="checkbox" checked={plan.keepSteps} disabled={!problem.include || !d.steps.length} onChange={(e) => setPlan({ ...plan, keepSteps: e.target.checked })} />
        {t("dt.add.keepSteps")}
      </label>

      <h4 className="extract__head">{t("dt.add.concepts", { n: concepts.length })}</h4>
      {!concepts.length && <p className="muted small">{t("dt.add.noConcepts")}</p>}
      <ul className="extract__list">
        {concepts.map((it) => (
          <Item key={it.key} item={it} onChange={(p) => setItem(it.key, p)} />
        ))}
      </ul>

      <div className="form__actions">
        <button onClick={onClose}>{t("common.cancel")}</button>
        <button className="primary" onClick={add} disabled={!count}>
          <Icon icon={Network} size={14} />
          {t("dt.add.run", { n: count })}
        </button>
      </div>
    </Modal>
  );
}

function Item({ item, onChange }: { item: PlanItem; onChange: (p: Partial<PlanItem>) => void }) {
  const t = useT();
  const existing = useGraphStore((s) => (item.existingId ? s.graphs[s.activeId]?.nodes.find((n) => n.id === item.existingId) : undefined));
  return (
    <li className={existing ? "extract__item extract__item--dup" : "extract__item"} data-testid={`plan-${item.key}`}>
      <input type="checkbox" checked={item.include} onChange={(e) => onChange({ include: e.target.checked })} aria-label={t("dt.add.include", { name: item.name })} />
      <div className="extract__body">
        {existing ? (
          <span className="extract__name">{existing.name}</span>
        ) : (
          <input className="extract__name" value={item.name} onChange={(e) => onChange({ name: e.target.value })} aria-label={t("dt.add.rename", { name: item.name })} />
        )}
        {existing && <div className="extract__dup small">{t("dt.add.existing")}</div>}
        {item.definition && (
          <div className="muted small">
            <MathText text={item.definition} />
          </div>
        )}
        {item.source && <div className="muted small">{t("dt.add.source", { source: sourceLabel(item.source) })}</div>}
      </div>
    </li>
  );
}
