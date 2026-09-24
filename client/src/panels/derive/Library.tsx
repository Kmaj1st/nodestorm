import { BookOpen, FileText, ListChecks, Play, Trash2, Upload } from "lucide-react";
import { useRef, useState } from "react";
import { useT } from "../../i18n";
import { derivationTitle, isSolved } from "../../lib/derivation";
import type { DocMeta } from "../../lib/docDb";
import { problemsKey, useDerive, type DocWithProblems } from "../../store/deriveStore";
import { useGraphStore } from "../../store/graphStore";
import { Icon } from "../../ui/Icon";
import { MathText } from "../MathText";

/** Documents (import, read, find problems), the problems found on sheets, your own problem, and past sessions. */
export function Library() {
  const t = useT();
  const docs = useDerive((s) => s.docs);
  const sessions = useDerive((s) => s.sessions);
  const available = useDerive((s) => s.available);
  const importing = useDerive((s) => s.importing);
  const start = useDerive((s) => s.start);
  const [own, setOwn] = useState("");

  const refs = docs.filter((d) => d.kind === "reference");
  const sheets = docs.filter((d) => d.kind === "problems");

  return (
    <div className="derive-library">
      {!available && <p className="warn-box small">{t("dt.noStorage")}</p>}

      <section className="derive-section" aria-labelledby="dt-own">
        <h3 id="dt-own" className="derive-section__title">{t("dt.own.title")}</h3>
        <form
          className="derive-own"
          onSubmit={(e) => {
            e.preventDefault();
            if (own.trim()) void start({ statement: own }).then(() => setOwn(""));
          }}
        >
          <textarea
            value={own}
            onChange={(e) => setOwn(e.target.value)}
            rows={3}
            placeholder={t("dt.own.placeholder")}
            aria-label={t("dt.own.label")}
          />
          <div className="form__actions">
            <button className="primary" type="submit" disabled={!own.trim()}>
              <Icon icon={Play} size={14} />
              {t("dt.start")}
            </button>
          </div>
        </form>
      </section>

      <section className="derive-section" aria-labelledby="dt-docs">
        <h3 id="dt-docs" className="derive-section__title">{t("dt.docs.title")}</h3>
        <p className="muted small">{t("dt.docs.hint")}</p>
        <div className="derive-import">
          <ImportButton kind="problems" label={t("dt.import.problems")} />
          <ImportButton kind="reference" label={t("dt.import.reference")} />
        </div>
        {importing && (
          <p className="derive-progress small" role="status">
            <span className="spinner spinner--xs" aria-hidden="true" />
            {importing.phase === "vision"
              ? t("dt.import.vision", { title: importing.title, done: importing.done, total: importing.total })
              : t("dt.import.text", { title: importing.title, done: importing.done, total: importing.total || "…" })}
          </p>
        )}

        {sheets.length > 0 && <h4 className="derive-subtitle">{t("dt.docs.sheets")}</h4>}
        {sheets.map((d) => <SheetEntry key={d.id} doc={d} />)}
        {refs.length > 0 && <h4 className="derive-subtitle">{t("dt.docs.references")}</h4>}
        <ul className="derive-docs">
          {refs.map((d) => (
            <li key={d.id}>
              <DocRow doc={d} />
            </li>
          ))}
        </ul>
        {!docs.length && !importing && <p className="muted small">{t("dt.docs.empty")}</p>}
      </section>

      {sessions.length > 0 && (
        <section className="derive-section" aria-labelledby="dt-sessions">
          <h3 id="dt-sessions" className="derive-section__title">{t("dt.sessions.title")}</h3>
          <ul className="derive-sessions">
            {sessions.map((s) => (
              <li key={s.id} className="derive-session">
                <button className="link derive-session__open" onClick={() => useDerive.getState().select(s.id)}>
                  <MathText text={derivationTitle(s)} inline />
                </button>
                <span className="muted small">
                  {isSolved(s) ? t("dt.sessions.solved") : t("dt.sessions.steps", { n: s.steps.length })}
                </span>
                <button
                  className="icon-btn"
                  onClick={() => void useDerive.getState().deleteSession(s.id)}
                  aria-label={t("dt.sessions.delete", { title: derivationTitle(s, 40) })}
                  title={t("common.delete")}
                >
                  <Icon icon={Trash2} size={14} />
                </button>
              </li>
            ))}
          </ul>
        </section>
      )}
    </div>
  );
}

