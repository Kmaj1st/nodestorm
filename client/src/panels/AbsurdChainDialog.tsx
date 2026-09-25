import {
  ABSURD_MAX_VIA,
  absurdHops,
  findByName,
  normalizeName,
  type AbsurdChainResponse,
  type AbsurdStyle,
  type ConceptNode,
} from "@nodestorm/shared";
import { ArrowDown, ArrowLeftRight, ArrowRight, ArrowUp, Copy, Dices, FlaskConical, MapPin, Plus, Puzzle, ShieldCheck, Shuffle, X } from "lucide-react";
import { useCallback, useEffect, useId, useRef, useState } from "react";
import { t as tr, useT, type MessageKey } from "../i18n";
import {
  ABSURD_LENGTHS,
  ABSURD_STYLES,
  chainToText,
  intermediates,
  isStop,
  surprisePair,
  type AbsurdLength,
  type AbsurdStop,
} from "../lib/absurd";
import { absurdChain, absurdKey, addAbsurdChainToSandbox, cancelTask } from "../lib/actions";
import { activeGraph, useGraphStore } from "../store/graphStore";
import { Icon } from "../ui/Icon";
import { ChainGame } from "./ChainGame";
import { MathText } from "./MathText";
import { Modal } from "./Modal";
import "./absurd.css";

/**
 * "Absurd chain" (parody mode): two ends (concepts of the graph or anything typed), a narration style and a length;
 * the answer is shown as a sequence of links, each with its sober fact and its silly narration. The chain can be
 * copied as text or added to a new sandbox; the graph itself is never changed here. "Guess the chain" builds the same
 * chain as a game (panels/ChainGame.tsx) with the concepts in the middle hidden.
 */
