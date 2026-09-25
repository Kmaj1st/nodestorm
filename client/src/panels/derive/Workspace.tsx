import type { RefereeSeverity, RefereeVerdict, StepVerdict } from "@nodestorm/shared";
import {
  BookOpen,
  ChevronRight,
  CircleAlert,
  CircleCheck,
  CircleHelp,
  CircleX,
  Copy,
  Lightbulb,
  ListChecks,
  Network,
  Pencil,
  Plus,
  ShieldCheck,
  Stamp,
  Trash2,
  type LucideIcon,
} from "lucide-react";
import { lazy, Suspense, useEffect, useMemo, useRef, useState } from "react";
import { useT, type MessageKey } from "../../i18n";
import {
  addStep,
  editStep,
  isSolved,
  nextHintNumber,
  refereeOutdated,
  removeStep,
  type Citation,
  type Derivation,
  type DerivStep,
} from "../../lib/derivation";
import { toMarkdown } from "../../lib/derivation";
import { cancelTask } from "../../lib/actions";
import { DERIVE_KEYS, useDerive } from "../../store/deriveStore";
import { useGraphStore } from "../../store/graphStore";
import { Icon } from "../../ui/Icon";
import { MathText } from "../MathText";

const AddToGraphDialog = lazy(() => import("./AddToGraphDialog").then((m) => ({ default: m.AddToGraphDialog })));

const VERDICT: Record<StepVerdict, { label: MessageKey; icon: LucideIcon }> = {
  ok: { label: "dt.verdict.ok", icon: CircleCheck },
  gap: { label: "dt.verdict.gap", icon: CircleAlert },
  error: { label: "dt.verdict.error", icon: CircleX },
  unclear: { label: "dt.verdict.unclear", icon: CircleHelp },
};

const REFEREE_VERDICT: Record<RefereeVerdict, { label: MessageKey; tone: string }> = {
  accept: { label: "dt.referee.verdict.accept", tone: "ok" },
  "minor revisions": { label: "dt.referee.verdict.minor", tone: "gap" },
  "major revisions": { label: "dt.referee.verdict.major", tone: "gap" },
  reject: { label: "dt.referee.verdict.reject", tone: "error" },
};
const SEVERITY_LABEL: Record<RefereeSeverity, MessageKey> = {
  fatal: "dt.referee.severity.fatal",
  major: "dt.referee.severity.major",
  minor: "dt.referee.severity.minor",
  pedantic: "dt.referee.severity.pedantic",
};