function ImportButton({ kind, label }: { kind: DocMeta["kind"]; label: string }) {
  const ref = useRef<HTMLInputElement>(null);
  const importing = useDerive((s) => Boolean(s.importing));
  return (
    <>
      <button onClick={() => ref.current?.click()} disabled={importing}>
        <Icon icon={Upload} size={14} />
        {label}
      </button>
      <input
        ref={ref}
        type="file"
        accept="application/pdf,.pdf,text/plain,.txt,.md,text/markdown"
        hidden
        data-testid={`import-${kind}`}
        onChange={(e) => {
          const file = e.target.files?.[0];
          e.target.value = "";
          if (file) void useDerive.getState().importFile(file, kind);
        }}
      />
    </>
  );
}

function DocRow({ doc }: { doc: DocWithProblems }) {
  const t = useT();
  return (
    <div className="derive-doc">
      <Icon icon={doc.kind === "problems" ? ListChecks : FileText} size={14} className="derive-doc__icon" />
      <button className="link derive-doc__title" onClick={() => void useDerive.getState().openReader(doc.id, 1)} title={t("dt.docs.open")}>
        {doc.title}
      </button>
      <span className="muted small">{t("dt.docs.pages", { n: doc.pages })}</span>
      <button
        className="icon-btn"
        onClick={() => void useDerive.getState().deleteDoc(doc.id)}
        aria-label={t("dt.docs.delete", { title: doc.title })}
        title={t("common.delete")}
      >
        <Icon icon={Trash2} size={14} />
      </button>
    </div>
  );
}

/** A problem sheet: its problems (once found), each ready to start. */
function SheetEntry({ doc }: { doc: DocWithProblems }) {
  const t = useT();
  const finding = useGraphStore((s) => Boolean(s.busy[problemsKey(doc.id)]));
  const start = useDerive((s) => s.start);
  return (
    <div className="derive-sheet">
      <DocRow doc={doc} />
      {doc.problems === undefined || finding ? (
        <button className="small-btn" onClick={() => void useDerive.getState().findProblems(doc.id)} disabled={finding}>
          {finding ? <span className="spinner spinner--xs" aria-hidden="true" /> : <Icon icon={ListChecks} size={14} />}
          {t(finding ? "dt.problems.finding" : "dt.problems.find")}
        </button>
      ) : (
        <ol className="derive-problems" aria-label={t("dt.problems.of", { title: doc.title })}>
          {doc.problems.map((p, i) => (
            <li key={i} className="derive-problem">
              <span className="derive-problem__label">{p.label || i + 1}</span>
              <div className="derive-problem__text">
                <MathText text={p.statement} />
                {p.page != null && (
                  <button className="link link--icon small" onClick={() => void useDerive.getState().openReader(doc.id, p.page!)}>
                    <Icon icon={BookOpen} size={12} />
                    {t("dt.page", { page: p.page })}
                  </button>
                )}
              </div>
              <button
                className="small-btn"
                onClick={() =>
                  void start({
                    statement: p.statement,
                    label: p.label || undefined,
                    source: { docId: doc.id, title: doc.title, ...(p.page != null ? { page: p.page } : {}) },
                  })
                }
                aria-label={t("dt.problems.start", { label: p.label || String(i + 1) })}
              >
                <Icon icon={Play} size={14} />
                {t("dt.start")}
              </button>
            </li>
          ))}
          {!doc.problems.length && <li className="muted small">{t("dt.problems.none")}</li>}
        </ol>
      )}
    </div>
  );
}
