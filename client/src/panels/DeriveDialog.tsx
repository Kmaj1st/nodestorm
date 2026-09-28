import { HINT_MAX, type DerivedProposal } from "@nodestorm/shared";
import { ArrowRight, Check, GitBranchPlus, Plus, RefreshCw } from "lucide-react";
import { useEffect, useRef, useState } from "react";
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
  const goalRef = useRef<HTMLInputElement>(null);
  // Set once "Fork a sandbox" was pressed here: says where accepted concepts now go.
  const [forked, setForked] = useState<string | null>(null);

  // Same as the toolbar's Fork sandbox. The copy keeps the concepts' ids, so the anchors, the proposals shown and a
  // derivation still running carry on; what is accepted from now on goes into the sandbox.
  const forkHere = () => {
    useGraphStore.getState().forkActive();
    const g = activeGraph(useGraphStore.getState());
    if (g.parentId) setForked(g.name);
    goalRef.current?.focus(); // the tip and its button are gone
  };

  const run = async () => {
    setProposals(null);
    setProposals((await derive(anchorIds, goal || undefined)) ?? []);
  };
  useEffect(() => { void run(); }, []); // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <Modal label={t("derive.dialog")} title={t("derive.title", { names: names.join(" + ") })} onClose={onClose}>
      {!graph.parentId && (
        <p className="hint derive__tip">
          <span>{t("derive.tip")}</span>
          <button onClick={forkHere} title={t("toolbar.forkTitle")}>
            <Icon icon={GitBranchPlus} size={14} />
            {t("derive.fork")}
          </button>
        </p>
      )}
      <p className={forked ? "hint" : "sr-only"} role="status">{forked && t("derive.forked", { name: forked })}</p>
      <div className="row derive__goal">
        <input ref={goalRef} value={goal} onChange={(e) => setGoal(e.target.value)} maxLength={HINT_MAX} placeholder={t("derive.goalPlaceholder")} aria-label={t("derive.goal")} />
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
                  <Icon icon={ArrowRight} size={12} /><span>{t("common.label", { label: l.to })} <em>{l.fromNew.kind}</em></span>
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
