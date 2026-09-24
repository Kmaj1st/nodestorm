import type { NameCandidate } from "@nodestorm/shared";
import { useState } from "react";
import { addCandidate, addConcept, cancelTask, suggestNames } from "../lib/actions";
import { useGraphStore } from "../store/graphStore";

export function AddNodeDialog({ onClose }: { onClose: () => void }) {
  const [mode, setMode] = useState<"name" | "describe">("name");
  const [name, setName] = useState("");
  const [definition, setDefinition] = useState("");
  const [description, setDescription] = useState("");
  const [candidates, setCandidates] = useState<NameCandidate[] | null>(null);
  const searching = useGraphStore((s) => Boolean(s.busy.name));

  const submitName = (e: React.FormEvent) => {
    e.preventDefault();
    if (!name.trim()) return;
    addConcept({ name, definition });
    onClose();
  };

  const search = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!description.trim()) return;
    setCandidates(null);
    setCandidates((await suggestNames(description)) ?? []);
  };

  return (
    <div className="modal" onClick={onClose}>
      <div className="modal__body" onClick={(e) => e.stopPropagation()} role="dialog" aria-label="Add concept">
        <div className="tabs">
          <button className={mode === "name" ? "tab tab--on" : "tab"} onClick={() => setMode("name")}>I know the name</button>
          <button className={mode === "describe" ? "tab tab--on" : "tab"} onClick={() => setMode("describe")}>Describe it</button>
        </div>

        {mode === "name" ? (
          <form onSubmit={submitName} className="form">
            <label>
              Name
              <input autoFocus value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. First Isomorphism Theorem" aria-label="Concept name" />
            </label>
            <label>
              Definition <span className="muted">(optional)</span>
              <textarea value={definition} onChange={(e) => setDefinition(e.target.value)} rows={3} />
            </label>
            <div className="form__actions">
              <button type="button" onClick={onClose}>Cancel</button>
              <button type="submit" className="primary" disabled={!name.trim()}>Add</button>
            </div>
          </form>
        ) : (
          <form onSubmit={search} className="form">
            <label>
              Describe the thing you can't name
              <textarea
                autoFocus
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                rows={4}
                placeholder="e.g. a map between two groups that keeps the multiplication structure"
                aria-label="Concept description"
              />
            </label>
            <div className="form__actions">
              <button type="button" onClick={onClose}>Cancel</button>
              {searching && (
                <button type="button" className="link" onClick={() => cancelTask("name")}>
                  Stop
                </button>
              )}
              <button type="submit" className="primary" disabled={!description.trim() || searching}>
                {searching ? "Searching…" : "Find a name"}
              </button>
            </div>
            {candidates && (
              <ul className="candidates">
                {candidates.length === 0 && <li className="muted">No suggestions.</li>}
                {candidates.map((c) => (
                  <li key={c.name}>
                    <div>
                      <strong>{c.name}</strong>
                      {c.aliases.length > 0 && <span className="muted"> · {c.aliases.join(", ")}</span>}
                      <div className="muted small">{c.definition}</div>
                    </div>
                    <button type="button" onClick={() => { addCandidate(c); onClose(); }}>Use</button>
                  </li>
                ))}
              </ul>
            )}
          </form>
        )}
      </div>
    </div>
  );
}
