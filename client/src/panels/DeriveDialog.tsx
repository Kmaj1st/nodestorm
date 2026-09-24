import type { DerivedProposal } from "@nodestorm/shared";
import { ArrowRight, Check, Plus, RefreshCw } from "lucide-react";
import { useEffect, useState } from "react";
import { Icon } from "../ui/Icon";
import { useT } from "../i18n";
import { acceptProposal, derive } from "../lib/actions";
import { activeGraph, useGraphStore } from "../store/graphStore";
import { MathText } from "./MathText";
import { Modal } from "./Modal";

export function DeriveDialog({ anchorIds, onClose }: { anchorIds: string[]; onClose: () => void }) {
  const t = useT();
  const graph = useGraphStore(activeGraph);
  const [goal, setGoal] = useState("");
  const [proposals, setProposals] = useState<DerivedProposal[] | null>(null);
  const [accepted, setAccepted] = useState<Set<string>>(new Set());
  const busy = useGraphStore((s) => Boolean(s.busy.derive));
  const names = graph.nodes.filter((n) => anchorIds.includes(n.id)).map((n) => n.name);

  const run = async () => {
    setProposals(null);
    setProposals((await derive(anchorIds, goal || undefined)) ?? []);
  };
  useEffect(() => { void run(); }, []); // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <Modal label={t("derive.dialog")} title={t("derive.title", { names: names.join(" + ") })} onClose={onClose}>
      {!graph.parentId && (
        <p className="hint">{t("derive.tip")}</p>
      )}
      <div className="row">
        <input value={goal} onChange={(e) => setGoal(e.target.value)} placeholder={t("derive.goalPlaceholder")} aria-label={t("derive.goal")} />
        <button onClick={run} disabled={busy}>
          {busy ? <span className="spinner spinner--xs" aria-hidden="true" /> : <Icon icon={RefreshCw} size={14} />}
          {busy ? t("derive.thinking") : t("derive.regenerate")}
        </button>
      </div>
      {busy && !proposals && <p className="muted">{t("derive.thinking")}</p>}
      <ul className="candidates">
        {proposals?.length === 0 && <li className="muted">{t("derive.none")}</li>}
        {proposals?.map((p) => (
          <li key={p.name}>
            <div>
              <strong>{p.name}</strong>
              <div className="muted small"><MathText text={p.definition} /></div>
              {p.links.map((l) => (
                <div className="small candidate__link" key={l.to}>
                  <Icon icon={ArrowRight} size={12} /><span>{l.to}: <em>{l.fromNew.kind}</em></span>
                </div>
              ))}
            </div>
            <button disabled={accepted.has(p.name)} onClick={() => { acceptProposal(p, anchorIds); setAccepted(new Set(accepted).add(p.name)); }}>
              <Icon icon={accepted.has(p.name) ? Check : Plus} size={14} />
              {accepted.has(p.name) ? t("derive.added") : t("derive.accept")}
            </button>
          </li>
        ))}
      </ul>
    </Modal>
  );
}
