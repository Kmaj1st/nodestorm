import { findByName, normalizeName, type AbsurdChainResponse, type AbsurdStyle } from "@nodestorm/shared";
import { ArrowLeftRight, ArrowRight, Copy, Dices, FlaskConical, ShieldCheck } from "lucide-react";
import { useEffect, useId, useRef, useState } from "react";
import { t as tr, useT, type MessageKey } from "../i18n";
import { ABSURD_LENGTHS, ABSURD_STYLES, chainToText, intermediates, type AbsurdLength } from "../lib/absurd";
import { absurdChain, absurdKey, addAbsurdChainToSandbox, cancelTask } from "../lib/actions";
import { activeGraph, useGraphStore } from "../store/graphStore";
import { Icon } from "../ui/Icon";
import { MathText } from "./MathText";
import { Modal } from "./Modal";
import "./absurd.css";

/**
 * "Absurd chain" (parody mode): two ends (concepts of the graph or anything typed), a narration style and a length;
 * the answer is shown as a sequence of links, each with its sober fact and its silly narration. The chain can be
 * copied as text or added to a new sandbox; the graph itself is never changed here.
 */
export function AbsurdChainDialog({ from: from0, to: to0, onClose }: { from: string; to: string; onClose: () => void }) {
  const t = useT();
  const graph = useGraphStore(activeGraph);
  const busy = useGraphStore((s) => Boolean(s.busy[absurdKey]));
  const [from, setFrom] = useState(from0);
  const [to, setTo] = useState(to0);
  const [style, setStyle] = useState<AbsurdStyle>("deadpan");
  const [length, setLength] = useState<AbsurdLength>("medium");
  const [res, setRes] = useState<AbsurdChainResponse | null>(null);
  // The ends of the chain on screen, and the intermediate concepts of every roll between them so far.
  const [rolled, setRolled] = useState<{ ends: string; avoid: string[] } | null>(null);
  const listId = useId();
  const resultRef = useRef<HTMLDivElement>(null);
  const runRef = useRef<HTMLButtonElement>(null);

  // Closing the dialog cancels a chain that is still being built.
  useEffect(() => () => cancelTask(absurdKey), []);

  const ends = `${normalizeName(from)}\u0000${normalizeName(to)}`;
  const named = Boolean(normalizeName(from) && normalizeName(to));
  // The same concept at both ends, also when one end is typed as the other's alias.
  const resolve = (x: string) => findByName(graph.nodes, x)?.id ?? `name:${normalizeName(x)}`;
  const same = named && resolve(from) === resolve(to);
  const again = Boolean(res && rolled?.ends === ends);

  const run = async () => {
    const avoid = again ? rolled!.avoid : [];
    const out = await absurdChain(from, to, style, ABSURD_LENGTHS[length], avoid);
    if (!out) return;
    setRes(out);
    setRolled({ ends, avoid: [...new Set([...avoid, ...intermediates(out)])] });
    requestAnimationFrame(() => resultRef.current?.focus());
  };

  const copy = async () => {
    if (!res) return;
    const ok = await navigator.clipboard?.writeText(chainToText(res)).then(() => true, () => false);
    useGraphStore.getState().setToast(tr(ok ? "absurd.copied" : "absurd.copyFailed"), ok ? "info" : "error");
  };

  const toSandbox = () => {
    if (!res) return;
    if (addAbsurdChainToSandbox(res)) onClose();
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
          requestAnimationFrame(() => runRef.current?.click());
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
        {same && <p className="error small" role="alert">{t("absurd.same")}</p>}
      </div>

      {busy && (
        <p className="muted status-line" role="status">
          <span className="spinner spinner--xs" aria-hidden="true" />
          {t("absurd.thinking")}
        </p>
      )}

      {res && (
        <div className="absurd__result" ref={resultRef} tabIndex={-1} aria-busy={busy} data-testid="absurd-result">
          <h3 className="absurd__title">{res.title}</h3>
          <ol className="absurd__chain" aria-label={t("absurd.chain")}>
            {res.chain.map((h, i) => (
              <li className="absurd-hop" key={`${i}:${h.from}:${h.to}`}>
                <span className="absurd-hop__n" aria-hidden="true">{i + 1}</span>
                <div className="absurd-hop__card">
                  <div className="absurd-hop__head">
                    <span className="absurd__sr">{t("absurd.hop", { n: i + 1 })}: </span>
                    <span className="absurd-hop__ends">
                      <strong>{h.from}</strong>
                      <Icon icon={ArrowRight} size={14} className="absurd-hop__arrow" />
                      <strong>{h.to}</strong>
                    </span>
                    {h.kind && <span className="absurd-hop__kind">{h.kind}</span>}
                  </div>
                  <p className="absurd-hop__fact">
                    <span className="absurd__sr">{t("absurd.factLabel")}: </span>
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
        {res && (
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
          className="primary"
          ref={runRef}
          onClick={() => void run()}
          disabled={!named || same || busy}
          title={again ? t("absurd.againTitle") : undefined}
        >
          <Icon icon={Dices} size={14} />
          {again ? t("absurd.again") : t("absurd.run")}
        </button>
      </div>
    </Modal>
  );
}
