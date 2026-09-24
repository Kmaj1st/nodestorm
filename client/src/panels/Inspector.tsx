import { isTheoremLike, leanEditorUrl, loogleSearchUrl, mathlibDocUrl, type ConceptKind, type ConceptNode, type ExplainLevel, ExplainVoice, type Graph, type RelationOrigin } from "@nodestorm/shared";
import {
  ArrowDown,
  ArrowLeftRight,
  ArrowRight,
  BookOpen,
  ChevronRight,
  Drama,
  ExternalLink,
  GraduationCap,
  PenLine,
  Highlighter,
  ListTree,
  Presentation,
  RefreshCw,
  Search,
  Sparkles,
  Trash2,
  TriangleAlert,
  Wand2,
} from "lucide-react";
import { useEffect, useState } from "react";
import { rich, useLang, useT, type MessageKey } from "../i18n";
import {
  analyzeNode,
  anatomyKey,
  anatomyNode,
  cancelTask,
  explainKey,
  explainNode,
  findInMathlib,
  mathlibKey,
  installAllKey,
  installAllMissing,
  installDep,
  mix,
  relookup,
  relookupKey,
  resolveCycle,
} from "../lib/actions";
import { removeDependency, removeNode, removeRelation, renameNode, setKind, updateNode, updateRelation } from "../lib/graphOps";
import { sourceLabel } from "../lib/export";
import { KIND_LABEL, KINDS } from "../lib/kinds";
import { hasMath } from "../lib/math";
import { cycleThrough, learningPath } from "../lib/paths";
import { activeGraph, isViewing, useGraphStore } from "../store/graphStore";
import { useDerive } from "../store/deriveStore";
import { useQuiz } from "../store/quizStore";
import { useSettings } from "../store/settingsStore";
import { useWalkthrough } from "../store/walkthroughStore";
import { StatusMark } from "../graph/ConceptNode";
import { Icon } from "../ui/Icon";
import { MathText } from "./MathText";

/**
 * A text field edited locally and saved on blur or Enter (Shift+Enter for a newline when multiline);
 * Escape reverts. `save` returns an error message to reject the value, which is shown under the field.
 * `grow`: a one-line field that wraps and grows with its text instead of scrolling sideways (concept names).
 */
function DraftField({ value, save, multiline, grow, className, label, testId }: {
  value: string;
  save: (v: string) => string | undefined;
  multiline?: boolean;
  grow?: boolean;
  className?: string;
  label: string;
  testId?: string;
}) {
  const [draft, setDraft] = useState(value);
  const [error, setError] = useState<string>();
  const readOnly = useGraphStore(isViewing); // a shared graph (its other controls are hidden in styles.css)
  useEffect(() => { setDraft(value); setError(undefined); }, [value]); // e.g. after undo

  const commit = () => {
    const err = draft === value ? undefined : save(draft);
    setError(err);
  };
  const props = {
    value: draft,
    readOnly,
    className: `${className ?? ""}${error ? " invalid" : ""}`,
    "aria-label": label,
    "aria-invalid": !!error,
    "data-testid": testId,
    onChange: (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => setDraft(e.target.value),
    onBlur: commit,
    onKeyDown: (e: React.KeyboardEvent<HTMLInputElement | HTMLTextAreaElement>) => {
      if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); commit(); }
      if (e.key === "Escape") { setDraft(value); setError(undefined); }
    },
  };
  return (
    <span className="draft">
      {multiline || grow ? <textarea rows={grow ? 1 : 3} {...props} /> : <input {...props} />}
      {error && <span className="error small" role="alert">{error}</span>}
    </span>
  );
}

export function Inspector() {
  const t = useT();
  const graph = useGraphStore(activeGraph);
  const inspect = useGraphStore((s) => s.inspect);

  if (inspect?.kind === "node") {
    const node = graph.nodes.find((n) => n.id === inspect.id);
    if (node) return <NodePanel node={node} graph={graph} />;
  }
  if (inspect?.kind === "edge") {
    const rel = graph.relations.find((r) => r.id === inspect.relationId);
    if (rel) return <RelationPanel graph={graph} relationId={rel.id} dir={inspect.dir} />;
  }
  return (
    <aside className="inspector inspector--help">
      <h3>{t("help.title")}</h3>
      <ol className="help">
        {HELP.map((k) => <li key={k}>{rich(k)}</li>)}
      </ol>
    </aside>
  );
}

