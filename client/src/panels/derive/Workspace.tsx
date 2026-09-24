import type { StepVerdict } from "@nodestorm/shared";
import {
  BookOpen,
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
  Trash2,
  type LucideIcon,
} from "lucide-react";
import { lazy, Suspense, useMemo, useState } from "react";
import { useT, type MessageKey } from "../../i18n";
import { addStep, editStep, isSolved, nextHintNumber, removeStep, type Citation, type DerivStep } from "../../lib/derivation";
import { toMarkdown } from "../../lib/derivation";
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

/** The current derivation: the problem, the learner's steps with the tutor's checks, hints, and the way out to the graph. */
export function Workspace() {
  const t = useT();
  const d = useDerive((s) => s.sessions.find((x) => x.id === s.currentId))!;
  const update = useDerive((s) => s.update);
  const hinting = useGraphStore((s) => Boolean(s.busy[DERIVE_KEYS.hint]));
  const viewing = useGraphStore((s) => Boolean(s.view));
  const [draft, setDraft] = useState("");
  const [adding, setAdding] = useState(false);
  const [copied, setCopied] = useState(false);
  const solved = isSolved(d);
  const src = d.problem.source;

  const add = (check: boolean) => {
    if (!draft.trim()) return;
    const r = addStep(d, draft);
    update(r.derivation);
    setDraft("");
    if (check) void useDerive.getState().check(r.id);
  };

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(toMarkdown(d));
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
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
        <h3 id="dt-steps" className="derive-section__title">{t("dt.steps.title")}</h3>
        {!d.steps.length && <p className="muted small">{t("dt.steps.empty")}</p>}
        <ol className="derive-steps">
          {d.steps.map((s, i) => (
            <Step key={s.id} step={s} n={i + 1} />
          ))}
        </ol>
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
            placeholder={t("dt.steps.placeholder")}
            aria-label={t("dt.steps.label", { n: d.steps.length + 1 })}
          />
          <div className="derive-row">
            <button onClick={() => add(false)} disabled={!draft.trim()}>
              <Icon icon={Plus} size={14} />
              {t("dt.steps.add")}
            </button>
            <button className="primary" onClick={() => add(true)} disabled={!draft.trim() || viewing} title={t("dt.steps.addCheckTitle")}>
              <Icon icon={ListChecks} size={14} />
              {t("dt.steps.addCheck")}
            </button>
            <span className="derive-row__spacer" />
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

function Step({ step, n }: { step: DerivStep; n: number }) {
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
            <textarea value={editing} onChange={(e) => setEditing(e.target.value)} rows={3} aria-label={t("dt.steps.edit", { n })} autoFocus />
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
            <span className="derive-sr"> {t("dt.steps.nth", { n })}</span>
          </button>
          <button className="icon-btn" onClick={() => setEditing(step.text)} aria-label={t("dt.steps.edit", { n })} title={t("dt.steps.editTitle")}>
            <Icon icon={Pencil} size={14} />
          </button>
          <button className="icon-btn" onClick={() => update(removeStep(d, step.id))} aria-label={t("dt.steps.delete", { n })} title={t("common.delete")}>
            <Icon icon={Trash2} size={14} />
          </button>
        </div>
      )}
    </li>
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
