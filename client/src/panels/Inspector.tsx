import type { ConceptNode, ExplainLevel, Graph } from "@nodestorm/shared";
import { useEffect, useState } from "react";
import { analyzeNode, explainKey, explainNode, installAllKey, installAllMissing, installDep, mix } from "../lib/actions";
import { removeDependency, removeNode, removeRelation, renameNode, updateNode, updateRelation } from "../lib/graphOps";
import { cycleThrough, learningPath } from "../lib/paths";
import { activeGraph, isViewing, useGraphStore } from "../store/graphStore";
import { useSettings } from "../store/settingsStore";

/**
 * A text field edited locally and saved on blur or Enter (Shift+Enter for a newline when multiline);
 * Escape reverts. `save` returns an error message to reject the value, which is shown under the field.
 */
function DraftField({ value, save, multiline, className, label, testId }: {
  value: string;
  save: (v: string) => string | undefined;
  multiline?: boolean;
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
      {multiline ? <textarea rows={3} {...props} /> : <input {...props} />}
      {error && <span className="error small" role="alert">{error}</span>}
    </span>
  );
}

export function Inspector() {
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
    <aside className="inspector">
      <h3>How to use</h3>
      <ol className="help">
        <li><b>Add</b> a concept by name, or describe it and let the AI name it.</li>
        <li>The AI checks each concept's <b>prerequisites</b>. Missing ones block the concept until you <b>install</b> them — or <b>Install all</b> to follow the whole chain.</li>
        <li>A concept's <b>learning path</b> lists everything it builds on in study order.</li>
        <li>Select two concepts (Shift/Ctrl-click) and press <b>Mix</b> to find how they relate — in both directions.</li>
        <li>Click an <b>arrowhead</b> on a relation to read what that side does to the other.</li>
        <li><b>Fork sandbox</b> to derive new ideas in a copy; merge back or discard later.</li>
        <li><b>Delete</b> removes the selection; <b>Ctrl+Z</b> / <b>Ctrl+Shift+Z</b> undo and redo.</li>
      </ol>
    </aside>
  );
}

function NodePanel({ node, graph }: { node: ConceptNode; graph: Graph }) {
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
      <div className="inspector__title">
        <DraftField
          key={node.id}
          value={node.name}
          label="Rename concept"
          className="title-input"
          save={(v) => {
            const r = renameNode(graph, node.id, v);
            if (!r.error) mutate((g) => renameNode(g, node.id, v).graph);
            return r.error;
          }}
        />
        <span className={`concept__badge concept__badge--${node.status}`}>{node.status}</span>
      </div>
      {node.aliases.length > 0 && <div className="muted small">also: {node.aliases.join(", ")}</div>}

      <label className="field">
        Definition
        <textarea
          rows={3}
          value={node.definition}
          data-testid="definition"
          readOnly={viewing}
          // Typing into the field is one undo step.
          onChange={(e) =>
            mutate((g) => updateNode(g, node.id, { definition: e.target.value }), graphId, { key: `def:${node.id}` })}
        />
      </label>

      {node.status === "error" && (
        <div className="error-box">
          <p className="error small">{node.error}</p>
          <button onClick={() => analyzeNode(node.id)}>Retry</button>
        </div>
      )}
      {node.status === "unclear" && (
        <div className="error-box error-box--unclear">
          <p className="small">“{node.name}” has several meanings.</p>
          <button className="primary" onClick={() => setClarifying({ graphId, nodeId: node.id })}>
            Choose meaning…
          </button>
        </div>
      )}

      <CycleWarning node={node} graph={graph} />

      <ExplainSection key={node.id} node={node} graphId={graphId} />

      <label className="field">
        My notes
        <textarea
          rows={3}
          value={node.notes ?? ""}
          placeholder="Your own notes: questions, examples, where you read about it…"
          data-testid="notes"
          readOnly={viewing}
          // Typing into the field is one undo step; an emptied field removes the notes.
          onChange={(e) =>
            mutate((g) => updateNode(g, node.id, { notes: e.target.value || undefined }), graphId, { key: `notes:${node.id}` })}
        />
      </label>

      <section>
        <div className="section-head">
          <h4>Missing dependencies</h4>
          {node.missingDeps.length > 0 && <InstallAll key={node.id} node={node} graphId={graphId} />}
        </div>
        {node.status === "checking" && <p className="muted small">Checking prerequisites…</p>}
        {node.status === "ok" && <p className="muted small">None — this concept is ready.</p>}
        <ul className="deps">
          {node.missingDeps.map((d) => (
            <li key={d.name} className="deps__missing">
              <div>
                <strong>{d.name}</strong> <span className="role">{d.role}</span>
                <div className="muted small">{d.reason}</div>
              </div>
              <button className="primary" onClick={() => installDep(node.id, d.name)} data-testid={`install-${d.name}`}>
                Install
              </button>
            </li>
          ))}
        </ul>
      </section>

      <section>
        <h4>Depends on</h4>
        {deps.length === 0 ? <p className="muted small">Nothing yet.</p> : (
          <ul className="links">
            {deps.map((d) => <li key={d.id}><button className="link" onClick={() => setInspect({ kind: "node", id: d.id })}>{d.name}</button></li>)}
          </ul>
        )}
        {dependents.length > 0 && (
          <>
            <h4>Needed by</h4>
            <ul className="links">
              {dependents.map((d) => <li key={d.id}><button className="link" onClick={() => setInspect({ kind: "node", id: d.id })}>{d.name}</button></li>)}
            </ul>
          </>
        )}
      </section>

      <LearningPath node={node} graph={graph} />

      <section>
        <h4>Relations</h4>
        <ul className="links">
          {graph.relations.filter((r) => r.a === node.id || r.b === node.id).map((r) => {
            const other = byId(r.a === node.id ? r.b : r.a);
            const dir = r.a === node.id ? "aToB" : "bToA";
            return (
              <li key={r.id}>
                <button className="link" onClick={() => setInspect({ kind: "edge", relationId: r.id, dir })}>
                  {r[dir].kind} → {other?.name}
                </button>
              </li>
            );
          })}
        </ul>
      </section>

      <div className="form__actions">
        <button onClick={() => analyzeNode(node.id)} disabled={node.status === "checking"}>
          Re-check dependencies
        </button>
        <button
          className="danger"
          onClick={() => { mutate((g) => removeNode(g, node.id)); setInspect(null); }}
        >
          Delete
        </button>
      </div>
    </aside>
  );
}