export function AbsurdChainDialog({ from: from0, to: to0, onClose }: { from: string; to: string; onClose: () => void }) {
  const t = useT();
  const graph = useGraphStore(activeGraph);
  const busy = useGraphStore((s) => Boolean(s.busy[absurdKey]));
  const [from, setFrom] = useState(from0);
  const [to, setTo] = useState(to0);
  const [style, setStyle] = useState<AbsurdStyle>("deadpan");
  const [length, setLength] = useState<AbsurdLength>("medium");
  // The user's stops between the ends, in order (ids keep each row's React identity while they are reordered).
  const [stops, setStops] = useState<Stop[]>([]);
  const [res, setRes] = useState<AbsurdChainResponse | null>(null);
  // The stops the chain on screen was built through (marked in it, and kept when it goes to a sandbox).
  const [shownVia, setShownVia] = useState<AbsurdStop[]>([]);
  // The ends (and stops) of the chain on screen, and the intermediate concepts of every roll between them so far.
  const [rolled, setRolled] = useState<{ ends: string; avoid: string[] } | null>(null);
  // A game round (its number remounts the board) while playing "Guess the chain", and whether it is finished.
  const [round, setRound] = useState<number | null>(null);
  const [over, setOver] = useState(false);
  const listId = useId();
  const resultRef = useRef<HTMLDivElement>(null);
  const runRef = useRef<HTMLButtonElement>(null);
  const playRef = useRef<HTMLButtonElement>(null);
  const playing = round !== null;

  // Closing the dialog cancels a chain that is still being built.
  useEffect(() => () => cancelTask(absurdKey), []);

  const routeKey = (a: string, b: string, via: readonly AbsurdStop[]) =>
    [a, b, ...via.map((s) => s.name)].map(normalizeName).join("\u0000");
  const named = Boolean(normalizeName(from) && normalizeName(to));
  // The same concept at both ends, also when one end is typed as the other's alias.
  const resolve = (x: string) => findByName(graph.nodes, x)?.id ?? `name:${normalizeName(x)}`;
  const same = named && resolve(from) === resolve(to);
  // A stop that is also one of the ends (the ends were edited after it was added).
  const clash = stops.find((s) => [from, to].some((e) => normalizeName(e) && resolve(e) === resolve(s.name)));
  // The game picks its own route: it is built without the stops.
  const again = Boolean(res && rolled?.ends === routeKey(from, to, stops));
  const againPlay = Boolean(res && rolled?.ends === routeKey(from, to, []));
  const hops = absurdHops(ABSURD_LENGTHS[length], stops.length);
  const widened = hops.min !== ABSURD_LENGTHS[length].min;

  /** Build a chain to show it, or (`play`) to guess it; the same ends (and stops) again take another route. */
  const run = async (a = from, b = to, play = false) => {
    const via: AbsurdStop[] = play ? [] : stops.map(({ name, description }) => ({ name, description }));
    const key = routeKey(a, b, via);
    const avoid = res && rolled?.ends === key ? rolled.avoid : [];
    const out = await absurdChain(a, b, style, absurdHops(ABSURD_LENGTHS[length], via.length), avoid, via);
    if (!out) return;
    setRes(out);
    setShownVia(via);
    setRolled({ ends: key, avoid: [...new Set([...avoid, ...intermediates(out).filter((n) => !isStop(n, via))])] });
    if (play) {
      setOver(false);
      setRound((r) => (r ?? 0) + 1); // the board focuses its guess field
    } else {
      setRound(null);
      requestAnimationFrame(() => resultRef.current?.focus());
    }
  };

  // Names a concept of the graph also goes by count as right guesses.
  const nodes = graph.nodes;
  const aliasesOf = useCallback((name: string) => {
    const n = findByName(nodes, name);
    return n ? [n.name, ...n.aliases] : [];
  }, [nodes]);

  // Two random ends (from the graph, or fun ones for a nearly empty graph), built straight away.
  // A stop is never picked as an end.
  const surprise = () => {
    const [a, b] = surprisePair(graph.nodes.map((n) => n.name).filter((n) => !isStop(n, stops)), [from, to]);
    setFrom(a);
    setTo(b);
    void run(a, b, playing);
  };

  const copy = async () => {
    if (!res) return;
    const ok = await navigator.clipboard?.writeText(chainToText(res)).then(() => true, () => false);
    useGraphStore.getState().setToast(tr(ok ? "absurd.copied" : "absurd.copyFailed"), ok ? "info" : "error");
  };

  const toSandbox = () => {
    if (!res) return;
    if (addAbsurdChainToSandbox(res, shownVia)) onClose();
  };

  return (
    <Modal label={t("absurd.title")} title={t("absurd.title")} onClose={onClose} className="absurd">
      <p className="muted">{t("absurd.intro")}</p>
      <div
        className="absurd__form"
        // Enter in either name field presses the footer's build button, a frame later: Enter may also be picking a
        // suggestion from the list, which fills the field first.
        onKeyDown={(e) => {
          if (e.key !== "Enter" || !(e.target instanceof HTMLInputElement) || e.nativeEvent.isComposing) return;
          e.preventDefault();
          requestAnimationFrame(() => (playing ? playRef : runRef).current?.click());
        }}
      >
        <div className="absurd__ends">
          <label className="field">
            {t("absurd.from")}
            <input value={from} onChange={(e) => setFrom(e.target.value)} list={listId} placeholder={t("absurd.fromPlaceholder")} autoFocus={!from0} />
          </label>
          <button
            type="button"
            className="icon-btn absurd__swap"
            onClick={() => { setFrom(to); setTo(from); }}
            aria-label={t("absurd.swap")}
            title={t("absurd.swap")}
          >
            <Icon icon={ArrowLeftRight} />
          </button>
          <label className="field">
            {t("absurd.to")}
            <input value={to} onChange={(e) => setTo(e.target.value)} list={listId} placeholder={t("absurd.toPlaceholder")} />
          </label>
        </div>
        <div className="absurd__surprise">
          <button type="button" className="small-btn" onClick={surprise} disabled={busy} title={t("absurd.surpriseTitle")} data-testid="absurd-surprise">
            <Icon icon={Shuffle} size={14} />
            {t("absurd.surprise")}
          </button>
        </div>
        <StopsEditor stops={stops} setStops={setStops} nodes={graph.nodes} listId={listId} ends={[from, to]} />
        {clash && <p className="error small" role="alert">{t("absurd.via.clash", { name: clash.name })}</p>}
        {playing && stops.length > 0 && <p className="muted small absurd__hint">{t("absurd.via.game")}</p>}
        <datalist id={listId}>
          {graph.nodes.map((n) => <option key={n.id} value={n.name} />)}
        </datalist>
        <div className="absurd__options">
          <label className="field">
            {t("absurd.style")}
            <select value={style} onChange={(e) => setStyle(e.target.value as AbsurdStyle)}>
              {ABSURD_STYLES.map((s) => <option key={s} value={s}>{t(`absurd.style.${s}` as MessageKey)}</option>)}
            </select>
          </label>
          <label className="field">
            {t("absurd.length")}
            <select value={length} onChange={(e) => setLength(e.target.value as AbsurdLength)}>
              {(Object.keys(ABSURD_LENGTHS) as AbsurdLength[]).map((l) => (
                <option key={l} value={l}>{t(`absurd.length.${l}` as MessageKey)}</option>
              ))}
            </select>
          </label>
        </div>
        {widened && !playing && (
          <p className="muted small absurd__hint" data-testid="absurd-via-hops">
            {t("absurd.via.hops", { n: stops.length, range: hops.min === hops.max ? `${hops.min}` : `${hops.min}–${hops.max}` })}
          </p>
        )}
        {same &&<p className="error small" role="alert">{t("absurd.same")}</p>}
      </div>

      {busy && (
        <p className="muted status-line" role="status">
          <span className="spinner spinner--xs" aria-hidden="true" />
          {t("absurd.thinking")}
        </p>
      )}

      {res && playing && (
        <ChainGame key={round} chain={res} aliasesOf={aliasesOf} busy={busy} onOver={setOver} />
      )}

      {res && !playing && (
        <div className="absurd__result" ref={resultRef} tabIndex={-1} aria-busy={busy} data-testid="absurd-result">
          <h3 className="absurd__title">{res.title}</h3>
          <ol className="absurd__chain" aria-label={t("absurd.chain")}>
            {res.chain.map((h, i) => (
              <li className="absurd-hop" key={`${i}:${h.from}:${h.to}`}>
                <span className="absurd-hop__n" aria-hidden="true">{i + 1}</span>
                <div className="absurd-hop__card">
                  <div className="absurd-hop__head">
                    <span className="sr-only">{t("absurd.hop", { n: i + 1 })}: </span>
                    <span className="absurd-hop__ends">
                      <strong>{h.from}</strong>
                      <Icon icon={ArrowRight} size={14} className="absurd-hop__arrow" />
                      <strong>{h.to}</strong>
                      {i < res.chain.length - 1 && isStop(h.to, shownVia) && (
                        <span className="absurd-hop__stop">
                          <Icon icon={MapPin} size={12} />
                          {t("absurd.via.yours")}
                        </span>
                      )}
                    </span>
                    {h.kind && <span className="absurd-hop__kind">{h.kind}</span>}
                  </div>
                  <p className="absurd-hop__fact">
                    <span className="sr-only">{t("absurd.factLabel")}: </span>
                    <MathText text={h.fact} />
                  </p>
                  {h.quip && <p className="absurd-hop__quip"><MathText text={h.quip} /></p>}
                </div>
              </li>
            ))}
          </ol>
          {res.moral && (
            <p className="absurd__moral">
              <span className="absurd__label">{t("absurd.moralLabel")}</span>
              <MathText text={res.moral} />
            </p>
          )}
          <p className="absurd__note muted small">
            <Icon icon={ShieldCheck} size={14} />
            <span>
              {res.plausibility && <>{t("absurd.plausibilityLabel")}: <MathText text={res.plausibility} /> </>}
              {t("absurd.check")}
            </span>
          </p>
        </div>
      )}

      <div className="form__actions">
        {res && (!playing || over) && (
          <>
            <button type="button" className="form__lead" onClick={copy}>
              <Icon icon={Copy} size={14} />
              {t("absurd.copy")}
            </button>
            <button type="button" onClick={toSandbox} title={t("absurd.sandboxTitle")} disabled={busy}>
              <Icon icon={FlaskConical} size={14} />
              {t("absurd.sandbox")}
            </button>
          </>
        )}
        {busy && <button type="button" onClick={() => cancelTask(absurdKey)}>{t("common.cancel")}</button>}
        <button
          type="button"
          className={playing ? "primary" : undefined}
          ref={playRef}
          onClick={() => void run(from, to, true)}
          disabled={!named || same || busy}
          title={playing && againPlay ? t("absurd.playAgainTitle") : t("absurd.playTitle")}
          data-testid="absurd-play"
        >
          <Icon icon={Puzzle} size={14} />
          {playing && againPlay ? t("absurd.playAgain") : t("absurd.play")}
        </button>
        <button
          type="button"
          className={playing ? undefined : "primary"}
          ref={runRef}
          onClick={() => void run()}
          disabled={!named || same || Boolean(clash) || busy}
          title={again && !playing ? t("absurd.againTitle") : undefined}
        >
          <Icon icon={Dices} size={14} />
          {again && !playing ? t("absurd.again") : t("absurd.run")}
        </button>
      </div>
    </Modal>
  );
}

