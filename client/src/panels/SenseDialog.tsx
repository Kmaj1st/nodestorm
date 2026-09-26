import type { ConceptNode, Reliability, SourceRef } from "@nodestorm/shared";
import { ExternalLink } from "lucide-react";
import { Fragment, useEffect, useId, useMemo, useRef, useState } from "react";
import { listJoin, useLang, useT } from "../i18n";
import type { MessageKey } from "../i18n";
import { chooseSense, compareSources, relookupKey, replaceDefinition } from "../lib/actions";
import { OWN_SOURCE, removeNode } from "../lib/graphOps";
import { cachedSources, groupBySense, sourceRef, sourcesFromSenses, type Gathered, type Source } from "../lib/sources";
import { useGraphStore } from "../store/graphStore";
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
  // Keyed so a picked passage or typed text never carries over to another concept or a new set of sources.
  // Reopened from its badge: what this session found for the name, if it is still cached.
  const found = clarifying.sources ?? cachedSources(node.name);
  const key = `${clarifying.graphId}:${node.id}:${found ? found.sources.map((s) => s.url ?? s.id).join("|") : (node.senses ?? []).map((x) => x.name).join("|")}`;
  return <SourcesChoice key={key} graphId={clarifying.graphId} node={node} found={found} replace={Boolean(clarifying.replace)} />;
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

function SourcesChoice({ graphId, node, found, replace }: { graphId: string; node: ConceptNode; found?: Gathered; replace: boolean }) {
  const t = useT();
  const lang = useLang(); // Chinese sentences follow each other without a space
  const setClarifying = useGraphStore((s) => s.setClarifying);
  const setSettingsOpen = useGraphStore((s) => s.setSettingsOpen);
  const mutate = useGraphStore((s) => s.mutate);
  const searching = useGraphStore((s) => Boolean(s.busy[relookupKey(graphId, node.id)]));
  // Without a fresh search (reopened after a reload), the passages stored on the concept, not rated.
  const sources = useMemo(() => found?.sources ?? sourcesFromSenses(node.senses ?? []), [found, node.senses]);
  const groups = useMemo(() => groupBySense(sources), [sources]);
  const byId = (id: string) => sources.find((s) => s.id === id);
  const [choice, setChoice] = useState<Choice | null>(() => (sources.length ? null : { kind: "own" }));
  const [ownName, setOwnName] = useState("");
  const [ownDef, setOwnDef] = useState("");
  /** The source whose text was copied into "My own definition" ("Edit a copy"). */
  const [copyOf, setCopyOf] = useState<string | null>(null);
  const [selection, setSelection] = useState<{ id: string; text: string } | null>(null);
  const [picked, setPicked] = useState<{ id: string; text: string } | null>(null);
  const [expanded, setExpanded] = useState<Set<string>>(() => new Set());
  const ownRef = useRef<HTMLTextAreaElement>(null);
  const uid = useId();

  // What the user selected with the mouse or a finger, when it lies inside one source's text: exactly those
  // characters of the source (anything else, such as a selection across two sources, doesn't count).
  useEffect(() => {
    const onChange = () => {
      const sel = document.getSelection();
      if (!sel || sel.isCollapsed || !sel.rangeCount) return setSelection(null);
      const holder = (n: Node | null) => (n instanceof Element ? n : n?.parentElement)?.closest<HTMLElement>("[data-source-text]");
      const a = holder(sel.anchorNode);
      if (!a || a !== holder(sel.focusNode)) return setSelection(null);
      const src = sources.find((s) => s.id === a.dataset.sourceText);
      const text = sel.toString().trim();
      setSelection(src && text.length > 1 && src.text.includes(text) ? { id: src.id, text } : null);
    };
    document.addEventListener("selectionchange", onChange);
    return () => document.removeEventListener("selectionchange", onChange);
  }, [sources]);

  const copy = copyOf ? byId(copyOf) : undefined;
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

  const close = () => setClarifying(null); // a waiting concept stays "unclear"; its badge reopens this
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
    setCopyOf(s.id);
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
  const openSearchSettings = () => {
    setSettingsOpen(true);
    let tries = 0;
    const scroll = () => {
      const part = document.querySelector<HTMLElement>('[data-testid="web-search-settings"]');
      if (part) part.scrollIntoView({ block: "start" });
      else if (++tries < 40) setTimeout(scroll, 50);
    };
    scroll();
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
      <p className="muted small">{t(replace ? "sources.introReplace" : "sources.intro")}</p>
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
      {!found && sources.length > 0 && <p className="small muted">{t("sources.stored")}</p>}
      {!sources.length && (
        <p className="small" data-testid="sources-nothing">
          {found || node.senses ? t("sources.nothing", { name: node.name }) : t("sense.nothingOff")}
        </p>
      )}

      <div className="sources" role="radiogroup" aria-label={t("sources.list")}>
        {groups.map((grp, gi) => (
          <Fragment key={grp.sense || `g${gi}`}>
            {groups.length > 1 && (
              <h3 className="sources__meaning small">
                {grp.sense ? t("sources.meaning", { sense: grp.sense }) : t("reliability.none")}
              </h3>
            )}
            {grp.sources.map((s) => {
              const id = `${uid}-${s.id}`;
              const long = s.text.length > SHORT;
              const open = expanded.has(s.id);
              return (
                <div key={s.id} className={`src${on(s.id) ? " src--on" : ""}`} data-testid="source-item" data-site={s.site}>
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
                      <span className="src__site">{s.site}</span>
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
                      <summary>{t("sources.why")}</summary>
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
                      <a href={s.url} target="_blank" rel="noopener noreferrer" className="src__link" aria-label={t("sources.newTab", { title: s.title || s.site })}>
                        {t("sources.open")}
                        <Icon icon={ExternalLink} size={12} />
                      </a>
                    )}
                    {long && (
                      <button type="button" className="link" aria-expanded={open} aria-controls={`${id}-text`} onClick={() => toggle(s.id)}>
                        {t(open ? "sources.showLess" : "sources.showAll")}
                      </button>
                    )}
                    <button type="button" className="link" title={t("sources.editCopyTitle")} onClick={() => editCopy(s)} data-testid="source-edit-copy">
                      {t("sources.editCopy")}
                    </button>
                  </div>
                </div>
              );
            })}
          </Fragment>
        ))}

        {picked && pickedSource && (
          <label className={`sense${choice?.kind === "selection" ? " sense--on" : ""}`} data-testid="source-selection">
            <input
              type="radio"
              name={`${uid}-source`}
              checked={choice?.kind === "selection"}
              onChange={() => setChoice({ kind: "selection", ...picked })}
            />
            <span>
              <b>{t("sources.selectionFrom", { site: pickedSource.site })}</b>
              <span className="small src__quote">{picked.text}</span>
            </span>
          </label>
        )}

        <label className={`sense${choice?.kind === "own" ? " sense--on" : ""}`}>
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
                    {t(copyKept ? "sources.copyExact" : "sources.copyChanged", { site: copy.site })}
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
            {result.source.site === OWN_SOURCE.site ? t("source.you") : result.source.site}
          </span>
          <MathText text={result.definition} />
        </div>
      )}

      <p className="small muted sources__searched" data-testid="sense-searched">
        {found && found.asked.length > 0 && t("sources.searched", { sites: listJoin(found.asked) })}
        {found && found.failed.length > 0 && <>{sp}{t("sense.failed", { sites: listJoin(found.failed) })}</>}
      </p>
      {(!found || !found.web) && (
        <div className="sources__engine small">
          {found && !found.web && <span className="muted">{t("sources.noEngine")}</span>}
          {!found && (
            <button type="button" className="small-btn" disabled={searching} onClick={() => void compareSources(node.id, graphId)} data-testid="sources-search-again">
              {t("sources.searchAgain")}
            </button>
          )}
          <button type="button" className="small-btn" onClick={openSearchSettings} data-testid="sources-settings">
            {t("sources.openSettings")}
          </button>
        </div>
      )}

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
 * A source's text as plain characters (so what the user selects is exactly the source's text), the passage marked.
 * Short: the passage with some context around it, the cut-off parts as "…" that can't be selected.
 */