/** The current derivation: the problem, the learner's steps with the tutor's checks, hints, and the way out to the graph. */
export function Workspace() {
  const t = useT();
  const d = useDerive((s) => s.sessions.find((x) => x.id === s.currentId))!;
  const update = useDerive((s) => s.update);
  const hinting = useGraphStore((s) => Boolean(s.busy[DERIVE_KEYS.hint]));
  const checking = useGraphStore((s) => Boolean(s.busy[DERIVE_KEYS.check]));
  const refereeing = useGraphStore((s) => Boolean(s.busy[DERIVE_KEYS.referee]));
  const viewing = useGraphStore((s) => Boolean(s.view));
  const [draft, setDraft] = useState("");
  const [adding, setAdding] = useState(false);
  const [copied, setCopied] = useState(false);
  const copiedTimer = useRef<ReturnType<typeof setTimeout>>(undefined);
  // The step just deleted, undoable until anything else changes the derivation (or a few seconds pass).
  const [deleted, setDeleted] = useState<{ before: Derivation; after: Derivation; n: number } | null>(null);
  useEffect(() => {
    if (!deleted) return;
    const timer = setTimeout(() => setDeleted(null), 8000);
    return () => clearTimeout(timer);
  }, [deleted]);
  useEffect(() => () => clearTimeout(copiedTimer.current), []);
  const solved = isSolved(d);
  const src = d.problem.source;

  const add = (check: boolean) => {
    // One check at a time: a second would cancel the first, leaving that step without a verdict.
    if (!draft.trim() || (check && checking)) return;
    const r = addStep(d, draft);
    update(r.derivation);
    setDraft("");
    if (check) void useDerive.getState().check(r.id);
  };

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(toMarkdown(d));
      setCopied(true);
      clearTimeout(copiedTimer.current);
      copiedTimer.current = setTimeout(() => setCopied(false), 2000);
    } catch {
      useGraphStore.getState().setToast(t("dt.copyFailed"), "error");
    }
  };

  return (
    <div className="derive-work">
      <section className="derive-problem-card" aria-labelledby="dt-problem">
        <h3 id="dt-problem" className="derive-section__title">
          {d.problem.label ? t("dt.problem.labelled", { label: d.problem.label }) : t("dt.problem.title")}
        </h3>
        <div className="derive-problem-card__text" data-testid="dt-problem">
          <MathText text={d.problem.statement} />
        </div>
        {src && (
          <button className="link link--icon small" onClick={() => void useDerive.getState().openReader(src.docId, src.page ?? 1)}>
            <Icon icon={BookOpen} size={12} />
            {src.page ? t("dt.sourcePage", { title: src.title, page: src.page }) : src.title}
          </button>
        )}
      </section>

      {solved && (
        <p className="derive-solved" role="status">
          <Icon icon={CircleCheck} size={16} />
          {t("dt.solved")}
        </p>
      )}

      <section aria-labelledby="dt-steps">
        <div className="derive-section__head">
          <h3 id="dt-steps" className="derive-section__title">{t("dt.steps.title")}</h3>
          {/* Reviews the steps below, so it sits on their heading; the rows under them are full. */}
          {refereeing && (
            <button className="small-btn derive-section__cancel" onClick={() => cancelTask(DERIVE_KEYS.referee)} data-testid="dt-referee-cancel">
              {t("common.cancel")}
            </button>
          )}
          <button
            className="small-btn"
            onClick={() => void useDerive.getState().referee()}
            disabled={refereeing || viewing || !d.steps.length}
            title={t("dt.referee.runTitle")}
            data-testid="dt-referee"
          >
            {refereeing ? <span className="spinner spinner--xs" aria-hidden="true" /> : <Icon icon={Stamp} size={14} />}
            {t("dt.referee.run")}
          </button>
        </div>
        {!d.steps.length && <p className="muted small">{t("dt.steps.empty")}</p>}
        <ol className="derive-steps">
          {d.steps.map((s, i) => (
            <Step
              key={s.id}
              step={s}
              n={i + 1}
              onDelete={() => {
                const after = removeStep(d, s.id);
                update(after);
                setDeleted({ before: d, after, n: i + 1 });
              }}
            />
          ))}
        </ol>
        {deleted && deleted.after === d && (
          <p className="derive-undo small" role="status">
            {t("dt.steps.deleted", { n: deleted.n })}
            <button
              className="link"
              onClick={() => {
                update(deleted.before);
                setDeleted(null);
              }}
              data-testid="dt-undo-delete"
            >
              {t("common.undo")}
            </button>
          </p>
        )}
        <div className="derive-new-step">
          <textarea
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && (e.ctrlKey || e.metaKey)) {
                e.preventDefault();
                add(true);
              }
            }}
            rows={3}
            maxLength={4000}
            placeholder={t("dt.steps.placeholder")}
            aria-label={t("dt.steps.label", { n: d.steps.length + 1 })}
          />
          <div className="derive-row">
            <button onClick={() => add(false)} disabled={!draft.trim()}>
              <Icon icon={Plus} size={14} />
              {t("dt.steps.add")}
            </button>
            <button className="primary" onClick={() => add(true)} disabled={!draft.trim() || viewing || checking} title={t("dt.steps.addCheckTitle")}>
              <Icon icon={ListChecks} size={14} />
              {t("dt.steps.addCheck")}
            </button>
            <span className="derive-row__spacer" />
            {hinting && (
              <button onClick={() => cancelTask(DERIVE_KEYS.hint)} data-testid="dt-hint-cancel">
                {t("common.cancel")}
              </button>
            )}
            <button onClick={() => void useDerive.getState().hint()} disabled={hinting || viewing}>
              {hinting ? <span className="spinner spinner--xs" aria-hidden="true" /> : <Icon icon={Lightbulb} size={14} />}
              {t(nextHintNumber(d) > 1 ? "dt.hint.more" : "dt.hint.get")}
            </button>
          </div>
        </div>
      </section>

      {d.hints.length > 0 && (
        <section aria-labelledby="dt-hints">
          <h3 id="dt-hints" className="derive-section__title">{t("dt.hint.title")}</h3>
          <ul className="derive-hints">
            {d.hints.map((h) => (
              <li key={h.id} className="derive-hint">
                <Icon icon={Lightbulb} size={14} className="derive-hint__icon" />
                <div>
                  <MathText text={h.text} />
                  <Cites cites={h.cites} />
                </div>
              </li>
            ))}
          </ul>
        </section>
      )}

      {d.referee && <RefereeCard d={d} />}

      <References />

      <div className="form__actions derive-work__actions">
        <button onClick={() => void copy()} disabled={!d.steps.length}>
          <Icon icon={copied ? CircleCheck : Copy} size={14} />
          {t(copied ? "dt.copied" : "dt.copy")}
        </button>
        <button className="primary" onClick={() => setAdding(true)} disabled={viewing}>
          <Icon icon={Network} size={14} />
          {t("dt.addToGraph")}
        </button>
      </div>
      {adding && (
        <Suspense fallback={null}>
          <AddToGraphDialog onClose={() => setAdding(false)} />
        </Suspense>
      )}
    </div>
  );
}

