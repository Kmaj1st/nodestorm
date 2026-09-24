import type { Graph } from "@nodestorm/shared";
import { useMemo, useState } from "react";
import { createPortal } from "react-dom";
import { rich, useLang, useT, type MessageKey } from "../i18n";
import { buildCards, CARD_KINDS, flashcardsFileName, toAnki, toCsv, type CardKind } from "../lib/flashcards";
import { learningPath } from "../lib/paths";
import { Modal } from "./Modal";
import "./flashcards.css";

const KIND_LABEL: Record<CardKind, MessageKey> = {
  definition: "flash.kindDefinition",
  prerequisites: "flash.kindPrereqs",
  relation: "flash.kindRelations",
};
/** How many cards the preview shows. */
const PREVIEW = 4;

/**
 * "Flashcards (Anki)…": the graph, or the selected concept's learning path, as cards for Anki (tab-separated file
 * with header lines) or a plain CSV (lib/flashcards.ts). Read-only, so it also works in the shared-graph viewer.
 * Rendered into <body> so it stays visible when the toolbar's small-screen menu that opened it folds away.
 */
export function FlashcardsDialog({ graph, project, rootId, onClose }: {
  graph: Graph;
  /** Project (or shared graph) name: the default deck, the tag on every card and the file name. */
  project: string;
  /** The selected concept, whose learning path can be exported instead of the whole graph. */
  rootId?: string;
  onClose: () => void;
}) {
  const t = useT();
  const lang = useLang(); // the card wording follows the interface language
  const root = rootId ? graph.nodes.find((n) => n.id === rootId) : undefined;
  const [scope, setScope] = useState<"graph" | "path">("graph");
  const [kinds, setKinds] = useState<Set<CardKind>>(() => new Set(CARD_KINDS));
  const [format, setFormat] = useState<"anki" | "csv">("anki");
  const [deck, setDeck] = useState(project);
  const [saved, setSaved] = useState<string | null>(null);

  const pathSize = useMemo(
    () => (root ? learningPath(graph, root.id).steps.filter((s) => s.kind === "node").length : 0),
    [graph, root],
  );
  const cards = useMemo(
    () => buildCards(graph, { kinds, rootId: scope === "path" ? root?.id : undefined, project }),
    // `lang`: buildCards words the cards with t(), so rebuild them when the language changes.
    [graph, kinds, scope, root?.id, project, lang],
  );

  const toggle = (kind: CardKind, on: boolean) => {
    const next = new Set(kinds);
    if (on) next.add(kind);
    else next.delete(kind);
    setKinds(next);
  };

  const download = () => {
    const anki = format === "anki";
    const name = flashcardsFileName(project, anki ? "anki.txt" : "flashcards.csv");
    const blob = new Blob([anki ? toAnki(cards, deck || project) : toCsv(cards)], {
      type: `${anki ? "text/plain" : "text/csv"};charset=utf-8`,
    });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = name;
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 1000);
    setSaved(t("flash.downloaded", { file: name, n: cards.length }));
  };

  return createPortal(
    <Modal label={t("flash.dialog")} onClose={onClose} className="flash">
      <h3>{t("flash.dialog")}</h3>
      <form className="form" onSubmit={(e) => { e.preventDefault(); if (cards.length) download(); }}>
        <p className="muted small">{t("flash.intro")}</p>
        <fieldset className="choice">
          <legend>{t("flash.scope")}</legend>
          <label>
            <input type="radio" name="flash-scope" checked={scope === "graph"} onChange={() => setScope("graph")} />
            <span>{t("flash.scopeGraph", { n: graph.nodes.length })}</span>
          </label>
          <label>
            <input type="radio" name="flash-scope" checked={scope === "path"} disabled={!root} onChange={() => setScope("path")} />
            <span>{root ? t("flash.scopePath", { name: root.name, n: pathSize }) : t("flash.scopePathNone")}</span>
          </label>
        </fieldset>
        <fieldset className="choice">
          <legend>{t("flash.kinds")}</legend>
          {CARD_KINDS.map((k) => (
            <label key={k} className="check">
              <input type="checkbox" checked={kinds.has(k)} onChange={(e) => toggle(k, e.target.checked)} />
              {t(KIND_LABEL[k])}
            </label>
          ))}
        </fieldset>
        <fieldset className="choice">
          <legend>{t("flash.format")}</legend>
          <label>
            <input type="radio" name="flash-format" checked={format === "anki"} onChange={() => setFormat("anki")} />
            <span>{t("flash.formatAnki")}</span>
          </label>
          <label>
            <input type="radio" name="flash-format" checked={format === "csv"} onChange={() => setFormat("csv")} />
            <span>{t("flash.formatCsv")}</span>
          </label>
        </fieldset>
        {format === "anki" ? (
          <>
            <label className="field">
              {t("flash.deck")}
              <input value={deck} onChange={(e) => setDeck(e.target.value)} aria-describedby="flash-deck-hint" />
            </label>
            <p id="flash-deck-hint" className="muted small flash__hint">{t("flash.deckHint")}</p>
            <p className="muted small">{rich("flash.ankiHelp")}</p>
          </>
        ) : (
          <p className="muted small">{rich("flash.csvHelp")}</p>
        )}

        <section className="flash__preview" aria-labelledby="flash-preview-head">
          <div className="flash__previewHead">
            <h4 id="flash-preview-head">{t("flash.preview")}</h4>
            <span className="muted small" data-testid="flash-count">{t("flash.count", { n: cards.length })}</span>
          </div>
          {cards.length ? (
            <ol className="flash__cards">
              {cards.slice(0, PREVIEW).map((c, i) => (
                <li key={i} className="flash__card">
                  <div><span className="flash__side">{t("flash.front")}</span> {c.front}</div>
                  <div><span className="flash__side">{t("flash.back")}</span> {c.back}</div>
                </li>
              ))}
            </ol>
          ) : (
            <p className="warn small">{t("flash.none")}</p>
          )}
          {cards.length > PREVIEW && <p className="muted small">{t("flash.previewMore", { n: cards.length - PREVIEW })}</p>}
        </section>

        {saved && <p className="muted small" role="status">{saved}</p>}
        <div className="form__actions">
          <button type="button" onClick={onClose}>{t("common.close")}</button>
          <button type="submit" className="primary" disabled={!cards.length} data-testid="flash-download">
            {t("flash.download")}
          </button>
        </div>
      </form>
    </Modal>,
    document.body,
  );
}
