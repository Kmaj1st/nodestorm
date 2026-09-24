import { EXTRACT_MAX_CHARS } from "@nodestorm/shared";
import { ArrowLeft, FileUp, Plus, ScanText } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { Icon } from "../ui/Icon";
import { t as tr, useT, type MessageKey } from "../i18n";
import { cancelTask, extractFromText, insertExtraction } from "../lib/actions";
import { buildReview, duplicateOf, linkUsable, newItems, type ExtractItem, type ExtractReview } from "../lib/extract";
import { activeGraph, useGraphStore } from "../store/graphStore";
import { MathText } from "./MathText";
import { Modal } from "./Modal";

const ROLE: Record<string, MessageKey> = { uses: "extract.roleUses", derives: "extract.roleDerives", assumes: "extract.roleAssumes" };

/** Plain-text files people keep notes in; anything else dropped on the box is refused with a message. */
const isTextFile = (f: File) => /^text\//.test(f.type) || /\.(txt|md|markdown|text)$/i.test(f.name);

/**
 * "Extract from text": paste (or drop / load a .txt or .md file) some notes, let the AI pick out concepts and the
 * relations the text states, then review them. Candidates that duplicate a concept in the graph are unticked and link
 * to that concept instead. "Add selected" adds everything ticked as one undo step.
 */
