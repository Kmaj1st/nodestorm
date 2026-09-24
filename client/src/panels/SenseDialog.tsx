import { useState } from "react";
import { analyzeNode, chooseSense } from "../lib/actions";
import { removeNode } from "../lib/graphOps";
import { useGraphStore } from "../store/graphStore";
import { useSettings } from "../store/settingsStore";

const OTHER = "__other__";

/** "What do you mean by X?" — shown when a concept name has several meanings. */
export function SenseDialog() {
  const clarifying = useGraphStore((s) => s.clarifying);
  const setClarifying = useGraphStore((s) => s.setClarifying);
  const mutate = useGraphStore((s) => s.mutate);
  const node = useGraphStore((s) =>
    s.clarifying ? s.graphs[s.clarifying.graphId]?.nodes.find((n) => n.id === s.clarifying!.nodeId) : undefined,
  );
  const optionCount = useSettings((s) => s.clarify.options);
  const [choice, setChoice] = useState<string | null>(null);
  const [otherName, setOtherName] = useState("");
  const [otherDef, setOtherDef] = useState("");

  if (!clarifying || !node) return null;
  const senses = node.senses ?? [];
  const close = () => setClarifying(null); // node stays "unclear"; its badge reopens this dialog

  const confirm = () => {
    if (choice === OTHER) {
      if (!otherDef.trim()) return;
      chooseSense(clarifying.graphId, node.id, { name: otherName.trim() || node.name, definition: otherDef });
    } else if (choice !== null) {
      chooseSense(clarifying.graphId, node.id, senses[Number(choice)]);
    }
  };
  const moreOptions = () => {
    // Re-ask the AI; clearing the definition keeps the analyze pipeline on the clarify step.
    setChoice(null);
    setClarifying(null);
    void analyzeNode(node.id, clarifying.graphId);
  };
  const remove = () => {
    mutate((g) => removeNode(g, node.id), clarifying.graphId);
    setClarifying(null);
  };

  return (
    <div className="modal" onClick={close}>
      <div className="modal__body" onClick={(e) => e.stopPropagation()} role="dialog" aria-label="What do you mean?">
        <h3>What do you mean by “{node.name}”?</h3>
        <p className="muted small">This name has several meanings. Pick the one you have in mind so the AI works with the right concept.</p>
        <div className="senses" role="radiogroup">
          {senses.map((s, i) => (
            <label key={i} className={`sense${choice === String(i) ? " sense--on" : ""}`}>
              <input type="radio" name="sense" checked={choice === String(i)} onChange={() => setChoice(String(i))} />
              <span>
                <span className="sense__head">
                  <b>{s.name}</b> <span className="role">{s.domain}</span>
                </span>
                <span className="muted small">{s.definition}</span>
              </span>
            </label>
          ))}
          <label className={`sense${choice === OTHER ? " sense--on" : ""}`}>
            <input type="radio" name="sense" checked={choice === OTHER} onChange={() => setChoice(OTHER)} />
            <span className="sense__other">
              <b>Something else</b>
              {choice === OTHER && (
                <>
                  <input
                    value={otherName}
                    onChange={(e) => setOtherName(e.target.value)}
                    placeholder={`Name (default: ${node.name})`}
                    aria-label="Your name for it"
                  />
                  <textarea
                    autoFocus
                    rows={3}
                    value={otherDef}
                    onChange={(e) => setOtherDef(e.target.value)}
                    placeholder="Describe what you mean"
                    aria-label="Your meaning"
                  />
                </>
              )}
            </span>
          </label>
        </div>
        <div className="form__actions">
          <button className="link small" onClick={remove}>Remove concept</button>
          <span className="spacer" />
          <button onClick={moreOptions} title={`Ask again (${optionCount} options — change in Settings)`}>Ask again</button>
          <button onClick={close}>Later</button>
          <button
            className="primary"
            onClick={confirm}
            disabled={choice === null || (choice === OTHER && !otherDef.trim())}
          >
            Use this meaning
          </button>
        </div>
      </div>
    </div>
  );
}