const HELP: MessageKey[] = ["help.add", "help.deps", "help.path", "help.mix", "help.arrow", "help.sandbox", "help.keys"];

function NodePanel({ node, graph }: { node: ConceptNode; graph: Graph }) {
  const t = useT();
  const mutate = useGraphStore((s) => s.mutate);
  const setInspect = useGraphStore((s) => s.setInspect);
  const setClarifying = useGraphStore((s) => s.setClarifying);
  const viewing = useGraphStore(isViewing);
  const graphId = graph.id;
  const deps = graph.nodes.filter((n) => node.dependsOn.includes(n.id));
  const dependents = graph.nodes.filter((n) => n.dependsOn.includes(node.id));
  const byId = (id: string) => graph.nodes.find((n) => n.id === id);

  return (
    <aside className="inspector" data-testid="node-panel">
      <header className="inspector__header">
      <div className="inspector__title">
        <DraftField
          key={node.id}
          value={node.name}
          label={t("node.rename")}
          className="title-input"
          grow
          save={(v) => {
            const r = renameNode(graph, node.id, v);
            if (!r.error) mutate((g) => renameNode(g, node.id, v).graph);
            return r.error;
          }}
        />
        <span className={`concept__badge concept__badge--${node.status}`}>
          <StatusMark status={node.status} />
          {t(STATUS_LABEL[node.status])}
        </span>
      </div>
      {node.aliases.length > 0 && <div className="muted small">{t("node.aliases", { aliases: node.aliases.join(", ") })}</div>}
      </header>

      <label className="field field--inline">
        {t("kind.label")}
        <select
          value={node.kind ?? ""}
          disabled={viewing}
          data-testid="kind-select"
          // A hand-picked kind is a user edit: an undo step. The AI never overrides it (graphOps.suggestKind).
          onChange={(e) => mutate((g) => setKind(g, node.id, (e.target.value || null) as ConceptKind | null), graphId)}
        >
          <option value="">{t("kind.none")}</option>
          {KINDS.map((k) => <option key={k} value={k}>{t(KIND_LABEL[k])}</option>)}
        </select>
      </label>

      <label className="field">
        {t("node.definition")}
        <textarea
          rows={3}
          value={node.definition}
          data-testid="definition"
          readOnly={viewing}
          // Typing into the field is one undo step.
          onChange={(e) =>
            // Once it's the user's own text, an encyclopedia no longer vouches for it.
            mutate((g) => updateNode(g, node.id, { definition: e.target.value, ...(node.source?.url ? { source: undefined } : {}) }), graphId, { key: `def:${node.id}` })}
        />
      </label>
      <MathPreview text={node.definition} testId="definition-preview" />
      <SourceLine node={node} viewing={viewing} />

      {node.status === "error" && (
        <div className="error-box">
          <p className="error small">{node.error}</p>
          <button onClick={() => analyzeNode(node.id)}><Icon icon={RefreshCw} size={14} />{t("node.retry")}</button>
        </div>
      )}
      {node.status === "unclear" && (
        <div className="error-box error-box--unclear">
          <p className="small">{t("node.unclear", { name: node.name })}</p>
          <button className="primary" onClick={() => setClarifying({ graphId, nodeId: node.id })}>
            {t("node.chooseMeaning")}
          </button>
        </div>
      )}

      <CycleWarning node={node} graph={graph} />

      <section>
        <div className="section-head">
          <h4>{t("node.missing")}</h4>
          {node.missingDeps.length > 0 && <InstallAll key={node.id} node={node} graphId={graphId} />}
        </div>
        {node.status === "checking" && <p className="muted small">{t("node.checking")}</p>}
        {node.status === "ok" && <p className="muted small">{t("node.ready")}</p>}
        <ul className="deps">
          {node.missingDeps.map((d) => (
            <li key={d.name} className="deps__missing">
              <div>
                <strong>{d.name}</strong> <span className="role">{d.role}</span>
                <div className="muted small"><MathText text={d.reason} /></div>
              </div>
              <button className="primary" onClick={() => installDep(node.id, d.name)} data-testid={`install-${d.name}`}>
                {t("common.install")}
              </button>
            </li>
          ))}
        </ul>
      </section>

      <section>
        <h4>{t("node.dependsOn")}</h4>
        {deps.length === 0 ? <p className="muted small">{t("node.nothingYet")}</p> : (
          <ul className="links links--chips">
            {deps.map((d) => <li key={d.id}><button className="link" onClick={() => setInspect({ kind: "node", id: d.id })}>{d.name}</button></li>)}
          </ul>
        )}
        {dependents.length > 0 && (
          <>
            <h4>{t("node.neededBy")}</h4>
            <ul className="links links--chips">
              {dependents.map((d) => <li key={d.id}><button className="link" onClick={() => setInspect({ kind: "node", id: d.id })}>{d.name}</button></li>)}
            </ul>
          </>
        )}
      </section>

      <LearningPath node={node} graph={graph} />

      <section>
        <h4>{t("node.relations")}</h4>
        <ul className="links links--rows">
          {graph.relations.filter((r) => r.a === node.id || r.b === node.id).map((r) => {
            const other = byId(r.a === node.id ? r.b : r.a);
            const dir = r.a === node.id ? "aToB" : "bToA";
            return (
              <li key={r.id}>
                <button className="link rel-link" onClick={() => setInspect({ kind: "edge", relationId: r.id, dir })}>
                  <span className="rel-link__kind">{r[dir].kind}</span>
                  <Icon icon={ArrowRight} size={14} className="rel-link__arrow" />
                  <span className="rel-link__to">{other?.name}</span>
                </button>
              </li>
            );
          })}
        </ul>
      </section>

      {isTheoremLike(node.kind) && <AnatomySection key={`anatomy:${node.id}`} node={node} graphId={graphId} />}

      <ExplainSection key={node.id} node={node} graphId={graphId} />
      <FormalSection node={node} graphId={graphId} viewing={viewing} />

      <label className="field">
        {t("node.notes")}
        <textarea
          rows={3}
          value={node.notes ?? ""}
          placeholder={t("node.notesPlaceholder")}
          data-testid="notes"
          readOnly={viewing}
          // Typing into the field is one undo step; an emptied field removes the notes.
          onChange={(e) =>
            mutate((g) => updateNode(g, node.id, { notes: e.target.value || undefined }), graphId, { key: `notes:${node.id}` })}
        />
      </label>

      <div className="form__actions inspector__footer">
        {!viewing && (
          <button onClick={() => useQuiz.getState().openQuiz(node.id)} data-testid="quiz-node">
            <Icon icon={GraduationCap} size={14} />{t("quiz.fromNode")}
          </button>
        )}
        {!viewing && (
          <button
            onClick={() =>
              void useDerive.getState().openPanel({
                problem: { statement: t("dt.fromNode.statement", { name: node.name, definition: node.definition || node.name }) },
              })}
            title={t("dt.fromNode.title")}
            data-testid="derive-node"
          >
            <Icon icon={PenLine} size={14} />{t("dt.fromNode")}
          </button>
        )}
        <button onClick={() => analyzeNode(node.id)} disabled={node.status === "checking"}>
          <Icon icon={RefreshCw} size={14} />{t("node.recheck")}
        </button>
        <button
          className="danger"
          onClick={() => { mutate((g) => removeNode(g, node.id)); setInspect(null); }}
        >
          <Icon icon={Trash2} size={14} />{t("common.delete")}
        </button>
      </div>
    </aside>
  );
}

