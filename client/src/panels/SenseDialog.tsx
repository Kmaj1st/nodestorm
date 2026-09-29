import type { ConceptNode, Reliability, SourceRef } from "@nodestorm/shared";
import { ExternalLink } from "lucide-react";
import { Fragment, memo, useEffect, useId, useMemo, useRef, useState, type ReactNode } from "react";
import { listJoin, useLang, useT } from "../i18n";
import type { MessageKey } from "../i18n";
import { cancelTask, chooseSense, compareSources, relookupKey, replaceDefinition } from "../lib/actions";
import { siteLabel } from "../lib/export";
import { OWN_SOURCE, removeNode } from "../lib/graphOps";
import { mathRanges } from "../lib/math";
import { whenElement } from "../lib/whenElement";
import { allSourcesFailed, cachedSources, groupBySense, sourceRef, sourcesFromSenses, type Gathered, type Source } from "../lib/sources";
import { useGraphStore } from "../store/graphStore";
import { isReady, useSettings } from "../store/settingsStore";
import { Icon } from "../ui/Icon";
import { MathText } from "./MathText";
import { Modal } from "./Modal";

/**
 * "Sources for X": where a concept's definition can come from — the encyclopedias, wikis and web pages found for its
 * name, most reliable first, as the AI rated them against each other. The user picks the passage the AI points to in
 * one of them, selects other words of a source's text, or writes their own. The definition is always a source's own
 * words (saved with that source) or the user's: the AI never writes it.
 */
export function SenseDialog() {
  const clarifying = useGraphStore((s) => s.clarifying);
  const node = useGraphStore((s) =>
    s.clarifying ? s.graphs[s.clarifying.graphId]?.nodes.find((n) => n.id === s.clarifying!.nodeId) : undefined,
  );
  if (!clarifying || !node) return null;
  // Keyed so nothing picked or typed carries over to another concept. A new set of sources for the same concept (a
  // search finished while it was open) only drops what was picked among the old ones (see SourcesChoice).
  // Reopened from its badge: what this session found for the name, if it is still cached.
  const found = clarifying.sources ?? cachedSources(node.name);
  const set = found ? found.sources.map((s) => s.url ?? s.id).join("|") : (node.senses ?? []).map((x) => x.name).join("|");
  return <SourcesChoice key={`${clarifying.graphId}:${node.id}`} set={set} graphId={clarifying.graphId} node={node} found={found} replace={Boolean(clarifying.replace)} />;
}

type Choice = { kind: "passage"; id: string } | { kind: "selection"; id: string; text: string } | { kind: "own" };

const RELIABILITY_LABEL: Record<Reliability, MessageKey> = {
  high: "reliability.high",
  medium: "reliability.medium",
  low: "reliability.low",
  unusable: "reliability.unusable",
};

/** Longest text shown before "Show the whole text". */
const SHORT = 360;
/** Context kept around the passage in the short view. */
const AROUND = 90;
/** How far a cut looks for a space, so it doesn't split a word (Chinese has none: it cuts where it is). */
const WORD = 40;

/**
 * The short view's lengths for `text`: Chinese, Japanese and Korean pack about twice as much into a character, so
 * such a text is cut at half the length.
 */
function limits(text: string): { short: number; around: number } {
  const dense = (text.match(/[\u3040-\u30ff\u3400-\u9fff\uac00-\ud7af]/g)?.length ?? 0) > text.length / 3;
  return dense ? { short: SHORT / 2, around: AROUND / 2 } : { short: SHORT, around: AROUND };
}

