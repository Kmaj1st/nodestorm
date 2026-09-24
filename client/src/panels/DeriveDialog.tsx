import type { DerivedProposal } from "@nodestorm/shared";
import { useEffect, useState } from "react";
import { useT } from "../i18n";
import { acceptProposal, derive } from "../lib/actions";
import { activeGraph, useGraphStore } from "../store/graphStore";
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
    <Modal label={t("derive.dialog")} onClose={onClose}>
      <h3>{t("derive.title", { names: names.join(" + ") })}</h3>
      {!graph.parentId && (
        <p className="hint">{t("derive.tip")}</p>
      )}
      <div className="row">
        <input value={goal} onChange={(e) => setGoal(e.target.value)} placeholder={t("derive.goalPlaceholder")} aria-label={t("derive.goal")} />
        <button onClick={run} disabled={busy}>{busy ? t("derive.thinking") : t("derive.regenerate")}</button>
      </div>
      {busy && !proposals && <p className="muted">{t("derive.thinking")}</p>}
      <ul className="candidates">
        {proposals?.length === 0 && <li className="muted">{t("derive.none")}</li>}
        {proposals?.map((p) => (
          <li key={p.name}>
            <div>
              <strong>{p.name}</strong>
              <div className="muted small">{p.definition}</div>
              {p.links.map((l) => (
                <div className="small" key={l.to}>→ {l.to}: <em>{l.fromNew.kind}</em></div>
              ))}
            </div>
            <button disabled={accepted.has(p.name)} onClick={() => { acceptProposal(p, anchorIds); setAccepted(new Set(accepted).add(p.name)); }}>
              {accepted.has(p.name) ? t("derive.added") : t("derive.accept")}
            </button>
          </li>
        ))}
      </ul>
      <div className="form__actions">
        <button onClick={onClose}>{t("common.close")}</button>
      </div>
    </Modal>
  );
}