const LEVELS: { value: ExplainLevel; label: string }[] = [
  { value: "intuitive", label: "Intuitive" },
  { value: "rigorous", label: "Rigorous" },
  { value: "example-driven", label: "Example-driven" },
];

/** "Explain more": a longer AI explanation at a chosen level, kept on the node until regenerated. */
function ExplainSection({ node, graphId }: { node: ConceptNode; graphId: string }) {
  const mutate = useGraphStore((s) => s.mutate);
  const running = useGraphStore((s) => Boolean(s.busy[explainKey(graphId, node.id)]));
  const ex = node.explanation;
  const [level, setLevel] = useState<ExplainLevel>(ex?.level ?? "intuitive");
  const [open, setOpen] = useState(true);
  const levelLabel = (l: ExplainLevel) => LEVELS.find((x) => x.value === l)?.label ?? l;
  return (
    <section data-testid="explain">
      <div className="section-head">
        <h4>Explain more</h4>
        <div className="explain__controls">
          <select aria-label="Explanation level" value={level} onChange={(e) => setLevel(e.target.value as ExplainLevel)}>
            {LEVELS.map((l) => <option key={l.value} value={l.value}>{l.label}</option>)}
          </select>
          <button
            className="small-btn"
            onClick={() => void explainNode(node.id, level, graphId)}
            disabled={running}
            data-testid="explain-button"
          >
            {running ? "Explaining…" : ex ? "Regenerate" : "Explain"}
          </button>
        </div>
      </div>
      {!ex && !running && <p className="muted small">A longer explanation with examples and common pitfalls.</p>}
      {ex && (
        <details className="explain" open={open} onToggle={(e) => setOpen(e.currentTarget.open)}>
          <summary>
            {levelLabel(ex.level)} explanation{" "}
            <span className="muted small">· {new Date(ex.createdAt).toLocaleDateString()}</span>
          </summary>
          <p className="explain__summary" data-testid="explanation-summary">{ex.summary}</p>
          {ex.intuition && <p className="small">{ex.intuition}</p>}
          {ex.keyPoints.length > 0 && (
            <>
              <h5>Key points</h5>
              <ul className="explain__list">{ex.keyPoints.map((k, i) => <li key={i}>{k}</li>)}</ul>
            </>
          )}
          {ex.examples.length > 0 && (
            <>
              <h5>Examples</h5>
              <ul className="explain__list">
                {ex.examples.map((x, i) => <li key={i}><b>{x.title}</b>{x.body && <> — {x.body}</>}</li>)}
              </ul>
            </>
          )}
          {ex.pitfalls.length > 0 && (
            <>
              <h5>Pitfalls</h5>
              <ul className="explain__list">{ex.pitfalls.map((p, i) => <li key={i}>{p}</li>)}</ul>
            </>
          )}
          {ex.furtherReading.length > 0 && (
            <>
              <h5>Further reading</h5>
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
              onClick={() => mutate((g) => updateNode(g, node.id, { definition: ex.summary }), graphId)}
              data-testid="use-summary"
            >
              Use summary as definition
            </button>
          </div>
        </details>
      )}
    </section>
  );
}

/** "Install all…" with a confirm popover listing what gets installed first. */
function InstallAll({ node, graphId }: { node: ConceptNode; graphId: string }) {
  const [open, setOpen] = useState(false);
  const running = useGraphStore((s) => Boolean(s.busy[installAllKey(graphId, node.id)]));
  const { maxDepth, maxNodes } = useSettings((s) => s.installAll);
  return (
    <div className="popover-anchor">
      <button className="small-btn" onClick={() => setOpen(!open)} disabled={running} aria-expanded={open} data-testid="install-all">
        {running ? "Installing…" : "Install all…"}
      </button>
      {open && !running && (
        <div className="popover" role="dialog" aria-label="Install all missing">
          <p className="small">Install these, then their own missing prerequisites:</p>
          <ul className="popover__list">
            {node.missingDeps.map((d) => <li key={d.name}>{d.name}</li>)}
          </ul>
          <p className="muted small">
            Up to {maxDepth} level{maxDepth === 1 ? "" : "s"} deep and {maxNodes} new concepts (change in Settings).
          </p>
          <div className="form__actions">
            <button onClick={() => setOpen(false)}>Cancel</button>
            <button
              className="primary"
              onClick={() => {
                setOpen(false);
                void installAllMissing(node.id, graphId);
              }}
              data-testid="install-all-confirm"
            >
              Install
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

/** Warns when this node sits on a dependency cycle and offers to cut one of its links. */
function CycleWarning({ node, graph }: { node: ConceptNode; graph: Graph }) {
  const mutate = useGraphStore((s) => s.mutate);
  const cycle = cycleThrough(graph, node.id);
  if (!cycle) return null;
  const name = (id: string) => graph.nodes.find((n) => n.id === id)?.name ?? "?";
  const links = cycle.slice(0, -1).map((from, i) => [from, cycle[i + 1]] as const);
  return (
    <div className="warn-box" data-testid="cycle-warning">
      <p className="small">
        <b>⚠ Dependency cycle:</b> {cycle.map(name).join(" → ")}. A concept can't be its own prerequisite, so one of
        these links is probably a wrong AI answer.
      </p>
      <ul className="links">
        {links.map(([from, to]) => (
          <li key={`${from}>${to}`} className="warn-box__link">
            <span className="small">{name(from)} needs {name(to)}</span>
            <button
              className="link small"
              onClick={() => mutate((g) => removeDependency(g, from, to), graph.id)}
              data-testid={`remove-link-${name(from)}-${name(to)}`}
            >
              Remove this link
            </button>
          </li>
        ))}
      </ul>
    </div>
  );
}

/** All transitive prerequisites in study order, with a toggle to highlight the chain on the canvas. */
function LearningPath({ node, graph }: { node: ConceptNode; graph: Graph }) {
  const setInspect = useGraphStore((s) => s.setInspect);
  const highlight = useGraphStore((s) => s.highlight);
  const setHighlight = useGraphStore((s) => s.setHighlight);
  const { steps, cyclic } = learningPath(graph, node.id);
  const on = highlight?.graphId === graph.id && highlight.nodeId === node.id;
  if (steps.length <= 1) return null; // no prerequisites at all
  return (
    <section>
      <div className="section-head">
        <h4>Learning path</h4>
        <button
          className={`small-btn${on ? " small-btn--on" : ""}`}
          aria-pressed={on}
          onClick={() => setHighlight(on ? null : { graphId: graph.id, nodeId: node.id })}
          data-testid="highlight-path"
        >
          Highlight
        </button>
      </div>
      <ol className="path" data-testid="learning-path">
        {steps.map((s) =>
          s.kind === "missing" ? (
            <li key={`missing:${s.name}`} className="path__step path__step--missing">
              {s.name} <span className="path__tag">missing</span>
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
      {cyclic && <p className="warn small">The prerequisites contain a cycle, so this order is only approximate.</p>}
    </section>
  );
}

function RelationPanel({ graph, relationId, dir }: { graph: Graph; relationId: string; dir: "aToB" | "bToA" }) {
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
      <div className="muted small">{rel.origin === "dependency" ? "Dependency link" : rel.origin === "derive" ? "Derived link" : "Mixed relation"}</div>
      <h3 className="rel-title">
        <span>{from?.name}</span>
        <span className="rel-kind">
          <DraftField
            key={`${relationId}:${dir}`}
            value={d.kind}
            label="Relation kind"
            save={(v) => {
              if (!v.trim()) return "Say what it does (or “none”).";
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
        label="Relation explanation"
        className="rel-explanation"
        testId="relation-explanation"
        save={(v) => { mutate((g) => updateRelation(g, relationId, dir, { explanation: v.trim() })); return undefined; }}
      />
      <div className="dir-switch">
        <button onClick={() => setInspect({ kind: "edge", relationId, dir: other })}>
          ⇄ Show what {to?.name} does to {from?.name}
        </button>
      </div>
      <div className="form__actions">
        {a && b && (
          <button onClick={() => mix(a.id, b.id)} disabled={busy}>{busy ? "Analyzing…" : "Re-analyze with AI"}</button>
        )}
        <button className="danger" onClick={() => { mutate((g) => removeRelation(g, relationId)); setInspect(null); }}>
          Delete relation
        </button>
      </div>
    </aside>
  );
}
