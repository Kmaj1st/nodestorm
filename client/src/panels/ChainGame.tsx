import type { AbsurdChainResponse } from "@nodestorm/shared";
import { ArrowRight, Check, Eye, Flag, Lightbulb, ShieldCheck, Trophy } from "lucide-react";
import { useEffect, useId, useRef, useState } from "react";
import { useT } from "../i18n";
import {
  clue,
  guess,
  isOpen,
  isOver,
  linkView,
  maxScore,
  newGame,
  pairKey,
  POINTS,
  recordBest,
  reveal,
  revealAll,
  score,
  stopsInOrder,
  tally,
  type Best,
  type ChainGame as Game,
} from "../lib/chainGame";
import { Icon } from "../ui/Icon";
import { MathText } from "./MathText";

type Feedback = { tone: "ok" | "wrong" | "info"; text: string } | null;

/**
 * "Guess the chain": the Absurd chain dialog's game board. The concepts between the two ends are hidden; the player
 * guesses them (in any order) from the links' relations, can ask for a clue (the link's narration with hidden names
 * blanked) or give one away, and gets a summary with the score and the best score for this pair of ends. Game logic
 * is lib/chainGame.ts; the dialog remounts this (with a new `key`) for every new chain.
 */
export function ChainGame({
  chain,
  aliasesOf,
  busy,
  onOver,
}: {
  chain: AbsurdChainResponse;
  aliasesOf: (name: string) => string[];
  busy: boolean;
  onOver: (over: boolean) => void;
}) {
  const t = useT();
  const [game, setGame] = useState<Game>(() => newGame(chain, aliasesOf));
  const [text, setText] = useState("");
  const [feedback, setFeedback] = useState<Feedback>(null);
  const [best, setBest] = useState<{ previous: Best | null; isBest: boolean } | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const summaryRef = useRef<HTMLDivElement>(null);
  const descId = useId();
  const over = isOver(game);
  const max = maxScore(game);
  const order = stopsInOrder(game);
  const blank = t("absurd.game.blank");
  const from = order[0]?.name ?? "";
  const to = order[order.length - 1]?.name ?? "";

  useEffect(() => {
    onOver(over);
  }, [over, onOver]);
  useEffect(() => {
    if (!over) inputRef.current?.focus();
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  /** Take the next state; a game that just ended records its score and brings the summary into view. */
  const commit = (next: Game, fb: Feedback) => {
    setGame(next);
    setFeedback(fb);
    if (!isOver(game) && isOver(next)) {
      if (maxScore(next) > 0) setBest(recordBest(pairKey(from, to), { score: score(next), max: maxScore(next) }));
      requestAnimationFrame(() => summaryRef.current?.focus());
    } else {
      requestAnimationFrame(() => inputRef.current?.focus());
    }
  };

  const onGuess = (e: React.FormEvent) => {
    e.preventDefault();
    const { game: next, result } = guess(game, text);
    const total = { score: score(next), max };
    switch (result.kind) {
      case "empty":
        return;
      case "correct":
        setText("");
        return commit(next, {
          tone: "ok",
          text: t("absurd.game.correct", { name: result.name, n: result.points, ...total }),
        });
      case "known":
        return commit(next, { tone: "info", text: t("absurd.game.known", { name: result.name }) });
      case "wrong":
        return commit(next, { tone: "wrong", text: t("absurd.game.wrong", { guess: text.trim() }) });
    }
  };

  const onClue = (i: number) => commit(clue(game, i), { tone: "info", text: t("absurd.game.clueShown", { n: i + 1 }) });
  const onReveal = (i: number) =>
    commit(reveal(game, i), { tone: "info", text: t("absurd.game.revealed", { n: i + 1, name: game.stops[i].name }) });
  const onGiveUp = () => commit(revealAll(game), { tone: "info", text: t("absurd.game.gaveUp") });

  const counts = tally(game);
  const name = (o: (typeof order)[number]) =>
    o.shown ? (
      <strong>{o.name}</strong>
    ) : (
      <span className="chain-game__blank">
        <span aria-hidden="true">?</span>
        <span className="absurd__sr">{t("absurd.game.hiddenConcept", { n: (o.stop ?? 0) + 1 })}</span>
      </span>
    );

  return (
    <div className="chain-game" aria-busy={busy} data-testid="chain-game">
      <div className="chain-game__head">
        <p className="chain-game__ends">
          <strong>{from}</strong>
          <Icon icon={ArrowRight} size={14} className="absurd-hop__arrow" />
          <span className="absurd__sr">{t("absurd.game.to")} </span>
          <strong>{to}</strong>
        </p>
        <p className="chain-game__score" data-testid="chain-game-score">
          {t("absurd.game.score", { score: score(game), max })}
        </p>
      </div>
      {!over && (
        <p className="muted small" id={descId}>
          {t("absurd.game.intro", { links: game.chain.chain.length, hidden: game.stops.length })}
        </p>
      )}

      {!over && (
        <form className="chain-game__guess" onSubmit={onGuess}>
          <label className="field">
            {t("absurd.game.guessLabel")}
            <input
              ref={inputRef}
              value={text}
              onChange={(e) => setText(e.target.value)}
              aria-describedby={descId}
              autoComplete="off"
              placeholder={t("absurd.game.guessPlaceholder")}
              disabled={busy}
            />
          </label>
          <button type="submit" className="primary" disabled={busy || !text.trim()}>
            <Icon icon={Check} size={14} />
            {t("absurd.game.guess")}
          </button>
        </form>
      )}
      <p
        className={`chain-game__feedback small${feedback ? ` chain-game__feedback--${feedback.tone}` : ""}`}
        role="status"
        data-testid="chain-game-feedback"
      >
        {feedback?.text}
      </p>

      {over && (
        <div className="chain-game__summary" ref={summaryRef} tabIndex={-1} data-testid="chain-game-summary">
          <p className="absurd__label">{t("absurd.game.summary")}</p>
          <h3 className="absurd__title">{chain.title}</h3>
          <p className="chain-game__final">
            <Icon icon={Trophy} size={20} />
            <span>{t("absurd.game.final", { score: score(game), max })}</span>
          </p>
          <p className="small">
            {t("absurd.game.tally", { guessed: counts.guessed, clued: counts.clued, revealed: counts.revealed, wrong: game.wrong })}
          </p>
          {best && (
            <p className="small chain-game__best" data-testid="chain-game-best">
              {best.isBest
                ? best.previous
                  ? t("absurd.game.newBest", { score: best.previous.score, max: best.previous.max })
                  : t("absurd.game.firstBest")
                : t("absurd.game.best", { score: best.previous!.score, max: best.previous!.max })}
            </p>
          )}
          {chain.moral && (
            <p className="absurd__moral">
              <span className="absurd__label">{t("absurd.moralLabel")}</span>
              <MathText text={chain.moral} />
            </p>
          )}
        </div>
      )}


      <ol className="absurd__chain" aria-label={t("absurd.chain")}>
        {game.chain.chain.map((h, i) => {
          const v = linkView(game, i, blank);
          const stop = order[i + 1].stop;
          const s = stop === null ? null : game.stops[stop];
          return (
            <li className="absurd-hop" key={i}>
              <span className="absurd-hop__n" aria-hidden="true">{i + 1}</span>
              <div className={`absurd-hop__card${v.fact ? "" : " chain-game__card--hidden"}`}>
                <div className="absurd-hop__head">
                  <span className="absurd__sr">{t("absurd.hop", { n: i + 1 })}: </span>
                  <span className="absurd-hop__ends">
                    {name(order[i])}
                    <Icon icon={ArrowRight} size={14} className="absurd-hop__arrow" />
                    {name(order[i + 1])}
                  </span>
                  {h.kind && <span className="absurd-hop__kind">{h.kind}</span>}
                  {s && s.status === "guessed" && (
                    <span className="chain-game__tag chain-game__tag--ok">
                      {t("absurd.game.found", { n: s.points })}
                    </span>
                  )}
                  {s && s.status === "revealed" && (
                    <span className="chain-game__tag">{t("absurd.game.given")}</span>
                  )}
                </div>
                {v.fact && (
                  <p className="absurd-hop__fact">
                    <span className="absurd__sr">{t("absurd.factLabel")}: </span>
                    <MathText text={v.fact} />
                  </p>
                )}
                {v.quip && <p className="absurd-hop__quip"><MathText text={v.quip} /></p>}
                {v.clue && (
                  <p className="absurd-hop__quip chain-game__clue">
                    <span className="absurd__label">{t("absurd.game.clueLabel")}</span>
                    <MathText text={v.clue} />
                  </p>
                )}
                {s && isOpen(s) && stop !== null && (
                  <div className="chain-game__actions">
                    {s.status === "hidden" && (
                      <button
                        type="button"
                        className="small-btn"
                        onClick={() => onClue(stop)}
                        disabled={busy}
                        aria-label={t("absurd.game.clueFor", { n: stop + 1 })}
                        title={t("absurd.game.clueTitle", { points: POINTS.clued })}
                      >
                        <Icon icon={Lightbulb} size={14} />
                        {t("absurd.game.clue")}
                      </button>
                    )}
                    <button
                      type="button"
                      className="small-btn"
                      onClick={() => onReveal(stop)}
                      disabled={busy}
                      aria-label={t("absurd.game.revealFor", { n: stop + 1 })}
                      title={t("absurd.game.revealTitle")}
                    >
                      <Icon icon={Eye} size={14} />
                      {t("absurd.game.reveal")}
                    </button>
                  </div>
                )}
              </div>
            </li>
          );
        })}
      </ol>

      {!over && (
        <div className="chain-game__giveup">
          <button type="button" className="small-btn" onClick={onGiveUp} disabled={busy}>
            <Icon icon={Flag} size={14} />
            {t("absurd.game.giveUp")}
          </button>
        </div>
      )}
      {over && (
        <p className="absurd__note muted small">
          <Icon icon={ShieldCheck} size={14} />
          <span>
            {chain.plausibility && <>{t("absurd.plausibilityLabel")}: <MathText text={chain.plausibility} /> </>}
            {t("absurd.check")}
          </span>
        </p>
      )}
    </div>
  );
}
