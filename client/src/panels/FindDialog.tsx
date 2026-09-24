import { useMemo, useState, type KeyboardEvent } from "react";
import { searchNodes } from "../lib/fuzzy";
import { viewport } from "../lib/viewport";
import { activeGraph, useGraphStore } from "../store/graphStore";

/** Command-palette style "find concept" (Ctrl/Cmd+K): fuzzy search over names and aliases. */
export function FindDialog({ onClose }: { onClose: () => void }) {
  const graph = useGraphStore(activeGraph);
  const [query, setQuery] = useState("");
  const [active, setActive] = useState(0);
  const hits = useMemo(() => searchNodes(graph.nodes, query), [graph.nodes, query]);

  const pick = (id: string) => {
    onClose();
    viewport.focus(id);
  };
  const onKey = (e: KeyboardEvent) => {
    if (e.key === "ArrowDown" || e.key === "ArrowUp") {
      e.preventDefault();
      const step = e.key === "ArrowDown" ? 1 : -1;
      setActive((i) => (hits.length ? (i + step + hits.length) % hits.length : 0));
    } else if (e.key === "Enter" && hits[active]) {
      e.preventDefault();
      pick(hits[active].id);
    } else if (e.key === "Escape") {
      onClose();
    }
  };

  return (
    <div className="modal modal--top" onClick={onClose}>
      <div className="modal__body palette" onClick={(e) => e.stopPropagation()} role="dialog" aria-label="Find concept">
        <input
          autoFocus
          value={query}
          onChange={(e) => { setQuery(e.target.value); setActive(0); }}
          onKeyDown={onKey}
          placeholder="Find a concept by name or alias…"
          aria-label="Find concept"
          role="combobox"
          aria-expanded={hits.length > 0}
          aria-controls="palette-results"
        />
        {hits.length > 0 ? (
          <ul className="palette__results" id="palette-results" role="listbox">
            {hits.map((n, i) => {
              const alias = query && !n.name.toLowerCase().includes(query.trim().toLowerCase())
                ? n.aliases.find((a) => a.toLowerCase().includes(query.trim().toLowerCase()))
                : undefined;
              return (
                <li
                  key={n.id}
                  role="option"
                  aria-selected={i === active}
                  className={`palette__item${i === active ? " palette__item--on" : ""}`}
                  onMouseEnter={() => setActive(i)}
                  onClick={() => pick(n.id)}
                >
                  <span>{n.name}</span>
                  {alias && <span className="muted small">also: {alias}</span>}
                </li>
              );
            })}
          </ul>
        ) : (
          <p className="muted small">{graph.nodes.length ? "No matching concept." : "This graph is empty."}</p>
        )}
      </div>
    </div>
  );
}