function Step({ step, n, onDelete }: { step: DerivStep; n: number; onDelete: () => void }) {
  const t = useT();
  const update = useDerive((s) => s.update);
  const d = useDerive((s) => s.sessions.find((x) => x.id === s.currentId))!;
  const checking = useGraphStore((s) => Boolean(s.busy[DERIVE_KEYS.check]));
  const mine = useDerive((s) => s.checkingId === step.id) && checking;
  const viewing = useGraphStore((s) => Boolean(s.view));
  const [editing, setEditing] = useState<string | null>(null);
  const c = step.check;
  const v = c && VERDICT[c.verdict];

  return (
    <li className={`derive-step${c ? ` derive-step--${c.verdict}` : ""}`} data-testid={`step-${n}`}>
      <span className="derive-step__n" aria-hidden="true">{n}</span>
      <div className="derive-step__body">
        {editing !== null ? (
          <form
            onSubmit={(e) => {
              e.preventDefault();
              if (editing.trim()) update(editStep(d, step.id, editing));
              setEditing(null);
            }}
          >
            <textarea
              value={editing}
              onChange={(e) => setEditing(e.target.value)}
              onKeyDown={(e) => {
                // As in the new-step box: Ctrl/Cmd+Enter saves; Escape cancels (without closing the dialog).
                if (e.key === "Enter" && (e.ctrlKey || e.metaKey)) {
                  e.preventDefault();
                  e.currentTarget.form?.requestSubmit();
                } else if (e.key === "Escape") {
                  e.preventDefault();
                  e.stopPropagation();
                  setEditing(null);
                }
              }}
              rows={3}
              maxLength={4000}
              aria-label={t("dt.steps.edit", { n })}
              autoFocus
            />
            <div className="derive-row">
              <button type="button" className="small-btn" onClick={() => setEditing(null)}>{t("common.cancel")}</button>
              <button type="submit" className="small-btn primary" disabled={!editing.trim()}>{t("common.save")}</button>
            </div>
          </form>
        ) : (
          <div className="derive-step__text">
            <MathText text={step.text} />
          </div>
        )}
        {c && v && (
          <div className="derive-check" data-testid={`verdict-${n}`}>
            <span className={`derive-verdict derive-verdict--${c.verdict}`}>
              <Icon icon={v.icon} size={14} />
              {t(v.label)}
            </span>
            {c.comment && (
              <span className="derive-check__comment">
                <MathText text={c.comment} inline />
              </span>
            )}
            {c.missing.length > 0 && (
              <p className="small derive-check__missing">
                {t("dt.missing")} {c.missing.join(", ")}
              </p>
            )}
            <Cites cites={c.cites} />
          </div>
        )}
      </div>
      {editing === null && (
        <div className="derive-step__actions">
          <button className="small-btn" onClick={() => void useDerive.getState().check(step.id)} disabled={checking || viewing}>
            {mine ? <span className="spinner spinner--xs" aria-hidden="true" /> : <Icon icon={ListChecks} size={14} />}
            {t(c ? "dt.steps.recheck" : "dt.steps.check")}
            <span className="sr-only"> {t("dt.steps.nth", { n })}</span>
          </button>
          <button className="icon-btn" onClick={() => setEditing(step.text)} aria-label={t("dt.steps.edit", { n })} title={t("dt.steps.editTitle")}>
            <Icon icon={Pencil} size={14} />
          </button>
          <button className="icon-btn" onClick={onDelete} aria-label={t("dt.steps.delete", { n })} title={t("common.delete")}>
            <Icon icon={Trash2} size={14} />
          </button>
        </div>
      )}
    </li>
  );
}