// Same wording as the badges on the canvas.
const STATUS_LABEL: Record<ConceptNode["status"], MessageKey> = {
  ok: "state.ok",
  blocked: "state.blocked",
  checking: "state.checking",
  unclear: "state.unclear",
  error: "state.error",
};

const LEVELS: { value: ExplainLevel; label: MessageKey }[] = [
  { value: "intuitive", label: "explain.intuitive" },
  { value: "rigorous", label: "explain.rigorous" },
  { value: "example-driven", label: "explain.exampleDriven" },
];

/** Narrators for "Explain more", in the enum's order ("plain", the default, first). Labels are `explain.voice.<value>`. */
const VOICES: readonly ExplainVoice[] = ExplainVoice.options;
const voiceLabel = (v: ExplainVoice) => `explain.voice.${v}` as MessageKey;

/**
 * "Explain more": a longer AI explanation at a chosen level, optionally told by a parody narrator (the content stays
 * the same), kept on the node until regenerated.
 */
function ExplainSection({ node, graphId }: { node: ConceptNode; graphId: string }) {
  const t = useT();
  const lang = useLang();
  const mutate = useGraphStore((s) => s.mutate);
  const running = useGraphStore((s) => Boolean(s.busy[explainKey(graphId, node.id)]));
  const ex = node.explanation;
  const [level, setLevel] = useState<ExplainLevel>(ex?.level ?? "intuitive");
  const [voice, setVoice] = useState<ExplainVoice>(ex?.voice ?? "plain");
  const [open, setOpen] = useState(true);
  const levelLabel = (l: ExplainLevel) => {
    const key = LEVELS.find((x) => x.value === l)?.label;
    return key ? t(key) : l;
  };
  return (
    <section data-testid="explain">
      <div className="section-head">
        <h4>{t("explain.title")}</h4>
        <div className="explain__controls">
          <button
            className="small-btn"
            onClick={() => void explainNode(node.id, level, graphId, voice)}
            disabled={running}
            data-testid="explain-button"
          >
            {running ? <span className="spinner spinner--xs" aria-hidden="true" /> : <Icon icon={Sparkles} size={14} />}
            {t(running ? "explain.running" : ex ? "explain.regenerate" : "explain.run")}
          </button>
        </div>
      </div>
      <div className="explain__controls explain__options">
        <select aria-label={t("explain.level")} value={level} onChange={(e) => setLevel(e.target.value as ExplainLevel)}>
          {LEVELS.map((l) => <option key={l.value} value={l.value}>{t(l.label)}</option>)}
        </select>
        <select aria-label={t("explain.voice")} title={t("explain.voiceTitle")} value={voice} onChange={(e) => setVoice(e.target.value as ExplainVoice)} data-testid="explain-voice">
          {VOICES.map((v) => <option key={v} value={v}>{t(voiceLabel(v))}</option>)}
        </select>
      </div>
      {!ex && !running && <p className="muted small">{t("explain.empty")}</p>}
      {ex && (
        <details className="explain" open={open} onToggle={(e) => setOpen(e.currentTarget.open)}>
          <summary>
            <Icon icon={ChevronRight} size={14} className="explain__chevron" />
            {t("explain.heading", { level: levelLabel(ex.level) })}{" "}
            {ex.voice && ex.voice !== "plain" && (
              <span className="explain__voice" data-testid="explain-voice-tag">
                <Icon icon={Drama} size={12} />
                {t(voiceLabel(ex.voice))}
              </span>
            )}
            <span className="muted small">· {new Date(ex.createdAt).toLocaleDateString(lang === "zh" ? "zh-CN" : "en")}</span>
          </summary>
          <p className="explain__summary" data-testid="explanation-summary"><MathText text={ex.summary} /></p>
          {ex.intuition && <p className="small"><MathText text={ex.intuition} /></p>}
          {ex.keyPoints.length > 0 && (
            <>
              <h5>{t("explain.keyPoints")}</h5>
              <ul className="explain__list">{ex.keyPoints.map((k, i) => <li key={i}><MathText text={k} /></li>)}</ul>
            </>
          )}
          {ex.examples.length > 0 && (
            <>
              <h5>{t("explain.examples")}</h5>
              <ul className="explain__list">
                {ex.examples.map((x, i) => (
                  <li key={i}><b><MathText text={x.title} inline /></b>{x.body && <> — <MathText text={x.body} /></>}</li>
                ))}
              </ul>
            </>
          )}
          {ex.pitfalls.length > 0 && (
            <>
              <h5>{t("explain.pitfalls")}</h5>
              <ul className="explain__list">{ex.pitfalls.map((p, i) => <li key={i}><MathText text={p} /></li>)}</ul>
            </>
          )}
          {ex.furtherReading.length > 0 && (
            <>
              <h5>{t("explain.reading")}</h5>
              <ul className="explain__list">
                {ex.furtherReading.map((r, i) => (
                  <li key={i}>{r.title}{r.hint && <span className="muted"> — {r.hint}</span>}</li>
                ))}
              </ul>
            </>
          )}
          <div className="form__actions">
            <button
              className="small-btn"
              disabled={node.definition.trim() === ex.summary.trim()}
              // A user decision, so a normal undo step.
              onClick={() => mutate((g) => updateNode(g, node.id, { definition: ex.summary, ...(node.source?.url ? { source: undefined } : {}) }), graphId)}
              data-testid="use-summary"
            >
              <Icon icon={ArrowDown} size={14} />{t("explain.useSummary")}
            </button>
          </div>
        </details>
      )}
    </section>
  );
}

