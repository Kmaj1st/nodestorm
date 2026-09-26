import type { QuizResponse, QuizStyle } from "@nodestorm/shared";
import { Check, CircleDashed, Eye, Lightbulb, RotateCcw, X, type LucideIcon } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import { useT, type MessageKey } from "../i18n";
import { cancelTask, gradeConcept, quizKey, quizQuestion } from "../lib/actions";
import * as quiz from "../lib/quiz";
import { useGraphStore } from "../store/graphStore";
import { MathText } from "./MathText";
import { Modal } from "./Modal";
import { Icon } from "../ui/Icon";
import "./quiz.css";

// Short names in the select (it can't wrap on a phone); the chosen one is explained under it.
const STYLES: { value: quiz.StylePref; label: MessageKey; hint: MessageKey }[] = [
  { value: "mixed", label: "quiz.styleMixed", hint: "quiz.styleMixedHint" },
  { value: "recall", label: "quiz.styleRecall", hint: "quiz.styleRecallHint" },
  { value: "apply", label: "quiz.styleApply", hint: "quiz.styleApplyHint" },
  { value: "connect", label: "quiz.styleConnect", hint: "quiz.styleConnectHint" },
];
const STYLE_TAG: Record<QuizStyle, MessageKey> = { recall: "quiz.tagRecall", apply: "quiz.tagApply", connect: "quiz.tagConnect" };
const GRADE_LABEL: Record<quiz.Grade | "skipped", MessageKey> = {
  knew: "quiz.knew",
  partly: "quiz.partly",
  didnt: "quiz.didnt",
  skipped: "quiz.skippedOne",
};
const GRADE_ICON: Record<quiz.Grade, LucideIcon> = { knew: Check, partly: CircleDashed, didnt: X };
const SKIP_REASON: Record<quiz.SkipReason, MessageKey> = {
  blocked: "quiz.skipBlocked",
  unclear: "quiz.skipUnclear",
  checking: "quiz.skipChecking",
};

interface Session {
  order: string[];
  skipped: quiz.QuizPlan["skipped"];
  done: string[];
  results: quiz.QuizResult[];
  style: quiz.StylePref;
  multipleChoice: boolean;
}

/** The question on screen: loading (no `q`), failed, or asked, with how much of it the user has uncovered. */
interface Card {
  id: string;
  name: string;
  style: QuizStyle;
  q?: QuizResponse;
  failed?: boolean;
  hints: number;
  revealed: boolean;
  picked?: number;
}

/**
 * "Quiz me": study the graph (or one concept's learning path) one question at a time, prerequisites first and weak
 * or unreviewed concepts sooner (lib/quiz.ts). Each answer is self-graded, which updates the concept's mastery.
 */