export function ExtractDialog({
  onClose,
  initial,
}: {
  onClose: () => void;
  /** Start at the review with these candidates (LaTeX import: lib/texImport.ts) instead of asking the AI. */
  initial?: { review: ExtractReview; title: string };
}) {
  const t = useT();
  const graph = useGraphStore(activeGraph);
  const busy = useGraphStore((s) => Boolean(s.busy.extract));
  const [text, setText] = useState("");
  const [focus, setFocus] = useState("");
  const [review, setReview] = useState<ExtractReview | null>(initial?.review ?? null);
  const [fileError, setFileError] = useState<string | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const tooLong = text.length > EXTRACT_MAX_CHARS;
  // Closing the dialog drops an extraction that is still running.
  useEffect(() => () => cancelTask("extract"), []);

  const loadFile = async (f: File | undefined) => {
    if (!f) return;
    if (!isTextFile(f)) return setFileError(tr("extract.notText", { name: f.name }));
    setFileError(null);
    setText(await f.text());
  };

  const run = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!text.trim() || tooLong) return;
    const res = await extractFromText(text, focus);
    if (res) setReview(buildReview(graph, res));
  };

  const setItem = (i: number, patch: Partial<ExtractItem>) =>
    review && setReview({ ...review, items: review.items.map((it, j) => (j === i ? { ...it, ...patch } : it)) });
  const setLink = (i: number, include: boolean) =>
    review && setReview({ ...review, links: review.links.map((l, j) => (j === i ? { ...l, include } : l)) });

  const adding = review ? newItems(graph, review.items).length : 0;
  const linking = review ? review.links.filter((l) => l.include && linkUsable(graph, review.items, l)).length : 0;
  const add = () => {
    if (!review) return;
    insertExtraction(review);
    onClose();
  };

  return (
    <Modal
      label={initial ? t("texImport.title", { title: initial.title }) : t("extract.title")}
      title={initial ? t("texImport.title", { title: initial.title }) : t("extract.title")}
      onClose={onClose}
      className="extract"
    >
      {!review ? (
        <form className="form" onSubmit={run}>
          <p className="muted small">{t("extract.intro")}</p>
          <label>
            {t("extract.textLabel")}
            <textarea
              autoFocus
              rows={10}
              value={text}
              onChange={(e) => setText(e.target.value)}
              onDragOver={(e) => e.preventDefault()}
              onDrop={(e) => {
                const f = e.dataTransfer.files[0];
                if (!f) return;
                e.preventDefault();
                void loadFile(f);
              }}
              placeholder={t("extract.placeholder")}
              aria-label={t("extract.textLabel")}
              aria-invalid={tooLong}
            />
          </label>
          <div className="extract__meta small">
            <span className={tooLong ? "error" : "muted"}>
              {tooLong ? t("extract.tooLong", { max: EXTRACT_MAX_CHARS }) : t("extract.count", { n: text.length, max: EXTRACT_MAX_CHARS })}
            </span>
            <button type="button" className="link link--icon" onClick={() => fileRef.current?.click()}>
              <Icon icon={FileUp} size={14} />{t("extract.loadFile")}
            </button>
          </div>
          {fileError && <p className="error small">{fileError}</p>}
          <input
            ref={fileRef}
            type="file"
            accept=".txt,.md,.markdown,text/plain,text/markdown"
            hidden
            onChange={(e) => { void loadFile(e.target.files?.[0]); e.target.value = ""; }}
          />
          <label>
            <span>{t("extract.focus")} <span className="muted">{t("add.optional")}</span></span>
            <input value={focus} onChange={(e) => setFocus(e.target.value)} placeholder={t("extract.focusPlaceholder")} maxLength={500} />
          </label>
          <div className="form__actions">
            <button type="button" onClick={onClose}>{t("common.cancel")}</button>
            {busy && <button type="button" className="link" onClick={() => cancelTask("extract")}>{t("add.stop")}</button>}
            <button type="submit" className="primary" disabled={!text.trim() || tooLong || busy}>
              {busy ? <span className="spinner spinner--xs" aria-hidden="true" /> : <Icon icon={ScanText} size={14} />}
              {busy ? t("extract.extracting") : t("extract.run")}
            </button>
          </div>
        </form>
      ) : (
        <>
          <p className="muted small">{t(initial ? "texImport.intro" : "extract.reviewIntro")}</p>
          <h4 className="extract__head">{t("extract.concepts", { n: review.items.length })}</h4>
          {review.items.length === 0 && <p className="muted">{t("extract.none")}</p>}
          <ul className="extract__list" aria-label={t("extract.concepts", { n: review.items.length })}>
            {review.items.map((it, i) => {
              const dup = duplicateOf(graph, it);
              return (
                <li key={it.source} className={dup ? "extract__item extract__item--dup" : "extract__item"} data-testid={`extract-${it.source}`}>
                  <input
                    type="checkbox"
                    checked={it.include && !dup}
                    disabled={Boolean(dup)}
                    onChange={(e) => setItem(i, { include: e.target.checked })}
                    aria-label={t("extract.include", { name: it.name })}
                  />
                  <div className="extract__body">
                    <input
                      className="extract__name"
                      value={it.name}
                      onChange={(e) => setItem(i, { name: e.target.value })}
                      aria-label={t("extract.rename", { name: it.source })}
                    />
                    {dup && <div className="extract__dup small">{t("extract.duplicate", { name: dup.name })}</div>}
                    {it.definition && <div className="muted small"><MathText text={it.definition} /></div>}
                    {it.quote && <blockquote className="extract__quote small">“<MathText text={it.quote} />”</blockquote>}
                  </div>
                </li>
              );
            })}
          </ul>
          {review.links.length > 0 && (
            <>
              <h4 className="extract__head">{t("extract.links", { n: review.links.length })}</h4>
              <ul className="extract__list">
                {review.links.map((l, i) => {
                  const usable = linkUsable(graph, review.items, l);
                  const label = l.role
                    ? t("extract.needs", { a: l.from, b: l.to, role: t(ROLE[l.role]) })
                    : `${l.from} → ${l.to}: ${l.aToB.kind}`;
                  return (
                    <li key={i} className="extract__link">
                      <label className="check" title={usable ? l.aToB.explanation : t("extract.linkUnusable")}>
                        <input type="checkbox" checked={l.include && usable} disabled={!usable} onChange={(e) => setLink(i, e.target.checked)} />
                        <span className={usable ? "small" : "small muted"}>{label}</span>
                      </label>
                    </li>
                  );
                })}
              </ul>
            </>
          )}
          <div className="form__actions">
            {!initial && <button className="form__lead" onClick={() => setReview(null)}><Icon icon={ArrowLeft} size={14} />{t("extract.back")}</button>}
            <button onClick={onClose}>{t("common.cancel")}</button>
            <button className="primary" disabled={!adding && !linking} onClick={add}>
              <Icon icon={Plus} size={14} />
              {t("extract.add", { n: adding, links: linking })}
            </button>
          </div>
        </>
      )}
    </Modal>
  );
}
