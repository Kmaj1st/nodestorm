import { Search } from "lucide-react";
import { useMemo, useState, type KeyboardEvent } from "react";
import { useT } from "../i18n";
import { noteMatch, searchNodes } from "../lib/fuzzy";
import { viewport } from "../lib/viewport";
import { activeGraph, useGraphStore } from "../store/graphStore";
import { useView, visibleNow } from "../store/viewStore";
import { Modal } from "./Modal";
import { Icon } from "../ui/Icon";

/** A one-line excerpt of `text` around [at, at+len), with ellipses where it was cut. */
function snippet(text: string, at: number, len: number, around = 24): string {
  const from = Math.max(0, at - around);
  const to = Math.min(text.length, at + len + around);
  return `${from > 0 ? "…" : ""}${text.slice(from, to).replace(/\s+/g, " ").trim()}${to < text.length ? "…" : ""}`;
}

/** Command-palette style "find concept" (Ctrl/Cmd+K): fuzzy search over names and aliases, then notes. */
export function FindDialog({ onClose }: { onClose: () => void }) {
  const t = useT();
  const graph = useGraphStore(activeGraph);
  const [query, setQuery] = useState("");
  const [active, setActive] = useState(0);
  const hits = useMemo(() => searchNodes(graph.nodes, query), [graph.nodes, query]);

  const pick = (id: string) => {
    onClose();
    // A concept the to-do view hides would be selected but invisible: show everything again first.
    // (In focus mode that's not needed — selecting moves the focus to it.)
    const view = useView.getState();
    if (!visibleNow().nodes.has(id) && view.todoOnly && !view.focus) {
      view.setPrefs({ todoOnly: false });
      useGraphStore.getState().setToast(t("find.revealed"), "info");
    }
    // Let the canvas render the newly visible node before centring on it.
    requestAnimationFrame(() => viewport.focus(id));
  };
  const onKey = (e: KeyboardEvent) => {
    if (e.key === "ArrowDown" || e.key === "ArrowUp") {
      e.preventDefault();
      const step = e.key === "ArrowDown" ? 1 : -1;
      setActive((i) => (hits.length ? (i + step + hits.length) % hits.length : 0));
    } else if (e.key === "Enter" && hits[active]) {
      e.preventDefault();
      pick(hits[active].id);
    }
  };

  return (
    <Modal label={t("find.dialog")} onClose={onClose} className="palette" top>
      <div className="palette__field">
      <Icon icon={Search} className="palette__icon" />
      <input
        autoFocus
        value={query}
        onChange={(e) => { setQuery(e.target.value); setActive(0); }}
        onKeyDown={onKey}
        placeholder={t("find.placeholder")}
        aria-label={t("find.dialog")}
        role="combobox"
        aria-expanded={hits.length > 0}
        aria-controls="palette-results"
      />
      </div>
      {hits.length > 0 ? (
        <ul className="palette__results" id="palette-results" role="listbox">
          {hits.map((n, i) => {
            const q = query.trim().toLowerCase();
            const alias = q && !n.name.toLowerCase().includes(q)
              ? n.aliases.find((a) => a.toLowerCase().includes(q))
              : undefined;
            // Found through the notes only: show the words around the match.
            const at = !alias && !n.name.toLowerCase().includes(q) ? noteMatch(query, n.notes) : -1;
            const note = at >= 0 ? snippet(n.notes!, at, q.length) : undefined;
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
                {alias && <span className="muted small">{t("find.also", { alias })}</span>}
                {note && <span className="muted small">{t("find.note", { note })}</span>}
              </li>
            );
          })}
        </ul>
      ) : (
        <p className="muted small">{t(graph.nodes.length ? "find.none" : "find.empty")}</p>
      )}
    </Modal>
  );
}
