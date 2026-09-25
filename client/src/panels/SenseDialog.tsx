import type { ConceptNode } from "@nodestorm/shared";
import { useState } from "react";
import { useT } from "../i18n";
import { aiSource, checkWithAi, chooseSense } from "../lib/actions";
import { removeNode } from "../lib/graphOps";
import { useGraphStore } from "../store/graphStore";
import { useSettings } from "../store/settingsStore";
import { MathText } from "./MathText";
import { Modal } from "./Modal";

const OTHER = "__other__";

/**
 * "What do you mean by X?" — the meanings of a concept's name to choose from: the AI's, or what the encyclopedias and
 * wikis found for a new concept ("Definitions for X", maybe none), with "Ask the AI" as the way to use the AI.
 */
export function SenseDialog() {
  const clarifying = useGraphStore((s) => s.clarifying);
  const node = useGraphStore((s) =>
    s.clarifying ? s.graphs[s.clarifying.graphId]?.nodes.find((n) => n.id === s.clarifying!.nodeId) : undefined,
  );
  if (!clarifying || !node) return null;
  // Keyed so the picked option and "something else" text never carry over to another node or a new set of meanings.
  const key = `${clarifying.graphId}:${node.id}:${(node.senses ?? []).map((x) => x.name).join("|")}`;
  return <SenseChoice key={key} graphId={clarifying.graphId} node={node} searched={clarifying.searched} />;
}

function SenseChoice({ graphId, node, searched }: { graphId: string; node: ConceptNode; searched?: { asked: string[]; failed: string[] } }) {
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
  // Meanings from look-ups (or none found) rather than the AI's.
  const lookedUp = !senses.length || senses.every((s) => s.source?.site && s.source.site !== "AI");
  const found = new Set(senses.map((s) => s.source?.site).filter(Boolean));
  const quiet = searched?.asked.filter((x) => !found.has(x) && !searched.failed.includes(x)) ?? [];
  const moreOptions = () => {
    // Ask the AI for meanings (not the encyclopedias again, which would give the same list).
    setChoice(null);
    if (checkWithAi(node.id, clarifying.graphId, { askAi: true })) setClarifying(null);
  };
  const remove = () => {
    mutate((g) => removeNode(g, node.id), clarifying.graphId);
    setClarifying(null);
  };

  return (
    <Modal
      label={t(lookedUp ? "sense.lookupDialog" : "sense.dialog")}
      title={t(lookedUp ? "sense.lookupTitle" : "sense.title", { name: node.name })}
      onClose={close}
    >
      <p className="muted small">{t(lookedUp ? "sense.lookupIntro" : "sense.intro")}</p>
      {lookedUp && (
        <p className="small sense__searched" data-testid="sense-searched">
          {!senses.length
            ? searched?.asked.length
              ? t("sense.nothing", { sites: searched.asked.join(", ") })
              : t(searched ? "sense.nothingOff" : "sense.none")
            : quiet.length > 0 && t("sense.notIn", { sites: quiet.join(", ") })}
          {searched && searched.failed.length > 0 && <> {t("sense.failed", { sites: searched.failed.join(", ") })}</>}
        </p>
      )}
      <div className="senses" role="radiogroup">
        {senses.map((s, i) => (
          <label key={i} className={`sense${choice === String(i) ? " sense--on" : ""}`}>
            <input type="radio" name="sense" checked={choice === String(i)} onChange={() => setChoice(String(i))} />
            <span>
              <span className="sense__head">
                <b>{s.name}</b> {s.domain && s.domain !== s.source?.site && <span className="role">{s.domain}</span>}
                {s.source?.site && <span className="sense__source small" title={t("sense.from", { site: s.source.site })}>{s.source.site}</span>}
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
        {lookedUp ? (
          <button onClick={moreOptions} title={t("sense.askAiTitle", { model: aiSource().title })} data-testid="sense-ask-ai">
            {t("sense.askAi")}
          </button>
        ) : (
          <button onClick={moreOptions} title={t("sense.askAgainTitle", { n: optionCount })}>{t("sense.askAgain")}</button>
        )}
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