/** The latest "Reviewer 2" report: verdict, the funny summary, the points (by step) and the grudging praise. */
function RefereeCard({ d }: { d: Derivation }) {
  const t = useT();
  const [open, setOpen] = useState(true);
  const r = d.referee!;
  const v = REFEREE_VERDICT[r.verdict];
  return (
    <section aria-labelledby="dt-referee">
      <details className="derive-referee" open={open} onToggle={(e) => setOpen(e.currentTarget.open)} data-testid="dt-referee-report">
        <summary>
          <Icon icon={ChevronRight} size={14} className="derive-referee__chevron" />
          <h3 id="dt-referee" className="derive-section__title">{t("dt.referee.title")}</h3>
          <span className={`derive-verdict derive-verdict--${v.tone}`}>{t(v.label)}</span>
        </summary>
        {refereeOutdated(d) && <p className="small derive-referee__outdated">{t("dt.referee.outdated")}</p>}
        <p className="derive-referee__summary"><MathText text={r.summary} /></p>
        {r.points.length > 0 ? (
          <ol className="derive-referee__points">
            {r.points.map((p, i) => (
              <li key={i} className={`derive-referee__point derive-referee__point--${p.severity}`}>
                <span className="derive-referee__meta">
                  <span className={`derive-severity derive-severity--${p.severity}`}>{t(SEVERITY_LABEL[p.severity])}</span>
                  <span className="muted">{p.step ? t("dt.referee.step", { n: p.step }) : t("dt.referee.general")}</span>
                </span>
                <MathText text={p.comment} />
              </li>
            ))}
          </ol>
        ) : (
          <p className="muted small">{t("dt.referee.none")}</p>
        )}
        {r.grudgingPraise && (
          <p className="derive-referee__praise">
            <span className="derive-referee__label">{t("dt.referee.praise")}</span>
            <MathText text={r.grudgingPraise} />
          </p>
        )}
        <p className="muted small derive-referee__note">
          <Icon icon={ShieldCheck} size={14} />
          {t("dt.referee.note")}
        </p>
      </details>
    </section>
  );
}

/** Citations as links that open the cited page. */
function Cites({ cites }: { cites: Citation[] }) {
  const t = useT();
  if (!cites.length) return null;
  return (
    <p className="derive-cites small">
      {cites.map((c) => (
        <button key={c.n} className="link" onClick={() => void useDerive.getState().openReader(c.docId, c.page)}>
          [{c.n}] {t("dt.sourcePage", { title: c.title, page: c.page })}
        </button>
      ))}
    </p>
  );
}

/** Which reference documents the tutor may cite. */
function References() {
  const t = useT();
  const all = useDerive((s) => s.docs);
  const docs = useMemo(() => all.filter((d) => d.kind === "reference"), [all]);
  const chosen = useDerive((s) => s.refDocs);
  const set = useDerive((s) => s.setRefDocs);
  const on = (id: string) => !chosen || chosen.includes(id);
  return (
    <details className="derive-refs">
      <summary>{docs.length ? t("dt.refs.summary", { n: docs.filter((d) => on(d.id)).length }) : t("dt.refs.none")}</summary>
      {docs.map((d) => (
        <label key={d.id} className="check">
          <input
            type="checkbox"
            checked={on(d.id)}
            onChange={() => {
              const now = docs.filter((x) => (x.id === d.id ? !on(x.id) : on(x.id))).map((x) => x.id);
              set(now.length === docs.length ? null : now);
            }}
          />
          {d.title}
        </label>
      ))}
      {!docs.length && <p className="muted small">{t("dt.refs.hint")}</p>}
    </details>
  );
}