/**
 * "Theorem anatomy" (theorem-like kinds): the AI takes the statement apart into hypotheses (each with why it is
 * needed and a counterexample without it), the conclusion, a proof idea, examples and non-examples. Kept on the node.
 */
function AnatomySection({ node, graphId }: { node: ConceptNode; graphId: string }) {
  const t = useT();
  const lang = useLang();
  const viewing = useGraphStore(isViewing);
  const key = anatomyKey(graphId, node.id);
  const running = useGraphStore((s) => Boolean(s.busy[key]));
  const [open, setOpen] = useState(true);
  const an = node.anatomy;
  if (viewing && !an) return null;
  return (
    <section data-testid="anatomy">
      <div className="section-head">
        <h4>{t("anatomy.title")}</h4>
        {!viewing && (
          <div className="explain__controls">
            {running && (
              <button className="small-btn" onClick={() => cancelTask(key)} data-testid="anatomy-cancel">
                {t("common.cancel")}
              </button>
            )}
            <button className="small-btn" onClick={() => void anatomyNode(node.id, graphId)} disabled={running} data-testid="anatomy-button">
              {running ? <span className="spinner spinner--xs" aria-hidden="true" /> : <Icon icon={ListTree} size={14} />}
              {t(running ? "anatomy.running" : an ? "anatomy.regenerate" : "anatomy.run")}
            </button>
          </div>
        )}
      </div>
      {!an && !running && <p className="muted small">{t("anatomy.empty")}</p>}
      {an && (
        <details className="explain anatomy" open={open} onToggle={(e) => setOpen(e.currentTarget.open)}>
          <summary>
            <Icon icon={ChevronRight} size={14} className="explain__chevron" />
            {t("anatomy.heading")}{" "}
            <span className="muted small">· {new Date(an.createdAt).toLocaleDateString(lang === "zh" ? "zh-CN" : "en")}</span>
          </summary>
          <h5>{t("anatomy.hypotheses")}</h5>
          {an.hypotheses.length === 0 ? (
            <p className="muted small">{t("anatomy.noHypotheses")}</p>
          ) : (
            <ol className="anatomy__hyps" data-testid="anatomy-hypotheses">
              {an.hypotheses.map((h, i) => (
                <li key={i}>
                  <MathText text={h.text} />
                  {h.whyNeeded && (
                    <div className="small"><span className="anatomy__label">{t("anatomy.why")}</span> <MathText text={h.whyNeeded} /></div>
                  )}
                  {h.counterexampleIfDropped && (
                    <div className="small"><span className="anatomy__label">{t("anatomy.without")}</span> <MathText text={h.counterexampleIfDropped} /></div>
                  )}
                </li>
              ))}
            </ol>
          )}
          <h5>{t("anatomy.conclusion")}</h5>
          <p className="explain__summary" data-testid="anatomy-conclusion"><MathText text={an.conclusion} /></p>
          {an.proofIdea && (
            <>
              <h5>{t(node.kind === "conjecture" ? "anatomy.evidence" : "anatomy.proofIdea")}</h5>
              <p className="small"><MathText text={an.proofIdea} /></p>
            </>
          )}
          {an.examples.length > 0 && (
            <>
              <h5>{t("anatomy.examples")}</h5>
              <ul className="explain__list">{an.examples.map((x, i) => <li key={i}><MathText text={x} /></li>)}</ul>
            </>
          )}
          {an.nonExamples.length > 0 && (
            <>
              <h5>{t("anatomy.nonExamples")}</h5>
              <ul className="explain__list">{an.nonExamples.map((x, i) => <li key={i}><MathText text={x} /></li>)}</ul>
            </>
          )}
        </details>
      )}
    </section>
  );
}

