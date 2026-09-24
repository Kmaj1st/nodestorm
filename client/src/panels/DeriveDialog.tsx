import type { DerivedProposal } from "@nodestorm/shared";
import { useEffect, useState } from "react";
import { acceptProposal, derive } from "../lib/actions";
import { activeGraph, useGraphStore } from "../store/graphStore";

export function DeriveDialog({ anchorIds, onClose }: { anchorIds: string[]; onClose: () => void }) {
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
    <div className="modal" onClick={onClose}>
      <div className="modal__body" onClick={(e) => e.stopPropagation()} role="dialog" aria-label="Derive">
        <h3>Derive from {names.join(" + ")}</h3>
        {!graph.parentId && (
          <p className="hint">Tip: derivations are safer in a sandbox — fork first to experiment without touching the main graph.</p>
        )}
        <div className="row">
          <input value={goal} onChange={(e) => setGoal(e.target.value)} placeholder="Optional goal, e.g. 'a counterexample'" />
          <button onClick={run} disabled={busy}>{busy ? "Thinking…" : "Regenerate"}</button>
        </div>
        {busy && !proposals && <p className="muted">Thinking…</p>}
        <ul className="candidates">
          {proposals?.length === 0 && <li className="muted">No proposals.</li>}
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
                {accepted.has(p.name) ? "Added" : "Accept"}
              </button>
            </li>
          ))}
        </ul>
        <div className="form__actions">
          <button onClick={onClose}>Close</button>
        </div>
      </div>
    </div>
  );
}