function SourcesChoice({ graphId, node, found, replace, set }: { graphId: string; node: ConceptNode; found?: Gathered; replace: boolean; set: string }) {
  const t = useT();
  const lang = useLang(); // Chinese sentences follow each other without a space
  const setClarifying = useGraphStore((s) => s.setClarifying);
  const setSettingsOpen = useGraphStore((s) => s.setSettingsOpen);
  const mutate = useGraphStore((s) => s.mutate);
  const task = useGraphStore((s) => s.busy[relookupKey(graphId, node.id)]);
  const searching = Boolean(task);
  const unreachable = Boolean(found && allSourcesFailed(found));
  // Without an AI the sources aren't rated: the pop-up offers to set one up.
  const aiReady = useSettings(isReady);
  // Without a fresh search (reopened after a reload), the passages stored on the concept, not rated.
  const sources = useMemo(() => found?.sources ?? sourcesFromSenses(node.senses ?? []), [found, node.senses]);
  const groups = useMemo(() => groupBySense(sources), [sources]);
  const byId = (id: string) => sources.find((s) => s.id === id);
  const [choice, setChoice] = useState<Choice | null>(() => (sources.length ? null : { kind: "own" }));
  const [ownName, setOwnName] = useState("");
  const [ownDef, setOwnDef] = useState("");
  /** The source whose text was copied into "My own definition" ("Edit a copy"). */
  const [copyOf, setCopyOf] = useState<Source | null>(null);
  const [selection, setSelection] = useState<{ id: string; text: string } | null>(null);
  const [picked, setPicked] = useState<{ id: string; text: string } | null>(null);
  const [expanded, setExpanded] = useState<Set<string>>(() => new Set());
  /**
   * The source the keyboard is on (its radio or one of its actions had the focus last). Only its actions are Tab
   * stops, so Tab goes from the list to "Use this text" in a few steps whatever the number of sources: the arrow keys
   * move between sources (as between any radios), then Tab reaches that source's actions. A source without a passage
   * (its radio can't be picked) keeps its actions in the Tab order. Mouse, touch and a screen reader's reading mode
   * reach every action as before.
   */
  const [active, setActive] = useState<string | null>(null);
  const ownRef = useRef<HTMLTextAreaElement>(null);
  const uid = useId();

  // A new set of sources while open (the search started from the badge, or Search again, finished): a pick among the
  // old ones goes (their ids are reused by the new ones), what the user typed stays, and so does the dialog (its focus).
  const [shownSet, setShownSet] = useState(set);
  if (shownSet !== set) {
    setShownSet(set);
    const typed = choice?.kind === "own" && Boolean(ownDef.trim() || ownName.trim());
    setChoice(typed ? choice : sources.length ? null : { kind: "own" });
    setSelection(null);
    setPicked(null);
    setExpanded(new Set());
    setActive(null);
  }

  // What the user selected with the mouse or a finger, when it lies inside one source's text: exactly those
  // characters of the source (anything else, such as a selection across two sources, doesn't count). A drag fires
  // many selection changes: they are mapped once per frame, and the pop-up only re-renders when the text changed.
  useEffect(() => {
    let frame = 0;
    const map = () => {
      frame = 0;
      const sel = document.getSelection();
      let next: { id: string; text: string } | null = null;
      if (sel && !sel.isCollapsed && sel.rangeCount) {
        const holder = (n: Node | null) => (n instanceof Element ? n : n?.parentElement)?.closest<HTMLElement>("[data-source-text]");
        const a = holder(sel.anchorNode);
        const src = a && a === holder(sel.focusNode) ? sources.find((s) => s.id === a.dataset.sourceText) : undefined;
        const span = src && selectedSpan(a!, sel.getRangeAt(0));
        const text = src && span ? src.text.slice(span.from, span.to).trim() : "";
        if (src && text.length > 1) next = { id: src.id, text };
      }
      setSelection((cur) => (cur?.id === next?.id && cur?.text === next?.text ? cur : next));
    };
    const onChange = () => {
      frame ||= requestAnimationFrame(map);
    };
    document.addEventListener("selectionchange", onChange);
    return () => {
      document.removeEventListener("selectionchange", onChange);
      cancelAnimationFrame(frame);
    };
  }, [sources]);

  // "My own definition" opens its fields under the list: bring them into view (the pop-up scrolls on its own).
  const ownOpen = choice?.kind === "own";
  const ownBox = useRef<HTMLLabelElement>(null);
  const firstRender = useRef(true);
  useEffect(() => {
    if (firstRender.current) return void (firstRender.current = false);
    if (!ownOpen) return;
    const reduced = window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
    ownBox.current?.scrollIntoView({ block: "nearest", behavior: reduced ? "auto" : "smooth" });
  }, [ownOpen]);

  const copy = copyOf ?? undefined;
  // A copy cut down to a part of the source's text is still its words; any other change makes it the user's.
  const copyKept = Boolean(copy && ownDef.trim() && copy.text.includes(ownDef.trim()));

  /** The definition and source the current choice saves, or null when there is nothing to save yet. */
  const chosen = (): { name: string; definition: string; source: SourceRef } | null => {
    if (!choice) return null;
    const nameOf = (s: Source) => (s.kind === "encyclopedia" && s.name?.trim() ? s.name : node.name);
    if (choice.kind === "own") {
      const definition = ownDef.trim();
      if (!definition) return null;
      return { name: ownName.trim() || node.name, definition, source: copy && copyKept ? sourceRef(copy) : OWN_SOURCE };
    }
    const src = byId(choice.id);
    const definition = choice.kind === "selection" ? choice.text : src?.passage;
    return src && definition ? { name: nameOf(src), definition, source: sourceRef(src) } : null;
  };
  const result = chosen();

  // A waiting concept stays "unclear"; its badge reopens this. A search still running for it is stopped ("Later").
  const close = () => {
    if (searching) cancelTask(relookupKey(graphId, node.id));
    setClarifying(null);
  };
  const confirm = () => {
    if (!result) return;
    if (replace) replaceDefinition(graphId, node.id, result);
    else chooseSense(graphId, node.id, { name: result.name, definition: result.definition, source: result.source });
  };
  const remove = () => {
    mutate((g) => removeNode(g, node.id), graphId);
    setClarifying(null);
  };
  const useSelection = () => {
    if (!selection) return;
    setPicked(selection);
    setChoice({ kind: "selection", ...selection });
    document.getSelection()?.removeAllRanges();
  };
  const editCopy = (s: Source) => {
    setOwnDef(s.text);
    setCopyOf(s);
    setChoice({ kind: "own" });
    requestAnimationFrame(() => ownRef.current?.focus());
  };
  const toggle = (id: string) =>
    setExpanded((cur) => {
      const next = new Set(cur);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  // Settings opens over this pop-up (what was picked or typed stays), scrolled to its Web search part.
  // The wait for that part (Settings and it may still be loading) ends when found, after 5 s, or when this pop-up goes.
  const stopWaiting = useRef<() => void>(undefined);
  useEffect(() => () => stopWaiting.current?.(), []);
  const openSearchSettings = () => {
    setSettingsOpen(true);
    stopWaiting.current?.();
    stopWaiting.current = whenElement(
      () => document.querySelector<HTMLElement>('[data-testid="web-search-settings"]'),
      (part) => part.scrollIntoView({ block: "start" }),
      { timeoutMs: 5000 },
    );
  };
  // The same, at its AI part (the provider and its key). Two frames after it appears, so the dialog has focused its
  // first field (which scrolls it to the top) by then.
  const openAiSettings = () => {
    setSettingsOpen(true);
    stopWaiting.current?.();
    stopWaiting.current = whenElement(
      () => document.querySelector<HTMLElement>('[data-testid="ai-settings"]'),
      (part) => requestAnimationFrame(() => requestAnimationFrame(() => part.scrollIntoView({ block: "start" }))),
      { timeoutMs: 5000 },
    );
  };
  const on = (id: string) => choice?.kind !== "own" && choice?.id === id;
  const pickedSource = picked ? byId(picked.id) : undefined;
  const sp = lang === "zh" ? "" : " ";

  return (
    <Modal
      label={t("sources.dialog")}
      title={t("sources.title", { name: node.name })}
      onClose={close}
      className="sources-dialog"
      dirty={choice?.kind === "own" && Boolean(ownDef.trim() || ownName.trim())}
    >
      {/* With nothing found there is no passage to pick: the "nothing found" line below says what to do instead. */}
      {(sources.length > 0 || searching) && <p className="muted small">{t(replace ? "sources.introReplace" : "sources.intro")}</p>}
      {found?.rated && found.note && (
        <section className="sources__note small" aria-label={t("sources.assessment")} data-testid="sources-note">
          <b>{t("common.label", { label: t("sources.assessment") })}</b>{sp}{found.note}
        </section>
      )}
      {found && !found.rated && sources.length > 0 && (
        <p className="sources__unrated small muted" data-testid="sources-unrated">
          {found.assessError ? t("sources.assessFailed", { error: found.assessError }) : t("sources.notRated")}
        </p>
      )}
      {!found && searching && (
        <p className="small sources__searching" role="status" data-testid="sources-searching">
          <span className="spinner spinner--xs" aria-hidden="true" />
          {task?.phase === "rating" ? t("task.assess", { name: node.name }) : t("sources.searching", { name: node.name })}
        </p>
      )}
      {!found && !searching && sources.length > 0 && (
        <p className="small muted">{t(sources.some((s) => s.reliability) ? "sources.storedRated" : "sources.stored")}</p>
      )}
      {!sources.length && !(searching && !found) && (
        <p className="small" data-testid="sources-nothing" role={unreachable ? "alert" : undefined}>
          {unreachable
            ? t("sources.allFailed")
            : found || node.senses
              ? t(aiReady ? "sources.nothing" : "sources.nothingNoAi", { name: node.name })
              : t("sense.nothingOff")}
        </p>
      )}

      <div className="sources" role="radiogroup" aria-label={t("sources.list")} aria-describedby={sources.length > 1 ? `${uid}-keys` : undefined}>
        {sources.length > 1 && <span id={`${uid}-keys`} className="sr-only">{t("sources.keys")}</span>}
        {groups.map((grp, gi) => (
          <Fragment key={grp.sense || `g${gi}`}>
            {groups.length > 1 && (
              <h3 className="sources__meaning small">
                {grp.sense ? t("sources.meaning", { sense: grp.sense }) : t(grp.sources.some((s) => s.reliability) ? "sources.otherMeaning" : "reliability.none")}
              </h3>
            )}
            {grp.sources.map((s) => {
              const id = `${uid}-${s.id}`;
              const long = s.text.length > limits(s.text).short;
              const open = expanded.has(s.id);
              // Out of the Tab order unless the keyboard is on this source; each names its source for screen readers.
              const tab = !s.passage || active === s.id ? undefined : -1;
              const site = siteLabel(s.site);
              const of = (action: string) => t("sources.actionOf", { action, site });
              return (
                <div
                  key={s.id}
                  className={`src${on(s.id) ? " src--on" : ""}`}
                  data-testid="source-item"
                  data-site={s.site}
                  onFocus={() => setActive(s.id)}
                >
                  <div className="src__head">
                    <input
                      type="radio"
                      id={id}
                      name={`${uid}-source`}
                      checked={choice?.kind === "passage" && choice.id === s.id}
                      disabled={!s.passage}
                      onChange={() => setChoice({ kind: "passage", id: s.id })}
                      aria-describedby={`${id}-text`}
                    />
                    <label htmlFor={id} className="src__label">
                      <span className="src__site">{site}</span>
                      {/* An encyclopedia entry by its own name (Wikidata's page title is only an id). */}
                      {(s.kind === "encyclopedia" && s.name?.trim() ? s.name : s.title) !== s.site && (
                        <span className="src__title">{s.kind === "encyclopedia" && s.name?.trim() ? s.name : s.title}</span>
                      )}
                    </label>
                    <span
                      className={`src__rel src__rel--${s.reliability ?? "none"}`}
                      data-testid="source-reliability"
                      title={s.reasons || undefined}
                    >
                      {t(s.reliability ? RELIABILITY_LABEL[s.reliability] : "reliability.none")}
                    </span>
                  </div>
                  {s.reasons && (
                    <details className="src__why small">
                      <summary tabIndex={tab} aria-label={of(t("sources.why"))}>{t("sources.why")}</summary>
                      <p data-testid="source-reasons">{s.reasons}</p>
                    </details>
                  )}
                  <div
                    className="src__text small"
                    id={`${id}-text`}
                    data-source-text={s.id}
                    data-testid="source-text"
                  >
                    <SourceText source={s} full={open || !long} markTitle={t(s.pointed ? "sources.passageAi" : "sources.passageLead")} />
                  </div>
                  {!s.passage && <p className="small muted">{t("sources.noPassage")}</p>}
                  <div className="src__actions small">
                    {s.url && (
                      <a href={s.url} target="_blank" rel="noopener noreferrer" className="src__link" tabIndex={tab} aria-label={t("sources.newTab", { title: s.title || s.site })}>
                        {t("sources.open")}
                        <Icon icon={ExternalLink} size={12} />
                      </a>
                    )}
                    {long && (
                      <button
                        type="button"
                        className="link"
                        tabIndex={tab}
                        aria-label={of(t(open ? "sources.showLess" : "sources.showAll"))}
                        aria-expanded={open}
                        aria-controls={`${id}-text`}
                        onClick={() => toggle(s.id)}
                      >
                        {t(open ? "sources.showLess" : "sources.showAll")}
                      </button>
                    )}
                    <button
                      type="button"
                      className="link"
                      tabIndex={tab}
                      aria-label={of(t("sources.editCopy"))}
                      title={t("sources.editCopyTitle")}
                      onClick={() => editCopy(s)}
                      data-testid="source-edit-copy"
                    >
                      {t("sources.editCopy")}
                    </button>
                  </div>
                </div>
              );
            })}
          </Fragment>
        ))}

        {picked && pickedSource && (
          <label className={`sense${choice?.kind === "selection" ? " sense--on" : ""}`} data-testid="source-selection" onFocus={() => setActive(null)}>
            <input
              type="radio"
              name={`${uid}-source`}
              checked={choice?.kind === "selection"}
              onChange={() => setChoice({ kind: "selection", ...picked })}
            />
            <span>
              <b>{t("sources.selectionFrom", { site: siteLabel(pickedSource.site) })}</b>
              <span className="small src__quote">{picked.text}</span>
            </span>
          </label>
        )}

        <label ref={ownBox} className={`sense${choice?.kind === "own" ? " sense--on" : ""}`} onFocus={() => setActive(null)}>
          <input type="radio" name={`${uid}-source`} checked={choice?.kind === "own"} onChange={() => setChoice({ kind: "own" })} data-testid="source-own" />
          <span className="sense__other">
            <b>{t("sense.own")}</b>
            {choice?.kind === "own" && (
              <>
                {!replace && (
                  <input
                    value={ownName}
                    onChange={(e) => setOwnName(e.target.value)}
                    placeholder={t("sense.otherName", { name: node.name })}
                    aria-label={t("sense.otherNameAria")}
                  />
                )}
                <textarea
                  ref={ownRef}
                  autoFocus={!sources.length}
                  rows={copy ? 5 : 3}
                  value={ownDef}
                  onChange={(e) => setOwnDef(e.target.value)}
                  placeholder={t("def.placeholder")}
                  aria-label={t("sense.ownDefAria")}
                  aria-describedby={copy ? `${uid}-copy` : undefined}
                  data-testid="source-own-text"
                />
                {copy && ownDef.trim() && (
                  <span id={`${uid}-copy`} className={`small src__copy${copyKept ? "" : " src__copy--changed"}`} role="status" data-testid="source-copy-note">
                    {t(copyKept ? "sources.copyExact" : "sources.copyChanged", { site: siteLabel(copy.site) })}
                  </span>
                )}
              </>
            )}
          </span>
        </label>
      </div>

      {sources.length > 0 && (
        <div className="sources__select small">
          <span className="muted">{t("sources.selectHint")}</span>
          <button
            type="button"
            className="small-btn"
            // Keep the selection: pressing the button must not clear it first.
            onMouseDown={(e) => e.preventDefault()}
            onClick={useSelection}
            disabled={!selection}
            title={selection ? undefined : t("sources.selectFirst")}
            data-testid="source-use-selection"
          >
            {t("sources.useSelection")}
          </button>
        </div>
      )}

      {result && (
        <div className="sources__preview small" data-testid="source-preview">
          <span className="muted">
            {t("common.label", { label: t("sources.savedAs") })}{" "}
            {result.source.site === OWN_SOURCE.site ? t("source.you") : siteLabel(result.source.site ?? "")}
          </span>
          <MathText text={result.definition} />
        </div>
      )}

      <p className="small muted sources__searched" data-testid="sense-searched">
        {found && found.asked.length > 0 && t("sources.searched", { sites: listJoin(found.asked) })}
        {found && found.failed.length > 0 && <>{sp}{t("sense.failed", { sites: listJoin(found.failed) })}</>}
      </p>
      <div className="sources__engine small">
        {found && !found.web && <span className="muted">{t("sources.noEngine")}</span>}
        {/* An explicit Search again also asks the search engines past their 30-day cache. */}
        <button
          type="button"
          className="small-btn"
          disabled={searching}
          onClick={() => void compareSources(node.id, graphId, { fresh: true, requery: true })}
          aria-describedby={found?.web ? `${uid}-quota` : undefined}
          data-testid="sources-search-again"
        >
          {t("sources.searchAgain")}
        </button>
        {found?.web && <span id={`${uid}-quota`} className="muted" data-testid="sources-quota">{t("sources.searchQuota")}</span>}
        {(!found || !found.web || unreachable) && (
          <button type="button" className="small-btn" onClick={openSearchSettings} data-testid="sources-settings">
            {t("sources.openSettings")}
          </button>
        )}
        {!aiReady && (
          <button type="button" className="small-btn" onClick={openAiSettings} data-testid="sources-setup-ai">
            {t("sources.setUpAi")}
          </button>
        )}
      </div>

      <div className="form__actions">
        {!replace && <button className="link small" onClick={remove}>{t("sense.remove")}</button>}
        <span className="spacer" />
        <button onClick={close}>{t(replace ? "common.cancel" : "sense.later")}</button>
        <button
          className="primary"
          onClick={confirm}
          disabled={!result}
          title={result ? undefined : t(choice?.kind === "own" ? "sense.writeFirst" : "sense.pickFirst")}
          data-testid="source-use"
        >
          {t("sources.use")}
        </button>
      </div>
    </Modal>
  );
}

/**
 * Where a selection inside a source's text (`holder`) starts and ends in that text. Every shown piece carries the
 * offsets of the characters it stands for (`data-from`, and `data-to` on a typeset formula), so what the user selects
 * maps back to the source's own characters; a selection that starts or ends inside a formula takes the whole formula.
 */
function selectedSpan(holder: HTMLElement, range: Range): { from: number; to: number } | null {
  const pieces = [...holder.querySelectorAll<HTMLElement>("[data-from]")];
  if (!pieces.length) return null;
  const at = (node: Node, offset: number, end: boolean): number | null => {
    const el = (node instanceof Element ? node : node.parentElement)?.closest<HTMLElement>("[data-from]");
    if (el && holder.contains(el)) {
      const from = Number(el.dataset.from);
      if (el.dataset.to) return end ? Number(el.dataset.to) : from; // a formula: all of it
      // A text piece: a single text node, or the element itself with the offset counting its children.
      if (node.nodeType === Node.TEXT_NODE) return from + offset;
      return offset === 0 ? from : from + (el.textContent ?? "").length;
    }
    // Outside every piece (the "…" of a shortened text, or the holder itself): the edge of the nearest piece inside
    // the selection.
    const follows = (p: Element) => (node.compareDocumentPosition(p) & Node.DOCUMENT_POSITION_FOLLOWING) !== 0;
    if (!end) {
      const next = pieces.find(follows);
      return next ? Number(next.dataset.from) : null;
    }
    const prev = [...pieces].reverse().find((p) => (!follows(p) || node.contains(p)) && !p.contains(node));
    return prev ? Number(prev.dataset.to ?? Number(prev.dataset.from) + (prev.textContent ?? "").length) : null;
  };
  // A boundary between an element's children (offset counts children): the child it touches, from its start or end.
  const edge = (node: Node, offset: number, end: boolean): number | null => {
    if (node.nodeType === Node.ELEMENT_NODE && !(node as Element).closest("[data-from]")) {
      const child = node.childNodes[end ? offset - 1 : offset];
      if (child) return at(child, end ? child.childNodes.length || (child.textContent ?? "").length : 0, end);
    }
    return at(node, offset, end);
  };
  const from = edge(range.startContainer, range.startOffset, false);
  const to = edge(range.endContainer, range.endOffset, true);
  return from !== null && to !== null && to > from ? { from, to } : null;
}

/** The characters [from, to) of `text`, formulas typeset; each piece says which characters it stands for. */
function Pieces({ text, from, to, formulas }: { text: string; from: number; to: number; formulas: { from: number; to: number }[] }) {
  const out: ReactNode[] = [];
  let at = from;
  for (const f of formulas) {
    if (f.to <= at || f.from >= to) continue;
    if (f.from < at || f.to > to) continue; // a formula cut by the passage's edge stays as its source
    if (f.from > at) out.push(<span key={at} data-from={at}>{text.slice(at, f.from)}</span>);
    out.push(
      <span key={f.from} className="src__math" data-from={f.from} data-to={f.to}>
        <MathText text={text.slice(f.from, f.to)} inline />
      </span>,
    );
    at = f.to;
  }
  if (at < to) out.push(<span key={at} data-from={at}>{text.slice(at, to)}</span>);
  return <>{out}</>;
}

/**
 * A source's text, formulas typeset, the passage marked. What the user selects still maps back to exactly the source's
 * characters (see selectedSpan). Short: the passage with some context around it, the cut-off parts as "…" that can't
 * be selected. Memoized: typing a definition or selecting words re-renders the pop-up, not every source's text.
 */
const SourceText = memo(function SourceText({ source, full, markTitle }: { source: Source; full: boolean; markTitle: string }) {
  const { text, passage } = source;
  const formulas = useMemo(() => mathRanges(text), [text]);
  const at = passage ? text.indexOf(passage) : -1;
  let from = 0;
  let to = text.length;
  if (!full) {
    const { short, around } = limits(text);
    if (at >= 0) {
      from = Math.max(0, at - around);
      to = Math.min(text.length, Math.max(at + passage.length + around, from + short));
    } else to = Math.min(text.length, short);
    // Cut at spaces, not inside words: the start after the next space, the end at the next space (when one is near;
    // never into the passage).
    if (from > 0 && /\S/.test(text[from - 1])) {
      const sp = text.indexOf(" ", from);
      if (sp >= 0 && sp - from < WORD && (at < 0 || sp < at)) from = sp + 1;
    }
    if (to < text.length) {
      const sp = text.indexOf(" ", to);
      if (sp < 0 ? text.length - to < WORD : sp - to < WORD) to = sp < 0 ? text.length : sp;
    }
    // Nor inside a formula.
    for (const f of formulas) {
      if (f.from < from && f.to > from) from = f.from;
      if (f.from < to && f.to > to) to = f.to;
    }
  }
  const markFrom = at >= 0 ? Math.max(at, from) : to;
  const markTo = at >= 0 ? Math.min(at + passage.length, to) : to;
  const p = (a: number, b: number) => (b > a ? <Pieces text={text} from={a} to={b} formulas={formulas} /> : null);
  return (
    <>
      {from > 0 && <span className="src__cut" aria-hidden="true">… </span>}
      {p(from, at >= 0 ? markFrom : to)}
      {markTo > markFrom && <mark title={markTitle} data-testid="source-passage">{p(markFrom, markTo)}</mark>}
      {at >= 0 && p(markTo, to)}
      {to < text.length && <span className="src__cut" aria-hidden="true"> …</span>}
    </>
  );
});
