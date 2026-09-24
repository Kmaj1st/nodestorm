import type { ConceptNode } from "@nodestorm/shared";
import { useState } from "react";
import { useT } from "../i18n";
import { analyzeNode, chooseSense } from "../lib/actions";
import { removeNode } from "../lib/graphOps";
import { useGraphStore } from "../store/graphStore";
import { useSettings } from "../store/settingsStore";
import { MathText } from "./MathText";
import { Modal } from "./Modal";

const OTHER = "__other__";

/** "What do you mean by X?" — shown when a concept name has several meanings. */
export function SenseDialog() {
  const clarifying = useGraphStore((s) => s.clarifying);
  const node = useGraphStore((s) =>
    s.clarifying ? s.graphs[s.clarifying.graphId]?.nodes.find((n) => n.id === s.clarifying!.nodeId) : undefined,
  );
  if (!clarifying || !node) return null;
  // Keyed so the picked option and "something else" text never carry over to another node or a new set of meanings.
  const key = `${clarifying.graphId}:${node.id}:${(node.senses ?? []).map((x) => x.name).join("|")}`;
  return <SenseChoice key={key} graphId={clarifying.graphId} node={node} />;
}

function SenseChoice({ graphId, node }: { graphId: string; node: ConceptNode }) {
  const t = useT();
  const setClarifying = useGraphStore((s) => s.setClarifying);
  const mutate = useGraphStore((s) => s.mutate);
  const clarifying = { graphId, nodeId: node.id };
  const optionCount = useSettings((s) => s.clarify.options);
  const [choice, setChoice] = useState<string | null>(null);
  const [otherName, setOtherName] = useState("");
  const [otherDef, setOtherDef] = useState("");

  const senses = node.senses ?? [];
  const picked = choice !== null && choice !== OTHER ? senses[Number(choice)] : undefined;
  const close = () => setClarifying(null); // node stays "unclear"; its badge reopens this dialog

  const confirm = () => {
    if (choice === OTHER) {
      if (!otherDef.trim()) return;
      chooseSense(clarifying.graphId, node.id, { name: otherName.trim() || node.name, definition: otherDef });
    } else if (picked) {
      chooseSense(clarifying.graphId, node.id, picked);
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
    <Modal label={t("sense.dialog")} title={t("sense.title", { name: node.name })} onClose={close}>
      <p className="muted small">{t("sense.intro")}</p>
      <div className="senses" role="radiogroup">
        {senses.map((s, i) => (
          <label key={i} className={`sense${choice === String(i) ? " sense--on" : ""}`}>
            <input type="radio" name="sense" checked={choice === String(i)} onChange={() => setChoice(String(i))} />
            <span>
              <span className="sense__head">
                <b>{s.name}</b> <span className="role">{s.domain}</span>
              </span>
              <span className="muted small"><MathText text={s.definition} /></span>
            </span>
          </label>
        ))}
        <label className={`sense${choice === OTHER ? " sense--on" : ""}`}>
          <input type="radio" name="sense" checked={choice === OTHER} onChange={() => setChoice(OTHER)} />
          <span className="sense__other">
            <b>{t("sense.other")}</b>
            {choice === OTHER && (
              <>
                <input
                  value={otherName}
                  onChange={(e) => setOtherName(e.target.value)}
                  placeholder={t("sense.otherName", { name: node.name })}
                  aria-label={t("sense.otherNameAria")}
                />
                <textarea
                  autoFocus
                  rows={3}
                  value={otherDef}
                  onChange={(e) => setOtherDef(e.target.value)}
                  placeholder={t("sense.otherDef")}
                  aria-label={t("sense.otherDefAria")}
                />
              </>
            )}
          </span>
        </label>
      </div>
      <div className="form__actions">
        <button className="link small" onClick={remove}>{t("sense.remove")}</button>
        <span className="spacer" />
        <button onClick={moreOptions} title={t("sense.askAgainTitle", { n: optionCount })}>{t("sense.askAgain")}</button>
        <button onClick={close}>{t("sense.later")}</button>
        <button
          className="primary"
          onClick={confirm}
          disabled={choice === OTHER ? !otherDef.trim() : !picked}
        >
          {t("sense.use")}
        </button>
      </div>
    </Modal>
  );
}
