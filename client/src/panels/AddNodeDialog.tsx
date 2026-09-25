import type { NameCandidate } from "@nodestorm/shared";
import { useState } from "react";
import { useT } from "../i18n";
import { addCandidate, addConcept, cancelTask, suggestNames } from "../lib/actions";
import { OWN_SOURCE } from "../lib/graphOps";
import { useGraphStore } from "../store/graphStore";
import { MathText } from "./MathText";
import { Modal } from "./Modal";

export function AddNodeDialog({ onClose }: { onClose: () => void }) {
  const t = useT();
  const [mode, setMode] = useState<"name" | "describe">("name");
  const [name, setName] = useState("");
  const [definition, setDefinition] = useState("");
  const [description, setDescription] = useState("");
  const [candidates, setCandidates] = useState<NameCandidate[] | null>(null);
  const searching = useGraphStore((s) => Boolean(s.busy.name));

  const submitName = (e: React.FormEvent) => {
    e.preventDefault();
    if (!name.trim()) return;
    addConcept({ name, definition, source: definition.trim() ? OWN_SOURCE : undefined });
    onClose();
  };

  const search = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!description.trim()) return;
    setCandidates(null);
    setCandidates((await suggestNames(description)) ?? []);
  };

  return (
    <Modal label={t("add.title")} title={t("add.title")} onClose={onClose} dirty={Boolean(definition.trim() || description.trim())}>
      <div className="tabs">
        <button className={mode === "name" ? "tab tab--on" : "tab"} aria-pressed={mode === "name"} onClick={() => setMode("name")}>
          {t("add.byName")}
        </button>
        <button className={mode === "describe" ? "tab tab--on" : "tab"} aria-pressed={mode === "describe"} onClick={() => setMode("describe")}>
          {t("add.describe")}
        </button>
      </div>

      {mode === "name" ? (
        <form onSubmit={submitName} className="form">
          <label>
            {t("add.name")}
            <input
              autoFocus
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder={t("add.namePlaceholder")}
              aria-label={t("add.nameAria")}
            />
          </label>
          <label>
            {t("add.definition")} <span className="muted">{t("add.optional")}</span>
            <textarea value={definition} onChange={(e) => setDefinition(e.target.value)} rows={3} />
          </label>
          <div className="form__actions">
            <button type="button" onClick={onClose}>{t("common.cancel")}</button>
            <button type="submit" className="primary" disabled={!name.trim()}>{t("common.add")}</button>
          </div>
        </form>
      ) : (
        <form onSubmit={search} className="form">
          <label>
            {t("add.describeLabel")}
            <textarea
              autoFocus
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              rows={4}
              placeholder={t("add.describePlaceholder")}
              aria-label={t("add.describeAria")}
            />
          </label>
          <div className="form__actions">
            <button type="button" onClick={onClose}>{t("common.cancel")}</button>
            {searching && (
              <button type="button" className="link" onClick={() => cancelTask("name")}>
                {t("add.stop")}
              </button>
            )}
            <button type="submit" className="primary" disabled={!description.trim() || searching}>
              {searching ? t("add.searching") : t("add.findName")}
            </button>
          </div>
          {candidates && (
            <ul className="candidates">
              {candidates.length === 0 && <li className="muted">{t("add.none")}</li>}
              {candidates.map((c) => (
                <li key={c.name}>
                  <div>
                    <strong>{c.name}</strong>
                    {c.aliases.length > 0 && <span className="muted"> · {c.aliases.join(", ")}</span>}
                    <div className="muted small"><MathText text={c.definition} /></div>
                  </div>
                  <button type="button" onClick={() => { addCandidate(c); onClose(); }}>{t("add.use")}</button>
                </li>
              ))}
            </ul>
          )}
        </form>
      )}
    </Modal>
  );
}