function SourceText({ source, full, markTitle }: { source: Source; full: boolean; markTitle: string }) {
  const { text, passage } = source;
  const at = passage ? text.indexOf(passage) : -1;
  let from = 0;
  let to = text.length;
  if (!full) {
    if (at >= 0) {
      from = Math.max(0, at - AROUND);
      to = Math.min(text.length, Math.max(at + passage.length + AROUND, from + SHORT));
    } else to = Math.min(text.length, SHORT);
    // Cut at spaces, not inside words.
    if (from > 0) from = Math.max(from, text.lastIndexOf(" ", from) + 1);
    if (to < text.length) {
      const sp = text.indexOf(" ", to);
      to = sp < 0 ? text.length : sp;
    }
  }
  const before = at >= 0 ? text.slice(from, Math.max(from, at)) : text.slice(from, to);
  const mark = at >= 0 ? text.slice(Math.max(at, from), Math.min(at + passage.length, to)) : "";
  const after = at >= 0 ? text.slice(Math.min(at + passage.length, to), to) : "";
  return (
    <>
      {from > 0 && <span className="src__cut" aria-hidden="true">… </span>}
      {before}
      {mark && <mark title={markTitle} data-testid="source-passage">{mark}</mark>}
      {after}
      {to < text.length && <span className="src__cut" aria-hidden="true"> …</span>}
    </>
  );
}
