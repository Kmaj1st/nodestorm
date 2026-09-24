import type { ConceptNode, Graph } from "@nodestorm/shared";
import { useEffect, useState } from "react";
import { analyzeNode, installDep, mix } from "../lib/actions";
import { removeNode, removeRelation, renameNode, updateNode, updateRelation } from "../lib/graphOps";
import { activeGraph, useGraphStore } from "../store/graphStore";

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
  useEffect(() => { setDraft(value); setError(undefined); }, [value]); // e.g. after undo

  const commit = () => {
    const err = draft === value ? undefined : save(draft);
    setError(err);
  };
  const props = {
    value: draft,
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
        <li>The AI checks each concept's <b>prerequisites</b>. Missing ones block the concept until you <b>install</b> them.</li>
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

      <section>
        <h4>Missing dependencies</h4>
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