export function QuizDialog({ graphId, rootId, pathFirst, onClose }: {
  graphId: string;
  rootId?: string;
  pathFirst: boolean;
  onClose: () => void;
}) {
  const t = useT();
  const graph = useGraphStore((s) => s.graphs[graphId]);
  const root = rootId ? graph?.nodes.find((n) => n.id === rootId) : undefined;
  const [scope, setScope] = useState<"graph" | "path">(root && pathFirst ? "path" : "graph");
  const [style, setStyle] = useState<quiz.StylePref>("mixed");
  const [multipleChoice, setMultipleChoice] = useState(false);
  const [session, setSession] = useState<Session | null>(null);
  const [card, setCard] = useState<Card | null>(null);
  const [finished, setFinished] = useState(false);
  // Answers to an older request (skipped, or the dialog moved on) are ignored.
  const request = useRef(0);
  const questionRef = useRef<HTMLDivElement>(null);
  const gradesRef = useRef<HTMLDivElement>(null);

  const plan = useMemo(
    () => (graph ? quiz.quizPlan(graph, scope === "path" ? root?.id : undefined) : { order: [], skipped: [] }),
    [graph, scope, root?.id],
  );
  const pathSize = useMemo(() => (graph && root ? quiz.quizPlan(graph, root.id).order.length : 0), [graph, root]);
  const wholeSize = useMemo(() => (graph ? quiz.quizPlan(graph).order.length : 0), [graph]);

  // Closing the dialog drops a question that is still being written.
  useEffect(() => () => cancelTask(quizKey(graphId)), [graphId]);
  // A new question takes focus (the buttons that led to it are gone); the grades do once the answer is shown.
  useEffect(() => {
    if (card?.q && !card.revealed) questionRef.current?.focus();
  }, [card?.id, card?.q]);
  useEffect(() => {
    if (card?.revealed) gradesRef.current?.querySelector("button")?.focus();
  }, [card?.revealed]);

  const current = () => useGraphStore.getState().graphs[graphId];

  const ask = async (id: string, s: Session) => {
    const g = current();
    const node = g?.nodes.find((n) => n.id === id);
    if (!node) return advance({ ...s, done: [...s.done, id] });
    const hasPrereqs = node.dependsOn.some((d) => g.nodes.some((n) => n.id === d));
    const cardStyle = quiz.pickStyle(s.style, node.mastery, hasPrereqs);
    const token = ++request.current;
    setCard({ id, name: node.name, style: cardStyle, hints: 0, revealed: false });
    const q = await quizQuestion(id, cardStyle, s.multipleChoice, graphId);
    if (request.current !== token) return;
    setCard((c) => (c?.id === id ? (q ? { ...c, q } : { ...c, failed: true }) : c));
  };

  const advance = (s: Session) => {
    setSession(s);
    const g = current();
    const next = g && quiz.nextConcept(g, s.order, new Set(s.done), Date.now());
    if (next) return void ask(next, s);
    request.current++;
    setCard(null);
    setFinished(true);
  };

  const start = () => {
    setFinished(false);
    advance({ order: plan.order, skipped: plan.skipped, done: [], results: [], style, multipleChoice });
  };

  const record = (grade: quiz.Grade | "skipped") => {
    if (!session || !card) return;
    if (grade !== "skipped") gradeConcept(card.id, grade, graphId);
    else cancelTask(quizKey(graphId));
    advance({
      ...session,
      done: [...session.done, card.id],
      results: [...session.results, { id: card.id, name: card.name, grade }],
    });
  };

  const finish = () => {
    cancelTask(quizKey(graphId));
    request.current++;
    setCard(null);
    setFinished(true);
  };

  const restart = () => {
    setSession(null);
    setFinished(false);
  };

  const title = t("quiz.title");
  let body: React.ReactNode;
  if (!session) {
    body = (
      <form className="form" onSubmit={(e) => { e.preventDefault(); if (plan.order.length) start(); }}>
        <p className="muted small">{t("quiz.intro")}</p>
        <fieldset className="choice">
          <legend>{t("quiz.scope")}</legend>
          <label>
            <input type="radio" name="quiz-scope" checked={scope === "graph"} onChange={() => setScope("graph")} />
            <span>{t("quiz.scopeGraph", { n: wholeSize })}</span>
          </label>
          <label>
            <input type="radio" name="quiz-scope" checked={scope === "path"} disabled={!root} onChange={() => setScope("path")} />
            <span>
              {root ? t("quiz.scopePath", { name: root.name, n: pathSize }) : t("quiz.scopePathNone")}
            </span>
          </label>
        </fieldset>
        <label className="field">
          {t("quiz.style")}
          <select value={style} onChange={(e) => setStyle(e.target.value as quiz.StylePref)} aria-describedby="quiz-style-hint">
            {STYLES.map((s) => <option key={s.value} value={s.value}>{t(s.label)}</option>)}
          </select>
        </label>
        <p id="quiz-style-hint" className="quiz__styleHint">{t(STYLES.find((s) => s.value === style)!.hint)}</p>
        <label className="check">
          <input type="checkbox" checked={multipleChoice} onChange={(e) => setMultipleChoice(e.target.checked)} />
          {t("quiz.multipleChoice")}
        </label>
        <SkippedList skipped={plan.skipped} />
        {!plan.order.length && <p className="warn small">{t("quiz.nothing")}</p>}
        <div className="form__actions">
          <button type="button" onClick={onClose}>{t("common.cancel")}</button>
          <button type="submit" className="primary" disabled={!plan.order.length} data-testid="quiz-start">
            {t("quiz.start")}
          </button>
        </div>
      </form>
    );
  } else if (finished || !card) {
    const sum = quiz.summarize(session.results);
    const notAsked = session.order.length - session.done.length;
    body = (
      <div className="quiz__summary" data-testid="quiz-summary">
        <h4>{t("quiz.summary")}</h4>
        <ul className="quiz__counts">
          {(["knew", "partly", "didnt", "skipped"] as const).map((g) => (
            <li key={g} className={`quiz__count quiz__count--${g}`}>
              <strong>{sum[g]}</strong> {t(GRADE_LABEL[g])}
            </li>
          ))}
        </ul>
        {session.results.length > 0 && (
          <ol className="quiz__results" aria-label={t("quiz.resultsLabel")}>
            {session.results.map((r) => (
              <li key={r.id}>
                {r.name} <span className={`quiz__grade quiz__grade--${r.grade}`}>{t(GRADE_LABEL[r.grade])}</span>
              </li>
            ))}
          </ol>
        )}
        {notAsked > 0 && <p className="muted small">{t("quiz.notAsked", { n: notAsked })}</p>}
        <SkippedList skipped={session.skipped} />
        <div className="form__actions">
          <button onClick={restart}><Icon icon={RotateCcw} size={14} />{t("quiz.again")}</button>
          <button className="primary" onClick={onClose} autoFocus>{t("common.close")}</button>
        </div>
      </div>
    );
  } else {
    const { q } = card;
    const correct = q?.choices && card.picked !== undefined ? card.picked === q.correctIndex : undefined;
    body = (
      <div className="quiz__card" data-testid="quiz-card">
        <div className="quiz__progress small muted">
          <span>{t("quiz.progress", { i: session.done.length + 1, n: session.order.length })}</span>
          <span className="quiz__tag">{t(STYLE_TAG[card.style])}</span>
        </div>
        <h4 className="quiz__concept" data-testid="quiz-concept">{card.name}</h4>
        <div className="quiz__live" aria-live="polite">
          {!q && !card.failed && <p className="muted">{t("quiz.loading")}</p>}
          {card.failed && (
            <div className="error-box">
              <p className="error small">{t("quiz.failed")}</p>
              <button onClick={() => session && void ask(card.id, session)}>{t("quiz.retry")}</button>
            </div>
          )}
          {q && (
            <div ref={questionRef} tabIndex={-1} className="quiz__question" data-testid="quiz-question">
              <MathText text={q.question} />
            </div>
          )}
        </div>
        {q?.choices && (
          <fieldset className="quiz__choices">
            <legend className="small muted">{t("quiz.choose")}</legend>
            {q.choices.map((c, i) => {
              // Once picked: the right option is marked, and the picked one too when it was wrong.
              const mark = card.picked === undefined ? "" : i === q.correctIndex ? "right" : i === card.picked ? "wrong" : "";
              return (
                <button
                  key={i}
                  className={`quiz__choice${mark ? ` quiz__choice--${mark}` : ""}`}
                  aria-pressed={card.picked === i}
                  disabled={card.picked !== undefined}
                  onClick={() => setCard({ ...card, picked: i, revealed: true })}
                >
                  <MathText text={c} inline />
                </button>
              );
            })}
          </fieldset>
        )}
        {q && card.hints > 0 && (
          <ol className="quiz__hints" aria-label={t("quiz.hintsLabel")}>
            {q.hints.slice(0, card.hints).map((h, i) => <li key={i}><MathText text={h} /></li>)}
          </ol>
        )}
        {q && !card.revealed && (
          <div className="quiz__row">
            {card.hints < q.hints.length && (
              <button onClick={() => setCard({ ...card, hints: card.hints + 1 })}>
                <Icon icon={Lightbulb} size={14} />
                {t("quiz.hint", { n: q.hints.length - card.hints })}
              </button>
            )}
            {!q.choices && (
              <button className="primary" onClick={() => setCard({ ...card, revealed: true })}>
                <Icon icon={Eye} size={14} />{t("quiz.showAnswer")}
              </button>
            )}
          </div>
        )}
        {q && card.revealed && (
          <>
            {correct !== undefined && (
              <p className={correct ? "ok" : "error"} role="status">{t(correct ? "quiz.right" : "quiz.wrong")}</p>
            )}
            <div className="quiz__answer" data-testid="quiz-answer">
              <strong>{t("quiz.answer")}</strong> <MathText text={q.answer} />
            </div>
            <div className="quiz__grades" role="group" aria-label={t("quiz.gradeLabel")} ref={gradesRef}>
              <span className="small muted" aria-hidden="true">{t("quiz.gradeLabel")}</span>
              {quiz.GRADES.map((g) => (
                <button key={g} className={`quiz__gradeBtn quiz__gradeBtn--${g}`} onClick={() => record(g)}>
                  <Icon icon={GRADE_ICON[g]} size={14} />
                  {t(GRADE_LABEL[g])}
                </button>
              ))}
            </div>
          </>
        )}
        <div className="form__actions quiz__footer">
          <button className="link" onClick={() => record("skipped")}>{t("quiz.skip")}</button>
          <button onClick={finish}>{t("quiz.finish")}</button>
        </div>
      </div>
    );
  }

  return (
    <Modal label={title} title={title} onClose={onClose} className="quiz">
      {body}
    </Modal>
  );
}

/** Concepts in scope that can't be quizzed yet, and why. */
function SkippedList({ skipped }: { skipped: quiz.QuizPlan["skipped"] }) {
  const t = useT();
  if (!skipped.length) return null;
  return (
    <div className="quiz__skipped" data-testid="quiz-skipped">
      <p className="small muted">{t("quiz.skippedNote", { n: skipped.length })}</p>
      <ul className="small">
        {skipped.map((s) => <li key={s.id}>{t(SKIP_REASON[s.reason], { name: s.name })}</li>)}
      </ul>
    </div>
  );
}