/**
 * The typeset version of a text field that contains LaTeX, shown under the field (which stays plain text, so editing
 * is an ordinary textarea). Nothing at all for text without a formula.
 */
function MathPreview({ text, testId }: { text: string; testId: string }) {
  const t = useT();
  if (!hasMath(text)) return null;
  return (
    <div className="math-preview" data-testid={testId}>
      <span className="math-preview__label">{t("math.preview")}</span>
      <MathText text={text} />
    </div>
  );
}

/** "Install all…" with a confirm popover listing what gets installed first. */
function InstallAll({ node, graphId }: { node: ConceptNode; graphId: string }) {
  const t = useT();
  const [open, setOpen] = useState(false);
  const running = useGraphStore((s) => Boolean(s.busy[installAllKey(graphId, node.id)]));
  const { maxDepth, maxNodes } = useSettings((s) => s.installAll);
  return (
    <div className="popover-anchor">
      <button className="small-btn" onClick={() => setOpen(!open)} disabled={running} aria-expanded={open} data-testid="install-all">
        {t(running ? "installAll.running" : "installAll.button")}
      </button>
      {open && !running && (
        <div className="popover" role="dialog" aria-label={t("installAll.dialog")}>
          <p className="small">{t("installAll.intro")}</p>
          <ul className="popover__list">
            {node.missingDeps.map((d) => <li key={d.name}>{d.name}</li>)}
          </ul>
          <p className="muted small">{t("installAll.limits", { depth: maxDepth, nodes: maxNodes })}</p>
          <div className="form__actions">
            <button onClick={() => setOpen(false)}>{t("common.cancel")}</button>
            <button
              className="primary"
              onClick={() => {
                setOpen(false);
                void installAllMissing(node.id, graphId);
              }}
              data-testid="install-all-confirm"
            >
              {t("common.install")}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

/** Warns when this node sits on a dependency cycle and offers to cut one of its links. */
function CycleWarning({ node, graph }: { node: ConceptNode; graph: Graph }) {
  const t = useT();
  const mutate = useGraphStore((s) => s.mutate);
  const cycle = cycleThrough(graph, node.id);
  if (!cycle) return null;
  const name = (id: string) => graph.nodes.find((n) => n.id === id)?.name ?? "?";
  const links = cycle.slice(0, -1).map((from, i) => [from, cycle[i + 1]] as const);
  return (
    <div className="warn-box" data-testid="cycle-warning">
      <p className="small warn-box__head">
        <Icon icon={TriangleAlert} size={16} className="warn-box__icon" />
        <span>{rich("cycle.warning", { chain: cycle.map(name).join(" → ") })}</span>
      </p>
      <button className="small-btn" onClick={() => void resolveCycle(graph.id, cycle)} data-testid="resolve-cycle">
        <Icon icon={Wand2} size={14} />{t("cycle.resolveButton")}
      </button>
      <ul className="links">
        {links.map(([from, to]) => (
          <li key={`${from}>${to}`} className="warn-box__link">
            <span className="small">{t("cycle.needs", { from: name(from), to: name(to) })}</span>
            <button
              className="link small"
              onClick={() => mutate((g) => removeDependency(g, from, to), graph.id)}
              data-testid={`remove-link-${name(from)}-${name(to)}`}
            >
              {t("cycle.remove")}
            </button>
          </li>
        ))}
      </ul>
    </div>
  );
}

/** All transitive prerequisites in study order, with a toggle to highlight the chain on the canvas. */
function LearningPath({ node, graph }: { node: ConceptNode; graph: Graph }) {
  const t = useT();
  const setInspect = useGraphStore((s) => s.setInspect);
  const highlight = useGraphStore((s) => s.highlight);
  const setHighlight = useGraphStore((s) => s.setHighlight);
  const { steps, cyclic } = learningPath(graph, node.id);
  const on = highlight?.graphId === graph.id && highlight.nodeId === node.id;
  if (steps.length <= 1) return null; // no prerequisites at all
  return (
    <section>
      <div className="section-head">
        <h4>{t("path.title")}</h4>
        <button
          className={`small-btn${on ? " small-btn--on" : ""}`}
          aria-pressed={on}
          onClick={() => setHighlight(on ? null : { graphId: graph.id, nodeId: node.id })}
          data-testid="highlight-path"
        >
          <Icon icon={Highlighter} size={14} />{t("path.highlight")}
        </button>
      </div>
      {/* Read-only, so it stays available in the share viewer (unlike the actions at the bottom). */}
      <button className="small-btn path__walk" onClick={() => useWalkthrough.getState().openWalkthrough(node.id)} data-testid="walk-node">
        <Icon icon={Presentation} size={14} />{t("walk.fromNode")}
      </button>
      <ol className="path" data-testid="learning-path">
        {steps.map((s) =>
          s.kind === "missing" ? (
            <li key={`missing:${s.name}`} className="path__step path__step--missing">
              {s.name} <span className="path__tag">{t("path.missing")}</span>
            </li>
          ) : s.id === node.id ? (
            <li key={s.id} className="path__step path__step--target">{s.name}</li>
          ) : (
            <li key={s.id} className="path__step">
              <button className="link" onClick={() => setInspect({ kind: "node", id: s.id })}>{s.name}</button>
            </li>
          ),
        )}
      </ol>
      {cyclic && <p className="warn small">{t("path.cyclic")}</p>}
    </section>
  );
}

const ORIGIN_LABEL: Record<RelationOrigin, MessageKey> = {
  dependency: "rel.dependency",
  mix: "rel.mix",
  derive: "rel.derive",
  extract: "rel.extract",
};

function RelationPanel({ graph, relationId, dir }: { graph: Graph; relationId: string; dir: "aToB" | "bToA" }) {
  const t = useT();
  const mutate = useGraphStore((s) => s.mutate);
  const setInspect = useGraphStore((s) => s.setInspect);
  const busy = useGraphStore((s) => Object.keys(s.busy).some((k) => k.startsWith("mix:")));
  const rel = graph.relations.find((r) => r.id === relationId)!;
  const a = graph.nodes.find((n) => n.id === rel.a);
  const b = graph.nodes.find((n) => n.id === rel.b);
  const [from, to] = dir === "aToB" ? [a, b] : [b, a];
  const d = rel[dir];
  const other = dir === "aToB" ? "bToA" : "aToB";

  return (
    <aside className="inspector" data-testid="relation-panel">
      <div className="inspector__eyebrow">{t(ORIGIN_LABEL[rel.origin])}</div>
      <h3 className="rel-title">
        <span>{from?.name}</span>
        <span className="rel-kind">
          <Icon icon={ArrowDown} size={14} className="rel-kind__arrow" />
          <DraftField
            key={`${relationId}:${dir}`}
            value={d.kind}
            label={t("rel.kind")}
            save={(v) => {
              if (!v.trim()) return t("rel.kindEmpty");
              mutate((g) => updateRelation(g, relationId, dir, { kind: v.trim() }));
              return undefined;
            }}
          />
        </span>
        <span>{to?.name}</span>
      </h3>
      <DraftField
        key={`${relationId}:${dir}`}
        value={d.explanation}
        multiline
        label={t("rel.explanation")}
        className="rel-explanation"
        testId="relation-explanation"
        save={(v) => { mutate((g) => updateRelation(g, relationId, dir, { explanation: v.trim() })); return undefined; }}
      />
      <MathPreview text={d.explanation} testId="relation-preview" />
      <div className="dir-switch">
        <button onClick={() => setInspect({ kind: "edge", relationId, dir: other })}>
          <Icon icon={ArrowLeftRight} size={14} />
          {t("rel.switch", { to: to?.name ?? "?", from: from?.name ?? "?" })}
        </button>
      </div>
      <div className="form__actions">
        {a && b && (
          <button onClick={() => mix(a.id, b.id)} disabled={busy}>
            {busy ? <span className="spinner spinner--xs" aria-hidden="true" /> : <Icon icon={RefreshCw} size={14} />}
            {t(busy ? "rel.analyzing" : "rel.reanalyze")}
          </button>
        )}
        <button className="danger" onClick={() => { mutate((g) => removeRelation(g, relationId)); setInspect(null); }}>
          <Icon icon={Trash2} size={14} />{t("rel.delete")}
        </button>
      </div>
    </aside>
  );
}

/** Where the definition came from (an encyclopedia page, or a page of an imported document); a looked-up one can be redone. */
function SourceLine({ node, viewing }: { node: ConceptNode; viewing: boolean }) {
  const t = useT();
  const graphId = useGraphStore((s) => s.activeId);
  const busy = useGraphStore((s) => Boolean(s.busy[relookupKey(graphId, node.id)]));
  const src = node.source;
  const lookupOn = useSettings((s) => s.lookup.enabled);
  const canLookup = !viewing && lookupOn;
  // Only for a concept with a source: others were defined by the AI or by hand, and the row would cost space.
  if (!src) return null;
  return (
    <div className="source-line small" data-testid="definition-source">
      <span className="muted">
        {t("node.source")}:{" "}
        {src.url ? (
          <a href={src.url} target="_blank" rel="noopener noreferrer">
            {src.site ? t("node.sourceLink", { site: src.site, title: src.title }) : src.title}
            <Icon icon={ExternalLink} size={12} />
          </a>
        ) : (
          sourceLabel(src)
        )}
      </span>
      {canLookup && src.url && (
        <button className="link link--icon" onClick={() => void relookup(node.id)} disabled={busy || node.status === "checking"}>
          <Icon icon={BookOpen} size={12} />
          {t("node.lookupAgain")}
        </button>
      )}
    </div>
  );
}

/**
 * "Lean / Mathlib": the declarations in Lean's Mathlib that formalise this concept. The AI suggests names and each
 * is checked with Loogle, so only real declarations are listed, with their type and a link to the Mathlib docs.
 */
function FormalSection({ node, graphId, viewing }: { node: ConceptNode; graphId: string; viewing: boolean }) {
  const t = useT();
  const running = useGraphStore((s) => Boolean(s.busy[mathlibKey(graphId, node.id)]));
  const f = node.formal;
  if (viewing && !f?.decls.length) return null;
  return (
    <section data-testid="formal">
      <div className="section-head">
        <h4>{t("formal.title")}</h4>
        {!viewing && (
          <button className="small-btn" onClick={() => void findInMathlib(node.id, graphId)} disabled={running} data-testid="formal-button">
            {running ? <span className="spinner spinner--xs" aria-hidden="true" /> : <Icon icon={Search} size={14} />}
            {t(running ? "formal.running" : f ? "formal.again" : "formal.run")}
          </button>
        )}
      </div>
      {!f && !running && <p className="muted small">{t("formal.empty")}</p>}
      {f && (
        <>
          {f.decls.length > 0 && (
            <ul className="formal-list">
              {f.decls.map((d) => (
                <li key={d.name} className="formal-decl">
                  <a href={mathlibDocUrl(d)} target="_blank" rel="noopener noreferrer" className="formal-decl__name">
                    <code>{d.name}</code>
                    <Icon icon={ExternalLink} size={12} />
                  </a>
                  {d.why && <span className="muted small"> {d.why}</span>}
                  <pre className="formal-decl__type">{d.name} :{d.type.startsWith(" ") ? "" : " "}{d.type}</pre>
                  {d.doc && <p className="small formal-decl__doc">{d.doc}</p>}
                  <a className="small formal-decl__try" href={leanEditorUrl(d.name)} target="_blank" rel="noopener noreferrer">
                    {t("formal.tryInLean")}
                    <Icon icon={ExternalLink} size={12} />
                  </a>
                </li>
              ))}
            </ul>
          )}
          <p className="muted small">
            {f.unverified.length > 0 && <>{t("formal.unverified", { names: f.unverified.join(", ") })} </>}
            <a href={loogleSearchUrl(`"${node.name}"`)} target="_blank" rel="noopener noreferrer">
              {t("formal.searchYourself")}
            </a>
          </p>
        </>
      )}
    </section>
  );
}