type Stop = AbsurdStop & { id: number };

/**
 * "Stops along the way": the user's own concepts the chain must pass through, in order. A stop is a concept of the
 * graph (typed by name or alias; suggested from the same list as the ends) or a custom one, which gets a field for
 * what it means. Rows move with up/down buttons and can be removed; each change is announced to screen readers.
 */
function StopsEditor({
  stops,
  setStops,
  nodes,
  listId,
  ends,
}: {
  stops: Stop[];
  setStops: (s: Stop[]) => void;
  nodes: ConceptNode[];
  listId: string;
  ends: [string, string];
}) {
  const t = useT();
  const [name, setName] = useState("");
  const [error, setError] = useState("");
  const [said, setSaid] = useState("");
  const nextId = useRef(1);
  const inputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLOListElement>(null);
  const labelId = useId();
  const helpId = useId();
  const full = stops.length >= ABSURD_MAX_VIA;
  const resolve = (x: string) => findByName(nodes, x)?.id ?? `name:${normalizeName(x)}`;

  const add = () => {
    // Read the field itself: Enter may have just picked a suggestion, which fills it before React state catches up.
    const typed = (inputRef.current?.value ?? name).trim();
    if (!normalizeName(typed)) return;
    if (full) return setError(t("absurd.via.full", { max: ABSURD_MAX_VIA }));
    const shown = findByName(nodes, typed)?.name ?? typed;
    if (stops.some((s) => resolve(s.name) === resolve(shown))) return setError(t("absurd.via.duplicate", { name: shown }));
    if (ends.some((e) => normalizeName(e) && resolve(e) === resolve(shown))) return setError(t("absurd.via.clash", { name: shown }));
    setStops([...stops, { id: nextId.current++, name: shown, description: "" }]);
    setName("");
    setError("");
    setSaid(t("absurd.via.added", { name: shown }));
    // The field goes away once the list is full: the focus moves to the new row's last button.
    if (stops.length + 1 >= ABSURD_MAX_VIA) {
      requestAnimationFrame(() => listRef.current?.querySelector<HTMLButtonElement>("li:last-child button:last-child")?.focus());
    }
  };

  const move = (i: number, d: -1 | 1) => {
    const next = [...stops];
    [next[i], next[i + d]] = [next[i + d], next[i]];
    setStops(next);
    setSaid(t("absurd.via.moved", { name: stops[i].name, n: i + d + 1 }));
    // Keep the focus on the moved row: on the same button, or the other one once it reaches the top or bottom.
    const id = stops[i].id;
    requestAnimationFrame(() => {
      const row = listRef.current?.querySelector(`[data-stop="${id}"]`);
      const same = row?.querySelector<HTMLButtonElement>(`[data-move="${d}"]`);
      (same && !same.disabled ? same : row?.querySelector<HTMLButtonElement>(`[data-move="${-d}"]`))?.focus();
    });
  };

  const remove = (i: number) => {
    setStops(stops.filter((_, j) => j !== i));
    setError("");
    setSaid(t("absurd.via.removed", { name: stops[i].name }));
    requestAnimationFrame(() => inputRef.current?.focus());
  };

  return (
    <div className="absurd-via" role="group" aria-labelledby={labelId} aria-describedby={helpId}>
      <div className="absurd-via__head">
        <span className="absurd-via__label" id={labelId}>
          <Icon icon={MapPin} size={14} />
          {t("absurd.via.label")}
        </span>
        <span className="muted small" id={helpId}>{t("absurd.via.help")}</span>
      </div>
      {stops.length > 0 && (
        <ol className="absurd-via__list" ref={listRef} aria-labelledby={labelId}>
          {stops.map((s, i) => {
            const known = findByName(nodes, s.name);
            return (
              <li className="absurd-stop" key={s.id} data-stop={s.id} data-testid="absurd-stop">
                <span className="absurd-stop__n" aria-hidden="true">{i + 1}</span>
                <span className="absurd-stop__head">
                  <strong className="absurd-stop__name">{s.name}</strong>
                  {known && <span className="absurd-stop__tag">{t("absurd.via.inGraph")}</span>}
                </span>
                {!known && (
                  <input
                    className="absurd-stop__desc"
                    value={s.description}
                    maxLength={500}
                    onChange={(e) => setStops(stops.map((x) => (x.id === s.id ? { ...x, description: e.target.value } : x)))}
                    aria-label={t("absurd.via.description", { name: s.name })}
                    placeholder={t("absurd.via.descriptionPlaceholder")}
                  />
                )}
                <div className="absurd-stop__actions">
                  <button
                    type="button"
                    className="icon-btn"
                    data-move="-1"
                    onClick={() => move(i, -1)}
                    disabled={i === 0}
                    aria-label={t("absurd.via.up", { name: s.name })}
                    title={t("absurd.via.up", { name: s.name })}
                  >
                    <Icon icon={ArrowUp} size={14} />
                  </button>
                  <button
                    type="button"
                    className="icon-btn"
                    data-move="1"
                    onClick={() => move(i, 1)}
                    disabled={i === stops.length - 1}
                    aria-label={t("absurd.via.down", { name: s.name })}
                    title={t("absurd.via.down", { name: s.name })}
                  >
                    <Icon icon={ArrowDown} size={14} />
                  </button>
                  <button
                    type="button"
                    className="icon-btn"
                    onClick={() => remove(i)}
                    aria-label={t("absurd.via.remove", { name: s.name })}
                    title={t("absurd.via.remove", { name: s.name })}
                  >
                    <Icon icon={X} size={14} />
                  </button>
                </div>
              </li>
            );
          })}
        </ol>
      )}
      {full ? (
        <p className="muted small">{t("absurd.via.full", { max: ABSURD_MAX_VIA })}</p>
      ) : (
        <div className="absurd-via__add">
          <label className="field">
            {t("absurd.via.new")}
            <input
              ref={inputRef}
              value={name}
              onChange={(e) => {
                setName(e.target.value);
                setError("");
              }}
              onKeyDown={(e) => {
                // Enter adds the stop here instead of building the chain.
                if (e.key !== "Enter" || e.nativeEvent.isComposing) return;
                e.preventDefault();
                e.stopPropagation();
                requestAnimationFrame(add);
              }}
              list={listId}
              placeholder={t("absurd.via.placeholder")}
              aria-invalid={error ? true : undefined}
            />
          </label>
          <button type="button" className="absurd-via__add-btn" onClick={add} disabled={!name.trim()}>
            <Icon icon={Plus} size={14} />
            {t("absurd.via.add")}
          </button>
        </div>
      )}
      {error && <p className="error small" role="alert">{error}</p>}
      <p className="sr-only" role="status">{said}</p>
    </div>
  );
}
